import Dexie from 'dexie';

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

db.version(5).stores({
  users: '++id, username, role',
  apartments: '++id, name, status, createdAt',
  tenants: '++id, name, email, documentId',
  contracts: '++id, apartmentId, tenantId, startDate, endDate',
  payments: '++id, apartmentId, contractId, date, type, period',
  utilityPayments: '++id, apartmentId, service, period, paid',
  expenses: '++id, apartmentId, date, category',
  vacancies: '++id, apartmentId, startDate',
  settings: '++id, key',
  photos: '++id, apartmentId',
  familyMembers: '++id, apartmentId, name',
  passwords: '++id, apartmentId, type',
});

const SEED_APARTMENTS = [
  { id: 1, name: '101 Casa', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 1, area: 0, rooms: 2, bathrooms: 2, waterPaymentCode: '11156', waterReadingDay: 7, gasPaymentCode: '1036207', gasReadingDay: 7, electricityPaymentCode: '', electricityReadingDay: 21 },
  { id: 2, name: '102 Aparta Estudio', monthlyRent: 750000, depositAmount: 600000, paymentDueDay: 5, status: 'occupied', floor: 1, area: 56, rooms: 2, bathrooms: 1, waterPaymentCode: '40135611', waterReadingDay: 7, gasPaymentCode: '1036207', gasReadingDay: 7, electricityPaymentCode: '', electricityReadingDay: 21 },
  { id: 3, name: '201', monthlyRent: 1000000, depositAmount: 700000, paymentDueDay: 20, status: 'occupied', floor: 2, area: 57, rooms: 2, bathrooms: 1, waterPaymentCode: '975250', waterReadingDay: 7, gasPaymentCode: '66499522', gasReadingDay: 7, electricityPaymentCode: '', electricityReadingDay: 21 },
  { id: 4, name: '202', monthlyRent: 1000000, depositAmount: 800000, paymentDueDay: 9, status: 'occupied', floor: 2, area: 56, rooms: 2, bathrooms: 1, waterPaymentCode: '975249', waterReadingDay: 7, gasPaymentCode: '66499584', gasReadingDay: 7, electricityPaymentCode: '', electricityReadingDay: 21 },
  { id: 5, name: '203', monthlyRent: 1000000, depositAmount: 800000, paymentDueDay: 11, status: 'occupied', floor: 2, area: 58, rooms: 2, bathrooms: 1, waterPaymentCode: '975247', waterReadingDay: 7, gasPaymentCode: '66499518', gasReadingDay: 7, electricityPaymentCode: '7809672', electricityReadingDay: 21 },
  { id: 6, name: '301', monthlyRent: 1100000, depositAmount: 800000, paymentDueDay: 24, status: 'occupied', floor: 3, area: 57, rooms: 2, bathrooms: 1, waterPaymentCode: '975245', waterReadingDay: 7, gasPaymentCode: '66499585', gasReadingDay: 7, electricityPaymentCode: '7889031', electricityReadingDay: 21 },
  { id: 7, name: '302', monthlyRent: 1000000, depositAmount: 800000, paymentDueDay: 12, status: 'occupied', floor: 3, area: 56, rooms: 2, bathrooms: 1, waterPaymentCode: '975244', waterReadingDay: 7, gasPaymentCode: '66499526', gasReadingDay: 7, electricityPaymentCode: '7889033', electricityReadingDay: 21 },
  { id: 8, name: '303', monthlyRent: 1000000, depositAmount: 800000, paymentDueDay: 6, status: 'occupied', floor: 3, area: 58, rooms: 2, bathrooms: 1, waterPaymentCode: '974325', waterReadingDay: 7, gasPaymentCode: '66499577', gasReadingDay: 7, electricityPaymentCode: '7889034', electricityReadingDay: 21 },
  { id: 9, name: '401', monthlyRent: 1300000, depositAmount: 800000, paymentDueDay: 15, status: 'occupied', floor: 4, area: 57, rooms: 2, bathrooms: 1, waterPaymentCode: '937381', waterReadingDay: 7, gasPaymentCode: '66499532', gasReadingDay: 7, electricityPaymentCode: '7889036', electricityReadingDay: 21 },
  { id: 10, name: '402', monthlyRent: 950000, depositAmount: 700000, paymentDueDay: 5, status: 'occupied', floor: 4, area: 56, rooms: 2, bathrooms: 1, waterPaymentCode: '800804', waterReadingDay: 7, gasPaymentCode: '66499573', gasReadingDay: 7, electricityPaymentCode: '7889037', electricityReadingDay: 21 },
  { id: 11, name: '403', monthlyRent: 1000000, depositAmount: 800000, paymentDueDay: 20, status: 'occupied', floor: 3, area: 58, rooms: 2, bathrooms: 1, waterPaymentCode: '937380', waterReadingDay: 7, gasPaymentCode: '66499604', gasReadingDay: 7, electricityPaymentCode: '7889039', electricityReadingDay: 21 },
  { id: 12, name: '501', monthlyRent: 1550000, depositAmount: 600000, paymentDueDay: 10, status: 'occupied', floor: 5, area: 57, rooms: 2, bathrooms: 1, waterPaymentCode: '935937', waterReadingDay: 7, gasPaymentCode: '67426719', gasReadingDay: 7, electricityPaymentCode: '', electricityReadingDay: 21 },
];

const SEED_TENANTS = [
  { id: 1, name: 'Luna', email: '', phone: '', documentId: '', notes: '' },
  { id: 2, name: 'Samir', email: '', phone: '', documentId: '', notes: '' },
  { id: 3, name: 'Cisney', email: '', phone: '', documentId: '', notes: '' },
  { id: 4, name: 'Valery', email: '', phone: '', documentId: '', notes: '' },
  { id: 5, name: 'Eukaris', email: '', phone: '', documentId: '', notes: '' },
  { id: 6, name: 'Johovana', email: '', phone: '', documentId: '', notes: '' },
  { id: 7, name: 'Edwin', email: '', phone: '', documentId: '', notes: '' },
  { id: 8, name: 'Adela', email: '', phone: '', documentId: '', notes: '' },
  { id: 9, name: 'Carlos', email: '', phone: '', documentId: '', notes: '' },
  { id: 10, name: 'Yoeli', email: '', phone: '', documentId: '', notes: '' },
  { id: 11, name: 'Dayanna', email: '', phone: '', documentId: '', notes: '' },
];

const SEED_CONTRACTS = [
  { id: 1, apartmentId: 2, tenantId: 1, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 750000, depositPaid: true },
  { id: 2, apartmentId: 3, tenantId: 2, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 3, apartmentId: 4, tenantId: 3, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 4, apartmentId: 5, tenantId: 4, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 5, apartmentId: 6, tenantId: 5, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1100000, depositPaid: true },
  { id: 6, apartmentId: 7, tenantId: 6, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 7, apartmentId: 8, tenantId: 7, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 8, apartmentId: 9, tenantId: 8, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1300000, depositPaid: true },
  { id: 9, apartmentId: 10, tenantId: 9, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 950000, depositPaid: true },
  { id: 10, apartmentId: 11, tenantId: 10, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1000000, depositPaid: true },
  { id: 11, apartmentId: 12, tenantId: 11, startDate: '2026-07-18T00:00:00.000Z', endDate: null, monthlyRent: 1550000, depositPaid: true },
];

const SEED_PASSWORDS = [
  { id: 1, type: 'admin', password: 'laujim123' },
  { id: 2, apartmentId: 2, password: '2779' },
  { id: 3, apartmentId: 3, password: '6364' },
  { id: 4, apartmentId: 4, password: '8808' },
  { id: 5, apartmentId: 5, password: '2113' },
  { id: 6, apartmentId: 6, password: '5082' },
  { id: 7, apartmentId: 7, password: '8183' },
  { id: 8, apartmentId: 8, password: '6493' },
  { id: 9, apartmentId: 9, password: '3213' },
  { id: 10, apartmentId: 10, password: '2365' },
  { id: 11, apartmentId: 11, password: '5326' },
  { id: 12, apartmentId: 12, password: '6494' },
];

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
  const pwdCount = await db.passwords.count();
  if (pwdCount === 0) {
    await db.passwords.bulkAdd(SEED_PASSWORDS);
  }
}

export default db;
