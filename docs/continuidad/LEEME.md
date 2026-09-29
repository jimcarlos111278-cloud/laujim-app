# Continuidad LAUJIM — trabaja desde donde sea, sin perder nada

Fecha de creación: 2026-09-29. Fuente de verdad en git (esta carpeta se commitea).

## Las 3 piezas

1. `BITACORA.md` — **cambios ejecutados**. Cada cambio real queda informado, explicado y con código/archivos. Se escribe al terminar cada tarea, desde cualquier método.
2. `PENDIENTES.md` — **lo no commiteado**. Cambios en curso + bloque AUTO generado desde `git status`. Para retomar sin adivinar.
3. `IDEAS.md` — **ideas sin ejecutar**. Ideas que te gustaron pero no se ejecutaron, en cualquier lugar o momento. No se pierden aunque cambies de PC/IA.

## Los 4 puntos de entrada (mismas capacidades)

| Dónde | Cómo entras | Qué lees primero | Cómo informas al salir |
|---|---|---|---|
| **PC local** (opencode / Codex / Antigravity) | `git pull` + `node scripts/handoff.cjs` + `node scripts/continuidad.cjs` | `docs/continuidad/LEEME.md` + `PENDIENTES.md` + `IDEAS.md` | `BITACORA.md` + commit + `npm run sync:aiven:pre-push` + push |
| **VM `laujim-vm`** (codex / agy / opencode en `~/laujim-repo`, tmux) | `git pull` + `node scripts/handoff.cjs` | mismos 3 + `GRAPH_REPORT.md` | `BITACORA.md` + commit + push (el hook post-commit anota en grafo vía `scripts/note-vm-change.cjs` → `POST /api/graph/note`) |
| **Harness / WhatsApp** (`opencode-bridge.cjs`, `portable-worker.cjs`) | `//` tarea (escritura) o `/` (lectura) por WhatsApp admin | el puente inyecta LEEME + BITACORA (cola) + PENDIENTES + IDEAS en cada tarea | el agente aplica el contrato de continuidad (BITACORA + `continuidad.cjs` + gate Aiven); al cerrar, el puente auto-registra la tarea en BITACORA (`scripts/harness-continuity.cjs`, sin duplicar) + WhatsApp confirma con 📝 |
| **IA externa sin clonar** (solo HTTP + `GRAPH_READER_TOKEN`) | `POST /api/graph/query` (`stats`/`search`/`neighbors`) + `git log` vía deploy | pide `BITACORA.md` y `PENDIENTES.md` por el canal disponible | deja propuesta en `IDEAS.md` (vía quien tenga el clon) o resumen para que se registre |

## Contrato mínimo al terminar CUALQUIER cambio (desde donde sea)

1. Verificar (`npm run build` u `oxlint` según toque).
2. Agregar entrada en `BITACORA.md`: fecha, origen (PC/VM/harness/externa), qué, por qué, archivos/código clave, cómo verificar, commit.
3. Si quedó algo a medias: anotarlo en `PENDIENTES.md` (manual). Si fue idea no ejecutada: anotarla en `IDEAS.md`.
4. `git add` solo intencional (nunca `-A`), commit, `npm run sync:aiven:pre-push`, push.
5. En VM: el hook post-commit anota el commit en el grafo/Aiven. En PC dev: regenerar grafo en el próximo `release-apk` o con `npm run graphify`.

## Orden de lectura al llegar (30 segundos)

```bash
git pull
node scripts/handoff.cjs
node scripts/continuidad.cjs
```

Luego lee: `BITACORA.md` (últimas 3 entradas) → `PENDIENTES.md` (bloque AUTO + manual) → `IDEAS.md` (solo las marcadas `idea` o `parqueada`).

## Reglas duras

- Una IA por tarea. `pull` al llegar, `push` al soltar.
- Secretos/env nunca en commits ni chat. Datos viven en VM/Aiven, nunca en estos docs.
- APK: todo cambio que llega a la app instalada exige `npm run release-apk` (ver `AGENTS.md`).
- Estos 4 archivos SÍ se versionan (son memoria durable, no secretos ni datos).
