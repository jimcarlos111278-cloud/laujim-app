import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

cmd = "curl -s -X POST 'http://127.0.0.1:8080/alpr/scan?mode=compare&cam=all'"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode("utf-8", errors="replace")
err = stderr.read().decode("utf-8", errors="replace")
print("OUTPUT:\n", out)
if err:
    print("ERR:\n", err)
ssh.close()
