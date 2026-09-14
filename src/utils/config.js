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

export const CLOUD_SERVER = 'https://conjunto-residendial-laujim.duckdns.org';
export const DEFAULT_SERVER = typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && !/^(?:localhost|127\.0\.0\.1)/i.test(window.location.hostname)
  ? window.location.origin
  : CLOUD_SERVER;
export const FALLBACK_SERVER = DEFAULT_SERVER;
const SERVER_CONFIG_KEY = 'laujim_server_pair';

function normalizeServer(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/i.test(normalized)) return '';
  // Descartar automáticamente URLs obsoletas de Render
  if (/onrender\.com$/i.test(normalized)) return '';
  return normalized;
}

export function getServerCandidates(preferred) {
  const config = getServerConfig();
  const selected = normalizeServer(preferred);
  const candidates = [selected, config.active, config.primary, DEFAULT_SERVER]
    .filter(Boolean);
  return [...new Set(candidates)];
}

export function getServerConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SERVER_CONFIG_KEY) || '{}'); } catch {}
  const legacy = normalizeServer(localStorage.getItem('apt_server_url'));
  const currentOrigin = typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && !/^(?:localhost|127\.0\.0\.1)/i.test(window.location.hostname)
    ? normalizeServer(window.location.origin)
    : '';
  const primary = currentOrigin || normalizeServer(saved.primary || legacy) || DEFAULT_SERVER;
  const backup = normalizeServer(saved.backup) || primary;
  const active = currentOrigin || normalizeServer(saved.active) || primary;
  return { primary, backup, active };
}

export function saveServerConfig(values = {}) {
  const current = getServerConfig();
  const next = {
    primary: normalizeServer(values.primary || current.primary) || DEFAULT_SERVER,
    backup: normalizeServer(values.backup || current.backup) || DEFAULT_SERVER,
    active: normalizeServer(values.active || current.active) || DEFAULT_SERVER,
  };
  localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function setActiveServer(server) {
  const value = normalizeServer(server);
  if (!value) return getServerConfig();
  return saveServerConfig({ active: value });
}

export function getBase() {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol) && !/^(?:localhost|127\.0\.0\.1)/i.test(window.location.hostname)) {
    return window.location.origin + '/api';
  }
  const config = getServerConfig();
  const raw = config.active || config.primary || DEFAULT_SERVER;
  return raw + '/api';
}

export function getRawBase() {
  return getBase().replace('/api', '') || DEFAULT_SERVER;
}

export function getPublicBaseUrl() {
  const pageOrigin = typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)
    ? normalizeServer(window.location.origin)
    : '';
  if (pageOrigin) return pageOrigin;
  const config = getServerConfig();
  return [config.active, config.primary, DEFAULT_SERVER]
    .map(normalizeServer)
    .find(Boolean) || CLOUD_SERVER;
}

function photoRawValue(photo) {
  if (typeof photo === 'string') return photo.trim();
  return String(photo?.url || '').trim();
}

function photoPageOrigin() {
  return typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)
    ? window.location.origin
    : getRawBase();
}

// A photo URL can be relative (/api/public/photos/123), an old absolute URL,
// or an inline data/blob URL. Return both Render nodes for internal photos so
// an <img> can fail over too; window.fetch interception cannot catch <img>.
export function photoUrlCandidates(photo) {
  if (!photo) return [];
  const inline = typeof photo === 'object' ? photo.data : photo;
  if (typeof inline === 'string' && /^(?:data:|blob:)/i.test(inline)) return [inline];
  const raw = photoRawValue(photo);
  if (!raw) return [];

  const pageOrigin = photoPageOrigin();
  let parsed;
  try {
    parsed = new URL(raw, `${pageOrigin}/`);
  } catch {
    return [`${pageOrigin}/${raw.replace(/^\/+/, '')}`];
  }

  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const configuredOrigins = getServerCandidates().filter(value => /^https?:\/\//i.test(value));
  const parsedOrigin = parsed.origin;
  const isConfiguredServer = configuredOrigins.includes(parsedOrigin)
    || /(?:onrender\.com|onbelmo\.uk)$/i.test(parsed.hostname)
    || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname);
  const origins = isConfiguredServer
    ? getServerCandidates(parsedOrigin).filter(value => /^https?:\/\//i.test(value))
    : [parsedOrigin];
  return [...new Set(origins.map(origin => `${origin}${path}`))];
}

export function photoUrl(photo) {
  return photoUrlCandidates(photo)[0] || '';
}

// Move a failed <img> to the next server candidate. Returns true when a new
// source was assigned, allowing callers to keep their existing final-error UI.
export function retryPhotoSource(event, photo) {
  const image = event?.currentTarget || event?.target;
  if (!image) return false;
  const candidates = photoUrlCandidates(photo);
  if (candidates.length < 2) return false;
  const current = image.currentSrc || image.src || '';
  const matchedIndex = candidates.findIndex(candidate => candidate === current);
  const rememberedIndex = Number(image.dataset?.photoFallbackIndex);
  const currentIndex = matchedIndex >= 0
    ? matchedIndex
    : Number.isFinite(rememberedIndex) ? rememberedIndex : 0;
  const nextIndex = currentIndex + 1;
  const next = candidates[nextIndex];
  if (!next) return false;
  if (image.dataset) image.dataset.photoFallbackIndex = String(nextIndex);
  image.src = next;
  return true;
}
