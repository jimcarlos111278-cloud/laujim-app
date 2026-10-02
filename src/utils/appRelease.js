import { DEFAULT_SERVER, getServerConfig, getRawBase } from './config';

function versionParts(value) {
  return String(value || '0').split('.').map(part => Number(part) || 0);
}

export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function normalizeBase(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?$/i.test(normalized)) return '';
  // REGLA MIGRACIÓN (VM Oracle vigente): onrender.com está eliminado y no debe volver.
  // Si encuentras onrender.com en futuras operaciones, elimínalo: ya se migró.
  // Render está suspendido (503): la APK jamás debe resolverse contra el proveedor anterior.
  if (/(?:onrender\.com|onbelmo\.uk)$/i.test(normalized)) return '';
  return normalized;
}

function isLoopback(hostname) {
  return /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(String(hostname || ''));
}

export function absoluteApkUrl(base, apkUrl) {
  const safeBase = normalizeBase(base) || DEFAULT_SERVER;
  try {
    const parsed = new URL(apkUrl || '/app-debug.apk', `${safeBase}/`);
    if (isLoopback(parsed.hostname)) {
      const fallback = new URL('/app-debug.apk', `${safeBase}/`);
      fallback.search = parsed.search;
      return fallback.toString();
    }
    return parsed.toString();
  } catch {
    return `${safeBase}/app-debug.apk`;
  }
}

async function readRelease(base) {
  const response = await fetch(`${base}/app-version.json?latest=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const release = await response.json();
  if (!release?.version) throw new Error('Respuesta de versión inválida');
  return {
    ...release,
    source: base,
    apkUrl: absoluteApkUrl(base, release.apkUrl),
  };
}

/**
 * Reads the release manifest from the configured servers. This is intentionally
 * independent of the API failover wrapper because the APK is a static asset.
 * An old APK can therefore still discover and download the newest APK when
 * its preferred node is unavailable.
 */
export async function getLatestAppRelease() {
  const config = getServerConfig();
  const bases = [...new Set([config.active, config.primary, config.backup, getRawBase()]
    .map(normalizeBase)
    .filter(Boolean))];
  const releases = (await Promise.all(bases.map(async base => {
    try { return await readRelease(base); } catch { return null; }
  }))).filter(Boolean);

  if (releases.length === 0) throw new Error('No se pudo consultar la versión publicada');
  // El servidor activo manda: un manifiesto viejo con versión mayor en un nodo
  // muerto no debe ganarle al nodo donde estás parado.
  const activeRelease = releases.find(r => r.source === bases[0]);
  if (activeRelease) return activeRelease;
  return releases.sort((a, b) => compareVersions(b.version, a.version))[0];
}
