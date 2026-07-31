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

const DEFAULT_SERVER = 'https://laujim-app.onrender.com';

export function getBase() {
  const custom = localStorage.getItem('apt_server_url');
  if (custom) return custom + '/api';
  if (isCapacitor()) return DEFAULT_SERVER + '/api';
  if (window.matchMedia('(display-mode: standalone)').matches) return DEFAULT_SERVER + '/api';
  return window.location.origin + '/api';
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
