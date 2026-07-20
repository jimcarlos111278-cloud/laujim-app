import db from './db/database';
import { addPendingOp } from './utils/sync';
import { AUTH_TOKEN, getBase, getRawBase } from './utils/config';

export function refreshBase() {}

function localDb(col) {
  const t = db[col];
  if (!t) throw new Error(`Collection ${col} not found`);
  return t;
}

async function tryServer(method, collection, id, body) {
  try {
    const base = getBase();
    let url = base + '/' + collection;
    if (id) url += '/' + id;
    const opts = { method, headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  } catch {
    return null;
  }
}

function queueOp(method, collection, data, localId) {
  addPendingOp({ method, collection, data, id: data?.id || localId, localId });
}

async function getServerVersion() {
  try {
    const res = await fetch(getBase() + '/version', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return null;
    return res.json();
  } catch {
    return null;
  }
}

function uploadFile(url, file, extra) {
  const fd = new FormData();
  fd.append(file.fieldname || 'photo', file.file || file);
  Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, v));
  return fetch((getRawBase()) + url, { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN }, body: fd }).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
}

async function fetchWhere(collection, field, value) {
  return localDb(collection).where(field).equals(value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : Number(value)).toArray();
}

async function fetchFirst(collection, field, value) {
  return localDb(collection).where(field).equals(value === 'true' ? true : value === 'false' ? false : isNaN(value) ? value : Number(value)).first();
}

export const api = {
  getServerVersion,
  async uploadPhoto(file, apartmentId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result;
          const existingPhotos = await localDb('photos').where('apartmentId').equals(apartmentId).toArray();
          for (const p of existingPhotos) {
            await localDb('photos').delete(p.id);
            tryServer('DELETE', 'photos', p.id);
          }
          const photoData = { apartmentId, data: dataUrl, filename: file.name, originalName: file.name, uploadedAt: new Date().toISOString() };
          const id = await localDb('photos').add(photoData);
          const saved = { ...photoData, id };
          const srv = await tryServer('POST', 'photos', null, saved);
          if (!srv) queueOp('POST', 'photos', saved);
          resolve(saved);
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  },
  async deletePhoto(id) {
    await localDb('photos').delete(Number(id));
    queueOp('DELETE', 'photos', { id });
    tryServer('DELETE', 'photos', id);
  },
  uploadContract(file, contractId) { return uploadFile('/api/upload/contract', { file, fieldname: 'contract' }, { contractId }); },
  async _init() {},
  photos: {
    async toArray() { return localDb('photos').toArray(); },
    async add(data) {
      const id = await localDb('photos').add(data);
      const srv = await tryServer('POST', 'photos', null, { ...data, id });
      if (!srv) queueOp('POST', 'photos', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('photos').delete(Number(id));
      queueOp('DELETE', 'photos', { id });
      tryServer('DELETE', 'photos', id);
    },
  },
  users: {
    async toArray() { return localDb('users').toArray(); },
    async add(data) {
      const id = await localDb('users').add(data);
      const srv = await tryServer('POST', 'users', null, { ...data, id });
      if (!srv) queueOp('POST', 'users', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('users').delete(Number(id));
      queueOp('DELETE', 'users', { id });
      tryServer('DELETE', 'users', id);
    },
  },
  apartments: {
    async toArray() { return localDb('apartments').toArray(); },
    async get(id) { return localDb('apartments').get(Number(id)); },
    async add(data) {
      const id = await localDb('apartments').add(data);
      const srv = await tryServer('POST', 'apartments', null, { ...data, id });
      if (!srv) queueOp('POST', 'apartments', { ...data, id });
      return { ...data, id };
    },
    async update(id, data) {
      await localDb('apartments').update(Number(id), data);
      queueOp('PUT', 'apartments', data, Number(id));
      tryServer('PUT', 'apartments', id, data);
    },
    async delete(id) {
      await localDb('apartments').delete(Number(id));
      queueOp('DELETE', 'apartments', { id });
      tryServer('DELETE', 'apartments', id);
    },
  },
  tenants: {
    async toArray() { return localDb('tenants').toArray(); },
    async get(id) { return localDb('tenants').get(Number(id)); },
    async add(data) {
      const id = await localDb('tenants').add(data);
      const srv = await tryServer('POST', 'tenants', null, { ...data, id });
      if (!srv) queueOp('POST', 'tenants', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('tenants').delete(Number(id));
      queueOp('DELETE', 'tenants', { id });
      tryServer('DELETE', 'tenants', id);
    },
  },
  contracts: {
    async toArray() { return localDb('contracts').toArray(); },
    async get(id) { return localDb('contracts').get(Number(id)); },
    async add(data) {
      const id = await localDb('contracts').add(data);
      const srv = await tryServer('POST', 'contracts', null, { ...data, id });
      if (!srv) queueOp('POST', 'contracts', { ...data, id });
      return { ...data, id };
    },
    async update(id, data) {
      await localDb('contracts').update(Number(id), data);
      queueOp('PUT', 'contracts', data, Number(id));
      tryServer('PUT', 'contracts', id, data);
    },
    async delete(id) {
      await localDb('contracts').delete(Number(id));
      queueOp('DELETE', 'contracts', { id });
      tryServer('DELETE', 'contracts', id);
    },
    where() {
      return { equals: async (val) => localDb('contracts').where('apartmentId').equals(Number(val)).toArray() };
    },
  },
  payments: {
    async toArray() { return localDb('payments').toArray(); },
    async add(data) {
      const id = await localDb('payments').add(data);
      const srv = await tryServer('POST', 'payments', null, { ...data, id });
      if (!srv) queueOp('POST', 'payments', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('payments').delete(Number(id));
      queueOp('DELETE', 'payments', { id });
      tryServer('DELETE', 'payments', id);
    },
  },
  expenses: {
    async toArray() { return localDb('expenses').toArray(); },
    async add(data) {
      const id = await localDb('expenses').add(data);
      const srv = await tryServer('POST', 'expenses', null, { ...data, id });
      if (!srv) queueOp('POST', 'expenses', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('expenses').delete(Number(id));
      queueOp('DELETE', 'expenses', { id });
      tryServer('DELETE', 'expenses', id);
    },
  },
  utilityPayments: {
    async toArray() { return localDb('utilityPayments').toArray(); },
    async add(data) {
      const id = await localDb('utilityPayments').add(data);
      const srv = await tryServer('POST', 'utilityPayments', null, { ...data, id });
      if (!srv) queueOp('POST', 'utilityPayments', { ...data, id });
      return { ...data, id };
    },
    async update(id, data) {
      await localDb('utilityPayments').update(Number(id), data);
      queueOp('PUT', 'utilityPayments', data, Number(id));
      tryServer('PUT', 'utilityPayments', id, data);
    },
  },
  vacancies: {
    async toArray() { return localDb('vacancies').toArray(); },
    async add(data) {
      const id = await localDb('vacancies').add(data);
      const srv = await tryServer('POST', 'vacancies', null, { ...data, id });
      if (!srv) queueOp('POST', 'vacancies', { ...data, id });
      return { ...data, id };
    },
    async update(id, data) {
      await localDb('vacancies').update(Number(id), data);
      queueOp('PUT', 'vacancies', data, Number(id));
      tryServer('PUT', 'vacancies', id, data);
    },
  },
  familyMembers: {
    async toArray() { return localDb('familyMembers').toArray(); },
    async add(data) {
      const id = await localDb('familyMembers').add(data);
      const srv = await tryServer('POST', 'familyMembers', null, { ...data, id });
      if (!srv) queueOp('POST', 'familyMembers', { ...data, id });
      return { ...data, id };
    },
    async delete(id) {
      await localDb('familyMembers').delete(Number(id));
      queueOp('DELETE', 'familyMembers', { id });
      tryServer('DELETE', 'familyMembers', id);
    },
  },
};
