import os
import tarfile
import paramiko
import time
import json

project_dir = r"c:\Proyecto Edificio Laujim APP\Proyecto Laujim APP fix"
tar_path = os.path.join(project_dir, "deploy_update.tar.gz")

print("--- Paso 1: Empaquetando deploy_update.tar.gz ---")
with tarfile.open(tar_path, "w:gz") as tar:
    tar.add(os.path.join(project_dir, "server.cjs"), arcname="server.cjs")
    tar.add(os.path.join(project_dir, "services-scraper.cjs"), arcname="services-scraper.cjs")
    tar.add(os.path.join(project_dir, "dist"), arcname="dist")
    if os.path.exists(os.path.join(project_dir, "lib")):
        tar.add(os.path.join(project_dir, "lib"), arcname="lib")
    
    # Servidor de streaming y Dual ALPR
    ezviz_server = os.path.join(project_dir, "deploy-oracle-vm", "ezviz_stream_server.py")
    if os.path.exists(ezviz_server):
        tar.add(ezviz_server, arcname="ezviz_stream_server.py")
        print(f"Incluido ezviz_stream_server.py (Dual ALPR: Local ML + Cloud)")

    callguard_apk = os.path.join(project_dir, "public", "callguard-dialer.apk")
    if os.path.exists(callguard_apk):
        tar.add(callguard_apk, arcname="callguard-dialer.apk")
        print(f"Incluido callguard-dialer.apk ({os.path.getsize(callguard_apk)/(1024*1024):.2f} MB)")
        
    main_apk = os.path.join(project_dir, "public", "app-debug.apk")
    if os.path.exists(main_apk):
        tar.add(main_apk, arcname="app-debug.apk")
        print(f"Incluido app-debug.apk ({os.path.getsize(main_apk)/(1024*1024):.2f} MB)")

tar_size_mb = os.path.getsize(tar_path) / (1024 * 1024)
print(f"deploy_update.tar.gz creado con éxito: {tar_size_mb:.2f} MB")

print("\n--- Paso 2: Conectando por SSH a Oracle VM (149.130.160.116) ---")
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
key_path = r"C:\Users\jimca\.ssh\id_ed25519_laujim"
ssh.connect("149.130.160.116", username="ubuntu", key_filename=key_path, timeout=20)

print("\n--- Paso 3: Subiendo tarball por SFTP ---")
sftp = ssh.open_sftp()
remote_tar = "/home/ubuntu/laujim-app/deploy_update.tar.gz"
sftp.put(tar_path, remote_tar)
sftp.close()
print("Tarball subido a la VM.")

print("\n--- Paso 4: Desempaquetando e inyectando en contenedores ---")
cmd = """
mkdir -p /home/ubuntu/laujim-app/app
tar -xzf /home/ubuntu/laujim-app/deploy_update.tar.gz -C /home/ubuntu/laujim-app/app/

# 1. Actualizar ezviz_stream_server.py en host y en laujim-video
if [ -f /home/ubuntu/laujim-app/app/ezviz_stream_server.py ]; then
    cp /home/ubuntu/laujim-app/app/ezviz_stream_server.py /home/ubuntu/laujim-app/ezviz_stream_server.py
    docker cp /home/ubuntu/laujim-app/app/ezviz_stream_server.py laujim-video:/app/ezviz_stream_server.py
    docker restart laujim-video
    echo "LAUJIM_VIDEO_RESTARTED"
fi

# 2. Actualizar laujim-app
cp /home/ubuntu/laujim-app/app/server.cjs /home/ubuntu/laujim-app/server.cjs
cp /home/ubuntu/laujim-app/app/services-scraper.cjs /home/ubuntu/laujim-app/services-scraper.cjs
docker cp /home/ubuntu/laujim-app/app/services-scraper.cjs laujim-app:/app/services-scraper.cjs
docker cp /home/ubuntu/laujim-app/app/dist laujim-app:/app/
if [ -d /home/ubuntu/laujim-app/app/lib ]; then
    docker cp /home/ubuntu/laujim-app/app/lib laujim-app:/app/
fi

if [ -f /home/ubuntu/laujim-app/app/callguard-dialer.apk ]; then
    docker cp /home/ubuntu/laujim-app/app/callguard-dialer.apk laujim-app:/app/public/callguard-dialer.apk
    docker cp /home/ubuntu/laujim-app/app/callguard-dialer.apk laujim-app:/app/dist/callguard-dialer.apk
fi

if [ -f /home/ubuntu/laujim-app/app/app-debug.apk ]; then
    docker cp /home/ubuntu/laujim-app/app/app-debug.apk laujim-app:/app/public/app-debug.apk
    docker cp /home/ubuntu/laujim-app/app/app-debug.apk laujim-app:/app/dist/app-debug.apk
fi

docker restart laujim-app
echo "DEPLOY_APPLIED_SUCCESS"
"""

stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
print(stdout.read().decode("utf-8", errors="ignore"))

print("\n--- Paso 5: Esperando 6 segundos a que los servicios inicialicen ---")
time.sleep(6)

# Verificar contenedores
stdin, stdout, stderr = ssh.exec_command("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")
print("Contenedores:\n", stdout.read().decode("utf-8", errors="replace"))

# Probar Endpoint de Dual ALPR Scan en producción
print("\n--- Paso 6: Ejecutando Escaneo Dual ALPR (Benchmark) en vivo ---")
scan_cmd = "curl -s -X POST 'http://127.0.0.1:10000/api/security/plates/scan?mode=compare&cam=all'"
stdin, stdout, stderr = ssh.exec_command(scan_cmd)
scan_out = stdout.read().decode("utf-8", errors="replace")
print("Respuesta Dual ALPR Scan:\n", scan_out[:800])

ssh.close()
print("\n=== ¡Despliegue de Dual ALPR completado con éxito! ===")
