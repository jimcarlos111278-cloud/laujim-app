import { getBase, getRawBase } from './config';

export async function isServerAvailable() {
  try {
    const base = getBase();
    // Use the public /api/ready endpoint which validates both server and database
    // without requiring an admin token or expiring session.
    const res = await fetch(base + '/ready', {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.ok !== false) {
        return { ok: true, state: data.state || 'ready' };
      }
    }
    // Fast fallback to /health if /api/ready had an issue
    const raw = getRawBase();
    const fallbackRes = await fetch(raw + '/health', {
      signal: AbortSignal.timeout(4000),
    });
    if (fallbackRes.ok) {
      return { ok: true, state: 'healthy' };
    }
    return { ok: false, reason: `Server responded with ${res.status}` };
  } catch (e) {
    // Retry once after a brief 500ms pause to guard against transient mobile socket resets / wakeups
    try {
      await new Promise(r => setTimeout(r, 500));
      const raw = getRawBase();
      const retryRes = await fetch(raw + '/health', { signal: AbortSignal.timeout(4000) });
      if (retryRes.ok) return { ok: true, state: 'healthy' };
    } catch (_) {}
    return { ok: false, reason: `Network error: ${e.message}` };
  }
}

