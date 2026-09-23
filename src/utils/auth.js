import { AUTH_TOKEN, getBase, setApiToken } from './config';
import { stopCloudPolling, stopDataVersionPolling } from '../api';
import { stopBackgroundNotifications } from './backgroundNotifications';
import { autoRecoverWorkerToken } from './portableWorker';

const STORAGE_KEY = 'apt_auth';
const BACKUP_STORAGE_KEY = 'apt_auth_backup';
// Marca de logout explícito: evita que el auto-restore (Capacitor) resucite
// la sesión recién cerrada y obligue al usuario a presionar salir dos veces.
const EXPLICIT_LOGOUT_KEY = 'laujim_explicit_logout';

export function isExplicitLogout() {
  try {
    const ts = Number(localStorage.getItem(EXPLICIT_LOGOUT_KEY) || 0);
    return Number.isFinite(ts) && ts > 0;
  } catch { return false; }
}

function markExplicitLogout() {
  try { localStorage.setItem(EXPLICIT_LOGOUT_KEY, String(Date.now())); } catch {}
}

function clearExplicitLogout() {
  try { localStorage.removeItem(EXPLICIT_LOGOUT_KEY); } catch {}
}

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
    if (!auth?.token || !auth?.role) {
      const sessionSaved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (sessionSaved?.token && sessionSaved?.role) {
        auth = sessionSaved;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionSaved));
          localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(sessionSaved));
        } catch {}
        setApiToken(sessionSaved.token);
      }
    }
    if (!auth?.token || !auth?.role) return null;
    return auth;
  } catch { return null; }
}

export async function restoreNativeAuth() {
  const current = getAuth();
  if (current) return current;
  // No resucitar una sesión que el usuario acaba de cerrar a propósito.
  if (isExplicitLogout()) return null;
  if (typeof window === 'undefined' || !window.Capacitor) return null;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const file = await Filesystem.readFile({
      path: 'laujim_auth.json',
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    if (file?.data) {
      const auth = JSON.parse(file.data);
      if (auth?.token && auth?.role) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
        localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(auth));
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
        setApiToken(auth.token);
        console.log('[AUTH] Successfully restored session from Android native storage');
        return auth;
      }
    }
  } catch {}
  return null;
}

export async function sendAuditLog(event, reason = '', details = {}) {
  try {
    const base = getBase();
    const token = AUTH_TOKEN || getAuth()?.token || null;
    const auth = getAuth();
    fetch(`${base}/audit/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
      },
      body: JSON.stringify({
        event,
        reason,
        details: { ...details, appVersion: '1.0.121' },
        user: auth?.name || null,
        role: auth?.role || null,
        platform: window.Capacitor ? 'android' : 'web',
        url: window.location?.href || '',
        clientTimestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {}
}

export function setAuth(data) {
  const auth = { role: data.role, name: data.name, apartmentId: data.apartmentId || null, token: data.token, expiresAt: data.expiresAt || null };
  try {
    clearExplicitLogout();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(auth));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  } catch {}
  setApiToken(auth.token);
  // Persist to native Android internal storage via Capacitor Filesystem
  if (typeof window !== 'undefined' && window.Capacitor) {
    import('@capacitor/filesystem').then(({ Filesystem, Directory, Encoding }) => {
      Filesystem.writeFile({
        path: 'laujim_auth.json',
        directory: Directory.Data,
        data: JSON.stringify(auth),
        encoding: Encoding.UTF8,
      }).catch(() => {});
    }).catch(() => {});
  }
  sendAuditLog('LOGIN_SUCCESS', 'credentials_accepted', { role: data.role, name: data.name });
}

export function clearAuth(options = {}, reason = 'unspecified') {
  const token = AUTH_TOKEN;
  markExplicitLogout();
  sendAuditLog('LOGOUT_TRIGGERED', reason, { permanent: options.permanent, options });
  stopBackgroundNotifications().catch(() => {});
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(BACKUP_STORAGE_KEY);
  } catch {}
  setApiToken('');
  stopCloudPolling();
  stopDataVersionPolling();
  if (token) fetch(getBase() + '/logout', { method: 'POST', headers: { 'x-auth-token': token } }).catch(() => {});
  // Esperar el borrado nativo: si Login monta antes de que termine, el
  // auto-restore ya no resucita la sesión gracias al flag explícito, pero
  // esperar deja el dispositivo limpio desde el primer clic.
  if (typeof window !== 'undefined' && window.Capacitor) {
    return import('@capacitor/filesystem').then(({ Filesystem, Directory }) => {
      return Filesystem.deleteFile({ path: 'laujim_auth.json', directory: Directory.Data }).catch(() => {});
    }).catch(() => {});
  }
  return Promise.resolve();
}

export function isAdmin() { return getAuth()?.role === 'admin'; }
export function isTenant() { return getAuth()?.role === 'tenant'; }

// Propagación de logout entre pestañas: el evento 'storage' solo llega a las
// OTRAS pestañas, que es justo lo que se necesita. Sin esto, cerrar sesión en
// una pestaña deja a las demás con un portal obsoleto cuyo sessionStorage
// propio resucita el token en localStorage (doble logout / sesión fantasma).
export function watchAuthRevoked(onRevoked) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event) => {
    try {
      if ((event.key === STORAGE_KEY || event.key === BACKUP_STORAGE_KEY) && !event.newValue) {
        onRevoked && onRevoked('storage_clear');
      } else if (event.key === EXPLICIT_LOGOUT_KEY && event.newValue) {
        onRevoked && onRevoked('explicit_logout');
      }
    } catch {}
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

// Revalida la sesión contra el servidor (detecta inquilino eliminado o
// credenciales revocadas mientras la pestaña estaba abierta/inactiva).
export async function revalidateSession() {
  const auth = getAuth();
  if (!auth?.token) return { ok: false, reason: 'no_token' };
  try {
    const res = await fetch(getBase() + '/auth/verify', {
      headers: { 'x-auth-token': auth.token },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      await clearAuth({}, 'revalidate_invalid');
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, stale: true };
  } catch {
    return { ok: true, stale: true };
  }
}
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
