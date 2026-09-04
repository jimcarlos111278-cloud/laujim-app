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
  2. Regenerate `public/app-version.json` (the installed app compares this to
     its own version to decide whether to show the update notification).
  3. Rebuild the APK (`vite` + Capacitor + Gradle) and copy it to
     `public/app-debug.apk`.
  4. Archive a historical snapshot of the knowledge graph
     (`scripts/archive-graph.cjs` → `graphify-out/archive/`).
  5. Run the `sync:aiven:pre-push` gate.
  6. Commit and push to `origin/main`.
- Options: `--message "..."` for a custom commit message, `--no-push` to build
  and commit without pushing, `--minor`/`--major` for a non-patch bump.
- After the push, verify Render deployed the new build by checking
  `https://laujim-app.onrender.com/api/version` shows the new version before
  claiming the APK notification is live.
- Never ship a code change to the app without bumping the version and
  rebuilding the APK. If a change is only server-side (no APK impact), a
  version bump is not required.
