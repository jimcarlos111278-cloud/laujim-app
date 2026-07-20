import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function generateRandomPwd(existing) {
  const used = new Set(existing);
  let pwd;
  do {
    pwd = String(Math.floor(1000 + Math.random() * 9000));
  } while (used.has(pwd));
  return pwd;
}

function generatePasswords(contracts) {
  const used = new Set();
  return contracts.map(c => {
    // Use month as seed but with random offset
    const month = new Date(c.startDate).getMonth() + 1;
    let pwd = String(month * 100 + Math.floor(Math.random() * 100)).padStart(4, '0').slice(-4);
    while (used.has(pwd)) {
      pwd = String(Math.floor(1000 + Math.random() * 9000));
    }
    used.add(pwd);
    return { apartmentId: c.apartmentId, password: pwd };
  });
}

const dbPath = join(root, 'data', 'database.json');
const db = JSON.parse(readFileSync(dbPath, 'utf-8'));

const tenantPasswords = generatePasswords(db.contracts || []);
const adminPassword = { type: 'admin', password: 'laujim123' };

const existingPwds = db.passwords || [];
const hasAdmin = existingPwds.find(p => p.type === 'admin');

const finalPasswords = [
  ...(hasAdmin ? [] : [adminPassword]),
  ...tenantPasswords,
];

// If there was an existing admin password, preserve it
if (hasAdmin) {
  finalPasswords.unshift(hasAdmin);
}

db.passwords = finalPasswords;
writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
console.log('database.json actualizado con', finalPasswords.length, 'passwords');

const dbCjsPath = join(root, 'db.cjs');
const seedCopy = JSON.parse(JSON.stringify(db));
const dbCjsContent = `const INITIAL_DATA = ${JSON.stringify(seedCopy, null, 2)};

module.exports = { INITIAL_DATA };
`;
writeFileSync(dbCjsPath, dbCjsContent, 'utf-8');
console.log('db.cjs actualizado');

console.log('\n--- CONTRASEÑAS DE INQUILINOS ---');
tenantPasswords.forEach(p => {
  const apt = db.apartments.find(a => a.id === p.apartmentId);
  const tenant = db.tenants.find(t => db.contracts.find(c => c.apartmentId === p.apartmentId)?.tenantId === t.id);
  console.log(`${apt?.name || 'Apto ' + p.apartmentId}: ${p.password} (${tenant?.name || ''})`);
});
console.log('Admin: laujim123');
