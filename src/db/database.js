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
    const names = [
      '101 Casa', '102 Aparta Estudio',
      '201', '202', '203',
      '301', '302', '303',
      '401', '402', '403', '404',
    ];
    const apts = names.map((name, i) => ({
      name,
      description: '',
      monthlyRent: 0,
      depositAmount: 0,
      paymentDueDay: 5,
      status: 'vacant',
      floor: Math.floor(i / 4) + 1,
      area: 0,
      rooms: i === 1 ? 1 : (i % 3 === 0 ? 3 : 2),
      bathrooms: i === 1 ? 1 : 2,
      notes: '',
      nic: '',
      waterReadingDay: 10,
      gasReadingDay: 12,
      electricityReadingDay: 15,
      createdAt: new Date().toISOString(),
    }));
    await db.apartments.bulkAdd(apts);
  }
}

export default db;
