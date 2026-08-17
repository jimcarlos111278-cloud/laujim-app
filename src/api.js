import db, { setCollectionData, pushToCollection, replaceInCollection, removeFromCollection } from './db/database';
import { AUTH_TOKEN, getBase, getRawBase } from './utils/config';

export function refreshBase() {}

// ─── Server API helpers ───

async function serverReq(method, collection, id, body) {
  const base = getBase();
  let url = base + '/' + collection;
  if (id) url += '/' + id;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const message = await res.text();
    const error = new Error(message || `Server responded with ${res.status}`);
    error.status = res.status;
    error.url = url;
    throw error;
  }
  return res.json();
}

async function getServerVersion() {
  try {
    const res = await fetch(getBase() + '/version', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return res.json();
  } catch { return null; }
}

function uploadFile(url, file, extra) {
  const fd = new FormData();
  fd.append(file.fieldname || 'photo', file.file || file);
  Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, v));
  return fetch((getRawBase()) + url, { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN }, body: fd }).then(async r => {
    if (!r.ok) {
      const payload = await r.json().catch(() => ({}));
      const error = new Error(payload.error || r.statusText || `Error ${r.status}`);
      error.status = r.status;
      throw error;
    }
    return r.json();
  });
}

// ─── Cloud sync: fetch ALL data from server ───

const CLOUD_COLLECTIONS = ['apartments', 'tenants', 'contracts', 'payments', 'expenses', 'utilityPayments', 'vacancies', 'familyMembers', 'settings', 'passwords', 'photos'];

let lastCloudSyncStatus = {
  ok: false,
  status: null,
  error: null,
  failedCollections: [],
  completedAt: null,
};

export function getCloudSyncStatus() {
  return { ...lastCloudSyncStatus, failedCollections: [...lastCloudSyncStatus.failedCollections] };
}

export async function refreshAllFromServer() {
  const failures = [];
  for (const col of CLOUD_COLLECTIONS) {
    try {
      const serverData = await serverReq('GET', col);
      if (Array.isArray(serverData)) {
        setCollectionData(col, serverData);
      } else {
        const error = new Error('El servidor devolvió una colección inválida');
        error.status = 502;
        throw error;
      }
    } catch (e) {
      failures.push({ collection: col, status: e.status || null, message: e.message || 'Error de sincronización' });
    }
  }
  const firstFailure = failures[0] || null;
  lastCloudSyncStatus = {
    ok: failures.length === 0,
    status: firstFailure?.status || null,
    error: firstFailure?.message || null,
    failedCollections: failures.map(item => item.collection),
    completedAt: new Date().toISOString(),
  };
  return lastCloudSyncStatus.ok;
}

// ─── Data version polling: reload page when data changes on server ───

let lastDataVersion = 0;
let versionPollInterval = null;
let suppressDataReloadUntil = 0;

// A local edit already updates the current screen. Do not let the generic
// external-change poll reload that screen while the edit is being committed.
// The server still remains the source of truth; this only avoids losing the
// user's scanner context during the short persistence window.
function markLocalMutation() {
  suppressDataReloadUntil = Date.now() + 15_000;
}

async function getDataVersion() {
  try {
    return await serverReq('GET', 'data-version');
  } catch { return null; }
}

export function startDataVersionPolling(ms = 3000) {
  stopDataVersionPolling();
  const startTime = Date.now();
  // First call just stores the current version
  getDataVersion().then(res => { if (res) lastDataVersion = res.version; });
  versionPollInterval = setInterval(async () => {
    try {
      const res = await getDataVersion();
      if (res && res.version && lastDataVersion > 0 && res.version !== lastDataVersion) {
        if (Date.now() < suppressDataReloadUntil) {
          lastDataVersion = res.version;
          return;
        }
        // Skip reload within first 12 seconds (let initial sync settle)
        if (Date.now() - startTime < 12000) {
          lastDataVersion = res.version;
          return;
        }
        // Don't reload on chat pages — they have their own real-time polling
        const path = window.location.pathname;
        if (path !== '/chat' && path !== '/whatsapp' && path !== '/whatsapp-contactos' && path !== '/mi-apto') {
          window.location.reload();
        } else {
          lastDataVersion = res.version;
        }
      }
      if (res) lastDataVersion = res.version;
    } catch {}
  }, ms);
}

export function stopDataVersionPolling() {
  if (versionPollInterval) { clearInterval(versionPollInterval); versionPollInterval = null; }
}

// ─── Polling for external changes (every 15s) ───

let pollInterval = null;
export function startCloudPolling(ms = 15000) {
  stopCloudPolling();
  pollInterval = setInterval(async () => {
    try { await refreshAllFromServer(); } catch {}
  }, ms);
}
export function stopCloudPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ─── Collection CRUD helpers ───

async function createItem(collection, data) {
  const result = await serverReq('POST', collection, null, data);
  const item = { ...data, id: result.id };
  pushToCollection(collection, item);
  return item;
}

async function updateItem(collection, id, data) {
  markLocalMutation();
  const result = await serverReq('PUT', collection, id, data);
  replaceInCollection(collection, Number(id), result);
  return result;
}

async function deleteItem(collection, id) {
  await serverReq('DELETE', collection, id);
  removeFromCollection(collection, Number(id));
}

async function fetchWhere(collection, field, value) {
  return db[collection].where(field).equals(value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : Number(value)).toArray();
}

async function fetchFirst(collection, field, value) {
  return db[collection].where(field).equals(value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : Number(value)).first();
}

// ─── API surface ───

export const api = {
  getServerVersion,
  refreshBase,
  marketplace: {
    async jobs(apartmentId) {
      const suffix = apartmentId ? `?apartmentId=${encodeURIComponent(apartmentId)}` : '';
      const response = await fetch(getBase() + '/marketplace/jobs' + suffix, {
        headers: { 'x-auth-token': AUTH_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo consultar Marketplace.');
      return Array.isArray(payload.jobs) ? payload.jobs : [];
    },
    async publish(apartmentId) {
      return serverReq('POST', 'marketplace/jobs', null, { apartmentId, publish: true });
    },
    async retry(jobId) {
      return serverReq('POST', `marketplace/jobs/${jobId}/retry`);
    },
    async cancel(jobId) {
      return serverReq('POST', `marketplace/jobs/${jobId}/cancel`);
    },
    async logs(jobId, limit = 80) {
      const params = new URLSearchParams({ limit: String(limit) });
      if (jobId) params.set('jobId', String(jobId));
      const response = await fetch(getBase() + '/marketplace/logs?' + params, {
        headers: { 'x-auth-token': AUTH_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudieron consultar los logs de Marketplace.');
      return Array.isArray(payload.logs) ? payload.logs : [];
    },
  },
  async uploadPhoto(file, apartmentId) {
    try {
      return await uploadFile('/api/upload/photo', file, { apartmentId });
    } catch (e) {
      if (e?.status === 413 || /20\s*MB|demasiado grande|supera el l[ií]mite/i.test(String(e?.message || ''))) throw e;
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const dataUrl = reader.result;
            const photoData = { apartmentId, data: dataUrl, filename: file.name, originalName: file.name, uploadedAt: new Date().toISOString() };
            const item = await createItem('photos', photoData);
            resolve(item);
          } catch (e2) { reject(e2); }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
  },
  async deletePhoto(id) {
    await deleteItem('photos', id);
  },
  uploadContract(file, contractId) { return uploadFile('/api/upload/contract', { file, fieldname: 'contract' }, { contractId }); },
  async _init() {},

  photos: {
    async toArray() { return db.photos.toArray(); },
    async add(data) { return createItem('photos', data); },
    async delete(id) { return deleteItem('photos', id); },
  },
  users: {
    async toArray() { return db.users.toArray(); },
    async add(data) { return createItem('users', data); },
    async delete(id) { return deleteItem('users', id); },
  },
  apartments: {
    async toArray() { return db.apartments.toArray(); },
    async get(id) { return db.apartments.get(Number(id)); },
    async add(data) { return createItem('apartments', data); },
    async update(id, data) { return updateItem('apartments', id, data); },
    async delete(id) { return deleteItem('apartments', id); },
  },
  tenants: {
    async toArray() { return db.tenants.toArray(); },
    async get(id) { return db.tenants.get(Number(id)); },
    async add(data) { return createItem('tenants', data); },
    async update(id, data) { return updateItem('tenants', id, data); },
    async delete(id) { return deleteItem('tenants', id); },
  },
  contracts: {
    async toArray() { return db.contracts.toArray(); },
    async get(id) { return db.contracts.get(Number(id)); },
    async add(data) { return createItem('contracts', data); },
    async update(id, data) { return updateItem('contracts', id, data); },
    async delete(id) { return deleteItem('contracts', id); },
    where() {
      return { equals: async (val) => db.contracts.where('apartmentId').equals(Number(val)).toArray() };
    },
  },
  payments: {
    async toArray() { return db.payments.toArray(); },
    async add(data) { return createItem('payments', data); },
    async delete(id) { return deleteItem('payments', id); },
  },
  expenses: {
    async toArray() { return db.expenses.toArray(); },
    async add(data) { return createItem('expenses', data); },
    async delete(id) { return deleteItem('expenses', id); },
  },
  utilityPayments: {
    async toArray() { return db.utilityPayments.toArray(); },
    async add(data) { return createItem('utilityPayments', data); },
    async update(id, data) { return updateItem('utilityPayments', id, data); },
  },
  vacancies: {
    async toArray() { return db.vacancies.toArray(); },
    async add(data) { return createItem('vacancies', data); },
    async update(id, data) { return updateItem('vacancies', id, data); },
  },
  familyMembers: {
    async toArray() { return db.familyMembers.toArray(); },
    async add(data) { return createItem('familyMembers', data); },
    async delete(id) { return deleteItem('familyMembers', id); },
  },
  passwords: {
    async toArray() { return db.passwords.toArray(); },
    async add(data) { return createItem('passwords', data); },
    async update(id, data) { return updateItem('passwords', id, data); },
    async delete(id) { return deleteItem('passwords', id); },
  },
};
