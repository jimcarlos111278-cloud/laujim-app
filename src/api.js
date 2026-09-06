import db, { setCollectionData, pushToCollection, replaceInCollection, removeFromCollection } from './db/database';
import { AUTH_TOKEN, getBase, getRawBase } from './utils/config';

export function refreshBase() {}

// ─── Server API helpers ───

// A stalled request used to keep the whole SPA on the loading screen forever.
// Keep the timeout at the transport layer so reads and writes fail visibly
// instead of leaving callers waiting indefinitely.
const SERVER_REQUEST_TIMEOUT_MS = 12_000;

function currentAuthToken() {
  try {
    return (typeof window !== 'undefined' && JSON.parse(localStorage.getItem('apt_auth') || '{}').token) || AUTH_TOKEN || '';
  } catch { return AUTH_TOKEN || ''; }
}

async function serverReq(method, collection, id, body) {
  const base = getBase();
  let url = base + '/' + collection;
  if (id) url += '/' + id;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-auth-token': currentAuthToken() } };
  if (body) opts.body = JSON.stringify(body);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), SERVER_REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, controller ? { ...opts, signal: controller.signal } : opts);
    if (!res.ok) {
      const message = await res.text();
      const error = new Error(message || `Server responded with ${res.status}`);
      error.status = res.status;
      error.url = url;
      throw error;
    }
    return res.json();
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const error = new Error(`Tiempo de espera agotado al consultar ${collection}.`);
      error.code = 'ETIMEDOUT';
      error.status = 408;
      error.url = url;
      throw error;
    }
    throw cause;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  return fetch((getRawBase()) + url, { method: 'POST', headers: { 'x-auth-token': currentAuthToken() }, body: fd }).then(async r => {
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

const CLOUD_COLLECTIONS = ['apartments', 'tenants', 'contracts', 'payments', 'expenses', 'utilityPayments', 'vacancies', 'familyMembers', 'settings', 'passwords', 'photos', 'paymentRules', 'paymentEvents', 'paymentAlerts'];

let lastCloudSyncStatus = {
  ok: false,
  status: null,
  error: null,
  failedCollections: [],
  completedAt: null,
};

let cloudSyncPromise = null;

export function getCloudSyncStatus() {
  return { ...lastCloudSyncStatus, failedCollections: [...lastCloudSyncStatus.failedCollections] };
}

export async function refreshAllFromServer(collections = CLOUD_COLLECTIONS) {
  // Prevent the 15-second poller from starting a second full sync while a
  // slower one is still in flight. The same promise is safe for startup,
  // polling and manual refreshes.
  if (cloudSyncPromise) return cloudSyncPromise;

  cloudSyncPromise = (async () => {
    // Requests are independent reads. Fetch them together, but only replace a
    // local collection after that collection returned a valid array. A failed
    // collection therefore never erases the last valid in-memory value.
    const requestedCollections = Array.isArray(collections) && collections.length
      ? [...new Set(collections.filter(collection => CLOUD_COLLECTIONS.includes(collection)))]
      : CLOUD_COLLECTIONS;
    const outcomes = await Promise.all(requestedCollections.map(async collection => {
      try {
        const serverData = await serverReq('GET', collection);
        if (!Array.isArray(serverData)) {
          const error = new Error('El servidor devolvió una colección inválida');
          error.status = 502;
          throw error;
        }
        setCollectionData(collection, serverData);
        return { collection, ok: true };
      } catch (e) {
        return {
          collection,
          ok: false,
          status: e.status || null,
          message: e.message || 'Error de sincronización',
        };
      }
    }));

    const failures = outcomes.filter(item => !item.ok);
    const firstFailure = failures.find(item => [401, 403].includes(item.status)) || failures[0] || null;
    lastCloudSyncStatus = {
      ok: failures.length === 0,
      status: firstFailure?.status || null,
      error: firstFailure?.message || null,
      failedCollections: failures.map(item => item.collection),
      completedAt: new Date().toISOString(),
    };
    return lastCloudSyncStatus.ok;
  })();

  try {
    return await cloudSyncPromise;
  } finally {
    cloudSyncPromise = null;
  }
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

export function startDataVersionPolling(ms = 10000) {
  stopDataVersionPolling();
  const startTime = Date.now();
  // First call just stores the current version
  getDataVersion().then(res => { if (res?.version) lastDataVersion = res.version; });
  versionPollInterval = setInterval(async () => {
    try {
      const res = await getDataVersion();
      if (res && res.version && lastDataVersion > 0 && res.version !== lastDataVersion) {
        lastDataVersion = res.version;
        if (Date.now() < suppressDataReloadUntil) return;
        // Skip sync within first 12 seconds (let initial sync settle)
        if (Date.now() - startTime < 12000) return;

        // Silently refresh data without ever reloading the browser window or WebView.
        // A hard window.location.reload() resets React state and kicks users out on mobile.
        try {
          await refreshAllFromServer();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('laujim:data-updated', { detail: { version: res.version } }));
          }
        } catch {}
        return;
      }
      if (res?.version) lastDataVersion = res.version;
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
        headers: { 'x-auth-token': currentAuthToken() },
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
        headers: { 'x-auth-token': currentAuthToken() },
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
    const response = await fetch(`${getRawBase()}/api/photo/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-auth-token': currentAuthToken() },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `No se pudo eliminar la foto (${response.status}).`);
    removeFromCollection('photos', Number(id));
    return payload;
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
  paymentAutomation: {
    async summary() {
      const response = await fetch(`${getBase()}/payments/automation`, { headers: { 'x-auth-token': currentAuthToken() }, signal: AbortSignal.timeout(8000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la conciliación de pagos.');
      return payload;
    },
    async associate(eventId, apartmentId, remember = true) {
      const response = await fetch(`${getBase()}/payments/automation/events/${encodeURIComponent(eventId)}/associate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': currentAuthToken() },
        body: JSON.stringify({ apartmentId, remember }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo asociar el pago.');
      return payload;
    },
    async dismiss(eventId) {
      const response = await fetch(`${getBase()}/payments/automation/events/${encodeURIComponent(eventId)}/dismiss`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': currentAuthToken() },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo descartar el evento.');
      return payload;
    },
    async addRule(rule) {
      const response = await fetch(`${getBase()}/payments/automation/rules`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': currentAuthToken() },
        body: JSON.stringify(rule),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar la regla.');
      return payload;
    },
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
