#!/usr/bin/env node
/**
 * harness-continuity.cjs
 *
 * Registro automático de cada tarea ejecutada por el harness/WhatsApp
 * (opencode-bridge.cjs → `opencode run`). Lo invoca el puente al cerrar una
 * tarea con escritura; también sirve manual:
 *   node scripts/harness-continuity.cjs --prompt "..." --mode code --write true --ok true --output "..."
 *
 * Hace (todo best-effort, nunca rompe el puente):
 * 1. Si BITACORA.md ya menciona el HEAD o el snippet de la tarea, no duplica.
 * 2. Si no, agrega entrada origen `harness-WhatsApp` con tarea, resultado y
 *    archivos tocados (git status, tope 20).
 * 3. Regenera el bloque AUTO de PENDIENTES.md (vía continuidad.cjs).
 * NO hace commit/push ni llama a note-vm-change (eso lo cubre el agente y el
 * hook post-commit; aquí evitamos spam). No imprime secretos.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bitacoraFile = path.join(root, 'docs', 'continuidad', 'BITACORA.md');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] || '') : '';
}

function main() {
  const prompt = arg('prompt').slice(0, 300);
  const mode = arg('mode') || 'code';
  const write = /^(1|true|yes)$/i.test(arg('write') || 'true');
  const ok = /^(1|true|yes)$/i.test(arg('ok') || 'true');
  const output = arg('output').slice(0, 500);
  if (!write || mode !== 'code') return;

  let bitacora = '';
  try {
    bitacora = fs.readFileSync(bitacoraFile, 'utf8');
  } catch {
    return;
  }
  const head = git(['log', '-1', '--pretty=%h']) || '';
  // Dedup SOLO por snippet de la tarea: el HEAD no bloquea (varias tareas
  // pueden ocurrir sobre el mismo commit; cada una deja su entrada).
  const snippet = prompt.slice(0, 60);
  if (snippet && bitacora.includes(snippet)) return;

  const today = new Date().toISOString().slice(0, 10);
  const porcelain = git(['status', '--porcelain', '-uall']);
  const files = porcelain ? porcelain.split('\n').slice(0, 20).map((l) => `- \`${l.trim()}\``).join('\n') : '(sin cambios detectados)';
  const entry = [
    '',
    `## ${today} — tarea harness/WhatsApp (auto)`,
    '',
    '- **Origen:** harness-WhatsApp.',
    `- **Qué:** ${prompt || '(tarea sin prompt registrado)'}`,
    `- **Resultado:** ${ok ? 'ok' : 'falló'}${output ? ` — ${output}` : ''}`,
    '- **Archivos tocados (snapshot al cerrar la tarea):**',
    files,
    `- **Commit:** \`${head || 'sin commitear aún'}\` (si el agente commiteó después, completar el hash).`,
    '- **Verificar:** `node scripts/continuidad.cjs` + revisar diff antes de push.',
    '',
  ].join('\n');
  try {
    const marker = '## Plantilla para la próxima entrada';
    if (bitacora.includes(marker)) {
      bitacora = bitacora.replace(marker, `${entry}\n${marker}`);
    } else {
      bitacora += entry;
    }
    fs.writeFileSync(bitacoraFile, bitacora, 'utf8');
  } catch {
    return;
  }
  try {
    spawnSync('node', [path.join(root, 'scripts', 'continuidad.cjs')], { cwd: root, timeout: 20000, stdio: 'ignore' });
  } catch { /* best-effort */ }
}

main();
