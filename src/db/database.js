// In-memory cloud-backed database (replaces IndexedDB/Dexie)
// Data is fetched from the server on startup and kept in sync via polling.
// All writes go directly to the server first.
// Falls back to embedded seed data when the server is unreachable.

const collections = [
  'apartments', 'tenants', 'contracts', 'payments', 'expenses',
  'utilityPayments', 'vacancies', 'familyMembers', 'settings',
  'passwords', 'photos', 'messages', 'users'
];

const SEED_DATA = {
  "users": [
    { "id": 1, "username": "admin", "password": "admin123", "role": "owner", "name": "Administrador" },
    { "id": 2, "username": "invitado", "password": "invitado123", "role": "guest", "name": "Invitado" }
  ],
  "apartments": [
    { "id": 1, "name": "101", "description": "", "monthlyRent": 0, "depositAmount": 0, "paymentDueDay": 5, "status": "occupied", "floor": 1, "area": 149, "rooms": 4, "bathrooms": 2, "notes": "", "nic": "", "waterPaymentCode": "11156", "waterReadingDay": 7, "gasPaymentCode": "1036207", "gasReadingDay": 7, "electricityPaymentCode": "", "electricityReadingDay": 21 },
    { "id": 2, "name": "102", "description": "", "monthlyRent": 750000, "depositAmount": 600000, "paymentDueDay": 5, "status": "occupied", "floor": 1, "area": 56, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "40135611", "waterReadingDay": 7, "gasPaymentCode": "1036207", "gasReadingDay": 7, "electricityPaymentCode": "", "electricityReadingDay": 21 },
    { "id": 3, "name": "201", "description": "", "monthlyRent": 1000000, "depositAmount": 700000, "paymentDueDay": 20, "status": "occupied", "floor": 2, "area": 57, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "975250", "waterReadingDay": 7, "gasPaymentCode": "66499522", "gasReadingDay": 7, "electricityPaymentCode": "", "electricityReadingDay": 21 },
    { "id": 4, "name": "202", "description": "", "monthlyRent": 1000000, "depositAmount": 800000, "paymentDueDay": 9, "status": "occupied", "floor": 2, "area": 56, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "975249", "waterReadingDay": 7, "gasPaymentCode": "66499584", "gasReadingDay": 7, "electricityPaymentCode": "", "electricityReadingDay": 21 },
    { "id": 5, "name": "203", "description": "", "monthlyRent": 1000000, "depositAmount": 800000, "paymentDueDay": 11, "status": "occupied", "floor": 2, "area": 58, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "975247", "waterReadingDay": 7, "gasPaymentCode": "66499518", "gasReadingDay": 7, "electricityPaymentCode": "7809672", "electricityReadingDay": 21 },
    { "id": 6, "name": "301", "description": "", "monthlyRent": 1100000, "depositAmount": 800000, "paymentDueDay": 24, "status": "occupied", "floor": 3, "area": 57, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "975245", "waterReadingDay": 7, "gasPaymentCode": "66499585", "gasReadingDay": 7, "electricityPaymentCode": "7889031", "electricityReadingDay": 21 },
    { "id": 7, "name": "302", "description": "", "monthlyRent": 1000000, "depositAmount": 800000, "paymentDueDay": 12, "status": "occupied", "floor": 3, "area": 56, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "975244", "waterReadingDay": 7, "gasPaymentCode": "66499526", "gasReadingDay": 7, "electricityPaymentCode": "7889033", "electricityReadingDay": 21 },
    { "id": 8, "name": "303", "description": "", "monthlyRent": 1000000, "depositAmount": 800000, "paymentDueDay": 6, "status": "occupied", "floor": 3, "area": 58, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "974325", "waterReadingDay": 7, "gasPaymentCode": "66499577", "gasReadingDay": 7, "electricityPaymentCode": "7889034", "electricityReadingDay": 21 },
    { "id": 9, "name": "401", "description": "", "monthlyRent": 1300000, "depositAmount": 800000, "paymentDueDay": 15, "status": "occupied", "floor": 4, "area": 57, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "937381", "waterReadingDay": 7, "gasPaymentCode": "66499532", "gasReadingDay": 7, "electricityPaymentCode": "7889036", "electricityReadingDay": 21 },
    { "id": 10, "name": "402", "description": "", "monthlyRent": 950000, "depositAmount": 700000, "paymentDueDay": 5, "status": "occupied", "floor": 4, "area": 56, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "800804", "waterReadingDay": 7, "gasPaymentCode": "66499573", "gasReadingDay": 7, "electricityPaymentCode": "7889037", "electricityReadingDay": 21 },
    { "id": 11, "name": "403", "description": "", "monthlyRent": 1000000, "depositAmount": 800000, "paymentDueDay": 20, "status": "occupied", "floor": 3, "area": 58, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "937380", "waterReadingDay": 7, "gasPaymentCode": "66499604", "gasReadingDay": 7, "electricityPaymentCode": "7889039", "electricityReadingDay": 21 },
    { "id": 12, "name": "501", "description": "", "monthlyRent": 1550000, "depositAmount": 600000, "paymentDueDay": 10, "status": "occupied", "floor": 5, "area": 57, "rooms": 2, "bathrooms": 1, "notes": "", "nic": "", "waterPaymentCode": "935937", "waterReadingDay": 7, "gasPaymentCode": "67426719", "gasReadingDay": 7, "electricityPaymentCode": "", "electricityReadingDay": 21 }
  ],
  "tenants": [
    { "id": 1, "name": "Luna", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 2, "name": "Samir", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 3, "name": "Cisney", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 4, "name": "Valery", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 5, "name": "Eukaris", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 6, "name": "Johovana", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 7, "name": "Edwin", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 8, "name": "Adela", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 9, "name": "Carlos", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 10, "name": "Yoeli", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" },
    { "id": 11, "name": "Dayanna", "phone": "", "documentId": "", "notes": "", "createdAt": "2026-07-20T06:47:58.630Z" }
  ],
  "contracts": [
    { "id": 1, "apartmentId": 2, "tenantId": 1, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 750000, "depositPaid": true },
    { "id": 2, "apartmentId": 3, "tenantId": 2, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 3, "apartmentId": 4, "tenantId": 3, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 4, "apartmentId": 5, "tenantId": 4, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 5, "apartmentId": 6, "tenantId": 5, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1100000, "depositPaid": true },
    { "id": 6, "apartmentId": 7, "tenantId": 6, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 7, "apartmentId": 8, "tenantId": 7, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 8, "apartmentId": 9, "tenantId": 8, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1300000, "depositPaid": true },
    { "id": 9, "apartmentId": 10, "tenantId": 9, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 950000, "depositPaid": true },
    { "id": 10, "apartmentId": 11, "tenantId": 10, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1000000, "depositPaid": true },
    { "id": 11, "apartmentId": 12, "tenantId": 11, "startDate": "2026-07-18T00:00:00.000Z", "endDate": null, "monthlyRent": 1550000, "depositPaid": true }
  ],
  "payments": [
    { "id": 1, "apartmentId": 10, "amount": 950000, "date": "2026-07-05", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 402 (Julio 2026)" },
    { "id": 2, "apartmentId": 1, "amount": 0, "date": "2026-07-05", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 101 (Julio 2026)" },
    { "id": 3, "apartmentId": 9, "amount": 1300000, "date": "2026-07-15", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 401 (Julio 2026)" },
    { "id": 4, "apartmentId": 7, "amount": 1000000, "date": "2026-07-12", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 302 (Julio 2026)" },
    { "id": 5, "apartmentId": 12, "amount": 1550000, "date": "2026-07-10", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 501 (Julio 2026)" },
    { "id": 6, "apartmentId": 4, "amount": 1000000, "date": "2026-07-09", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 202 (Julio 2026)" },
    { "id": 7, "apartmentId": 2, "amount": 750000, "date": "2026-07-05", "period": "2026-07", "type": "rent", "paymentMode": "full", "description": "Pago de arriendo - 102 (Julio 2026)" }
  ],
  "expenses": [],
  "utilityPayments": [],
  "vacancies": [],
  "familyMembers": [],
  "settings": [],
  "photos": [],
  "passwords": [
    { "id": 265, "type": "admin", "password": "laujim123" },
    { "id": 266, "apartmentId": 2, "password": "2779" },
    { "id": 267, "apartmentId": 3, "password": "6364" },
    { "id": 268, "apartmentId": 4, "password": "8808" },
    { "id": 269, "apartmentId": 5, "password": "2113" },
    { "id": 270, "apartmentId": 6, "password": "5082" },
    { "id": 271, "apartmentId": 7, "password": "8183" },
    { "id": 272, "apartmentId": 8, "password": "6493" },
    { "id": 273, "apartmentId": 9, "password": "3213" },
    { "id": 274, "apartmentId": 10, "password": "2365" },
    { "id": 275, "apartmentId": 11, "password": "5326" },
    { "id": 276, "apartmentId": 12, "password": "6494" }
  ],
  "messages": []
};

const data = {};
collections.forEach(name => { data[name] = []; });

function createTable(name) {
  const table = data[name];
  return {
    toArray: () => Promise.resolve([...table]),
    get: (id) => Promise.resolve(table.find(i => Number(i.id) === Number(id)) || null),
    add: (item) => {
      const entry = { ...item };
      if (!entry.id) entry.id = Date.now() + Math.floor(Math.random() * 999);
      table.push(entry);
      return Promise.resolve(entry.id);
    },
    put: (item) => {
      const idx = table.findIndex(i => Number(i.id) === Number(item.id));
      if (idx >= 0) { table[idx] = { ...table[idx], ...item }; }
      else { table.push(item); }
      return Promise.resolve(item.id);
    },
    update: (id, changes) => {
      const idx = table.findIndex(i => Number(i.id) === Number(id));
      if (idx >= 0) { table[idx] = { ...table[idx], ...changes }; return Promise.resolve(1); }
      return Promise.resolve(0);
    },
    delete: (id) => {
      const idx = table.findIndex(i => Number(i.id) === Number(id));
      if (idx >= 0) { table.splice(idx, 1); return Promise.resolve(1); }
      return Promise.resolve(0);
    },
    clear: () => { table.length = 0; return Promise.resolve(); },
    count: () => Promise.resolve(table.length),
    bulkAdd: (items) => { items.forEach(item => table.push(item)); return Promise.resolve(); },
    where: (fieldOrObj) => {
      if (typeof fieldOrObj === 'object') {
        const filters = fieldOrObj;
        return createWhereAPI(table, filters);
      }
      return createWhereFieldAPI(table, fieldOrObj);
    },
    orderBy: (field) => ({
      toArray: () => Promise.resolve([...table].sort((a, b) => (a[field] || '') < (b[field] || '') ? -1 : 1)),
    }),
  };
}

function createWhereFieldAPI(table, field) {
  return {
    equals: (val) => ({
      toArray: () => Promise.resolve(table.filter(i => i[field] === val)),
      first: () => Promise.resolve(table.find(i => i[field] === val) || null),
      sortBy: (sortField) => Promise.resolve(
        [...table.filter(i => i[field] === val)].sort((a, b) => {
          const av = a[sortField] || '';
          const bv = b[sortField] || '';
          return av < bv ? -1 : av > bv ? 1 : 0;
        })
      ),
      delete: async () => {
        const toDelete = table.filter(i => i[field] === val);
        toDelete.forEach(item => {
          const idx = table.indexOf(item);
          if (idx >= 0) table.splice(idx, 1);
        });
        return toDelete.length;
      },
    }),
    above: (val) => ({
      toArray: () => Promise.resolve(table.filter(i => i[field] > val)),
    }),
    between: (low, high) => ({
      toArray: () => Promise.resolve(table.filter(i => i[field] >= low && i[field] <= high)),
    }),
  };
}

function createWhereAPI(table, filters) {
  const entries = Object.entries(filters);
  return {
    first: () => Promise.resolve(table.find(item => entries.every(([k, v]) => item[k] === v)) || null),
    toArray: () => Promise.resolve(table.filter(item => entries.every(([k, v]) => item[k] === v))),
    delete: async () => {
      const toDelete = table.filter(item => entries.every(([k, v]) => item[k] === v));
      toDelete.forEach(item => {
        const idx = table.indexOf(item);
        if (idx >= 0) table.splice(idx, 1);
      });
      return toDelete.length;
    },
  };
}

const db = {};
collections.forEach(name => { db[name] = createTable(name); });

export function initDB() {
  // Load seed data as fallback if arrays are empty (server unavailable)
  collections.forEach(name => {
    if (data[name].length === 0 && SEED_DATA[name]) {
      const seed = JSON.parse(JSON.stringify(SEED_DATA[name]));
      data[name].length = 0;
      data[name].push(...seed);
    }
  });
}

export function setCollectionData(name, items) {
  // Never overwrite local data with empty arrays from server
  if (items.length === 0 && data[name].length > 0) return;
  data[name].length = 0;
  data[name].push(...items);
}

export function pushToCollection(name, item) {
  data[name].push(item);
}

export function removeFromCollection(name, id) {
  const idx = data[name].findIndex(i => Number(i.id) === Number(id));
  if (idx >= 0) data[name].splice(idx, 1);
}

export function replaceInCollection(name, id, item) {
  const idx = data[name].findIndex(i => Number(i.id) === Number(id));
  if (idx >= 0) data[name][idx] = item;
  else data[name].push(item);
}

export default db;
