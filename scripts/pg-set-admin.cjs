// Uso: <password por stdin> | node pg-set-admin.cjs
// Corre DENTRO del contenedor laujim-app (tiene pg + DATABASE_URL).
// Actualiza admin_password_hash en Postgres (fuente real de verdad).
// Solo imprime estado, nunca secretos.
const { Pool } = require('pg');
const crypto = require('crypto');
let p = '';
process.stdin.on('data', d => { p += d; });
process.stdin.on('end', async () => {
  p = String(p || '').replace(/[\r\n]+$/, '');
  if (!p) { console.log('NO_PASS'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query("SELECT value FROM store WHERE key = 'database'");
    if (!r.rows[0]) { console.log('NO_DB_ROW'); process.exit(1); }
    const db = r.rows[0].value;
    const salt = crypto.randomBytes(16).toString('base64url');
    const digest = crypto.scryptSync(p, salt, 32).toString('base64url');
    const value = `scrypt$${salt}$${digest}`;
    if (!Array.isArray(db.settings)) db.settings = [];
    const ex = db.settings.find(s => s.key === 'admin_password_hash');
    if (ex) ex.value = value;
    else db.settings.push({ id: 1, key: 'admin_password_hash', value });
    await pool.query(
      "INSERT INTO store (key, value) VALUES ('database', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [db]
    );
    const parts = value.split('$');
    const e = Buffer.from(parts[2], 'base64url');
    const a = crypto.scryptSync(p, parts[1], e.length);
    console.log('PG_UPDATED_SELF_VERIFY:', e.length === a.length && crypto.timingSafeEqual(e, a));
  } catch (err) { console.log('PG_ERR:' + err.message); process.exit(1); }
  finally { try { await pool.end(); } catch {} }
});
process.stdin.resume();
