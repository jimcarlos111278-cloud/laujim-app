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
- **Commit:** `0e65991`.

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
