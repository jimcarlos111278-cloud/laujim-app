// Uso: node pg-del-hash.cjs (dentro del contenedor laujim-app).
// Elimina admin_password_hash de Postgres para que mande ADMIN_PASSWORD del .env.
// Solo imprime conteos, nunca secretos.
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query("SELECT value FROM store WHERE key = 'database'");
    const db = r.rows[0]?.value;
    if (!db) { console.log('NO_DB_ROW'); process.exit(1); }
    const before = (db.settings || []).length;
    db.settings = (db.settings || []).filter(s => s.key !== 'admin_password_hash');
    await pool.query(
      "INSERT INTO store (key, value) VALUES ('database', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [db]
    );
    console.log('HASH_REMOVED settings ' + before + '->' + db.settings.length);
  } catch (e) { console.log('PG_ERR:' + String(e.message).split('\n')[0]); process.exit(1); }
  finally { try { await pool.end(); } catch {} }
})();
