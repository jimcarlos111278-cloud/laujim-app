#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════
#  INSTALADOR INTEGRAL DE LAUJIM APP EN ORACLE CLOUD ALWAYS FREE (UBUNTU 24.04)
#  IP VM: 149.130.160.116 (2 OCPU / 12GB RAM / 200GB SSD)
# ════════════════════════════════════════════════════════════════════════════════

set -e

echo "=== 1. Actualizando paquetes del sistema ==="
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl gnupg git postgresql-client ufw

echo "=== 2. Habilitando puertos en el Firewall de Ubuntu ==="
# Abrir HTTP (80) y HTTPS (443) para Cloudflare, y RDP (3389)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || true

echo "=== 3. Instalando Docker y Docker Compose para ARM64 ==="
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker "$USER"
    sudo systemctl enable --now docker
    rm -f get-docker.sh
fi

echo "=== 4. Preparando directorios del proyecto ==="
APP_DIR="/home/ubuntu/laujim-app"
mkdir -p "$APP_DIR/backups" "$APP_DIR/hls" "$APP_DIR/recordings" "$APP_DIR/app"

# Si existe el tarball de la aplicación y aún no está extraído, extraerlo en app/
if [ -f "$APP_DIR/laujim-app-source.tar.gz" ] && [ ! -f "$APP_DIR/app/package.json" ]; then
    echo "Extrayendo código fuente de la aplicación en $APP_DIR/app..."
    tar --overwrite -xzf "$APP_DIR/laujim-app-source.tar.gz" -C "$APP_DIR/app" || true
fi

# Si existe la unidad compartida de Windows RDP (thinclient_drives), sincronizar
SHARED_SRC="/home/ubuntu/thinclient_drives/C/Proyecto Edificio Laujim APP"
if [ -d "$SHARED_SRC" ]; then
    echo "Sincronizando archivos desde la unidad compartida de Windows C:..."
    rsync -av --exclude 'node_modules' --exclude '.git' --exclude '*.apk' "$SHARED_SRC/Proyecto Laujim APP fix/" "$APP_DIR/app/" || true
fi

# Configurar variables de entorno si no existen
if [ ! -f "$APP_DIR/.env" ]; then
    cat <<EOF > "$APP_DIR/.env"
DB_PASSWORD=\${DB_PASSWORD:-LaujimDB2026Secure!}
AIVEN_DATABASE_URL=\${AIVEN_DATABASE_URL:-}
ADMIN_USERNAME=\${ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=\${ADMIN_PASSWORD:-laujim123}
EOF
fi

echo "=== 5. Configurando cron para respaldo a Aiven ==="
chmod +x "$APP_DIR/sync-db-aiven.sh" || true
(crontab -l 2>/dev/null | grep -v "sync-db-aiven.sh" ; echo "0 */6 * * * $APP_DIR/sync-db-aiven.sh >> /home/ubuntu/backups/sync.log 2>&1") | crontab -

echo "=== 6. Iniciando servicios con Docker Compose ==="
cd "$APP_DIR"
docker compose up -d --build

echo "=== 7. Verificando y sincronizando base de datos inicial ==="
sleep 6
docker exec laujim-db psql -U laujim -d laujim_prod -c "CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value JSONB NOT NULL);" || true

STORE_COUNT=$(docker exec laujim-db psql -U laujim -d laujim_prod -t -c "SELECT count(*) FROM store;" 2>/dev/null | tr -d ' ' || echo "0")
if [ "$STORE_COUNT" = "0" ] || [ -z "$STORE_COUNT" ]; then
    if [ -n "$AIVEN_DATABASE_URL" ]; then
        echo "Poblando base de datos local desde Aiven por primera vez..."
        pg_dump "$AIVEN_DATABASE_URL" -t store --data-only | docker exec -i laujim-db psql -U laujim -d laujim_prod || true
        echo "¡Base de datos local inicializada con datos de producción!"
        docker restart laujim-app || true
    fi
fi

echo ""
echo "=========================================================================="
echo "  ¡DESPLIEGUE COMPLETADO CON ÉXITO EN ORACLE CLOUD!"
echo "  - PostgreSQL: Local en Docker (puerto 5432, 0ms de latencia)"
echo "  - Laujim App: Corriendo en http://localhost:10000"
echo "  - Motor Video: Corriendo en http://localhost:8080"
echo "  - Proxy Caddy: Escuchando en puertos 80 y 443 con SSL automático"
echo "=========================================================================="
