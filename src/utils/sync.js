import { getBase, AUTH_TOKEN } from './config';

export async function isServerAvailable() {
  try {
    const base = getBase();
    const res = await fetch(base + '/apartments/count', {
      signal: AbortSignal.timeout(10000),
      headers: { 'x-auth-token': AUTH_TOKEN },
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) return { ok: false, reason: `Server responded with ${res.status}: ${await res.text()}` };
    if (!ct.includes('application/json')) return { ok: false, reason: `Invalid content type: ${ct}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Network error: ${e.message}` };
  }
}
