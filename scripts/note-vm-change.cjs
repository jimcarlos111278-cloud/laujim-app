#!/usr/bin/env node
/**
 * note-vm-change.cjs
 *
 * Lo ejecuta el hook post-commit del clon de la VM: anota el commit en los
 * metadatos del grafo en Aiven (sin regenerar nodos; eso pasa en release-apk).
 * Uso: node scripts/note-vm-change.cjs
 * Silencioso ante fallos (nunca rompe un commit). Requiere GRAPH_READER_TOKEN
 * en el entorno o en /home/ubuntu/laujim-app/.env, y el servidor en :10000.
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function readToken() {
  if (String(process.env.GRAPH_READER_TOKEN || '').trim()) return process.env.GRAPH_READER_TOKEN.trim();
  for (const file of ['/home/ubuntu/laujim-app/.env']) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const match = line.match(/^GRAPH_READER_TOKEN=(.*)$/);
        if (match && match[1].trim()) return match[1].trim();
      }
    } catch {}
  }
  return '';
}

async function main() {
  const token = readToken();
  if (!token) return;
  const root = git(['rev-parse', '--show-toplevel'], process.cwd());
  const commit = git(['rev-parse', '--short', 'HEAD'], root);
  const message = git(['log', '-1', '--pretty=%s'], root);
  if (!commit) return;
  const res = await fetch('http://127.0.0.1:10000/api/graph/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-graph-token': token },
    body: JSON.stringify({ commit, message }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) console.log('Cambio anotado en el grafo: ' + commit);
}

main().catch(() => {});
