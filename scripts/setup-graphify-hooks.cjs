// Instala hooks de git para regenerar el grafo de graphify automaticamente.
// Uso: node scripts/setup-graphify-hooks.cjs
// Copia hooks/pre-commit a .git/hooks/pre-commit (Windows + Git for Windows).
const { existsSync, copyFileSync, mkdirSync, chmodSync } = require('fs');
const { join, dirname } = require('path');

const ROOT = dirname(__dirname);
const SRC = join(ROOT, 'hooks', 'pre-commit');
const GIT_DIR = join(ROOT, '.git');
const HOOKS_DIR = join(GIT_DIR, 'hooks');
const DST = join(HOOKS_DIR, 'pre-commit');

if (!existsSync(GIT_DIR)) {
  console.error('[graphify] .git no encontrado; no se puede instalar el hook.');
  process.exit(1);
}

mkdirSync(HOOKS_DIR, { recursive: true });
if (!existsSync(SRC)) {
  console.error(`[graphify] falta origen del hook: ${SRC}`);
  process.exit(1);
}

copyFileSync(SRC, DST);
try {
  chmodSync(DST, 0o755);
} catch (_) {
  // Windows: chmod es no-op en muchos casos; ignorar.
}
console.log('[graphify] hook instalado en ' + DST);
console.log(`[graphify] configuracion: predev/prebuild en package.json ya enganchados.`);