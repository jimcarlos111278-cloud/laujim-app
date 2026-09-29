#!/usr/bin/env node
/**
 * continuidad.cjs
 *
 * Punto único de continuidad usable desde CUALQUIER método:
 * PC local, VM (codex/agy/opencode), harness/WhatsApp (puente) o IA externa
 * con acceso al clon. Solo Node, sin dependencias.
 *
 * Hace:
 * 1. Lee git (rama, HEAD, status porcelain).
 * 2. Regenera el bloque AUTO de docs/continuidad/PENDIENTES.md.
 * 3. Verifica si BITACORA.md menciona el HEAD actual.
 * 4. Resume continuidad (handoff ya da el detalle git+grafo).
 *
 * Uso: node scripts/continuidad.cjs [--write] (por defecto escribe el bloque AUTO)
 * Solo lectura salvo el bloque AUTO. No imprime secretos.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pendientesFile = path.join(root, 'docs', 'continuidad', 'PENDIENTES.md');
const bitacoraFile = path.join(root, 'docs', 'continuidad', 'BITACORA.md');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const branch = git(['branch', '--show-current']) || '?';
const head = git(['log', '-1', '--pretty=%h|%ad|%s', '--date=short']) || '(sin historial)';
const short = head.split('|')[0] || '';
const porcelain = git(['status', '--porcelain', '-uall']);
const lines = porcelain ? porcelain.split('\n') : [];
const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('M '));
const untracked = lines.filter((l) => l.startsWith('??'));

const today = new Date().toISOString().slice(0, 10);
// Untracked agrupado por carpeta raíz (evita dumps de 100+ líneas cuando hay
// carpetas nuevas como design-proposals/ o ponytail/); los archivos sueltos y
// los de docs/continuidad + scripts/ se listan uno por uno por ser los críticos.
function groupUntracked(paths) {
  const groups = new Map();
  for (const p of paths) {
    const clean = p.replace(/^"\?\? "?/, '').replace(/"$/, '').trim();
    const seg = clean.split('/')[0] || clean;
    if (!groups.has(seg)) groups.set(seg, []);
    groups.get(seg).push(clean);
  }
  const out = [];
  for (const [seg, items] of groups) {
    const isDir = items.length > 1 || items[0].includes('/');
    const critical = seg === 'docs' || seg === 'scripts';
    if (critical || !isDir || items.length === 1) {
      for (const item of items.slice(0, 15)) out.push(`- \`?? ${item}\``);
      if (items.length > 15) out.push(`- \`?? ${seg}/… (+${items.length - 15} más)\``);
    } else {
      out.push(`- \`?? ${seg}/… (${items.length} archivos)\``);
    }
    if (out.length >= 30) { out.push(`- … (+${paths.length} en total, ver \`git status\`)`); break; }
  }
  return out;
}
const untrackedPaths = untracked.map((l) => l.slice(2).trim());
const autoBlock = [
  '<!-- AUTO:INICIO (no editar a mano — lo regenera scripts/continuidad.cjs) -->',
  `## AUTO — snapshot ${today} (${modified.length} modificados + ${untrackedPaths.length} nuevos)`,
  '',
  `Modificados (${modified.length}):`,
  ...modified.map((l) => `- \`${l.trim()}\``),
  '',
  `Nuevos sin versionar (${untrackedPaths.length}, agrupados):`,
  ...groupUntracked(untrackedPaths),
  '',
  'Nota: antes de commitear, revisar uno por uno (`git add` intencional, nunca `-A`). Detalle total con `git status --porcelain -uall`.',
  '<!-- AUTO:FIN -->',
].join('\n');

let pendientesEstado = 'ausente docs/continuidad/PENDIENTES.md';
try {
  let content = fs.readFileSync(pendientesFile, 'utf8');
  if (!content.includes('<!-- AUTO:INICIO')) {
    pendientesEstado = 'PENDIENTES.md sin marcas AUTO (no tocado)';
  } else {
    content = content.replace(/<!-- AUTO:INICIO[\s\S]*?<!-- AUTO:FIN -->/, () => autoBlock);
    if (process.argv.includes('--write') || !process.argv.slice(2).length) {
      fs.writeFileSync(pendientesFile, content, 'utf8');
      pendientesEstado = `bloque AUTO regenerado (${lines.length} archivos)`;
    } else {
      pendientesEstado = 'bloque AUTO calculado (sin --write no se guardó)';
    }
  }
} catch (e) {
  pendientesEstado = `no se pudo leer/escribir PENDIENTES.md: ${e.message}`;
}

let bitacoraEstado = 'ausente docs/continuidad/BITACORA.md';
try {
  const bitacora = fs.readFileSync(bitacoraFile, 'utf8');
  bitacoraEstado = short && short !== '' && bitacora.includes(short)
    ? `BITACORA menciona HEAD ${short} (al día)`
    : `BITACORA NO menciona HEAD ${short || '?'} (pendiente documentar)`;
} catch (e) {
  bitacoraEstado = `no se pudo leer BITACORA.md: ${e.message}`;
}

console.log(`Rama: ${branch}`);
console.log(`HEAD: ${head}`);
console.log(`Sin commitear: ${lines.length} (${modified.length} modificados, ${untracked.length} nuevos)`);
console.log(`PENDIENTES: ${pendientesEstado}`);
console.log(`BITACORA: ${bitacoraEstado}`);
console.log('Siguiente: lee docs/continuidad/LEEME.md + PENDIENTES (AUTO+MANUAL) + IDEAS, y al terminar documenta en BITACORA.');
