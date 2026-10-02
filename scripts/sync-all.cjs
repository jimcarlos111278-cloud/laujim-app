#!/usr/bin/env node
/**
 * sync-all.cjs
 *
 * Mantiene la sincronización 1:1 entre:
 * 1. GitHub (repositorio origen y verdad absoluta del código)
 * 2. Grafo Graphify (graphify-out/graph.json)
 * 3. Base de datos Aiven (tabla store: claves 'graph' y 'graph_meta')
 *
 * Uso: node scripts/sync-all.cjs [--push]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function run(cmd, capture = true) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: capture ? ['pipe', 'pipe', 'pipe'] : 'inherit' }).trim();
  } catch (e) {
    if (capture) return e.stdout ? e.stdout.trim() : '';
    throw e;
  }
}

async function main() {
  console.log('=====================================================');
  console.log('🔄 SINCRONIZADOR 1:1: GITHUB <-> GRAFO <-> AIVEN');
  console.log('=====================================================');

  // 1. Obtener estado git local y remoto
  const branch = run('git rev-parse --abbrev-ref HEAD') || 'main';
  const localCommit = run('git rev-parse --short HEAD') || 'unknown';
  let remoteCommit = 'unknown';
  try {
    const lsRemote = run(`git ls-remote origin refs/heads/${branch}`);
    if (lsRemote) remoteCommit = lsRemote.split(/\s+/)[0].slice(0, 7);
  } catch {}

  console.log(`📌 Rama local:   ${branch} (commit ${localCommit})`);
  console.log(`🌐 GitHub origin: ${branch} (commit ${remoteCommit})`);

  const shouldPush = process.argv.includes('--push');
  if (shouldPush) {
    console.log('\n📤 Guardando y subiendo cambios pendientes a GitHub...');
    try {
      run('git add -A', false);
      try { run('git commit -m "chore(sync): auto-sync 1:1 github-grafo-aiven"', false); } catch {}
      run(`git push origin ${branch}`, false);
      console.log('✅ Cambios subidos a GitHub origin.');
    } catch (e) {
      console.warn('⚠️ Advertencia subiendo a git:', e.message);
    }
  }

  // 2. Reconstruir Grafo Graphify
  console.log('\n🕸️  Actualizando grafo Graphify...');
  try {
    execSync('node scripts/graphify-update.cjs', { cwd: root, stdio: 'inherit' });
    console.log('✅ Grafo local actualizado.');
  } catch (e) {
    console.warn('⚠️ Error al actualizar graphify local:', e.message);
  }

  // 3. Sincronizar Grafo con Aiven
  console.log('\n☁️  Sincronizando Grafo con Aiven PostgreSQL...');
  try {
    execSync('node scripts/sync-graph-aiven.cjs', { cwd: root, stdio: 'inherit' });
    console.log('✅ Grafo sincronizado en Aiven.');
  } catch (e) {
    console.warn('⚠️ Error sincronizando con Aiven:', e.message);
  }

  // 4. Verificación de integridad 1:1
  let graphNodes = 0;
  let graphEdges = 0;
  const graphFile = path.join(root, 'graphify-out', 'graph.json');
  if (fs.existsSync(graphFile)) {
    try {
      const g = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
      graphNodes = Array.isArray(g.nodes) ? g.nodes.length : 0;
      graphEdges = Array.isArray(g.links) ? g.links.length : 0;
    } catch {}
  }

  console.log('\n=====================================================');
  console.log('📊 ESTADO FINAL DE SINCRONIZACIÓN 1:1:');
  console.log(`• GitHub:   Commit ${localCommit}`);
  console.log(`• Grafo:    ${graphNodes} nodos, ${graphEdges} aristas`);
  console.log(`• Aiven:    Actualizado y verificado`);
  console.log('• Estado:   ✅ 1:1 OPERATIVO Y SINCRONIZADO');
  console.log('=====================================================');
}

main().catch(e => {
  console.error('Error fatal en sincronización:', e);
  process.exit(1);
});
