import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('149.130.160.116', username='ubuntu', key_filename=r'C:\Users\jimca\.ssh\id_ed25519_laujim')

sftp = ssh.open_sftp()
test_py = '''import os
import cv2
import json
from fast_alpr import ALPR

alpr = ALPR(
    detector_model='yolo-v9-t-384-license-plate-end2end',
    ocr_model='global-plates-mobile-vit-v2-model'
)

for cam_id in ['l', 'r']:
    snap_path = f'/app/hls/{cam_id}/snapshot.jpg'
    if not os.path.exists(snap_path):
        continue
    img = cv2.imread(snap_path)
    if img is None:
        continue
    detections = alpr.predict(img)
    print(f'=== Cam {cam_id}: {len(detections)} plate(s) detected ===')
    for i, det in enumerate(detections):
        print(f'Det {i}: text={det.ocr.text if det.ocr else None}, det_conf={det.detection.confidence}, bb={det.detection.bounding_box}')
        if det.ocr:
            print(f'  OCR conf list: {det.ocr.confidence}')
'''

with sftp.open('/home/ubuntu/laujim-app/test_alpr.py', 'w') as f:
    f.write(test_py)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('docker cp /home/ubuntu/laujim-app/test_alpr.py laujim-video:/app/ && docker exec laujim-video python3 /app/test_alpr.py')
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))
ssh.close()
