import os
import tarfile
import paramiko

project_dir = r"c:\Proyecto Edificio Laujim APP\Proyecto Laujim APP fix"
tar_path = os.path.join(project_dir, "dist_update.tar.gz")

print("--- Paso 1: Empaquetando dist (sin apks pesados) y server.cjs ---")
with tarfile.open(tar_path, "w:gz") as tar:
    def filter_releases(tarinfo):
        if "releases" in tarinfo.name:
            return None
        return tarinfo
    tar.add(os.path.join(project_dir, "dist"), arcname="dist", filter=filter_releases)
    tar.add(os.path.join(project_dir, "server.cjs"), arcname="server.cjs")
    tar.add(os.path.join(project_dir, "services-scraper.cjs"), arcname="services-scraper.cjs")
    tar.add(os.path.join(project_dir, "deploy-oracle-vm", "ezviz_stream_server.py"), arcname="ezviz_stream_server.py")

tar_size_mb = os.path.getsize(tar_path) / (1024 * 1024)
print(f"dist_update.tar.gz creado: {tar_size_mb:.2f} MB")

print("\n--- Paso 2: Conectando a Oracle VM (149.130.160.116) ---")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("149.130.160.116", username="ubuntu", key_filename=r"C:\Users\jimca\.ssh\id_ed25519_laujim", timeout=20)

print("\n--- Paso 3: Subiendo tarball ---")
sftp = ssh.open_sftp()
sftp.put(tar_path, "/home/ubuntu/laujim-app/dist_update.tar.gz")
sftp.close()
print("Tarball subido.")

cmd = """
tar -xzf /home/ubuntu/laujim-app/dist_update.tar.gz -C /home/ubuntu/laujim-app/app/
docker cp /home/ubuntu/laujim-app/app/dist laujim-app:/app/
docker cp /home/ubuntu/laujim-app/app/server.cjs laujim-app:/app/server.cjs
docker cp /home/ubuntu/laujim-app/app/services-scraper.cjs laujim-app:/app/services-scraper.cjs
docker cp /home/ubuntu/laujim-app/app/ezviz_stream_server.py laujim-video:/app/ezviz_stream_server.py
docker restart laujim-video
docker restart laujim-app
echo "ALL_CONTAINERS_RESTARTED_OK"
"""

stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode("utf-8", errors="replace"))
print(stderr.read().decode("utf-8", errors="replace"))

ssh.close()
print("¡Actualización de frontend y backend completada!")
