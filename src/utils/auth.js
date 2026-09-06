import { AUTH_TOKEN, getBase, setApiToken } from './config';
import { stopCloudPolling, stopDataVersionPolling } from '../api';
import { stopBackgroundNotifications } from './backgroundNotifications';
import { autoRecoverWorkerToken } from './portableWorker';

const STORAGE_KEY = 'apt_auth';
const BACKUP_STORAGE_KEY = 'apt_auth_backup';

export function getAuth() {
  try {
    let auth = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!auth?.token || !auth?.role) {
      const backup = JSON.parse(localStorage.getItem(BACKUP_STORAGE_KEY) || 'null');
      if (backup?.token && backup?.role) {
        auth = backup;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(backup)); } catch {}
        setApiToken(backup.token);
      }
    }
    if (!auth?.token || !auth?.role) return null;
    return auth;
  } catch { return null; }
}

export function setAuth(data) {
  const auth = { role: data.role, name: data.name, apartmentId: data.apartmentId || null, token: data.token, expiresAt: data.expiresAt || null };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(auth));
  } catch {}
  setApiToken(auth.token);
}

export function clearAuth(options = {}) {
  const token = AUTH_TOKEN;
  stopBackgroundNotifications().catch(() => {});
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (options.permanent !== false) {
      localStorage.removeItem(BACKUP_STORAGE_KEY);
    }
  } catch {}
  setApiToken('');
  stopCloudPolling();
  stopDataVersionPolling();
  if (token) fetch(getBase() + '/logout', { method: 'POST', headers: { 'x-auth-token': token } }).catch(() => {});
}

export function isAdmin() { return getAuth()?.role === 'admin'; }
export function isTenant() { return getAuth()?.role === 'tenant'; }
export function getTenantApartmentId() { return isTenant() ? getAuth().apartmentId : null; }
export function requireAuth() { return getAuth() ? null : { redirect: '/login' }; }

async function login(username, password) {
  try {
    const res = await fetch(getBase() + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.authenticated || !data.token) return { ok: false, error: data.error || 'Credenciales inválidas' };
    setAuth(data);
    // Auto-recover scraper worker token for admin users so the APK always has it
    if (data.role === 'admin') autoRecoverWorkerToken(data.token).catch(() => {});
    return { ok: true, role: data.role, apartmentId: data.apartmentId };
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor' };
  }
}

export function loginAdmin(username, password) { return login(username, password); }
export function loginTenant(apartment, documentId) { return login(apartment, documentId); }
