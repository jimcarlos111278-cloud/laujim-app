import { getRawBase } from './config';

const STORAGE_KEY = 'laujim_portable_worker';
const DEFAULT_TIMEOUT_MS = 10000;

function detectPlatform() {
  if (typeof window === 'undefined') return 'unknown';
  if (window.Capacitor) return 'android';
  if (/Android/i.test(navigator.userAgent || '')) return 'android-web';
  return 'pc-web';
}

function makeDeviceId() {
  const platform = detectPlatform();
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${platform}-laujim-${random}`.toLowerCase();
}

function cleanServerUrl(value) {
  const fallback = getRawBase();
  const raw = String(value || fallback).trim().replace(/\/+$/, '');
  return raw.replace(/\/api$/i, '');
}

export function getPortableWorkerSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      serverUrl: cleanServerUrl(saved.serverUrl),
      token: String(saved.token || ''),
      deviceId: String(saved.deviceId || makeDeviceId()),
      platform: String(saved.platform || detectPlatform()),
      runtime: String(saved.runtime || ((typeof window !== 'undefined' && window.Capacitor) ? 'laujim-apk' : 'laujim-web-worker')),
      appVersion: String(saved.appVersion || '2.5.0'),
    };
  } catch {
    return {
      serverUrl: cleanServerUrl(),
      token: '',
      deviceId: makeDeviceId(),
      platform: detectPlatform(),
      runtime: 'laujim-worker',
      appVersion: '2.5.0',
    };
  }
}

export function savePortableWorkerSettings(settings) {
  const current = getPortableWorkerSettings();
  const next = {
    ...current,
    ...settings,
    serverUrl: cleanServerUrl(settings?.serverUrl || current.serverUrl),
    token: String(settings?.token ?? current.token).trim(),
    deviceId: String(settings?.deviceId || current.deviceId || '').trim() || makeDeviceId(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function workerRequest(path, settings, options = {}) {
  const current = settings || getPortableWorkerSettings();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Worker-Token': current.token,
    'X-Worker-Id': current.deviceId,
    ...(options.headers || {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  return fetch(`${cleanServerUrl(current.serverUrl)}${path}`, {
    ...options,
    headers,
    signal: controller.signal,
  }).then(async response => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    return payload;
  }).finally(() => clearTimeout(timer));
}

export function fetchPortableWorkerConfig(settings) {
  return workerRequest('/worker/v1/config', settings);
}

export function registerPortableWorker(settings, replaceExisting = true) {
  const current = savePortableWorkerSettings(settings);
  return workerRequest('/worker/v1/register', current, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: current.deviceId,
      platform: current.platform,
      runtime: current.runtime,
      appVersion: current.appVersion,
      providers: ['air-e', 'water', 'gas'],
      replaceExisting,
    }),
  });
}

export function heartbeatPortableWorker(settings) {
  const current = settings || getPortableWorkerSettings();
  return workerRequest('/worker/v1/heartbeat', current, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: current.deviceId,
      platform: current.platform,
      runtime: current.runtime,
      appVersion: current.appVersion,
    }),
  });
}

export function pushPortableWorkerResults(results, meta = {}, settings) {
  const current = settings || getPortableWorkerSettings();
  return workerRequest('/worker/v1/results', current, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: current.deviceId,
      runId: meta.runId || `run-${Date.now()}`,
      capturedAt: meta.capturedAt || new Date().toISOString(),
      results: Array.isArray(results) ? results : [],
    }),
  });
}

export function maskWorkerToken(token) {
  const value = String(token || '');
  if (!value) return 'No configurado';
  if (value.length < 10) return '••••••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
