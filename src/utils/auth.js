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

// ─── Tab única de inquilino (single live tab) ─────────────────────────────
// Un solo usuario = una sola pestaña viva: al loguearse aquí se expulsa la
// anterior de forma obligatoria (push instantáneo por BroadcastChannel +
// revocación de sesión en servidor) y se sigue en ESTA pestaña.
const LIVE_TAB_KEY = 'laujim_live_tenant_tab';
const TAB_CHANNEL = 'laujim-tab';
const LIVE_TTL_MS = 15000;
let myTabId = null;
let liveTimer = null;
let tabChannel = null;

function getMyTabId() {
  if (!myTabId) {
    try {
      myTabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    } catch { myTabId = String(Date.now()); }
  }
  return myTabId;
}

function getTabChannel() {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
  if (!tabChannel) {
    try { tabChannel = new BroadcastChannel(TAB_CHANNEL); } catch { return null; }
  }
  return tabChannel;
}

function readLiveTab() {
  try {
    const raw = localStorage.getItem(LIVE_TAB_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.token || !entry?.ts) return null;
    if (Date.now() - Number(entry.ts) > LIVE_TTL_MS) return null;
    return entry;
  } catch { return null; }
}

// Reclama esta pestaña como la viva (solo inquilinos) con latido cada 5s.
// Solo late con pestaña visible para no mantener el motor caliente en vano.
export function claimLiveTenantTab() {
  try {
    if (typeof window === 'undefined' || getAuth()?.role !== 'tenant') return;
    const id = getMyTabId();
    const write = () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const auth = getAuth();
        if (auth?.role !== 'tenant' || !auth?.token) return;
        localStorage.setItem(LIVE_TAB_KEY, JSON.stringify({ id, token: auth.token, ts: Date.now() }));
      } catch {}
    };
    write();
    if (!liveTimer) liveTimer = setInterval(write, 5000);
  } catch {}
}

export function releaseLiveTenantTab() {
  try {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    const live = readLiveTab();
    if (live && live.id === getMyTabId()) localStorage.removeItem(LIVE_TAB_KEY);
  } catch {}
  if (tabChannel) { try { tabChannel.close(); } catch {} tabChannel = null; }
}

// Aviso instantáneo a otras pestañas: "esta sesión murió, salgan ya".
function broadcastTakeover(token) {
  try { getTabChannel()?.postMessage({ type: 'takeover', token, tab: getMyTabId() }); } catch {}
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
  // Sesión única obligatoria: esta pestaña pasa a ser LA viva; las demás
  // reciben el takeover por BroadcastChannel y salen a login sin pelear video.
  if (auth.role === 'tenant') {
    broadcastTakeover(auth.token);
    claimLiveTenantTab();
  }
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
  releaseLiveTenantTab();
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

// Verifica un token puntual contra el servidor (true = sigue vigente).
async function verifyToken(token) {
  if (!token) return false;
  try {
    const res = await fetch(getBase() + '/auth/verify', {
      headers: { 'x-auth-token': token },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return true; // Sin red no se expulsa a nadie: se reintentará después.
  }
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
      if (event.key === STORAGE_KEY || event.key === BACKUP_STORAGE_KEY) {
        if (!event.newValue) {
          onRevoked && onRevoked('storage_clear');
        } else {
          // Otra pestaña escribió una sesión distinta (nuevo login del mismo
          // u otro usuario). Comparo contra MI token en memoria (AUTH_TOKEN):
          // el localStorage ya muestra el token nuevo, así que getAuth() no
          // sirve aquí. Si mi token murió en el servidor (fui reemplazado),
          // salgo; si sigue válido —equipo compartido— no interrumpo el video.
          let incoming = null;
          try { incoming = JSON.parse(event.newValue); } catch {}
          if (incoming?.token && AUTH_TOKEN && incoming.token !== AUTH_TOKEN) {
            verifyToken(AUTH_TOKEN).then(valid => {
              if (!valid) { try { onRevoked && onRevoked('superseded'); } catch {} }
            }).catch(() => {});
          }
        }
      } else if (event.key === EXPLICIT_LOGOUT_KEY && event.newValue) {
        onRevoked && onRevoked('explicit_logout');
      }
    } catch {}
  };
  window.addEventListener('storage', handler);
  // Takeover instantáneo: otra pestaña se logueó con el mismo usuario y tomó
  // la sesión. Salir de inmediato (más rápido que esperar el próximo verify).
  let bcCleanup = () => {};
  try {
    const ch = getTabChannel();
    if (ch) {
      const onMsg = (event) => {
        try {
          const msg = event?.data;
          if (msg?.type === 'takeover' && msg.token && AUTH_TOKEN && msg.token !== AUTH_TOKEN) {
            onRevoked && onRevoked('takeover');
          }
        } catch {}
      };
      ch.addEventListener('message', onMsg);
      bcCleanup = () => { try { ch.removeEventListener('message', onMsg); } catch {} };
    }
  } catch {}
  return () => { window.removeEventListener('storage', handler); bcCleanup(); };
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
    if (res.ok) {
      // Sesión restaurada (reapertura): reclamar como pestaña viva.
      try { if (auth?.role === 'tenant') claimLiveTenantTab(); } catch {}
      return { ok: true };
    }
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
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      return { ok: false, error: 'El servidor tardó más de 8 segundos en responder. Revisa tu conexión e inténtalo de nuevo.' };
    }
    return { ok: false, error: 'No se pudo conectar con el servidor (red bloqueada o sin salida). Prueba incógnito o revisa tu antivirus/firewall.' };
  }
}

export function loginAdmin(username, password) { return login(username, password); }
export function loginTenant(apartment, documentId) { return login(apartment, documentId); }
