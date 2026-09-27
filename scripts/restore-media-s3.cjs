#!/usr/bin/env node
/**
 * restore-media-s3.cjs
 *
 * Inverso de backup-media-s3.cjs: descarga desde S3/R2 (prefijo
 * laujim-backups/) hacia el disco local. Para reconstruir una VM.
 * Uso: node scripts/restore-media-s3.cjs [--dry-run] [--only <prefijo>]
 *   prefijos: uploads | backups-local | graph-archive | apk-releases
 *
 * Omite archivos que ya existen con el mismo tamaño. Nunca imprime secretos.
 */
const fs = require('node:fs');
const path = require('node:path');
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const root = path.resolve(__dirname, '..');
const PREFIX = 'laujim-backups/';

const TARGETS = {
  'uploads/': 'uploads',
  'backups-local/': 'backups',
  'graph-archive/': path.join('graphify-out', 'archive'),
  'apk-releases/': path.join('public', 'releases'),
};

function r2Config() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(process.env.R2_BACKUP_BUCKET || process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim();
  return { accountId, bucket, accessKeyId, secretAccessKey, endpoint };
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  const cfg = r2Config();
  if (!cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.endpoint) {
    console.error('[restore-media] R2 no configurado (falta R2_BACKUP_BUCKET/R2_BUCKET o credenciales).');
    process.exit(2);
  }
  const s3 = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

  let downloaded = 0;
  let skipped = 0;
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const obj of page.Contents || []) {
      const rel = obj.Key.slice(PREFIX.length);
      const [prefix, ...rest] = [rel.slice(0, rel.indexOf('/') + 1), rel.slice(rel.indexOf('/') + 1)];
      const targetBase = TARGETS[prefix];
      if (!targetBase) continue;
      if (only && only !== prefix.replace(/\/$/, '')) continue;
      const dest = path.join(root, targetBase, ...rest);
      let localSize = -1;
      try {
        localSize = fs.statSync(dest).size;
      } catch {}
      if (localSize === obj.Size) {
        skipped++;
        continue;
      }
      console.log(`${dryRun ? 'FALTARÍA' : 'BAJANDO'} ${rel} (${obj.Size} B)`);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const got = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: obj.Key }));
        fs.writeFileSync(dest, await streamToBuffer(got.Body));
        downloaded++;
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : null;
  } while (token);
  console.log(`[restore-media] Listo${dryRun ? ' (simulación)' : ''}: ${downloaded} descargados, ${skipped} ya estaban.`);
}

main().catch(error => {
  console.error(`[restore-media] ${error.message}`);
  process.exit(1);
});
