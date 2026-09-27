import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

test_script = """
import requests
import json
import time

t0 = time.time()
try:
    print("Sending POST request to /alpr/scan?mode=ml&cam=l...")
    res = requests.post("http://127.0.0.1:8080/alpr/scan?mode=ml&cam=l", timeout=10)
    print("Status:", res.status_code)
    print("Response in", round(time.time() - t0, 2), "s:")
    print(json.dumps(res.json(), indent=2))
except Exception as e:
    print("Error:", e)
"""

sftp = ssh.open_sftp()
with sftp.open("/home/ubuntu/laujim-app/test_scan_direct.py", "w") as f:
    f.write(test_script)
sftp.close()

stdin, stdout, stderr = ssh.exec_command("python3 /home/ubuntu/laujim-app/test_scan_direct.py")
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
