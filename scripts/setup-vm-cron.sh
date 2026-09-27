#!/usr/bin/env bash
# setup-vm-cron.sh — automatización en la VM (idempotente, seguro re-ejecutar).
# Instala: respaldo semanal a R2 (domingo 08:00 UTC = 03:00 Bogotá) y
# auto-reinicio si /health falla (cada 5 min). Uso en la VM:
#   bash scripts/setup-vm-cron.sh   (o su equivalente ya instalado)
set -e
APP_DIR=/home/ubuntu/laujim-app
MARK="# LAUJIM_CRON"
CRON_BACKUP="0 8 * * 0 docker cp $APP_DIR/app/scripts/backup-media-s3.cjs laujim-app:/app/scripts/backup-media-s3.cjs && docker exec laujim-app node scripts/backup-media-s3.cjs >> $APP_DIR/backups/cron-backup.log 2>&1 $MARK"
CRON_HEALTH="*/5 * * * * curl -sf http://127.0.0.1:10000/health > /dev/null || docker restart laujim-app $MARK"
mkdir -p "$APP_DIR/backups"
TMP_CRON=$(mktemp)
(crontab -l 2>/dev/null | grep -v "$MARK" || true) > "$TMP_CRON"
printf '%s\n%s\n' "$CRON_BACKUP" "$CRON_HEALTH" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"
echo "[cron] Instalado:"
crontab -l | grep "$MARK" || true
