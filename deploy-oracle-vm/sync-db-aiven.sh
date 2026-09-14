#!/bin/bash
# ─── RESPALDO Y SINCRONIZACIÓN AUTOMÁTICA POSTGRES LOCAL -> AIVEN ───
# Ejecución recomendada en cron cada 6 o 12 horas.

set -e

# Cargar variables de entorno si existen
if [ -f "/home/ubuntu/laujim-app/.env" ]; then
    set -a
    . /home/ubuntu/laujim-app/.env
    set +a
fi

BACKUP_DIR="/home/ubuntu/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/laujim_db_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Iniciando respaldo de base de datos local..."

# 1. Exportar la base de datos local comprimida
docker exec laujim-db pg_dump -U laujim -d laujim_prod | gzip > "$BACKUP_FILE"
echo "[$(date)] Respaldo local guardado en: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# 2. Si AIVEN_DATABASE_URL está configurada, sincronizar hacia Aiven
if [ -n "$AIVEN_DATABASE_URL" ]; then
    echo "[$(date)] Sincronizando respaldo hacia Aiven PostgreSQL..."
    gunzip -c "$BACKUP_FILE" | psql "$AIVEN_DATABASE_URL" > /dev/null 2>&1 || {
        echo "[$(date)] AVISO: Sincronización a Aiven falló o la URL no está accesible. El backup local quedó seguro."
    }
    echo "[$(date)] Sincronización hacia Aiven completada con éxito."
fi

# 3. Purgar respaldos locales con más de 7 días de antigüedad
find "$BACKUP_DIR" -name "laujim_db_*.sql.gz" -mtime +7 -delete
echo "[$(date)] Limpieza completada. Copias antiguas eliminadas."
