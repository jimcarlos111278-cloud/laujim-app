# PENDIENTES — lo no commiteado / en curso

> Lo genera `node scripts/continuidad.cjs` (bloque AUTO desde `git status`) + notas manuales. Si cambias de PC/IA, aquí está lo que quedó a medias.

<!-- AUTO:INICIO (no editar a mano — lo regenera scripts/continuidad.cjs) -->
## AUTO — snapshot 2026-09-29 (13 modificados + 179 nuevos)

Modificados (13):
- `M .env.example`
- `M deploy-oracle-vm/docker-compose.yml`
- `M graphify-out/.graphify_labels.json`
- `M graphify-out/.graphify_labels.json.sig`
- `M graphify-out/GRAPH_REPORT.md`
- `M graphify-out/graph.json`
- `M graphify-out/manifest.json`
- `M scraper-graph/android/app/src/main/java/com/laujim/aptmanager/PortalSessionVault.java`
- `M scraper-graph/android/app/src/main/java/com/laujim/aptmanager/ScraperWorkerService.java`
- `M scraper-graph/android/app/src/main/java/com/laujim/aptmanager/ScraperWorkerStore.java`
- `M scraper-graph/docs/scraper-worker.md`
- `M scraper-graph/src/services-scraper.cjs`
- `M scratch/dbg-alpr.py`

Nuevos sin versionar (179, agrupados):
- `?? .opencode/… (154 archivos)`
- `?? "Bot scraper/WhatsApp Image 2026-08-31 at 12.14.50 PM.jpeg`
- `?? configurar-codigos-camaras.bat`
- `?? deploy-oracle-vm/diag-video.sh`
- `?? deploy_temp.sh`
- `?? design-proposals/… (10 archivos)`
- `?? eng.traineddata`
- `?? "fotos de la app nativa de samsung/… (5 archivos)`
- `?? graphify-out/… (2 archivos)`
- `?? iniciar-camaras-25fps.bat`
- `?? probe.html`
- `?? tools/go2rtc/go2rtc.exe`

Nota: antes de commitear, revisar uno por uno (`git add` intencional, nunca `-A`). Detalle total con `git status --porcelain -uall`.
<!-- AUTO:FIN -->

## MANUAL — en curso (editar a mano)

- [x] (2026-09-29, PC) Sistema de continuidad creado y commiteado: `docs/continuidad/` + `scripts/continuidad.cjs` + `handoff` + `AGENTS` + manual + harness sincronizado.
- [ ] (2026-09-29, PC) Revisar y commitear por grupos lo restante: 1) `server.cjs` + scraper-worker, 2) `deploy-oracle-vm/docker-compose.yml` + `diag-video.sh`, 3) `graphify-out/` base, 4) decidir qué hacer con `design-proposals/` y `Bot scraper/`.
- [ ] (2026-09-29, PC) Confirmar si `opencode-bridge.cjs` modificado es del harness-WhatsApp y documentarlo en BITACORA al commitear.
- [ ] Ejemplo: `- [ ] (fecha, origen) descripción + archivo(s) + siguiente paso.`
