// In-memory client cache. Sensitive records are fetched only after an admin session.
const collections = [
  'apartments', 'tenants', 'contracts', 'payments', 'expenses',
  'utilityPayments', 'vacancies', 'familyMembers', 'settings',
  'passwords', 'photos', 'messages', 'users'
];

const data = Object.fromEntries(collections.map(name => [name, []]));

function matches(item, filters) {
  return Object.entries(filters).every(([key, value]) => item[key] === value);
}

function tableFor(name) {
  const table = data[name];
  return {
    toArray: () => Promise.resolve([...table]),
    get: id => Promise.resolve(table.find(item => Number(item.id) === Number(id)) || null),
    add: item => {
      const entry = { ...item, id: item.id || Date.now() + Math.floor(Math.random() * 999) };
      table.push(entry);
      return Promise.resolve(entry.id);
    },
    put: item => {
      const index = table.findIndex(entry => Number(entry.id) === Number(item.id));
      if (index >= 0) table[index] = { ...table[index], ...item };
      else table.push(item);
      return Promise.resolve(item.id);
    },
    update: (id, changes) => {
      const index = table.findIndex(entry => Number(entry.id) === Number(id));
      if (index < 0) return Promise.resolve(0);
      table[index] = { ...table[index], ...changes };
      return Promise.resolve(1);
    },
    delete: id => {
      const index = table.findIndex(entry => Number(entry.id) === Number(id));
      if (index < 0) return Promise.resolve(0);
      table.splice(index, 1);
      return Promise.resolve(1);
    },
    clear: () => { table.length = 0; return Promise.resolve(); },
    count: () => Promise.resolve(table.length),
    bulkAdd: items => { table.push(...items); return Promise.resolve(); },
    where: fieldOrFilters => {
      const filtered = typeof fieldOrFilters === 'object'
        ? () => table.filter(item => matches(item, fieldOrFilters))
        : value => table.filter(item => item[fieldOrFilters] === value);
      if (typeof fieldOrFilters === 'object') {
        return {
          first: () => Promise.resolve(filtered()[0] || null),
          toArray: () => Promise.resolve(filtered()),
          delete: () => {
            const remove = new Set(filtered());
            for (let i = table.length - 1; i >= 0; i--) if (remove.has(table[i])) table.splice(i, 1);
            return Promise.resolve(remove.size);
          },
        };
      }
      return {
        equals: value => ({
          toArray: () => Promise.resolve(filtered(value)),
          first: () => Promise.resolve(filtered(value)[0] || null),
          sortBy: key => Promise.resolve([...filtered(value)].sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')))),
          delete: () => {
            const remove = new Set(filtered(value));
            for (let i = table.length - 1; i >= 0; i--) if (remove.has(table[i])) table.splice(i, 1);
            return Promise.resolve(remove.size);
          },
        }),
        above: value => ({ toArray: () => Promise.resolve(table.filter(item => item[fieldOrFilters] > value)) }),
        between: (low, high) => ({ toArray: () => Promise.resolve(table.filter(item => item[fieldOrFilters] >= low && item[fieldOrFilters] <= high)) }),
      };
    },
    orderBy: field => ({ toArray: () => Promise.resolve([...table].sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')))) }),
  };
}

const db = Object.fromEntries(collections.map(name => [name, tableFor(name)]));

export function initDB() {}

export function setCollectionData(name, items) {
  if (!data[name]) return;
  data[name].length = 0;
  data[name].push(...items);
}

export function pushToCollection(name, item) { if (data[name]) data[name].push(item); }

export function removeFromCollection(name, id) {
  const index = data[name]?.findIndex(item => Number(item.id) === Number(id)) ?? -1;
  if (index >= 0) data[name].splice(index, 1);
}

export function replaceInCollection(name, id, item) {
  const index = data[name]?.findIndex(entry => Number(entry.id) === Number(id)) ?? -1;
  if (index >= 0) data[name][index] = item;
  else if (data[name]) data[name].push(item);
}

export default db;
