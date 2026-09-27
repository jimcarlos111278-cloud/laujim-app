import paramiko
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim")

# Check admin user
stdin, stdout, stderr = ssh.exec_command("grep -E '^ADMIN_' /home/ubuntu/laujim-app/.env")
admin_env = stdout.read().decode().strip()
lines = admin_env.split("\n")
user = ""
pwd = ""
for line in lines:
    if line.startswith("ADMIN_USERNAME="):
        user = line.split("=", 1)[1].strip().strip('"').strip("'")
    if line.startswith("ADMIN_PASSWORD="):
        pwd = line.split("=", 1)[1].strip().strip('"').strip("'")

# Login via curl on VM to get valid admin token
login_cmd = f"curl -s -X POST http://127.0.0.1:10000/api/login -H 'Content-Type: application/json' -d '{{\"username\":\"{user}\",\"password\":\"{pwd}\"}}'"
stdin, stdout, stderr = ssh.exec_command(login_cmd)
login_res = stdout.read().decode()
token = json.loads(login_res).get("token", "")

print("Token obtenido con éxito.")

# 1. Trigger broadcast-upgrade with 1.0.126
bcast_cmd = f"curl -s -X POST http://127.0.0.1:10000/api/admin/broadcast-upgrade -H 'Content-Type: application/json' -H 'x-auth-token: {token}' -d '{{\"version\":\"1.0.126\"}}'"
stdin, stdout, stderr = ssh.exec_command(bcast_cmd)
bcast_res = stdout.read().decode()
print("Broadcast result:\n", bcast_res)

# 2. Fetch events to confirm upgrade item
events_cmd = f"curl -s http://127.0.0.1:10000/api/notifications/events -H 'x-auth-token: {token}'"
stdin, stdout, stderr = ssh.exec_command(events_cmd)
events_res = stdout.read().decode()
events = json.loads(events_res).get("items", [])
upgrades = [e for e in events if e.get("category") == "upgrade"]
print("\nUpgrades encontrados en /api/notifications/events:")
print(json.dumps(upgrades, indent=2))

ssh.close()
