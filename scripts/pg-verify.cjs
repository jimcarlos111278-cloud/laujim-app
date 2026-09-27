// Uso: <password por stdin> | node pg-verify.cjs
// Lee el hash REAL de Postgres y lo verifica con node. Imprime solo booleanos.
const { Pool } = require('pg');
const crypto = require('crypto');
let p = '';
process.stdin.on('data', d => { p += d; });
process.stdin.on('end', async () => {
  p = String(p || '').replace(/[\r\n]+$/, '');
  console.log('GOT_LEN:', p.length);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await pool.query("SELECT value FROM store WHERE key = 'database'");
    const st = r.rows[0]?.value?.settings || [];
    const rows = st.filter(s => s.key === 'admin_password_hash');
    console.log('HASH_ROWS:', rows.length);
    for (const h of rows) {
      const parts = String(h.value || '').split('$');
      try {
        const e = Buffer.from(parts[2], 'base64url');
        const a = crypto.scryptSync(p, parts[1], e.length);
        console.log('VERIFY:', e.length === a.length && crypto.timingSafeEqual(e, a));
      } catch { console.log('VERIFY: err'); }
    }
  } catch (e) { console.log('PG_ERR'); }
  finally { try { await pool.end(); } catch {} }
});
process.stdin.resume();
