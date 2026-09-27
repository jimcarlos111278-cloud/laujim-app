// Uso: <password por stdin> | node set-admin-pass.cjs <database.json>
// Actualiza admin_password_hash (formato scrypt$sal$digest). No imprime secretos.
const fs = require('fs');
const crypto = require('crypto');
const file = process.argv[2];
if (!file) { console.error('NO_FILE'); process.exit(1); }
let pass = '';
process.stdin.on('data', d => { pass += d; });
process.stdin.on('end', () => {
  pass = String(pass || '').replace(/[\r\n]+$/, '');
  if (!pass) { console.error('NO_PASS'); process.exit(1); }
  const salt = crypto.randomBytes(16).toString('base64url');
  const digest = crypto.scryptSync(pass, salt, 32).toString('base64url');
  const value = `scrypt$${salt}$${digest}`;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(j.settings)) j.settings = [];
  const ex = j.settings.find(s => s.key === 'admin_password_hash');
  if (ex) ex.value = value;
  else {
    const id = (j.nextId && j.nextId.settings) || (j.settings.length + 1);
    j.settings.push({ id, key: 'admin_password_hash', value });
    if (j.nextId) j.nextId.settings = id + 1;
  }
  fs.writeFileSync(file, JSON.stringify(j));
  console.log('ADMIN_PASS_UPDATED');
});
process.stdin.resume();
