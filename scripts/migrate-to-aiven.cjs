const { readFileSync } = require('fs');
const { Pool } = require('pg');
const path = require('path');

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: Set DATABASE_URL env var first');
    process.exit(1);
  }

  const cleanUrl = url.replace(/sslmode=[^&]+&?/, '');
  const pool = new Pool({ connectionString: cleanUrl, ssl: { rejectUnauthorized: false } });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);

  const backupFile = path.join(__dirname, '..', 'backups', 'auto-latest.json');
  const data = JSON.parse(readFileSync(backupFile, 'utf-8'));

  await pool.query(
    'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    ['database', JSON.stringify(data)]
  );

  console.log('Datos migrados exitosamente a Aiven');
  await pool.end();
}

migrate().catch(e => { console.error('Error:', e.message); process.exit(1); });
