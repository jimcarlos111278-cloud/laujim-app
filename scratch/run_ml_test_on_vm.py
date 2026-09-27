import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

sftp = ssh.open_sftp()
sftp.put(r"c:\Proyecto Edificio Laujim APP\Proyecto Laujim APP fix\scratch\test_ml_pipeline.py", "/home/ubuntu/laujim-app/test_ml_pipeline.py")
sftp.close()

stdin, stdout, stderr = ssh.exec_command("docker cp /home/ubuntu/laujim-app/test_ml_pipeline.py laujim-video:/app/ && docker exec laujim-video python3 /app/test_ml_pipeline.py")
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
