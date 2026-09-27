import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

script = """
import fast_plate_ocr
import open_image_models
print("fast_plate_ocr dir:", dir(fast_plate_ocr))
print("open_image_models dir:", dir(open_image_models))
"""

stdin, stdout, stderr = ssh.exec_command(f"docker exec laujim-video python3 -c '{script}'")
print(stdout.read().decode("utf-8", errors="replace"))
ssh.close()
