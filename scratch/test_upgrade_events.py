import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

# Check admin user
stdin, stdout, stderr = ssh.exec_command("grep -E '^ADMIN_' /home/ubuntu/laujim-app/.env")
admin_env = stdout.read().decode().strip()
print("Admin env config:")
lines = admin_env.split("\n")
user = ""
pwd = ""
for line in lines:
    if line.startswith("ADMIN_USERNAME="):
        user = line.split("=", 1)[1].strip().strip('"').strip("'")
    if line.startswith("ADMIN_PASSWORD="):
        pwd = line.split("=", 1)[1].strip().strip('"').strip("'")

print(f"Admin username: {user}")

# Login via curl on VM to get valid admin token
login_cmd = f"curl -s -X POST http://127.0.0.1:10000/api/login -H 'Content-Type: application/json' -d '{{\"username\":\"{user}\",\"password\":\"{pwd}\"}}'"
stdin, stdout, stderr = ssh.exec_command(login_cmd)
login_res = stdout.read().decode()
print("Login result:\n", login_res)

import json
token = ""
try:
    token = json.loads(login_res).get("token", "")
except:
    pass

if token:
    print(f"Token obtenido: {token[:10]}...")
    # Fetch events
    events_cmd = f"curl -s http://127.0.0.1:10000/api/notifications/events -H 'x-auth-token: {token}'"
    stdin, stdout, stderr = ssh.exec_command(events_cmd)
    events_res = stdout.read().decode()
    print("Events response:\n", json.dumps(json.loads(events_res), indent=2))
else:
    print("No token obtained")

ssh.close()
