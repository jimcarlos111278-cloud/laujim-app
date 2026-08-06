// Reinicia el grafo de graphify de forma automatica (hooks git + npm).
// Uso: node scripts/graphify-update.cjs [--code-only]
// Localiza la CLI en ~/.local/bin o en PATH. No depende del PATH del sistema.
const { spawnSync } = require('child_process');
const { homedir } = require('os');
const { existsSync } = require('fs');
const { join, dirname } = require('path');

const PROJECT_ROOT = dirname(__dirname);
const CANDIDATES = [
  join(homedir(), '.local', 'bin', 'graphify.exe'),
  join(homedir(), '.local', 'bin', 'graphify'),
];

function findBinary() {
  for (const p of CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return 'graphify';
}

const ROOT = findBinary();
const args = ['update', PROJECT_ROOT].concat(process.argv.slice(2));

const res = spawnSync(ROOT, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });

if (res.error) {
  // En CI/Render la CLI global de graphify no esta instalada; no debe romper el build.
  if (res.error.code === 'ENOENT') {
    console.warn('[graphify] CLI no encontrada en este entorno; se omite la actualizacion del grafo.');
    process.exit(0);
  }
  console.error(`[graphify] no se pudo ejecutar ${ROOT}: ${res.error.message}`);
  process.exit(2);
}
if (res.status !== 0) {
  console.error(`[graphify] fallo con codigo ${res.status}`);
  process.exit(res.status || 1);
}
console.log('[graphify] grafo actualizado OK');