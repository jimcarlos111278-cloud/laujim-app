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

// Cada intento contra un servidor alterno tiene su propio techo: un nodo
// muerto (DNS colgado, TCP sin respuesta) no debe comerse el timeout global
// de quien llama. Si el llamante aborta, el intento en curso también muere.
const ATTEMPT_TIMEOUT_MS = 6000;

function attemptSignal(init) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Servidor sin respuesta', 'TimeoutError'));
  }, ATTEMPT_TIMEOUT_MS);
  const outer = init && init.signal;
  if (outer) {
    if (outer.aborted) {
      clearTimeout(timer);
      controller.abort(outer.reason);
    } else {
      outer.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort(outer.reason);
      }, { once: true });
    }
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
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
      const attempt = attemptSignal(init);
      try {
        const response = await nativeFetch(requestUrl, { ...init, signal: attempt.signal });
        attempt.done();
        if (response.ok || !safe || !shouldRetryStatus(response.status)) {
          if (response.ok) setActiveServer(server);
          return response;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        attempt.done();
        lastError = error;
        if (!safe) throw error;
      }
    }
    throw lastError || new Error('No hay un servidor Laujim disponible.');
  };
  window[INSTALL_KEY] = true;
}
