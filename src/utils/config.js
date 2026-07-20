export const AUTH_TOKEN = 'laujim laujim';
const DEFAULT_SERVER = 'https://laujim-app.onrender.com';

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

export function photoUrl(photo) {
  if (!photo) return '';
  if (photo.data) return photo.data;
  if (!photo.url) return '';
  if (photo.url.startsWith('http')) return photo.url;
  return getRawBase() + photo.url;
}
