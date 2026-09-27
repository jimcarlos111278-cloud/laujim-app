#!/usr/bin/env node
/**
 * sync-graph-aiven.cjs
 *
 * Sube el grafo local (graphify-out/graph.json) a Aiven (claves
 * graph/graph_meta) para que cualquier IA lo consulte por HTTP sin clonar.
 * Uso: node scripts/sync-graph-aiven.cjs [--strict]
 * Automático en cada release-apk. Requiere AIVEN_DATABASE_URL o DATABASE_URL.
 * Sin --strict: advierte y sale 0 si no hay DB (no rompe releases en PCs sin Aiven).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const strict = process.argv.includes('--strict');

function dbUrl() {
  return String(process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL || '').trim();
}

async function main() {
  const url = dbUrl();
  if (!url) {
    console.log('[sync-graph] Sin URL de base de datos; omito.');
    if (strict) process.exit(1);
    return;
  }
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    console.log('[sync-graph] Falta dependencia pg; omito.');
    if (strict) process.exit(1);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(root, 'graphify-out', 'graph.json'), 'utf8'));
  } catch {
    console.error('[sync-graph] No hay graphify-out/graph.json local.');
    process.exit(1);
  }
  if (!Array.isArray(parsed.nodes)) {
    console.error('[sync-graph] graph.json inválido (sin nodes).');
    process.exit(1);
  }
  const meta = {
    updatedAt: new Date().toISOString(),
    source: 'sync-graph-script',
    nodeCount: parsed.nodes.length,
    linkCount: Array.isArray(parsed.links) ? parsed.links.length : null,
    size: Buffer.byteLength(JSON.stringify(parsed)),
    builtAtCommit: parsed.built_at_commit || null,
  };
  const pool = new Pool({
    connectionString: url.replace(/sslmode=[^&]+&?/, ''),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query('INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['graph', JSON.stringify(parsed)]);
    await pool.query('INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['graph_meta', JSON.stringify(meta)]);
    console.log(`[sync-graph] Grafo en Aiven: ${meta.nodeCount} nodos.`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch(error => {
  console.error('[sync-graph] ' + error.message);
  process.exit(1);
});
