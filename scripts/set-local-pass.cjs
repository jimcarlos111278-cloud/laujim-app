// Uso: node set-local-pass.cjs <db.json> <password>
// Misma lógica que hashAdminPassword() de server.cjs. No imprime secretos.
const fs = require('fs');
const crypto = require('crypto');
const file = process.argv[2];
const pass = String(process.argv[3] || '');
if (!file || !pass) { console.error('ARGS'); process.exit(1); }
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
// Autoverificación inmediata con verifyAdminPasswordHash:
const parts = value.split('$');
const expected = Buffer.from(parts[2], 'base64url');
const actual = crypto.scryptSync(pass, parts[1], expected.length);
console.log('SELF_VERIFY:', expected.length === actual.length && crypto.timingSafeEqual(expected, actual));
