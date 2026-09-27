#!/usr/bin/env node
/**
 * backup-media-s3.cjs
 *
 * Sube a S3/R2 lo que solo vive en disco de la VM: fotos/uploads, backups
 * locales y snapshots del grafo. Segunda copia fuera de la VM.
 * Uso: npm run backup:media
 *
 * Usa las mismas variables del servidor: R2_ACCOUNT_ID, R2_BUCKET,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (R2_ENDPOINT opcional).
 * Omite archivos ya subidos con el mismo tamaño. Nunca imprime secretos.
 */
const fs = require('node:fs');
const path = require('node:path');
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');

const root = path.resolve(__dirname, '..');
const PREFIX = 'laujim-backups/';
const MAX_BYTES = 100 * 1024 * 1024;

const SOURCES = [
  { dir: 'uploads', prefix: 'uploads/' },
  { dir: 'Backup', prefix: 'backups-local/' },
  { dir: 'backups', prefix: 'backups-local/' },
  { dir: path.join('graphify-out', 'archive'), prefix: 'graph-archive/' },
  { dir: path.join('public', 'releases'), prefix: 'apk-releases/' },
];

function r2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  // El backup va a R2_BACKUP_BUCKET (laujim-backups); la app usa R2_BUCKET
  // (laujim-media) para su operación. Mismo par de llaves si el token cubre
  // ambos buckets.
  const bucket = String(process.env.R2_BACKUP_BUCKET || process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim();
  return { accountId, bucket, accessKeyId, secretAccessKey, endpoint };
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function main() {
  const cfg = r2Config();
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.endpoint) {
    console.error('[backup-media] R2 no configurado (falta R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ACCOUNT_ID).');
    process.exit(2);
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  const existing = new Map();
  let token;
  try {
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: PREFIX, ContinuationToken: token }));
      for (const obj of page.Contents || []) {
        existing.set(obj.Key, obj.Size);
      }
      token = page.IsTruncated ? page.NextContinuationToken : null;
    } while (token);
  } catch (error) {
    console.error(`[backup-media] No se pudo listar el bucket: ${error.message}`);
    process.exit(1);
  }

  let uploaded = 0;
  let skipped = 0;
  for (const source of SOURCES) {
    const absDir = path.join(root, source.dir);
    for (const full of walk(absDir)) {
      const stat = fs.statSync(full);
      if (stat.size > MAX_BYTES) {
        console.log(`[backup-media] Omitido por tamaño: ${path.relative(root, full)}`);
        continue;
      }
      const key = PREFIX + source.prefix + path.relative(absDir, full).split(path.sep).join('/');
      if (existing.get(key) === stat.size) {
        skipped++;
        continue;
      }
      await s3.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: fs.readFileSync(full) }));
      uploaded++;
    }
  }
  console.log(`[backup-media] Listo: ${uploaded} subidos, ${skipped} ya estaban.`);
}

main().catch(error => {
  console.error(`[backup-media] ${error.message}`);
  process.exit(1);
});
