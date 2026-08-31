/**
 * npm run sync-seed
 *
 * Connects to a running server (default http://localhost:1011),
 * fetches all data from /api/data/all, and regenerates:
 *   - data/database.json
 *   - db.cjs
 *   - src/db/database.js (apartments/tenants/contracts seed)
 *
 * Usage: npm run sync-seed
 *        SYNC_URL=http://my-server.com:1011 npm run sync-seed
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const BASE = (process.env.SYNC_URL || 'http://localhost:1011').replace(/\/+$/, '');
const AUTH = 'laujim laujim';
const API = BASE + (BASE.includes('/api') ? '' : '/api');

async function main() {
  console.log(`Conectando a ${API}/data/all ...`);

  const res = await fetch(`${API}/data/all`, {
    headers: { 'x-auth-token': AUTH },
  });

  if (!res.ok) {
    console.error(`ERROR: ${res.status} ${res.statusText}`);
    console.error('Asegúrate de que el servidor esté corriendo (npm start)');
    process.exit(1);
  }

  const data = await res.json();
  console.log(`Datos recibidos:`);
  Object.entries(data).forEach(([key, val]) => {
    console.log(`  ${key}: ${Array.isArray(val) ? val.length : 'N/A'}`);
  });

  // 1. Write data/database.json
  const dataPath = join(root, 'data', 'database.json');
  writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n✓ data/database.json escrito`);

  // 2. Write db.cjs (server seed)
  // Strip createdAt so server generates fresh timestamps on first load
  const seedCopy = JSON.parse(JSON.stringify(data));
  const dbCjsContent = `const INITIAL_DATA = ${JSON.stringify(seedCopy, null, 2)};

module.exports = { INITIAL_DATA };
`;
  const dbCjsPath = join(root, 'db.cjs');
  writeFileSync(dbCjsPath, dbCjsContent, 'utf-8');
  console.log(`✓ db.cjs actualizado`);

  // 3. Write src/db/database.js (Dexie seed)
  const apts = (data.apartments || []).map(a => ({
    id: a.id, name: a.name, monthlyRent: a.monthlyRent, depositAmount: a.depositAmount,
    paymentDueDay: a.paymentDueDay, status: a.status, floor: a.floor, area: a.area,
    rooms: a.rooms, bathrooms: a.bathrooms, waterPaymentCode: a.waterPaymentCode || '',
    waterReadingDay: a.waterReadingDay || 7, gasPaymentCode: a.gasPaymentCode || '',
    gasReadingDay: a.gasReadingDay || 7, electricityPaymentCode: a.electricityPaymentCode || '',
    electricityReadingDay: a.electricityReadingDay || 21,
  }));
  const tens = (data.tenants || []).map(t => ({
    id: t.id, name: t.name, email: t.email || '', phone: t.phone || '',
    documentId: t.documentId || '', notes: t.notes || '',
  }));
  const cons = (data.contracts || []).map(c => ({
    id: c.id, apartmentId: c.apartmentId, tenantId: c.tenantId,
    startDate: c.startDate, endDate: c.endDate || null,
    monthlyRent: c.monthlyRent, depositPaid: c.depositPaid,
  }));

  const dbJsContent = `import Dexie from 'dexie';

const db = new Dexie('ApartmentManager');

db.version(3).stores({
  users: '++id, username, role',
  apartments: '++id, name, status, createdAt',
  tenants: '++id, name, email, documentId',
  contracts: '++id, apartmentId, tenantId, startDate, endDate',
  payments: '++id, apartmentId, contractId, date, type',
  utilityPayments: '++id, apartmentId, service, period',
  expenses: '++id, apartmentId, date, category',
  vacancies: '++id, apartmentId, startDate',
  settings: '++id, key',
  photos: '++id, apartmentId',
  familyMembers: '++id, apartmentId, name',
});

db.version(4).stores({
  users: '++id, username, role',
  apartments: '++id, name, status, createdAt',
  tenants: '++id, name, email, documentId',
  contracts: '++id, apartmentId, tenantId, startDate, endDate',
  payments: '++id, apartmentId, contractId, date, type',
  utilityPayments: '++id, apartmentId, service, period, paid',
  expenses: '++id, apartmentId, date, category',
  vacancies: '++id, apartmentId, startDate',
  settings: '++id, key',
  photos: '++id, apartmentId',
  familyMembers: '++id, apartmentId, name',
});

const SEED_APARTMENTS = ${JSON.stringify(apts, null, 2)};

const SEED_TENANTS = ${JSON.stringify(tens, null, 2)};

const SEED_CONTRACTS = ${JSON.stringify(cons, null, 2)};

export async function initDB() {
  const count = await db.users.count();
  if (count === 0) {
    await db.users.bulkAdd([
      { username: 'admin', password: 'admin123', role: 'owner', name: 'Administrador' },
      { username: 'invitado', password: 'invitado123', role: 'guest', name: 'Invitado' },
    ]);
  }
  const aptCount = await db.apartments.count();
  if (aptCount === 0) {
    await db.apartments.bulkAdd(SEED_APARTMENTS.map(a => ({ ...a, description: '', notes: '', nic: '', createdAt: new Date().toISOString() })));
  }
  const tenCount = await db.tenants.count();
  if (tenCount === 0) {
    await db.tenants.bulkAdd(SEED_TENANTS.map(t => ({ ...t, createdAt: new Date().toISOString() })));
  }
  const conCount = await db.contracts.count();
  if (conCount === 0) {
    await db.contracts.bulkAdd(SEED_CONTRACTS.map(c => ({ ...c, createdAt: new Date().toISOString() })));
  }
}

export default db;
`;
  const dbJsPath = join(root, 'src', 'db', 'database.js');
  writeFileSync(dbJsPath, dbJsContent, 'utf-8');
  console.log(`✓ src/db/database.js actualizado`);

  console.log('\n✅ Sync completo. Haz commit y push para actualizar Render.');
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
