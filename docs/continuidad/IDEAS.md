# IDEAS — sin ejecutar (no se pierden aunque cambies de lugar)

> Ideas que te gustaron pero NO se ejecutaron, en cualquier lugar u momento. Estados: `idea` (nueva), `parqueada` (vale pero después), `descartada` (con motivo), `hecha` (ya pasó a BITACORA con link al commit).

## Activas

- [ ] (2026-09-29, PC) `idea` — Que el harness/WhatsApp también deje su resumen en BITACORA automáticamente (hoy depende de que el puente edite el doc o de que la próxima IA lo transcriba). Siguiente paso: añadir al puente un apéndice a `docs/continuidad/BITACORA.md` + `note-vm-change`.
- [ ] (2026-09-29, PC) `idea` — Endpoint o comando único `continuidad` visible por HTTP para la IA externa (que hoy solo tiene `/api/graph/query` + resúmenes por chat). Siguiente paso: exponer `BITACORA`/`PENDIENTES` resumidos vía `/api/graph/note`-like de lectura o incluirlos en el query.
- [ ] Ejemplo: `- [ ] (fecha, origen) estado — descripción + siguiente paso.`

## Parqueadas / descartadas / hechas

- [x] (2026-09-29, PC) `hecha` — Que el harness/WhatsApp también deje su resumen en BITACORA automáticamente → implementado: contexto de continuidad en `opencode-bridge.cjs` + contrato en el prompt + auto-registro `scripts/harness-continuity.cjs` + confirmación 📝 por WhatsApp (`server.cjs`).
