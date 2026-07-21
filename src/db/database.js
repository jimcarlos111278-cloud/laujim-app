// In-memory cloud-backed database (replaces IndexedDB/Dexie)
// Data is fetched from the server on startup and kept in sync via polling.
// All writes go directly to the server first.

const collections = [
  'apartments', 'tenants', 'contracts', 'payments', 'expenses',
  'utilityPayments', 'vacancies', 'familyMembers', 'settings',
  'passwords', 'photos', 'messages', 'users'
];

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

export function initDB() { /* cloud-backed - no IndexedDB init needed */ }

export function setCollectionData(name, items) {
  data[name] = items;
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
