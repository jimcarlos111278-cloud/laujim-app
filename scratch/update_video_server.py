import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

sftp = ssh.open_sftp()
sftp.put(r"c:\Proyecto Edificio Laujim APP\Proyecto Laujim APP fix\deploy-oracle-vm\ezviz_stream_server.py", "/home/ubuntu/laujim-app/ezviz_stream_server.py")
sftp.close()

cmd = """
docker cp /home/ubuntu/laujim-app/ezviz_stream_server.py laujim-video:/app/ezviz_stream_server.py
docker restart laujim-video
"""
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))
ssh.close()
print("ezviz_stream_server.py updated and laujim-video restarted!")
