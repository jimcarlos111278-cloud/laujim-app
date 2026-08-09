/**
 * Persistence gate for code pushes.
 *
 * Verifies the durable Aiven store before a push and uploads the local runtime
 * snapshot only when data/database.json has an intentional working-tree change
 * (or when Aiven is empty). It never prints the connection string or values.
 *
 * Usage: npm run sync:aiven:pre-push
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'database.json');

function localDataChanged() {
  try {
    return Boolean(execFileSync('git', ['status', '--porcelain', '--', 'data/database.json'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch (error) {
    throw new Error(`No se pudo comprobar el estado de data/database.json: ${error.message}`);
  }
}

function collectionCount(data) {
  return Object.values(data).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
}

async function syncAiven() {
  const databaseUrl = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('AIVEN_DATABASE_URL no está configurada; se bloquea el push para no desplegar datos sin respaldo durable.');
  }
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error('No existe data/database.json; no se puede verificar el estado antes del push.');
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`data/database.json no es JSON válido: ${error.message}`);
  }
  const hasData = Object.values(data).some(value => Array.isArray(value) && value.length > 0);
  if (!hasData) throw new Error('data/database.json está vacío; se bloquea el push para proteger Aiven.');

  const changed = localDataChanged();
  const pool = new Pool({
    connectionString: databaseUrl.replace(/sslmode=[^&]+&?/, ''),
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )
    `);
    const existing = await pool.query('SELECT key, value FROM store WHERE key IN ($1, $2)', ['database', 'database_meta']);
    const hasAivenData = existing.rows.some(row => row.key === 'database' && row.value && typeof row.value === 'object');

    if (changed || !hasAivenData) {
      const client = await pool.connect();
      try {
        const now = new Date().toISOString();
        await client.query('BEGIN');
        await client.query(
          'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
          ['database', JSON.stringify(data)]
        );
        await client.query(
          'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
          ['database_meta', JSON.stringify({ updatedAt: now, source: 'pre-push' })]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      console.log(`[AIVEN] Estado local sincronizado antes del push (${collectionCount(data)} registros).`);
    } else {
      console.log('[AIVEN] Estado durable verificado; no se reemplazó Aiven con un snapshot local sin cambios.');
    }
  } finally {
    await pool.end();
  }
}

syncAiven().catch(error => {
  console.error(`[AIVEN] ${error.message}`);
  process.exitCode = 1;
});
