// Uso: <password por stdin> | node verify-admin.cjs
// Verifica admin_password_hash del DB vivo con la misma lógica de server.cjs.
// Solo imprime true/false, nunca secretos.
const fs = require('fs');
const crypto = require('crypto');
let found = null;
try {
  const j = JSON.parse(fs.readFileSync('/app/data/database.json', 'utf8'));
  found = (j.settings || []).find(s => s.key === 'admin_password_hash') || null;
} catch (e) { console.log('DB_READ_FAIL'); process.exit(0); }
let p = '';
process.stdin.on('data', d => { p += d; });
process.stdin.on('end', () => {
  p = String(p || '').replace(/[\r\n]+$/, '');
  if (!found) { console.log('NO_HASH'); return; }
  const parts = String(found.value || '').split('$');
  try {
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(p, parts[1], expected.length);
    console.log('VERIFY:', expected.length === actual.length && crypto.timingSafeEqual(expected, actual));
  } catch (e) { console.log('VERIFY_ERR'); }
});
process.stdin.resume();
