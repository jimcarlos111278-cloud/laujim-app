## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

### Arquitectura de grafos: principal + histórico

El grafo de conocimiento tiene dos capas:

- **Grafo principal** (`graphify-out/graph.json`): contiene SOLO el código real del
  proyecto (~1.4 MB, ~1.3K nodos). Se consulta siempre. Se mantiene limpio gracias
  a `.graphifyignore`, que excluye cachés de Gradle, `node_modules/`, builds,
  temporales y artefactos generados. **No regenerar sin `.graphifyignore`** o el
  grafo se contamina de nuevo con código de terceros.
- **Snapshots históricos** (`graphify-out/archive/graph-<fecha>.json.gz`): copias
  comprimidas del grafo completo en cada release. Se consultan SOLO cuando se busca
  una versión pasada o se quiere hacer rollback. Para consultar uno, descomprimir y
  usar `graphify query --graph <archivo-descomprimido> "<pregunta>"`.

`scripts/archive-graph.cjs` genera un snapshot comprimido del grafo actual. Se
ejecuta automáticamente en cada `npm run release-apk` (etiquetado con la versión),
y puede ejecutarse manualmente con `node scripts/archive-graph.cjs --label "texto"`.

## Build/push persistence gate

- Before **every** `git push`, the build agent must run `npm run sync:aiven:pre-push`.
- The command must finish successfully before pushing. If `AIVEN_DATABASE_URL` is
  missing or the sync fails, stop and report the blocker; never push first.
- The command verifies Aiven and uploads `data/database.json` only when that
  runtime file has an intentional local working-tree change (or Aiven is empty),
  preventing a stale tracked snapshot from replacing newer production values.
- Do not use `git add -A` for a data snapshot. Stage only the intended code and
  documentation files. The repository `hooks/pre-push` enforces the same gate
  when installed with `node scripts/setup-graphify-hooks.cjs`.

## APK release standard (nueva APK + notificación)

Every code change that ships to the Android app MUST also publish a new APK so
the installed app detects the update and shows the "nueva APK" notification.
This is a hard standard, not optional.

- Run `npm run release-apk` (wraps `scripts/release-apk.cjs`) to:
  1. Bump the patch version in `android/app/build.gradle` (`versionName`).
  2. Rebuild the APK (`vite` + Capacitor + Gradle) into `public/app-debug.apk`.
  3. Copy it to `public/releases/laujim-v<version>.apk`, keeping only the
     last 10 (oldest deleted). APKs NEVER go to git (see `.gitignore`); they
     reach the VM via deploy/scp or R2 (`npm run backup:media` syncs them).
  4. Regenerate `public/app-version.json` pointing at the versioned APK
     (the installed app compares this to its own version to decide whether
     to show the update notification).
  5. Archive a historical snapshot of the knowledge graph
     (`scripts/archive-graph.cjs` → `graphify-out/archive/`) and stage the
     base graph files (`graph.json`, `GRAPH_REPORT.md`, `manifest.json`).
  6. Run the `sync:aiven:pre-push` gate.
  7. Commit (no APKs) and push to `origin/main`.
- Options: `--message "..."` for a custom commit message, `--no-push` to build
  and commit without pushing, `--minor`/`--major` for a non-patch bump.
- After the push, verify Oracle serves the new build by checking
  `https://conjunto-residendial-laujim.duckdns.org/api/version` shows the new version before
  claiming the APK notification is live.
- Never ship a code change to the app without bumping the version and
  rebuilding the APK. If a change is only server-side (no APK impact), a
  version bump is not required.

## Multi-PC / multi-IA continuity (leer al arrancar en otra máquina)

El proyecto vive en VM + GitHub + Aiven y varias IAs (este u otro PC) operan
sobre él. La sincronización la hacen git y las fuentes durables, no la
herramienta. Reglas:

- Al llegar: `git pull`, luego `git log --oneline -5` + `node scripts/handoff.cjs` + `node scripts/continuidad.cjs`.
  Memoria durable: `docs/continuidad/LEEME.md` + `BITACORA.md` (ejecutados) + `PENDIENTES.md` (sin commit) + `IDEAS.md` (sin ejecutar).
  El mapa del proyecto es `GRAPH_REPORT.md` + `graphify-out/graph.json`.
- Una sola IA por tarea a la vez. Conflictos = la otra sesión no hizo push.
- Al soltar: verificar (`npm run build` u `oxlint`), documentar en `docs/continuidad/BITACORA.md` (y `PENDIENTES.md`/`IDEAS.md` si aplica),
  `git add` solo de lo intencional (nunca `-A`), commit, `npm run sync:aiven:pre-push`, push.
- El grafo se refresca por release (`release-apk` lo archiva) o manual con
  `npm run graphify` + commit de `graphify-out/` (solo archivos base).
- Secretos y datos viven en VM/Aiven, nunca en commits ni en el chat.
