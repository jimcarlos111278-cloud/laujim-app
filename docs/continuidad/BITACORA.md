# BITÁCORA — cambios ejecutados (informados, explicados, con código)

> Cada entrada la escribe quien ejecuta el cambio, **desde cualquier método** (PC, VM, harness/WhatsApp, IA externa vía quien tenga el clon). Sin entrada aquí, el cambio se considera no entregado.

Formato por entrada: fecha | origen | qué | por qué | archivos/código clave | cómo verificar | commit.

---

## 2026-09-28 — release APK con purga Render + harness IA con modelos configurables

- **Origen:** PC dev. **Commit:** `5892240`.
- **Qué:** release de APK que purga restos de Render y deja el harness de IA con modelos configurables.
- **Por qué:** Render suspendido por el dueño (`suspend-by-user`); el frontend ya descarta `onrender.com` (`src/utils/config.js`). No volver a Render.
- **Archivos clave:** `android/app/build.gradle` (bump versión), `public/app-version.json`, `server.cjs`, `src/utils/config.js`, `src/utils/failoverFetch.js`, `deploy-oracle-vm/Dockerfile.app`, `scripts/portable-worker.cjs`, `opencode-bridge.cjs`.
- **Verificar:** `https://conjunto-residendial-laujim.duckdns.org/api/version` muestra la nueva versión; la app instalada notifica "nueva APK".

## 2026-09-28 — purga plataforma Render + harness WhatsApp con modelo configurable

- **Origen:** PC dev. **Commit:** `5bee373`.
- **Qué:** chore que elimina la plataforma Render del código y deja el harness de WhatsApp con `IA modelo/modelos`, failover con timeout y `docker-start.sh`.
- **Por qué:** misma causa Render + robustez del cobro/recordatorios por WhatsApp ante caídas de un modelo.
- **Archivos clave:** `.env.example`, `Dockerfile`, `docker-start.sh`, `server.cjs`, `src/pages/Settings.jsx`, `src/utils/auth.js`, `services-scraper.cjs`, `scripts/sync-seed.js`, `MarketplaceWorkerService.java`, `PortalSessionVault.java`, `ScraperWorkerService.java`, `ScraperWorkerStore.java`.
- **Verificar:** `npm run build` + buscar restos `onrender` en `src/` (debe quedar solo el descarte en `config.js`).

## 2026-09-28 — plan cerradura peatonal (memoria durable)

- **Origen:** PC dev. **Commit:** `74ba75e`.
- **Qué:** documento durable del plan de cerradura peatonal.
- **Archivos clave:** `docs/plan-cerradura-peatonal.md`.
- **Verificar:** existe el doc y se puede citar desde cualquier IA.

## 2026-09-28 — predial sin doble /api + driver CDP permanente

- **Origen:** PC dev. **Commit:** `03a96a7`.
- **Qué:** fix del flujo predial (evita doble `/api`) + driver CDP permanente.
- **Archivos clave:** `src/pages/Predial.jsx`, `scratch/cdp-drive.py`, `scripts/open-chrome-cdp.ps1`.
- **Verificar:** flujo predial responde sin duplicar prefijo y el driver CDP no se cae entre intentos.

## 2026-09-28 — traza hits predial (debug)

- **Origen:** PC dev. **Commit:** `4de8176`.
- **Qué:** debug temporal con traza de hits del scraper predial.
- **Verificar:** logs muestran hits; retirar cuando se confirme el fix.

## 2026-09-28 — predial automático 24h (Orion) + panel por apartamento y totales

- **Origen:** PC dev. **Commit:** `1cc0a2e`.
- **Qué:** feat predial automático cada 24h + panel por apartamento y totales.
- **Verificar:** panel muestra totales y por apartamento tras el ciclo.

## 2026-09-28 — ALPR Fase 2 recorte YOLO vehículo/moto antes del OCR

- **Origen:** PC dev. **Commit:** `ee2c0d0`.
- **Qué:** ALPR recorta vehículo/moto con YOLO antes del OCR.
- **Verificar:** placas de moto mejoran; mismo número de llamadas OCR.

## 2026-09-28 — ALPR ráfaga + frame más nítido para motos

- **Origen:** PC dev. **Commit:** `e62a620`.
- **Qué:** ráfaga ALPR y selección del frame más nítido para motos (misma 1 llamada).
- **Verificar:** tasa de lectura en motos sube sin costo extra.

## 2026-09-27 — ALPR auto dispara en movimiento grande + expone racha

- **Origen:** PC dev. **Commit:** `ad7d4fb`.
- **Qué:** fix disparo automático ante movimiento grande sin 2da confirmación + expone racha.
- **Verificar:** patrulla dispara y la racha es visible.

## 2026-09-27 — contador usos ALPR visible + tope mensual en manuales

- **Origen:** PC dev. **Commit:** `1deee0f`.
- **Qué:** contador de usos ALPR visible + tope mensual en manuales.
- **Verificar:** manuales muestran contador y respetan tope.

## 2026-09-27 — ALPR detecta (fix snapshot) + GUI solo Cloud

- **Origen:** PC dev. **Commit:** `cb00b02` (release).
- **Qué:** release ALPR con fix de snapshot + GUI solo Cloud.
- **Verificar:** `/api/version` + detección en Cloud.

## 2026-09-27 — ALPR tmp en /tmp + stderr PIPE

- **Origen:** PC dev. **Commit:** `1a19d20`.
- **Qué:** fix tmp ALPR en `/tmp` + stderr por PIPE (DEVNULL+bind daba RC=1 sin archivo).
- **Verificar:** intentos ALPR generan archivo y RC=0.

---

## 2026-09-29 — sistema de continuidad + harness sincronizado

- **Origen:** PC (opencode).
- **Qué:** las 3 piezas (BITACORA/PENDIENTES/IDEAS en `docs/continuidad/`) + `scripts/continuidad.cjs` + `scripts/handoff.cjs` ampliado + harness/WhatsApp sincronizado (contexto de continuidad en el puente, contrato obligatorio en el prompt, auto-registro `scripts/harness-continuity.cjs` sin duplicar, confirmación 📝 por WhatsApp).
- **Por qué:** trabajar desde PC, VM, harness o IA externa con las mismas capacidades y todo cambio siempre documentado.
- **Archivos clave:** `docs/continuidad/*`, `scripts/continuidad.cjs`, `scripts/harness-continuity.cjs`, `opencode-bridge.cjs`, `server.cjs` (1 línea), `scripts/handoff.cjs`, `AGENTS.md`, `docs/manual-operacion-ia.md`.
- **Cómo verificar:** `node scripts/continuidad.cjs` + `node scripts/handoff.cjs` (BITACORA al día, PENDIENTES regenerado).
- **Commit:** `0e65991` (hash completado en `9fe00b8`; cierre de trazabilidad en el commit de esta línea).

## 2026-09-30 — logs server/app reales + Facebook en VM (worker + estado)

- **Origen:** PC dev (sesión por casos 3/4).
- **Qué:** fix de `appendScraperLog` (guardaba `'render'`, la UI filtra `'server'` → panel vacío) + migración de viejos; eventos del worker VM se etiquetan `server`; ScraperWorker con badge VM/Teléfono, filtro por dispositivo y nota del celular viejo + dónde viven logs de FB; nuevo `scripts/facebook-vm-worker.cjs` (cola, perfil persistente, `--login/--check-session/--once`); endpoints `POST /worker/v1/facebook/heartbeat` + `GET /api/facebook/status`; tarjeta Facebook en Configuración; mensajes de cola neutros (APK o VM); pie de Marketplace actualizado; vars `FB_VM_*` en `.env.example`.
- **Por qué:** logs del servidor invisibles; publicar atado al teléfono; sesión FB solo en APK.
- **Archivos clave:** `server.cjs`, `scripts/facebook-vm-worker.cjs`, `src/pages/ScraperWorker.jsx`, `src/pages/Settings.jsx`, `src/pages/ApartmentDetail.jsx`, `.env.example`.
- **Cómo verificar:** `node --check server.cjs scripts/facebook-vm-worker.cjs`; `GET /api/facebook/status`; en la VM `--check-session` tras `--login`.
- **Commit:** pendiente.

## 2026-09-30 — deploy VM con casos 0-4 + fix app-version.json

- **Origen:** PC dev vía `ssh laujim` (Tailscale).
- **Qué:** rebuild `docker compose up -d --build app` con server.cjs, opencode-bridge.cjs, dist y worker FB; env `SCRAPER_WORKER_ENABLED=true` + `FB_VM_*` en `.env` y `docker-compose.yml` (con backups); corrección de `app-version.json` (el build usó un generate-version.js viejo de la VM que apuntaba a Render → se fijó a `releases/laujim-v1.0.135.apk` en duckdns); scripts sincronizados (`generate-version.js`, `fix-html.js`, `facebook-vm-worker.cjs`); `--check-session` responde `needs_login`.
- **Por qué:** activar cola/worker FB y todo el paquete de casos en producción.
- **Archivos clave:** `/home/ubuntu/laujim-app/.env`, `docker-compose.yml`, `app/dist/app-version.json`, `scripts/vm-enable-fb-worker.sh`, `scripts/vm-fix-version-file.sh`.
- **Cómo verificar:** `https://conjunto-residendial-laujim.duckdns.org/app-version.json` correcto; `docker exec laujim-app node /app/scripts/facebook-vm-worker.cjs --check-session`.
- **Commit:** pendiente.

## 2026-09-30 — sesión FB en VM + worker encendido + alerta needs_login

- **Origen:** PC dev vía `ssh laujim` + consola OCI (root) + RDP del dueño.
- **Qué:** login manual de Facebook en perfil persistente (`./fb-profile`, perms 1000:1001/770); `--check-session` → `ok`; worker corriendo en el contenedor cada 60s + cron keepalive cada 5 min; alerta WhatsApp al admin en transición a `needs_login` (server.cjs); clave `ubuntu` fijada; baneos fail2ban limpiados; VNC en 5900 (clave `laujim-vnc`).
- **Por qué:** activar CASO 4 (publicar sin teléfono) con sesión 2FA del dueño.
- **Archivos clave:** `server.cjs` (alerta), `scripts/facebook-vm-worker.cjs`, compose (volumen fb-profile), crontab host.
- **Cómo verificar:** `GET /api/facebook/status` (sesión ok); publicar un apartamento Disponible con el botón y ver `published` + URL.
- **Commit:** pendiente.

## Plantilla para la próxima entrada (copiar y rellenar)

```md
## AAAA-MM-DD — título corto

- **Origen:** PC / VM / harness-WhatsApp / externa.
- **Qué:** ...
- **Por qué:** ...
- **Archivos clave:** ...
- **Cómo verificar:** ...
- **Commit:** `hash`.
```

## 2026-09-30 — harness IA obedece docs + modo estable + pagos avisan + scraper honesto + /api/settings

- **Origen:** PC dev (sesión por casos 0/1/2).
- **Qué:** docs del harness OFF por defecto (`IA docs on/off`, `sin/con docs`), thinking high, timeout 300s, respuesta 6000 chars; modo IA estable 2h con escape exacto y salida solo por botones admin; aviso WhatsApp al admin con OCR + `APROBAR <apto>` al llegar comprobante; `/api/system/stats` trae `services` real; Settings con tarjeta APK Instalada→Disponible, pills Docker/scraper con datos vivos; nuevas rutas `GET/POST/PUT /api/settings` (los Guardar de Configuración iban al vacío); mensaje honesto de publicar en web.
- **Por qué:** el outbox forzaba HTML+md siempre; el modo se salía con cualquier botón o palabra prefijo; el admin no se enteraba de comprobantes; pills estáticos; Render muerto (503) en resolución de APK.
- **Archivos clave:** `opencode-bridge.cjs`, `server.cjs`, `src/utils/appRelease.js`, `src/pages/Settings.jsx`, `src/pages/ApartmentDetail.jsx`.
- **Cómo verificar:** `node --check server.cjs`, `oxlint`, `vite build`; por WhatsApp `IA estado` muestra Docs OFF; mandar foto de comprobante avisa al admin; `/api/settings` persiste plantillas y admin phones.
- **Commit:** pendiente.

## 2026-10-02 — remapeo total a VM: onrender fuera, workers teléfono/S23 retirados, FB solo fb-publisher.cjs

- **Origen:** PC dev (sesión de limpieza GUI + workers).
- **Qué:** eliminado onrender de la resolución (regla REGLA MIGRACIÓN en `src/utils/config.js` + `src/utils/appRelease.js`: si aparece onrender.com en futuras operaciones, eliminarlo; descarte automático solo limpia URLs viejas de localStorage); `.env.example` apunta a `scripts/fb-publisher.cjs` (sin teléfono/workers S23); cola FB en `server.cjs` remapeada a VM ("En cola para la VM (sesión FB abierta)" en creación + 2 reintentos); `ApartmentDetail.jsx` sin ramas isCapacitor/Android (botón "Publicar desde la VM", "Reintentar en la VM", badge "VM:", pie fb-publisher.cjs); `Settings.jsx` solo VM (credenciales, "Ver logs del scraper en la VM", tarjeta FB con `fb-publisher.cjs --login`, badge "Solo VM"); `Utilities.jsx` portal siempre `window.open` (fuera `openAndroidPortal`/`supportsAndroidScraperWorker`); `ScraperWorker.jsx` cabecera "Scraper en la VM / Solo VM" + aviso de retirados, "Activar este dispositivo (retirado)" deshabilitado, sección "Ejecución automática en Android" bloqueada con `false &&` (Iniciar/Detener/Ejecutar ahora/permisos no se renderizan), saveSchedule sin side-effect nativo, textos APK→VM; `scripts/vm-fb-vnc.sh` usa `fb-publisher.cjs`; nativo `MarketplaceBrowserActivity.java` dice "Publicar desde la VM".
- **Por qué:** Render suspendido (503) y S23/teléfono fuera de operación; la publicación la ejecuta la VM con sesión FB abierta y el raspado corre en Chromium local. Botones de teléfono eran muertos que confundían.
- **Archivos clave:** `src/utils/config.js`, `src/utils/appRelease.js`, `.env.example`, `server.cjs`, `src/pages/ApartmentDetail.jsx`, `src/pages/Settings.jsx`, `src/pages/Utilities.jsx`, `src/pages/ScraperWorker.jsx`, `scripts/vm-fb-vnc.sh`, `android/.../MarketplaceBrowserActivity.java`.
- **Cómo verificar:** `node --check server.cjs`, `npx oxlint` en archivos tocados, `npm run build`; en UI: Apartamento Disponible → "Publicar desde la VM" encola con mensaje VM; Ajustes → Facebook muestra `fb-publisher.cjs --login`; ScraperWorker sin sección Android; `GET /api/facebook/status` vivo en VM.
- **Commit:** pendiente.
