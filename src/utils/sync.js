import db from '../db/database';
import { getBase, AUTH_TOKEN } from './config';

const PENDING_KEY = 'apt_pending_ops';

function getPendingOps() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}

function savePendingOps(ops) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(ops));
}

export function addPendingOp(op) {
  const ops = getPendingOps();
  ops.push({ ...op, _id: Date.now() + '_' + Math.random().toString(36).slice(2), _createdAt: new Date().toISOString() });
  savePendingOps(ops);
}

export function clearPendingOps() {
  localStorage.removeItem(PENDING_KEY);
}

export function hasPendingOps() {
  return getPendingOps().length > 0;
}

export async function isServerAvailable() {
  try {
    const base = getBase();
    const res = await fetch(base + '/apartments/count', {
      signal: AbortSignal.timeout(3000),
      headers: { 'x-auth-token': AUTH_TOKEN },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return { ok: false, reason: `Server responded with ${res.status}: ${await res.text()}` };
    if (!ct.includes('application/json')) return { ok: false, reason: `Invalid content type: ${ct}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Network error: ${e.message}` };
  }
}

const COLLECTIONS = ['users', 'apartments', 'tenants', 'contracts', 'payments', 'expenses', 'utilityPayments', 'vacancies', 'familyMembers', 'settings', 'photos'];

async function serverReq(method, collection, id, body) {
  const base = getBase();
  let url = base + '/' + collection;
  if (id) url += '/' + id;
  const opts = { method, headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json();
}

export async function syncPull() {
  const serverStatus = await isServerAvailable();
  if (!serverStatus.ok) return { ok: false, reason: serverStatus.reason || 'Servidor no disponible' };
  for (const col of COLLECTIONS) {
    try {
      const data = await serverReq('GET', col);
      await db[col].clear();
      if (data.length > 0) await db[col].bulkAdd(data);
    } catch (e) {
      return { ok: false, reason: `Error en Pull de ${col}: ${e.message}` };
    }
  }
  return { ok: true };
}

export async function syncPush() {
  const serverStatus = await isServerAvailable();
  if (!serverStatus.ok) return { ok: false, reason: serverStatus.reason || 'Servidor no disponible' };
  const ops = getPendingOps();
  if (ops.length === 0) return { ok: true, pushed: 0 };
  let pushed = 0;
  const remainingOps = [];
  for (const op of ops) {
    try {
      if (op.method === 'DELETE') {
        await serverReq('DELETE', op.collection, op.id);
      } else if (op.method === 'POST') {
        const result = await serverReq('POST', op.collection, null, op.data);
        if (op.id && op.localId) {
          const existing = await db[op.collection].get(op.localId);
          if (existing) await db[op.collection].update(op.localId, { id: result.id });
        }
      } else if (op.method === 'PUT') {
        await serverReq('PUT', op.collection, op.id, op.data);
      }
      pushed++;
    } catch (e) {
      remainingOps.push(op);
      // Log the error for debugging, but don't stop the whole push
      console.error(`Error en Push de ${op.collection} (ID: ${op.id || op.localId}): ${e.message}`);
    }
  }
  savePendingOps(remainingOps);
  return { ok: true, pushed, failed: ops.length - pushed };
}

export async function syncAll() {
  const pushResult = await syncPush();
  if (!pushResult.ok) return pushResult;
  const pullResult = await syncPull();
  return { ...pullResult, pushed: pushResult.pushed, failed: pushResult.failed };
}

export async function syncAllWithChanges() {
  let before = null;
  try {
    before = JSON.stringify(await db.payments.toArray());
  } catch { /* first run */ }
  const result = await syncAll();
  if (!result.ok) return { ...result, paymentsChanged: false };
  let after = null;
  try {
    after = JSON.stringify(await db.payments.toArray());
  } catch { /* empty */ }
  const paymentsChanged = before !== null && before !== after;
  localStorage.setItem('last_payments_hash', after || '');
  return { ...result, paymentsChanged };
}

let syncInterval = null;

export function startAutoSync(intervalMs = 30000, onChange) {
  stopAutoSync();
  const tick = async () => {
    const r = await syncAllWithChanges();
    if (r.paymentsChanged && typeof onChange === 'function') {
      onChange(r);
    }
  };
  tick();
  syncInterval = setInterval(tick, intervalMs);
}

export function stopAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

export function getSyncStatus() {
  const pending = getPendingOps();
  return { pendingCount: pending.length, hasPending: pending.length > 0 };
}
