import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

print("=== 1. Scraper Air-e Logs ===")
stdin, stdout, stderr = ssh.exec_command("docker logs --tail 200 laujim-app 2>&1 | grep -i -E 'air-e|scraper' | tail -n 30")
print(stdout.read().decode('utf-8', errors='ignore'))

print("\n=== 2. Video Container & Logs ===")
stdin, stdout, stderr = ssh.exec_command("docker ps --filter 'name=laujim-video'")
print(stdout.read().decode('utf-8', errors='ignore'))

stdin, stdout, stderr = ssh.exec_command("docker logs --tail 40 laujim-video 2>&1")
print(stdout.read().decode('utf-8', errors='ignore'))

print("\n=== 3. Video Port / Stream Test ===")
stdin, stdout, stderr = ssh.exec_command("curl -s http://127.0.0.1:8000/cameras | head -n 30")
print(stdout.read().decode('utf-8', errors='ignore'))

ssh.close()
