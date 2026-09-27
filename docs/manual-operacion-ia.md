# Manual de operación multi-PC / multi-IA

El proyecto vive en VM + GitHub + Aiven + R2. Cualquier IA (opencode,
Codex, Antigravity, Claude) opera desde cualquier PC siguiendo este manual.

## Dónde corre cada IA
- **VM `laujim-vm`** (cola Tailscale, IP `100.96.247.74`): `codex`, `agy`,
  `opencode` (1.18.x) con las mismas keys. Carpeta de trabajo
  `~/laujim-repo` (clon git). Deploy en `/home/ubuntu/laujim-app`
  (NO es git: no editar a mano, se sincroniza).
- **PC local**: Antigravity / opencode / Codex sobre clon local + git.

## Entrar (cualquier PC)
```bash
tailscale ssh ubuntu@laujim-vm   # o: ssh -i <llave> ubuntu@100.96.247.74
tmux new -s trabajo              # existe: tmux attach -t trabajo
export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$PATH"
cd ~/laujim-repo && git pull
node scripts/handoff.cjs
codex   # o: agy | opencode
```
Al soltar: `commit + push` + `Ctrl-b d`.

## Mapa del proyecto (leer siempre primero)
`GRAPH_REPORT.md` + `graphify-out/graph.json` + `AGENTS.md`.
Sin clonar (IA externa, solo HTTP + `GRAPH_READER_TOKEN`):
`POST https://conjunto-residendial-laujim.duckdns.org/api/graph/query`
header `x-graph-token`, body `{"action":"stats"}`,
`{"action":"search","q":"login"}` o `{"action":"neighbors","id":"..."}`.

## Reporte automático de cambios (modo externo, sin IA en VM)
El hook post-commit de `~/laujim-repo` anota cada commit en Aiven
(`scripts/note-vm-change.cjs` → `POST /api/graph/note`); la regeneración
de nodos pasa en el próximo `release-apk`. En la VM no corre ninguna IA
persistente (ahorro RAM): al terminar, salir de la TUI y `tmux kill-session`.

## Plantillas de prompt
- Continuar: *Lee GRAPH_REPORT.md y graphify-out/graph.json. Continúa con:
  [tarea]. No toques [alcance]. Al terminar: verifica con `npm run build`,
  haz commit y push.*
- Nueva: *Contexto: [2 líneas]. Implementa [X] como [archivo parecido].
  Verifica y commitea por grupos.*
- Revisar: *Revisa `git diff --stat` y el diff: errores, secretos, rupturas.
  Dime qué está mal ANTES de commitear.*
- Cierre: *Deja git limpio (commit+push), corre handoff y resume en 3 líneas.*

## Reglas duras
1. Una IA por tarea. 2. `pull` al llegar, `push` al soltar.
3. `git add` solo intencional (nunca `-A`). 4. Gate
   `npm run sync:aiven:pre-push` antes de cada push.
5. Secretos/env nunca en commits ni chat. 6. Grafo: regenerar en PC dev
   (`npm run graphify`, `graphify` no instalable en VM) y sincronizar con
   `py scratch/sftp-sync-vm.py` o `release-apk`.

## Sincronización entre copias
- Código+grafo: GitHub (bajo demanda, no cada build).
- Datos: Aiven. Secretos: VM + Aiven (`/admin`).
- Medios/APK/snapshots: R2 (`backup-media` domingos 03:00 Bogotá vía cron;
  restore con `restore-media-s3.cjs --dry-run` primero).
- Salud: cron cada 5 min reinicia si `/health` falla.
- Desastre: ver `deploy-oracle-vm/RESTORE.md`.
