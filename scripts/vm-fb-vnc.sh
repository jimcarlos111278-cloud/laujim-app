#!/bin/bash
# Expone la GUI de la VM (display :99 del contenedor) por VNC + lanza el login de FB.
# Uso en la VM: VNC_PASS=una-clave bash vm-fb-vnc.sh
# Luego conecta tu visor VNC a 100.96.247.74:5900 (por Tailscale).
set -e
cd /home/ubuntu/laujim-app

echo '--- 1/4 volumen persistente para el perfil FB ---'
python3 - <<'PYEOF'
path = 'docker-compose.yml'
text = open(path, encoding='utf-8').read()
if './fb-profile:/tmp/laujim-fb-profile' in text:
    print('VOLUME-EXISTS')
else:
    anchor = '    network_mode: host\n\n  # ─── 4. PROXY INVERSO CADDY'
    assert anchor in text, 'anchor compose no encontrado'
    text = text.replace(
        anchor,
        '    volumes:\n      - ./fb-profile:/tmp/laujim-fb-profile\n    network_mode: host\n\n  # ─── 4. PROXY INVERSO CADDY',
        1,
    )
    open(path, 'w', encoding='utf-8').write(text)
    print('VOLUME-ADD')
PYEOF
mkdir -p fb-profile

echo '--- 2/4 recrear app con el volumen (sin rebuild) ---'
docker compose up -d

echo '--- 3/4 instalar y encender VNC en el contenedor ---'
docker exec -u 0 laujim-app bash -c "apt-get update -qq && apt-get install -y -qq x11vnc >/dev/null 2>&1 && echo VNC-INSTALLED || echo VNC-INSTALL-FAIL"
VNC_PASS="${VNC_PASS:-laujim-vnc}"
docker exec -u 0 laujim-app bash -c "mkdir -p /root/.vnc && x11vnc -storepasswd '$VNC_PASS' /root/.vnc/passwd"
docker exec -u 0 laujim-app bash -c "pkill -f 'x11vnc.*:99' 2>/dev/null; true"
docker exec -u 0 -d laujim-app x11vnc -display :99 -rfbport 5900 -listen 0.0.0.0 -forever -shared -bg -rfbauth /root/.vnc/passwd
sleep 2
docker exec laujim-app bash -c "pgrep -a x11vnc | head -2 || echo VNC-NOT-RUNNING"

echo '--- 4/4 abrir Facebook para login (30 min) ---'
docker cp /home/ubuntu/laujim-app/app/scripts/fb-publisher.cjs laujim-app:/app/scripts/fb-publisher.cjs
docker exec -u node -d -e DISPLAY=:99 laujim-app node /app/scripts/fb-publisher.cjs --login
echo "VNC-LISTO host=100.96.247.74 puerto=5900 clave=$VNC_PASS"
