import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

script = """
import os
import cv2
from fast_alpr import ALPR

alpr = ALPR(detector_model='yolo-v9-t-384-license-plate-end2end', detector_conf_thresh=0.20)

for cam_id in ['l', 'r']:
    snap_path = f'/app/hls/{cam_id}/snapshot.jpg'
    if not os.path.exists(snap_path):
        continue
    img = cv2.imread(snap_path)
    if img is None:
        continue
    h, w = img.shape[:2]
    print(f'=== Testing Cam {cam_id} ({w}x{h}) ===')
    
    # 1. Full image
    res_full = alpr.predict(img)
    print(f'Full image: {len(res_full)} plate(s)')
    for r in res_full:
        t = r.ocr.text if r.ocr else '?'
        print(f'  [Full] {t} box={r.detection.bounding_box}')

    # 2. Road ROI (y: 35% to 100%)
    roi_y1 = int(h * 0.35)
    roi_img = img[roi_y1:h, 0:w]
    res_roi = alpr.predict(roi_img)
    print(f'Road ROI (y={roi_y1}..{h}): {len(res_roi)} plate(s)')
    for r in res_roi:
        t = r.ocr.text if r.ocr else '?'
        # adjust y back to full image coords
        bb = r.detection.bounding_box
        print(f'  [ROI] {t} box=({bb.x1}, {bb.y1 + roi_y1}, {bb.x2}, {bb.y2 + roi_y1})')

    # 3. Two Road Tiles (Left half of road, Right half of road)
    mid_x = w // 2
    tile_left = img[roi_y1:h, 0:mid_x + int(w*0.1)]
    tile_right = img[roi_y1:h, mid_x - int(w*0.1):w]
    
    res_tl = alpr.predict(tile_left)
    res_tr = alpr.predict(tile_right)
    print(f'Tile Left: {len(res_tl)} plate(s), Tile Right: {len(res_tr)} plate(s)')
    for r in res_tl:
        t = r.ocr.text if r.ocr else '?'
        bb = r.detection.bounding_box
        print(f'  [Tile-L] {t} box=({bb.x1}, {bb.y1 + roi_y1}, {bb.x2}, {bb.y2 + roi_y1})')
    for r in res_tr:
        t = r.ocr.text if r.ocr else '?'
        bb = r.detection.bounding_box
        x_off = mid_x - int(w*0.1)
        print(f'  [Tile-R] {t} box=({bb.x1 + x_off}, {bb.y1 + roi_y1}, {bb.x2 + x_off}, {bb.y2 + roi_y1})')
"""

sftp = ssh.open_sftp()
with sftp.open("/home/ubuntu/laujim-app/test_roi.py", "w") as f:
    f.write(script)
sftp.close()

stdin, stdout, stderr = ssh.exec_command("docker cp /home/ubuntu/laujim-app/test_roi.py laujim-video:/app/ && docker exec laujim-video python3 /app/test_roi.py")
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
