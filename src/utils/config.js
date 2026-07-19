export const AUTH_TOKEN = 'laujim laujim';
const DEFAULT_SERVER = 'http://192.168.1.21:1011';

export function isCapacitor() {
  return typeof window !== 'undefined' && (window.Capacitor !== undefined);
}

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

export function photoUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return getRawBase() + url;
}
