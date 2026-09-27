import os
import re
import time
import requests
import cv2
import numpy as np

# Test if fast_alpr is available
from fast_alpr import ALPR

print("Testing ALPR initialization...")
alpr = ALPR(
    detector_model="yolo-v9-t-384-license-plate-end2end",
    detector_conf_thresh=0.20
)
print("ALPR initialized successfully!")

def disambiguate_colombian_plate(raw_text: str):
    text = re.sub(r'[^A-Z0-9]', '', raw_text.upper())
    if not text:
        return None
    l_map = {'0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z', '4': 'A', '6': 'G', 'Q': 'O'}
    d_map = {'O': '0', 'I': '1', 'B': '8', 'S': '5', 'Z': '2', 'A': '4', 'G': '6', 'D': '0', 'L': '1'}
    if len(text) == 6:
        letters = "".join([l_map.get(c, c) for c in text[:3]])
        digits = "".join([d_map.get(c, c) for c in text[3:6]])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{3}$', digits):
            return f"{letters}-{digits}", "Automóvil / Camión"
    for i in range(len(text) - 5):
        chunk = text[i:i+6]
        letters = "".join([l_map.get(c, c) for c in chunk[:3]])
        digits = "".join([d_map.get(c, c) for c in chunk[3:6]])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{3}$', digits):
            return f"{letters}-{digits}", "Automóvil / Camión"
        moto_d = "".join([d_map.get(c, c) for c in chunk[3:5]])
        moto_l = l_map.get(chunk[5], chunk[5])
        if re.match(r'^[A-Z]{3}$', letters) and re.match(r'^[0-9]{2}$', moto_d) and re.match(r'^[A-Z]$', moto_l):
            return f"{letters}-{moto_d}{moto_l}", "Motocicleta"
    return None

def scan_plates_ml(img):
    h, w = img.shape[:2]
    roi_y1 = int(h * 0.35)
    mid_x = w // 2
    overlap = int(w * 0.12)
    
    crops = [
        (img[roi_y1:h, 0:w], 0, roi_y1, "Road ROI"),
        (img[roi_y1:h, 0:mid_x + overlap], 0, roi_y1, "Left Tile"),
        (img[roi_y1:h, mid_x - overlap:w], mid_x - overlap, roi_y1, "Right Tile"),
    ]
    
    found = []
    seen_boxes = []
    
    for crop_img, off_x, off_y, label in crops:
        res = alpr.predict(crop_img)
        for r in res:
            raw_text = r.ocr.text if r.ocr else ""
            char_confs = r.ocr.confidence if r.ocr and r.ocr.confidence else [0.5]
            avg_conf = round(float(sum(char_confs) / len(char_confs)), 3)
            det_conf = round(float(r.detection.confidence), 3)
            
            bb = r.detection.bounding_box
            gx1 = bb.x1 + off_x
            gy1 = bb.y1 + off_y
            gx2 = bb.x2 + off_x
            gy2 = bb.y2 + off_y
            
            # Deduplicate by spatial overlap
            cx = (gx1 + gx2) / 2.0
            cy = (gy1 + gy2) / 2.0
            is_dup = False
            for scx, scy, splate in seen_boxes:
                if abs(cx - scx) < 50 and abs(cy - scy) < 50:
                    is_dup = True
                    break
            if is_dup:
                continue
                
            formatted = disambiguate_colombian_plate(raw_text)
            plate_str = formatted[0] if formatted else raw_text.strip().upper()
            vtype = formatted[1] if formatted else "Vehículo"
            
            if len(plate_str) >= 4:
                seen_boxes.append((cx, cy, plate_str))
                found.append({
                    "plate": plate_str,
                    "raw_text": raw_text,
                    "type": vtype,
                    "confidence": avg_conf,
                    "detector_confidence": det_conf,
                    "box": {"x1": int(gx1), "y1": int(gy1), "x2": int(gx2), "y2": int(gy2)},
                    "box_norm": {
                        "xmin": round(gx1 / w, 4),
                        "ymin": round(gy1 / h, 4),
                        "xmax": round(gx2 / w, 4),
                        "ymax": round(gy2 / h, 4)
                    },
                    "engine": "local_ml"
                })
    return found

# Test on Cam l and Cam r
for cam in ["l", "r"]:
    p = f"/app/hls/{cam}/snapshot.jpg"
    if os.path.exists(p):
        t0 = time.time()
        img = cv2.imread(p)
        res = scan_plates_ml(img)
        dt = round((time.time() - t0) * 1000, 1)
        print(f"Cam {cam} scan completed in {dt}ms: {len(res)} plates:")
        for r in res:
            print(f"  -> {r['plate']} ({r['type']}) conf={r['confidence']} box={r['box']}")
