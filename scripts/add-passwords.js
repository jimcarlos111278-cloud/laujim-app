import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function generatePasswords(contracts, existingAdmin) {
  const used = new Set();
  const result = [];
  if (existingAdmin) result.push(existingAdmin);
  for (const c of contracts) {
    let pwd;
    do { pwd = String(Math.floor(1000 + Math.random() * 9000)); } while (used.has(pwd));
    used.add(pwd);
    result.push({ apartmentId: c.apartmentId, password: pwd });
  }
  return result;
}

const dbPath = join(root, 'data', 'database.json');
const db = JSON.parse(readFileSync(dbPath, 'utf-8'));

const existingAdmin = (db.passwords || []).find(p => p.type === 'admin') || { type: 'admin', password: 'laujim123' };
db.passwords = generatePasswords(db.contracts || [], existingAdmin);

writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
console.log('database.json actualizado con', db.passwords.length, 'passwords');

const dbCjsPath = join(root, 'db.cjs');
const seedCopy = JSON.parse(JSON.stringify(db));
const dbCjsContent = `const INITIAL_DATA = ${JSON.stringify(seedCopy, null, 2)};

module.exports = { INITIAL_DATA };
`;
writeFileSync(dbCjsPath, dbCjsContent, 'utf-8');
console.log('db.cjs actualizado');

console.log('\n--- CONTRASEÑAS ---');
db.passwords.forEach(p => {
  if (p.apartmentId) {
    const apt = db.apartments.find(a => a.id === p.apartmentId);
    const tenant = db.tenants.find(t => db.contracts.find(c => c.apartmentId === p.apartmentId)?.tenantId === t.id);
    console.log(`${apt?.name || 'Apto ' + p.apartmentId}: ${p.password} (${tenant?.name || ''})`);
  } else {
    console.log(`Admin: ${p.password}`);
  }
});
