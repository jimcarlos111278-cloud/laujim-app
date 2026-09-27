// Diagnóstico: ¿a qué DB se conecta la app y tiene el hash nuevo?
// Solo imprime hostname + booleanos, nunca secretos ni hashes.
const { Pool } = require('pg');
(async () => {
  const raw = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL || '';
  try {
    const u = new URL(raw.replace(/sslmode=[^&]+&?/, ''));
    console.log('SRC:', process.env.AIVEN_DATABASE_URL ? 'AIVEN' : 'DATABASE_URL', 'HOST:', u.hostname);
  } catch { console.log('SRC:unparseable'); }
  const pool = new Pool({ connectionString: raw });
  try {
    const r = await pool.query("SELECT value FROM store WHERE key = 'database'");
    const db = r.rows[0]?.value;
    if (!db) { console.log('NO_DB_ROW'); return; }
    const st = Array.isArray(db.settings) ? db.settings : [];
    const h = st.find(s => s.key === 'admin_password_hash');
    console.log('HAS_HASH:', Boolean(h), 'VAL_LEN:', h ? String(h.value).length : 0);
  } catch (e) { console.log('PG_ERR:' + e.message.split('\n')[0]); }
  finally { try { await pool.end(); } catch {} }
})();
