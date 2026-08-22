import { AUTH_TOKEN, getBase, setApiToken } from './config';
import { stopCloudPolling, stopDataVersionPolling } from '../api';
import { stopBackgroundNotifications } from './backgroundNotifications';

const STORAGE_KEY = 'apt_auth';

export function getAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!auth?.token || !auth?.role) return null;
    return auth;
  } catch { return null; }
}

export function setAuth(data) {
  const auth = { role: data.role, name: data.name, apartmentId: data.apartmentId || null, token: data.token, expiresAt: data.expiresAt || null };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  setApiToken(auth.token);
}

export function clearAuth() {
  const token = AUTH_TOKEN;
  stopBackgroundNotifications().catch(() => {});
  localStorage.removeItem(STORAGE_KEY);
  setApiToken('');
  // A Render deploy or a restored database can invalidate server sessions.
  // After signing out this browser must stop polling or it would keep sending
  // authenticated requests that the server now rejects (401) in a tight loop.
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
    return { ok: true, role: data.role, apartmentId: data.apartmentId };
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor' };
  }
}

export function loginAdmin(username, password) { return login(username, password); }
export function loginTenant(apartment, documentId) { return login(apartment, documentId); }
