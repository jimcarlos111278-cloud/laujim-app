import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

script = """
import time, json
from ezviz_stream_server import trigger_alpr_scan

t0 = time.time()
print('Starting trigger_alpr_scan...')
res = trigger_alpr_scan(mode='compare', cam='all')
print('Finished in', round(time.time() - t0, 2), 's')
print(json.dumps(res, indent=2))
"""

sftp = ssh.open_sftp()
with sftp.open("/home/ubuntu/laujim-app/test_run_func.py", "w") as f:
    f.write(script)
sftp.close()

stdin, stdout, stderr = ssh.exec_command("docker cp /home/ubuntu/laujim-app/test_run_func.py laujim-video:/app/ && docker exec laujim-video python3 /app/test_run_func.py")
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
