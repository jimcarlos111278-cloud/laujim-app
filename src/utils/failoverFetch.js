import { getServerCandidates, setActiveServer } from './config';

const INSTALL_KEY = '__laujimFailoverFetchInstalled';
const NATIVE_FETCH_KEY = '__laujimNativeFetch';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function rawUrl(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input.url === 'string') return input.url;
  return '';
}

function candidateUrl(raw, server) {
  const parsed = new URL(raw, window.location.origin);
  return `${server}${parsed.pathname}${parsed.search}${parsed.hash || ''}`;
}

function serverForUrl(raw, candidates) {
  const parsed = new URL(raw, window.location.origin);
  return candidates.find(server => {
    const serverUrl = new URL(server);
    return serverUrl.origin === parsed.origin;
  }) || null;
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function installFailoverFetch() {
  if (typeof window === 'undefined' || window[INSTALL_KEY]) return;
  const nativeFetch = window.fetch.bind(window);
  window[NATIVE_FETCH_KEY] = nativeFetch;

  window.fetch = async function laujimFailoverFetch(input, init = {}) {
    const raw = rawUrl(input);
    if (!raw) return nativeFetch(input, init);

    let parsed;
    try { parsed = new URL(raw, window.location.origin); } catch { return nativeFetch(input, init); }
    if (!parsed.pathname.startsWith('/api/')) return nativeFetch(input, init);

    const method = String(init.method || input?.method || 'GET').toUpperCase();
    // Login is the one POST that is safe to retry: it only creates the same
    // short-lived session in the shared Aiven database. Other writes are not
    // retried automatically because a lost response could duplicate a save.
    const safe = SAFE_METHODS.has(method) || (method === 'POST' && /\/api\/login$/.test(parsed.pathname));
    const candidates = getServerCandidates(parsed.origin);
    const originCandidate = serverForUrl(raw, candidates);
    if (!originCandidate || candidates.length < 2) return nativeFetch(input, init);

    let lastError;
    for (const server of candidates) {
      const requestUrl = candidateUrl(raw, server);
      try {
        const response = await nativeFetch(requestUrl, init);
        if (response.ok || !safe || !shouldRetryStatus(response.status)) {
          if (response.ok) setActiveServer(server);
          return response;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (!safe) throw error;
      }
    }
    throw lastError || new Error('No hay un servidor Laujim disponible.');
  };
  window[INSTALL_KEY] = true;
}
