#!/usr/bin/env node
/**
 * handoff.cjs
 *
 * Resumen de continuidad para cambiar de PC/IA sin perder el punto:
 * rama, últimos commits, archivos sin commitear y frescura del grafo.
 * Uso: node scripts/handoff.cjs
 * Solo lectura. No imprime secretos.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function fmtDate(value) {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return String(value);
  return new Date(time).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

const branch = git(['branch', '--show-current']) || '?';
console.log(`Rama: ${branch}`);
console.log('--- últimos 5 commits ---');
console.log(git(['log', '--oneline', '-5']) || '(sin historial)');
console.log('--- sin commitear ---');
const porcelain = git(['status', '--porcelain']);
if (!porcelain) {
  console.log('(árbol limpio: puedes cambiar de PC sin dejar nada)');
} else {
  const lines = porcelain.split('\n');
  console.log(`${lines.length} archivo(s):`);
  for (const line of lines.slice(0, 20)) console.log(`  ${line}`);
  if (lines.length > 20) console.log(`  ... y ${lines.length - 20} más`);
}
console.log('--- grafo ---');
const graphFile = path.join(root, 'graphify-out', 'graph.json');
let graphMtime = null;
try {
  graphMtime = fs.statSync(graphFile).mtime;
} catch {}
const graphCommit = git(['log', '-1', '--format=%ci %h', '--', 'graphify-out/graph.json']);
console.log(`disco: ${graphMtime ? fmtDate(graphMtime) : 'ausente'} | GitHub: ${graphCommit || 'sin commitear'}`);
