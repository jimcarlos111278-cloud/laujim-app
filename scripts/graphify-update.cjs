// Reinicia el grafo de graphify de forma automatica (hooks git + npm).
// Uso: node scripts/graphify-update.cjs [--code-only]
// Prefiere la CLI via Python (python -m graphify), que no depende de binarios
// .exe que Windows pueda bloquear con AppLocker/WDAC/Smart App Control.
// Si no hay Python con graphify, cae al binario ~/.local/bin/graphify(.exe).
// Un bloqueo del SO (UNKNOWN) o binario ausente (ENOENT) NO rompe el build.
const { spawnSync } = require('child_process');
const { homedir } = require('os');
const { existsSync, readFileSync } = require('fs');
const { join, dirname } = require('path');

const PROJECT_ROOT = dirname(__dirname);
const args = ['update', PROJECT_ROOT].concat(process.argv.slice(2));

// Pythones candidatos con el paquete graphify instalado (mismo orden que el
// hook de git: pin de uv tools, luego graphify-out/.graphify_python).
const PYTHON_CANDIDATES = [
  join(homedir(), 'AppData', 'Roaming', 'uv', 'tools', 'graphifyy', 'Scripts', 'python.exe'),
  join(homedir(), 'AppData', 'Roaming', 'uv', 'tools', 'graphify', 'Scripts', 'python.exe'),
];
try {
  const pinned = readFileSync(join(PROJECT_ROOT, 'graphify-out', '.graphify_python'), 'utf8').trim();
  if (pinned) PYTHON_CANDIDATES.push(pinned);
} catch { /* sin archivo de python fijado */ }

function hasGraphify(python) {
  if (!existsSync(python)) return false;
  const probe = spawnSync(python, ['-c', "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('graphify') else 1)"], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

function findPython() {
  for (const p of PYTHON_CANDIDATES) {
    if (hasGraphify(p)) return p;
  }
  return null;
}

function findBinary() {
  for (const p of [join(homedir(), '.local', 'bin', 'graphify.exe'), join(homedir(), '.local', 'bin', 'graphify')]) {
    if (existsSync(p)) return p;
  }
  return 'graphify';
}

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });
}

const python = findPython();
if (python) {
  const res = run(python, ['-m', 'graphify'].concat(args));
  if (res.error) {
    console.error(`[graphify] no se pudo ejecutar python -m graphify (${python}): ${res.error.message}`);
    process.exit(2);
  }
  if (res.status !== 0) {
    console.error(`[graphify] fallo con codigo ${res.status}`);
    process.exit(res.status || 1);
  }
  console.log('[graphify] grafo actualizado OK (via python)');
  process.exit(0);
}

// Sin Python con graphify: intentar el binario compilado.
const ROOT = findBinary();
const res = spawnSync(ROOT, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: false });

if (res.error) {
  // En CI/Render la CLI global de graphify no esta instalada; no debe romper el build.
  // UNKNOWN = bloqueado por politica de Windows (AppLocker/WDAC/Smart App Control).
  if (res.error.code === 'ENOENT' || res.error.code === 'UNKNOWN') {
    console.warn(`[graphify] CLI no disponible en este entorno (${res.error.code}); se omite la actualizacion del grafo.`);
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