import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

cmd = """docker exec laujim-video python3 -c '
import time, os, cv2
from ezviz_stream_server import capture_snapshot, scan_plates_ml

t0 = time.time()
print("1. Testing capture_snapshot(l)...")
s = capture_snapshot("l")
print("Snapshot l:", s, "in", round(time.time() - t0, 2), "s")

t1 = time.time()
print("2. Testing scan_plates_ml on l...")
img = cv2.imread(s)
print("Image loaded shape:", img.shape)
res = scan_plates_ml(img, "l")
print("ML results:", res, "in", round(time.time() - t1, 2), "s")
'"""

stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
