#!/usr/bin/env node
/**
 * archive-graph.cjs
 *
 * Crea un snapshot histórico comprimido del grafo de conocimiento actual
 * (graphify-out/graph.json) en graphify-out/archive/.
 *
 * El grafo principal se regenera periódicamente con SOLO los archivos reales
 * del proyecto (gracias a .graphifyignore). Este script preserva una copia
 * comprimida del grafo completo en cada release, para poder consultar
 * versiones pasadas o hacer rollback si es necesario.
 *
 * Uso:
 *   node scripts/archive-graph.cjs [--label "texto-opcional"]
 *
 * Salida:
 *   graphify-out/archive/graph-<YYYY-MM-DD>[-<label>].json.gz
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const graphFile = path.join(root, 'graphify-out', 'graph.json');
const archiveDir = path.join(root, 'graphify-out', 'archive');

function main() {
  const args = process.argv.slice(2);
  const labelIdx = args.indexOf('--label');
  const label = labelIdx >= 0 ? args[labelIdx + 1] : null;

  if (!fs.existsSync(graphFile)) {
    console.error(`[archive-graph] No existe ${graphFile}. Nada que archivar.`);
    process.exit(1);
  }

  const stat = fs.statSync(graphFile);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);

  // Nombre del archivo: graph-<fecha>[-<label>].json.gz
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const suffix = label ? `-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const outFile = path.join(archiveDir, `graph-${date}${suffix}.json.gz`);

  fs.mkdirSync(archiveDir, { recursive: true });

  console.log(`[archive-graph] Archivo fuente: ${graphFile} (${sizeMB} MB)`);
  console.log(`[archive-graph] Comprimiendo...`);

  const input = fs.createReadStream(graphFile);
  const gzip = zlib.createGzip({ level: 9 });
  const output = fs.createWriteStream(outFile);

  input.pipe(gzip).pipe(output);

  output.on('finish', () => {
    const outStat = fs.statSync(outFile);
    const outMB = (outStat.size / (1024 * 1024)).toFixed(2);
    console.log(`[archive-graph] Snapshot guardado: ${outFile} (${outMB} MB)`);
    console.log(`[archive-graph] Listo.`);
  });

  output.on('error', (err) => {
    console.error(`[archive-graph] Error al escribir: ${err.message}`);
    process.exit(1);
  });
}

main();
