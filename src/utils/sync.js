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

export const COLLECTIONS = ['users', 'apartments', 'tenants', 'contracts', 'payments', 'expenses', 'utilityPayments', 'vacancies', 'familyMembers', 'settings', 'photos', 'passwords'];

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
  await backupAllCollections();
  for (const col of COLLECTIONS) {
    try {
      const serverData = await serverReq('GET', col);
      // Skip if server has no data — don't wipe local Dexie with empty server
      if (!serverData || serverData.length === 0) continue;
      // For apartments: skip if all rents are $0 (server was reset to INITIAL_DATA)
      if (col === 'apartments' && serverData.length > 0 && serverData.every(a => !a.monthlyRent)) continue;
      // Save local items before clearing (merge strategy: keep local items server doesn't have)
      const localItems = await db[col].toArray();
      await db[col].clear();
      await db[col].bulkAdd(serverData);
      // Re-add local items that are NOT in server data (server may be outdated/behind)
      const serverIds = new Set(serverData.map(s => s.id));
      const itemsToRestore = localItems.filter(l => !serverIds.has(l.id));
      if (itemsToRestore.length > 0) {
        await db[col].bulkAdd(itemsToRestore);
      }
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

let autoSaveTimer = null;
export function triggerAutoSave(delayMs = 2000) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    autoSaveTimer = null;
    const result = await syncPush();
    if (result.ok && result.pushed > 0) {
      console.log(`Auto-save: ${result.pushed} operacion(es) enviada(s)`);
    }
  }, delayMs);
}

// Backup ALL collections to localStorage so data survives server resets / syncPull
const BACKUP_COLLECTIONS = ['apartments', 'tenants', 'contracts', 'payments', 'expenses', 'utilityPayments', 'vacancies', 'familyMembers', 'settings', 'passwords'];

let backupTimer = null;
export async function backupAllCollections() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(async () => {
    backupTimer = null;
    try {
      const dbMod = (await import('../db/database')).default;
      for (const name of BACKUP_COLLECTIONS) {
        try {
          const data = await dbMod[name].toArray();
          localStorage.setItem('bkp_' + name, JSON.stringify(data));
        } catch (e) {
          console.warn('Backup failed for', name, e);
        }
      }
      localStorage.setItem('bkp_timestamp', new Date().toISOString());
    } catch (e) {
      console.warn('Full backup failed:', e);
    }
  }, 500);
}

// Restore ALL collections from localStorage backup that are missing from IndexedDB
export async function restoreAllFromBackup() {
  const ts = localStorage.getItem('bkp_timestamp');
  if (!ts) return { restored: 0 };
  console.log('Restoring from backup taken at', ts);
  let total = 0;
  try {
    const dbMod = (await import('../db/database')).default;
    for (const name of BACKUP_COLLECTIONS) {
      try {
        const raw = localStorage.getItem('bkp_' + name);
        if (!raw) continue;
        const backupItems = JSON.parse(raw);
        if (!Array.isArray(backupItems) || backupItems.length === 0) continue;
        const current = await dbMod[name].toArray();
        const currentIds = new Set(current.map(c => c.id));
        const missing = backupItems.filter(b => !currentIds.has(b.id));
        if (missing.length > 0) {
          await dbMod[name].bulkAdd(missing);
          console.log(`Restored ${missing.length} items to ${name} from backup`);
          total += missing.length;
        }
      } catch (e) {
        console.warn('Restore backup failed for', name, e);
      }
    }
  } catch (e) {
    console.warn('Restore all backup failed:', e);
  }
  return { restored: total };
}

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
