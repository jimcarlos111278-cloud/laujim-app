# Restauración ante desastre (VM perdida o disco muerto)

Fuentes de verdad: código+grafo en GitHub, datos+secretos en Aiven,
medios/APKs/snapshots en R2 (`laujim-backups`). Nada vive solo en la VM.

## Requisitos previos (guardados FUERA de la VM, gestor de claves)
- URL de Aiven (`AIVEN_DATABASE_URL`) + llaves R2 (`R2_*`).
- Este repo clonable + cuenta Oracle Cloud + cuenta Cloudflare.

## Reconstrucción (VM Ubuntu nueva)
1. Instalar Docker: `curl -fsSL https://get.docker.com | sudo sh`.
2. `git clone https://github.com/jimcarlos111278-cloud/laujim-app.git`
   y copiar `deploy-oracle-vm/docker-compose.yml` + `Caddyfile` a
   `/home/ubuntu/laujim-app/` (o el `PROJECT_DIR` que uses).
3. Crear `/home/ubuntu/laujim-app/.env` con TODAS las variables
   (inventario en `.env.example`; valores desde Aiven clave `app_secrets`
   + gestor de claves para Aiven/R2).
4. `docker compose up -d` (levanta Postgres, app, video, Caddy).
5. Restaurar disco desde R2 (con `R2_*` ya en el entorno):
   `node scripts/restore-media-s3.cjs`
   (primero `--dry-run` para ver qué falta).
6. `docker compose up -d --build app` si la imagen es vieja;
   verificar `/api/version`, `/api/auth/github/status` y `/admin`.
7. Reinstalar automatización: `bash scripts/setup-vm-cron.sh`.
8. Tailscale (`tailscale up`) para acceso multi-PC.

## Notas
- El backup corre solo los domingos 03:00 Bogotá + auto-restart cada
  5 min si `/health` falla (ver `scripts/setup-vm-cron.sh`).
- `graphify-out/` del contenedor se monta desde `./app/graphify-out`
  (ver `docker-compose.override.yml`); sincronizar con
  `py scratch/sftp-sync-vm.py` tras regenerar el grafo.
- Probar este procedimiento 1 vez al año en una VM temporal.

## Acceso multi-PC (Tailscale, indefinido)
- VM dentro de la tailnet como `laujim-vm` (IP `100.96.247.74`), con
  SSH de Tailscale activo (`tailscale up --ssh`) y expiración de llave
  desactivada en consola (Machines → `···` → Disable key expiry).
- Desde cualquier PC con la app Tailscale (misma cuenta):
  `tailscale ssh ubuntu@laujim-vm` (sin llaves) o
  `ssh -i <llave> ubuntu@100.96.247.74`.
- Sesiones persistentes entre PCs con `tmux` (`new -s trabajo` / `attach -t trabajo`).
- Si se reinstala la VM: `tailscale up --ssh --hostname=laujim-vm`
  + aprobar URL + desactivar expiración de nuevo.

## Dónde trabaja la IA en la VM (dos carpetas, no mezclar)
- `~/laujim-repo` — clon git de trabajo (IAs: `codex`, `agy`).
  Aquí se hace `pull`, se edita, se verifica (`npm run build`,
  `node scripts/handoff.cjs`) y se hace `push`. Árbol siempre limpio
  al cambiar de PC.
- `/home/ubuntu/laujim-app` — copia de deploy (NO es git).
  Recibe archivos vía `py scratch/sftp-sync-vm.py` desde el PC dev
  o `git`-less sync; el contenedor la monta (`server.cjs`, `dist`,
  `public`, `uploads`, `graphify-out`).
- Herramientas en la VM: node 22, `codex` y `agy` en `~/.local/bin`,
  `graphify` NO instalable (regenerar grafo en PC dev + sincronizar).
