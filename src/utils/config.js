const STORAGE_KEY = 'apt_auth';

function storedToken() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').token || '';
  } catch { return ''; }
}

// This is a live module binding: requests use the authenticated session token,
// never a secret embedded in the browser bundle.
export let AUTH_TOKEN = storedToken();

export function setApiToken(token) {
  AUTH_TOKEN = token || '';
}

export function isCapacitor() {
  return typeof window !== 'undefined' && window.Capacitor !== undefined;
}

// Belmo is the primary application host. Render remains available as a
// read/write fallback while its Hobby workspace is suspended or recovering.
export const DEFAULT_SERVER = 'https://laujim-app-2f53.onbelmo.uk';
export const FALLBACK_SERVER = 'https://laujim-app.onrender.com';

function normalizeServer(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
}

export function getServerCandidates(preferred) {
  const selected = normalizeServer(preferred);
  const isKnownHost = selected === DEFAULT_SERVER || selected === FALLBACK_SERVER;
  const candidates = [isKnownHost ? DEFAULT_SERVER : selected, FALLBACK_SERVER]
    .filter(Boolean);
  return [...new Set(candidates)];
}

export function getBase() {
  const custom = localStorage.getItem('apt_server_url');
  if (custom && !/onrender\.com$/i.test(normalizeServer(custom))) return normalizeServer(custom) + '/api';
  if (custom && /onrender\.com$/i.test(normalizeServer(custom))) {
    localStorage.setItem('apt_server_url', DEFAULT_SERVER);
  }
  if (isCapacitor()) return DEFAULT_SERVER + '/api';
  if (window.matchMedia('(display-mode: standalone)').matches) return DEFAULT_SERVER + '/api';
  const origin = normalizeServer(window.location.origin);
  if (origin && !/onrender\.com$/i.test(origin) && !/localhost|127\.0\.0\.1/i.test(origin)) {
    return origin + '/api';
  }
  return DEFAULT_SERVER + '/api';
}

export function getRawBase() {
  return getBase().replace('/api', '') || DEFAULT_SERVER;
}

export function photoUrl(photo) {
  if (!photo) return '';
  if (photo.data) return photo.data;
  if (!photo.url) return '';
  return photo.url.startsWith('http') ? photo.url : getRawBase() + photo.url;
}
