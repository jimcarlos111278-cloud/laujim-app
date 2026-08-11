'use strict';

// Portable PC worker. It reuses the portal-only scrapers, opens a persistent
// local Chrome profile, and sends only sanitized results to Render. Credentials
// stay in portable-worker.config.json on this machine.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const configPath = path.resolve(process.env.PORTABLE_WORKER_CONFIG || path.join(ROOT, 'portable-worker.config.json'));

function readConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Falta ${configPath}. Copia portable-worker.config.example.json y completa sus valores.`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const serverUrl = String(parsed.serverUrl || '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  const workerToken = String(parsed.workerToken || '').trim();
  const deviceId = String(parsed.deviceId || 'pc-laujim-01').trim();
  if (!/^https?:\/\//i.test(serverUrl)) throw new Error('serverUrl debe comenzar por http:// o https://.');
  if (!workerToken) throw new Error('workerToken está vacío. Usa el mismo SCRAPER_WORKER_TOKEN de Render.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(deviceId)) throw new Error('deviceId inválido.');
  return { ...parsed, serverUrl, workerToken, deviceId };
}

const config = readConfig();
const chromeProfileDir = path.resolve(config.chromeProfileDir || path.join(os.homedir(), '.laujim-chrome-profiles'));

// These must be set before loading services-scraper.cjs because it reads the
// browser mode and profile settings during module initialization.
process.env.RENDER_FULL_CHROME = 'true';
process.env.BROWSER_MODE = 'full';
process.env.RENDER_CHROME_PROFILE_DIR = chromeProfileDir;

const servicesScraper = require(path.join(ROOT, 'services-scraper.cjs'));

const localDb = {
  apartments: [],
  portalCredentials: [],
};
servicesScraper.init(localDb, () => {});

async function requestJson(endpoint, options = {}) {
  const response = await fetch(config.serverUrl + endpoint, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Worker-Token': config.workerToken,
      'X-Worker-Id': config.deviceId,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
  return payload;
}

async function register() {
  return requestJson('/worker/v1/register', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: config.deviceId,
      platform: 'windows',
      runtime: 'portable-worker-node',
      appVersion: '1.0.0',
      providers: ['air-e', 'water', 'gas'],
      replaceExisting: config.replaceExisting !== false,
    }),
  });
}

async function loadRemoteConfig() {
  return requestJson('/worker/v1/config');
}

function applyRemoteConfig(remote) {
  localDb.apartments = (remote.apartments || []).map(apartment => ({
    ...apartment,
    electricityPaymentCode: apartment.electricityPaymentCode || '',
    waterPaymentCode: apartment.waterPaymentCode || '',
    gasPaymentCode: apartment.gasPaymentCode || '',
  }));
  const credentials = config.portalCredentials || {};
  localDb.portalCredentials = [
    ['air-e', credentials['air-e']],
    ['triple-a', credentials['triple-a']],
    ['gascaribe', credentials.gascaribe],
  ].filter(([, value]) => value && value.username && value.password)
    .map(([provider, value]) => ({ provider, username: String(value.username), password: String(value.password) }));
}

async function runProvider(provider) {
  if (provider === 'air-e') return servicesScraper.scrapeAirE();
  if (provider === 'water') return servicesScraper.scrapeTripleAAccount();
  if (provider === 'gas') return servicesScraper.scrapeGasAccount();
  return [];
}

async function runOnce(reason = 'schedule') {
  const startedAt = new Date().toISOString();
  console.log(`[PORTABLE WORKER] Inicio ${reason}: ${config.deviceId}`);
  const remote = await loadRemoteConfig();
  applyRemoteConfig(remote);
  const providers = remote.schedule?.providers?.length ? remote.schedule.providers : ['air-e', 'water', 'gas'];
  const results = [];

  for (const provider of providers) {
    const started = Date.now();
    try {
      const providerResults = await runProvider(provider);
      if (Array.isArray(providerResults)) results.push(...providerResults);
      console.log(`[PORTABLE WORKER] ${provider}: ${Array.isArray(providerResults) ? providerResults.length : 0} resultado(s) en ${Math.round((Date.now() - started) / 1000)} s.`);
    } catch (error) {
      console.error(`[PORTABLE WORKER] ${provider}: ${error.message}`);
    }
  }

  if (!results.length) {
    console.warn('[PORTABLE WORKER] No hubo resultados para enviar; se conserva el último valor confirmado en Render.');
    await requestJson('/worker/v1/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ deviceId: config.deviceId, platform: 'windows', runtime: 'portable-worker-node', appVersion: '1.0.0' }),
    });
    return { results: 0, capturedAt: startedAt };
  }

  const response = await requestJson('/worker/v1/results', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: config.deviceId,
      runId: `pc-${Date.now()}`,
      capturedAt: new Date().toISOString(),
      results,
    }),
  });
  console.log(`[PORTABLE WORKER] Render persistió ${response.persisted || 0} resultado(s).`);
  return { results: response.persisted || 0, capturedAt: startedAt };
}

async function main() {
  const once = process.argv.includes('--once');
  await register();
  console.log(`[PORTABLE WORKER] Registrado. Perfil Chrome: ${chromeProfileDir}`);
  await runOnce('boot');
  if (once) return;

  const remote = await loadRemoteConfig();
  const hours = Math.max(1, Number(remote.schedule?.intervalHours || 12));
  const delay = hours * 60 * 60 * 1000;
  console.log(`[PORTABLE WORKER] Próxima ejecución en ${hours} h.`);
  setInterval(() => runOnce('schedule').catch(error => console.error('[PORTABLE WORKER] Error:', error.message)), delay);
}

main().catch(error => {
  console.error('[PORTABLE WORKER] Fatal:', error.message);
  process.exitCode = 1;
});
