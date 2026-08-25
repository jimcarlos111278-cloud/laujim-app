/**
 * services-scraper.cjs
 *
 * Automated checker for public service bills (Air-e, Triple A, Gases del Caribe).
 * Uses puppeteer-core with either a full Chrome/Chromium runtime (Render Docker)
 * or @sparticuz/chromium as the serverless fallback.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const cron = require('node-cron');

// @sparticuz/chromium v149+ is ESM-only (export default) and bundles a Linux
// binary intended for Render/Lambda. On Windows we fall back to the system
// Chrome/Edge so the scraper can also run locally for testing.
const IS_WINDOWS = process.platform === 'win32';
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const LINUX_CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];
const FULL_CHROME_ENABLED = /^(1|true|yes|full)$/i.test(
  process.env.RENDER_FULL_CHROME || process.env.BROWSER_MODE || '',
);
// Prefer one Browserless account/token per provider so a quota or auth issue
// in one portal cannot consume or disable the other services. Keep the legacy
// token as a backwards-compatible fallback for existing Render deployments.
const BROWSERLESS_TOKENS = {
  'air-e': String(process.env.BROWSERLESS_TOKEN_AIR_E || process.env.BROWSERLESS_TOKEN || '').trim(),
  water: String(process.env.BROWSERLESS_TOKEN_WATER || process.env.BROWSERLESS_TOKEN || '').trim(),
  gas: String(process.env.BROWSERLESS_TOKEN_GAS || process.env.BROWSERLESS_TOKEN || '').trim(),
};
const BROWSERLESS_WS_ENDPOINT = String(process.env.BROWSERLESS_WS_ENDPOINT || '').trim();
const BROWSERLESS_REGION = String(process.env.BROWSERLESS_REGION || 'production-sfo').trim();
const BROWSERLESS_PROFILES = String(process.env.BROWSERLESS_PROFILES || 'air-e,water,gas')
  .split(',')
  .map((profile) => profile.trim().toLowerCase())
  .filter(Boolean);
const BROWSERLESS_SOLVE_CAPTCHAS = /^(1|true|yes)$/i.test(
  process.env.BROWSERLESS_SOLVE_CAPTCHAS || (Object.values(BROWSERLESS_TOKENS).some(Boolean) ? 'true' : ''),
);
// If one provider-specific Browserless account is invalid/exhausted, use a
// configured sibling account as a remote-browser failover. This is still the
// same portal flow; it never falls back to a payment QR or public link.
const BROWSERLESS_CROSS_PROVIDER_FAILOVER = !/^(0|false|no)$/i.test(
  process.env.BROWSERLESS_CROSS_PROVIDER_FAILOVER || 'true',
);
// Browserless documents the stealth route as an option for sites that need a
// stronger fingerprint. Keep the proven base route by default because some
// current accounts reject /stealth with HTTP 400; Render can opt in with
// BROWSERLESS_STEALTH=true without a code change.
const BROWSERLESS_STEALTH = /^(1|true|yes)$/i.test(process.env.BROWSERLESS_STEALTH || '');
const BROWSERLESS_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.BROWSERLESS_TIMEOUT_MS || 0) || 0,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gasContractPaymentUrl(contract) {
  const code = String(contract || '').trim();
  return code ? `https://portal.gascaribe.com/payments/contract/${encodeURIComponent(code)}` : null;
}

function firstExistingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function resolveChromium(profileName = 'services', useFullChrome = FULL_CHROME_ENABLED) {
  if (useFullChrome) {
    if (!IS_WINDOWS && !process.env.DISPLAY) {
      throw new Error('Full Chrome requires DISPLAY. Start Render with Xvfb (for example, xvfb-run).');
    }

    const executablePath = firstExistingPath(IS_WINDOWS ? CHROME_CANDIDATES : LINUX_CHROME_CANDIDATES);
    if (!executablePath) {
      throw new Error('Full Chrome is enabled but no Chromium/Chrome executable was found in the runtime image.');
    }

    const profileRoot = process.env.RENDER_CHROME_PROFILE_DIR || path.join(os.tmpdir(), 'laujim-chrome-profiles');
    const userDataDir = path.join(profileRoot, profileName);
    fs.mkdirSync(userDataDir, { recursive: true });

    return {
      executablePath,
      userDataDir,
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1366,768',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    };
  }

  // Local dev on Windows: use an installed browser (sparticuz's binary is Linux-only).
  if (IS_WINDOWS) {
    for (const p of CHROME_CANDIDATES) {
      if (fs.existsSync(p)) return { executablePath: p, args: [], headless: true };
    }
    throw new Error('No Chrome/Edge found on Windows. Install a browser to run the local scraper.');
  }
  // A Linux PC/VPS may have its own Chromium/Chrome. Prefer it over the
  // serverless Sparticuz binary so the portable worker remains independent of
  // Browserless and can keep a normal persistent profile.
  const localLinuxChrome = firstExistingPath(LINUX_CHROME_CANDIDATES);
  if (localLinuxChrome) {
    return {
      executablePath: localLinuxChrome,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
  }
  // Serverless / Linux: use sparticuz chromium (ESM-only since v149).
  // Load it with dynamic import() so it works from this CommonJS file
  // (require() of an ESM module throws ERR_REQUIRE_ESM on Node >= 22).
  const mod = await import('@sparticuz/chromium');
  const chromium = mod.default ?? mod;
  return {
    executablePath: await chromium.executablePath(),
    // headless:'shell' selects the optimized headless build for serverless.
    headless: 'shell',
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
  };
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const AIR_E_URLS = {
  login:   'https://portal.air-e.com/Login?returnurl=%2fMis-Facturas%2fListado-de-Facturas',
  listado: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List',
};

// The three providers expose authenticated portals. Browserless is used by
// launchBrowser() for each named profile; these URLs describe the provider
// routes used after the authenticated session is established.
const TRIPLE_A_URLS = {
  login: 'https://portal.aaa.com.co/iniciar-sesion',
  policies: 'https://portal.aaa.com.co/polizas',
};
const GAS_PORTAL_URLS = {
  login: 'https://portal.gascaribe.com/login',
  contracts: 'https://portal.gascaribe.com/contracts',
  payments: 'https://portal.gascaribe.com/payments',
};
const GAS_API_BASE = 'https://pagosweb-production-api.innovacion-gascaribe.com';
const PORTAL_AUTH_TIMEOUT_MS = 180000;
const PORTAL_DATA_TIMEOUT_MS = 90000;
const PORTAL_LOGIN_ATTEMPTS = 3;
const PORTAL_AUTH_SETTLE_TIMEOUT_MS = 60000;
const PORTAL_DATA_ATTEMPTS = 2;
const PORTAL_DATA_RETRY_DELAY_MS = 2500;
// Gascaribe's frontend can expose a Turnstile token a few seconds before its
// backend accepts the challenge. Keep this delay provider-specific so the
// other portals do not pay the extra wait.
const GAS_TURNSTILE_SETTLE_DELAY_MS = Math.max(
  10000,
  Number(process.env.GAS_TURNSTILE_SETTLE_DELAY_MS || 10000) || 10000,
);
const TRIPLE_A_LOGIN_METHOD = String(process.env.TRIPLE_A_LOGIN_METHOD || 'credentials')
  .trim()
  .toLowerCase();
const TRIPLE_A_GOOGLE_LOGIN_TIMEOUT_MS = Math.max(
  30000,
  Number(process.env.TRIPLE_A_GOOGLE_LOGIN_TIMEOUT_MS || PORTAL_AUTH_TIMEOUT_MS) || PORTAL_AUTH_TIMEOUT_MS,
);

// Legacy fallback only. The source of truth is now db.apartments, so adding a
// NIC in the admin UI is enough to include the apartment in the next scrape.
const AIR_E_NIC_MAP = {
  '2059378': '101',
  '6906395': '102',
  '7889028': '201',
  '7809670': '202',
  '7809672': '203',
  '7889031': '301',
  '7889033': '302',
  '7889034': '303',
  '7889036': '401',
  '7889037': '402',
  '7889039': '403',
  '7889035': '501',
};

function configuredAirETargets(apartments = db?.apartments || []) {
  const targets = [];
  const ordered = [...(apartments || [])].sort((left, right) => {
    const leftConfigured = left?.status === 'occupied' ? 0 : 1;
    const rightConfigured = right?.status === 'occupied' ? 0 : 1;
    return leftConfigured - rightConfigured || String(left?.name || '').localeCompare(String(right?.name || ''), 'es', { numeric: true });
  });

  for (const apartment of ordered) {
    const nic = String(apartment?.electricityPaymentCode || apartment?.nic || '').replace(/\D/g, '');
    // A single Air-e NIC can intentionally be shared by multiple apartments.
    // Keep one target per apartment so the same portal debt is displayed on
    // every apartment that is configured with that shared NIC.
    if (!nic) continue;
    targets.push({
      apartmentId: apartment.id,
      apartment: apartment.name,
      nic,
      electricityPaymentUrl: apartment.electricityPaymentUrl || null,
    });
  }

  // Keep the old mapping as a compatibility fallback for diagnostic scripts
  // that initialise the scraper without an apartment database.
  if (targets.length) return targets;
  return Object.entries(AIR_E_NIC_MAP).map(([nic, apartment]) => ({ nic, apartment }));
}

// ── DB REF (set by server.cjs) ─────────────────────────────────────────────
let db = null;
let saveData = null;
let lastScrapeError = null;
let lastWaterScrapeError = null;
let lastGasScrapeError = null;

function getLastScrapeError() {
  return lastScrapeError;
}

function getLastWaterScrapeError() {
  return lastWaterScrapeError;
}

function getLastGasScrapeError() {
  return lastGasScrapeError;
}

function init(dbRef, saveFn) {
  db = dbRef;
  saveData = saveFn;
}

// Air-e credentials are stored in plain text in db.portalCredentials (provider 'air-e')
// by the admin-only portal-credentials endpoints.
function getAirECredentials() {
  const rec = (db && db.portalCredentials || []).find(r => r.provider === 'air-e');
  if (!rec) {
    throw new Error('Credenciales de Air-e no configuradas. Guárdalas en Ajustes → Credenciales de servicios.');
  }
  const email = rec.username;
  const password = rec.password;
  if (!email || !password) {
    throw new Error('Credenciales de Air-e incompletas.');
  }
  return { email, password };
}

// Portal credentials are stored in db.portalCredentials by the admin-only
// endpoints. The username is an email for the current providers, but keeping
// this helper generic lets each scraper share the same credential lookup.
function getPortalCredentials(provider) {
  const wanted = new Set((Array.isArray(provider) ? provider : [provider])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean));
  const rec = (db && db.portalCredentials || []).find(record =>
    wanted.has(String(record.provider || '').trim().toLowerCase())
  );
  if (!rec) throw new Error(`Credenciales de ${[...wanted].join(' / ') || 'servicios'} no configuradas.`);
  if (!rec.username || !rec.password) throw new Error(`Credenciales de ${rec.provider} incompletas.`);
  return { username: rec.username, password: rec.password };
}

// ── BROWSER LAUNCH (Render-compatible) ─────────────────────────────────────

function browserlessEndpointFor(profileName, {
  stealth = BROWSERLESS_STEALTH,
  tokenOverride = null,
} = {}) {
  const profile = String(profileName || '').trim().toLowerCase();
  if (!BROWSERLESS_PROFILES.includes(profile)) return null;
  const profileToken = tokenOverride || BROWSERLESS_TOKENS[profile] || '';
  if (!profileToken && !BROWSERLESS_WS_ENDPOINT) return null;

  try {
    const endpoint = new URL(BROWSERLESS_WS_ENDPOINT || `wss://${BROWSERLESS_REGION}.browserless.io`);
    if (profileToken) {
      // Replace a token embedded in a legacy endpoint so each provider really
      // uses its own account instead of silently sharing the old key.
      endpoint.searchParams.set('token', profileToken);
    }
    if (stealth && !/\/stealth\/?$/i.test(endpoint.pathname)) {
      endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/stealth`;
    }
    if (BROWSERLESS_SOLVE_CAPTCHAS) {
      endpoint.searchParams.set('solveCaptchas', 'true');
    }
    if (BROWSERLESS_TIMEOUT_MS > 0) {
      endpoint.searchParams.set('timeout', String(BROWSERLESS_TIMEOUT_MS));
    }
    const proxy = String(process.env.BROWSERLESS_PROXY || '').trim();
    if (proxy && !endpoint.searchParams.has('proxy')) endpoint.searchParams.set('proxy', proxy);
    const proxyCountry = String(process.env.BROWSERLESS_PROXY_COUNTRY || '').trim();
    if (proxyCountry && !endpoint.searchParams.has('proxyCountry')) {
      endpoint.searchParams.set('proxyCountry', proxyCountry);
    }
    return endpoint.toString();
  } catch {
    return null;
  }
}

// Some Browserless accounts accept the standard BaaS route but reject the
// stealth route. Keep the same provider token and try the standard route
// before falling back to the local browser; the scraper remains portal-only.
function browserlessEndpointCandidates(profileName) {
  const profile = String(profileName || '').trim().toLowerCase();
  const providerEnvNames = {
    'air-e': 'BROWSERLESS_TOKEN_AIR_E',
    water: 'BROWSERLESS_TOKEN_WATER',
    gas: 'BROWSERLESS_TOKEN_GAS',
  };
  const tokenSources = [];
  const seenTokens = new Set();
  const addToken = (source, token) => {
    const value = String(token || '').trim();
    if (!value || seenTokens.has(value)) return;
    seenTokens.add(value);
    tokenSources.push({ source, token: value });
  };

  addToken(profile, process.env[providerEnvNames[profile]]);
  if (BROWSERLESS_CROSS_PROVIDER_FAILOVER) {
    for (const sibling of ['water', 'air-e', 'gas']) {
      if (sibling === profile) continue;
      addToken(sibling, process.env[providerEnvNames[sibling]]);
    }
  }
  addToken('legacy', process.env.BROWSERLESS_TOKEN);

  const candidates = [];
  const routeModes = [BROWSERLESS_STEALTH];
  if (BROWSERLESS_STEALTH) routeModes.push(false);
  for (const { source, token } of tokenSources) {
    for (const stealth of routeModes) {
      const endpoint = browserlessEndpointFor(profile, { stealth, tokenOverride: token });
      if (!endpoint || candidates.some(candidate => candidate.endpoint === endpoint)) continue;
      candidates.push({
        endpoint,
        source,
        route: stealth ? 'stealth' : 'standard',
      });
    }
  }
  return candidates;
}

async function launchBrowser(profileName = 'services', useFullChrome = FULL_CHROME_ENABLED) {
  const browserlessEndpoints = browserlessEndpointCandidates(profileName);
  for (let index = 0; index < browserlessEndpoints.length; index += 1) {
    const candidate = browserlessEndpoints[index];
    const browserlessEndpoint = candidate.endpoint;
    console.log(`[BROWSERLESS] Connecting remote browser for ${profileName} (${candidate.source} token, ${candidate.route})...`);
    try {
      return await puppeteer.connect({
        browserWSEndpoint: browserlessEndpoint,
        protocolTimeout: 60000,
      });
    } catch (error) {
      const next = index + 1 < browserlessEndpoints.length
        ? `trying ${browserlessEndpoints[index + 1].source} token/${browserlessEndpoints[index + 1].route}`
        : 'falling back to local browser';
      console.error(`[BROWSERLESS] ${profileName} ${candidate.source} token/${candidate.route} connection failed; ${next}:`, error.message);
    }
  }

  const cfg = await resolveChromium(profileName, useFullChrome);
  return await puppeteer.launch({
    args: cfg.args,
    defaultViewport: { width: 1366, height: 768 },
    executablePath: cfg.executablePath,
    headless: cfg.headless,
    protocolTimeout: 60000,
    ...(cfg.userDataDir ? { userDataDir: cfg.userDataDir } : {}),
  });
}

// Local-only browser for server-generated artifacts (for example the global
// WhatsApp services report). It deliberately bypasses Browserless and the
// visible/full-Chrome worker profile: rendering a report must not consume a
// remote browser quota or interfere with the authenticated portal session.
async function launchLocalBrowser(profileName = 'services-report') {
  const cfg = await resolveChromium(profileName, false);
  return await puppeteer.launch({
    args: cfg.args,
    defaultViewport: { width: 1200, height: 900 },
    executablePath: cfg.executablePath,
    headless: cfg.headless,
    protocolTimeout: 60000,
    ...(cfg.userDataDir ? { userDataDir: cfg.userDataDir } : {}),
  });
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

// Browserless exposes CAPTCHA lifecycle events through CDP. Automatic
// solving is enabled in the connection URL, but explicitly triggering the
// solver when an event arrives also covers forms that submit immediately
// after a Turnstile iframe is injected.
async function attachBrowserlessCaptchaSolver(page, provider) {
  if (!BROWSERLESS_SOLVE_CAPTCHAS || typeof page?.createCDPSession !== 'function') return null;
  const cdp = await page.createCDPSession().catch(() => null);
  if (!cdp || typeof cdp.on !== 'function') return null;
  const state = { status: '', solved: false };
  const onFound = event => {
    state.status = String(event?.status || 'found');
    console.log(`[${provider}] Browserless CAPTCHA: ${state.status}.`);
    if (state.status === 'solved' || typeof cdp.send !== 'function') return;
    // Some Browserless accounts emit `solving` without completing the
    // automatic command. Sending the documented solve command again is
    // idempotent and wakes that challenge without touching the portal form.
    cdp.send('Browserless.solveCaptcha')
      .then(result => {
        state.solved = Boolean(result?.solved);
        console.log(`[${provider}] Browserless CAPTCHA solver: ${state.solved ? 'resuelto' : 'sin confirmacion'}.`);
      })
      .catch(error => console.warn(`[${provider}] Browserless CAPTCHA solver error: ${error.message}`));
  };
  const onSolved = () => {
    state.status = 'solved';
    state.solved = true;
    console.log(`[${provider}] Browserless CAPTCHA: resuelto automaticamente.`);
  };
  cdp.on('Browserless.captchaFound', onFound);
  cdp.on('Browserless.captchaAutoSolved', onSolved);
  return {
    state,
    async waitForSolved(timeout = 45000) {
      const activityDeadline = Date.now() + Math.min(5000, timeout);
      while (!state.status && Date.now() < activityDeadline) await sleep(250);
      if (!state.status || state.status === 'solved') return state;
      const deadline = Date.now() + Math.max(0, timeout - 5000);
      while (state.status !== 'solved' && Date.now() < deadline) await sleep(250);
      return state;
    },
    async close() {
      cdp.off?.('Browserless.captchaFound', onFound);
      cdp.off?.('Browserless.captchaAutoSolved', onSolved);
      await cdp.detach?.().catch?.(() => {});
    },
  };
}

async function gotoPortalPage(page, url, options = {}, provider = 'Portal') {
  const { attempts = 2, retryDelayMs = 2000, ...gotoOptions } = options || {};
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url, gotoOptions);
    } catch (error) {
      lastError = error;
      const retryable = /frame detached|target closed|execution context was destroyed|navigation timeout/i.test(String(error?.message || error));
      if (!retryable || attempt >= attempts) throw error;
      console.warn(`[${provider}] Navegacion inestable; reintentando (${attempt + 1}/${attempts}): ${error.message}`);
      await sleep(retryDelayMs);
    }
  }
  throw lastError || new Error(`No se pudo abrir ${url}.`);
}

async function recreatePortalPage(browser, oldPage, oldCaptchaSolver, provider) {
  // Create the replacement first. Browserless may close the remote session
  // when the last page is closed while Turnstile is replacing its iframe.
  // Opening first preserves the browser connection and its cookies.
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
  const captchaSolver = await attachBrowserlessCaptchaSolver(page, provider);
  if (oldCaptchaSolver) await oldCaptchaSolver.close().catch(() => {});
  await oldPage?.close?.().catch(() => {});
  return { page, captchaSolver };
}

async function waitAndType(page, selector, text, timeout = 45000) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout });
    await page.click(selector);
    await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.value = ''; }, selector);
    await page.type(selector, text, { delay: 50 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      inputs: [...document.querySelectorAll('input')].slice(0, 20).map(input => ({
        type: input.type,
        id: input.id,
        name: input.name,
        visible: !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length),
      })),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1600),
    })).catch(() => ({ url: page.url(), title: 'unavailable' }));
    console.error('[AIR-E] Login page diagnostic:', JSON.stringify(state));
    throw error;
  }
}

function portalFrameRoots(page) {
  const roots = [page];
  if (typeof page?.frames !== 'function') return roots;
  try {
    const main = typeof page.mainFrame === 'function' ? page.mainFrame() : null;
    for (const frame of page.frames()) {
      if (frame && frame !== main) roots.push(frame);
    }
  } catch {}
  return roots;
}

async function visibleHandle(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const root of portalFrameRoots(page)) {
      for (const selector of list) {
        const handles = await root.$$(selector).catch(() => []);
        for (const handle of handles) {
          const box = await handle.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) return handle;
          try { await handle.dispose(); } catch {}
        }
      }
    }
    await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
  }
  return null;
}

async function typeVisibleField(page, selectors, value, timeout = 45000) {
  const handle = await visibleHandle(page, selectors, timeout);
  if (!handle) {
    throw new Error(`No se encontró un campo visible (${(Array.isArray(selectors) ? selectors : [selectors]).join(', ')}).`);
  }
  try {
    await handle.click({ clickCount: 3 });
    await handle.type(String(value ?? ''), { delay: 35 });
    return handle;
  } catch (error) {
    try { await handle.dispose(); } catch {}
    throw error;
  }
}

async function clickVisibleButton(page, selectors, timeout = 20000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  const actionWords = /ingresar|iniciar|sesion|login|entrar|acceder|continuar|autenticar|consultar|buscar|enviar|submit/i;
  while (Date.now() < deadline) {
    let formFallback = null;
    for (const root of portalFrameRoots(page)) {
      for (const selector of list) {
        const handles = await root.$$(selector).catch(() => []);
        for (const handle of handles) {
          const box = await handle.boundingBox().catch(() => null);
          if (!box || box.width <= 0 || box.height <= 0) {
            try { await handle.dispose(); } catch {}
            continue;
          }
          const info = await handle.evaluate(element => ({
            type: element.getAttribute('type') || '',
            text: (element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
            inForm: Boolean(element.closest('form')),
            disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
          })).catch(() => null);
          if (!info || info.disabled) {
            try { await handle.dispose(); } catch {}
            continue;
          }
          const isSubmit = /submit/i.test(info.type) || actionWords.test(info.text);
          if (isSubmit) {
            await handle.click();
            return true;
          }
          if (info.inForm && !formFallback) formFallback = handle;
          else {
            try { await handle.dispose(); } catch {}
          }
        }
      }
    }
    if (formFallback) {
      await formFallback.click();
      return true;
    }
    await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
  }
  return false;
}

async function clickVisiblePortalButtonByText(page, patterns, timeout = 20000) {
  const matchers = (Array.isArray(patterns) ? patterns : [patterns])
    .map(pattern => pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'i'));
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const root of portalFrameRoots(page)) {
      const handles = await root.$$('button, input[type="button"], input[type="submit"], [role="button"]')
        .catch(() => []);
      for (const handle of handles) {
        const box = await handle.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) {
          await handle.dispose().catch(() => {});
          continue;
        }
        const info = await handle.evaluate(element => ({
          text: (element.innerText || element.value || element.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim(),
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        })).catch(() => null);
        if (!info || info.disabled || !matchers.some(matcher => matcher.test(info.text))) {
          await handle.dispose().catch(() => {});
          continue;
        }
        await handle.click();
        await handle.dispose().catch(() => {});
        return true;
      }
    }
    await sleep(Math.min(500, Math.max(50, deadline - Date.now())));
  }
  return false;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function apartmentNumberFrom(value) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ' ');
  const explicit = text.match(/(?:apto|apartamento|unidad|unit|inmueble|inmueble)\s*#?\s*([1-9]\d{2})\b/i);
  if (explicit?.[1]) return explicit[1];
  const exact = text.trim().match(/^([1-9]\d{2})$/);
  if (exact?.[1]) return exact[1];
  const match = text.match(/\b([1-9]\d{2})\b/);
  return match?.[1] || null;
}

function configuredApartmentTargets(apartments = db?.apartments || []) {
  return (apartments || [])
    .filter(apartment => apartment && apartment.name)
    .map(apartment => ({
      apartmentId: apartment.id,
      apartment: apartment.name,
      apartmentNumber: apartmentNumberFrom(apartment.name),
      waterPaymentUrl: apartment.waterPaymentUrl || null,
      waterPaymentCode: apartment.waterPaymentCode || null,
      gasPaymentCode: apartment.gasPaymentCode || null,
      gasPaymentUrl: gasContractPaymentUrl(apartment.gasPaymentCode),
    }));
}

function matchPortalApartment(targets, identifiers = []) {
  return matchPortalApartmentForService(targets, identifiers, null);
}

function normalizePortalText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function portalIdentifierValues(value, key = '', depth = 0, output = []) {
  if (value === null || value === undefined || depth > 4) return output;
  if (['string', 'number', 'bigint'].includes(typeof value)) {
    const text = String(value).trim();
    const identifierKey = /(?:id|code|number|numero|policy|poliza|contract|contrato|subscription|suscripcion|account|cuenta|reference|referencia|alias|name|nombre|address|direccion|apto|apartamento|unit|unidad|property|inmueble|customer|cliente)/i.test(key);
    if (text && (identifierKey || !key)) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => portalIdentifierValues(item, key, depth + 1, output));
    return output;
  }
  if (typeof value !== 'object') return output;
  for (const [childKey, childValue] of Object.entries(value)) {
    portalIdentifierValues(childValue, childKey, depth + 1, output);
  }
  return output;
}

function portalCodeValues(target, service) {
  if (service === 'water') return [target?.waterPaymentCode];
  if (service === 'gas') return [target?.gasPaymentCode];
  return [target?.waterPaymentCode, target?.gasPaymentCode];
}

function matchPortalApartmentForService(targets, identifiers = [], service = null) {
  const rawValues = (Array.isArray(identifiers) ? identifiers : [identifiers])
    .flatMap(value => portalIdentifierValues(value))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const values = [...new Set(rawValues)];
  const normalizedValues = values.map(normalizePortalText).filter(Boolean);
  const digitValues = values.map(normalizeDigits).filter(Boolean);

  let best = null;
  let bestScore = 0;
  for (const target of targets || []) {
    const targetCodeValues = portalCodeValues(target, service)
      .map(normalizeDigits)
      .filter(Boolean);
    const targetTextCodes = portalCodeValues(target, service)
      .map(normalizePortalText)
      .filter(Boolean);
    const targetNumber = target.apartmentNumber || apartmentNumberFrom(target.apartment);
    const targetName = normalizePortalText(target.apartment);
    let score = 0;

    // Account/reference IDs are the strongest match. For gas we deliberately
    // use gasPaymentCode only; the old generic matcher accidentally compared
    // gas contracts against the water policy number first.
    const codeMatch = targetCodeValues.some(code => digitValues.includes(code)) ||
      targetTextCodes.some(code => normalizedValues.includes(code));
    const apartmentMatch = targetNumber && values.some(value => apartmentNumberFrom(value) === targetNumber);
    const nameMatch = targetName && normalizedValues.includes(targetName);
    if (codeMatch) score = 100;
    if (apartmentMatch) score = Math.max(score, codeMatch ? 150 : 50);
    if (nameMatch) score = Math.max(score, codeMatch ? 160 : 60);

    if (score > bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

// The local worker must read the rendered authenticated portal, just as a
// person does in Chrome.  Calling /bff/subscriptions or /invoices directly
// loses the browser's short-lived session/anti-forgery state and was the cause
// of the recurring 401/422 results.  These helpers deliberately use only DOM
// interaction and rendered text; no cookies, storage or raw API payloads are
// inspected.
const RENDERED_PORTAL_TIMEOUT_MS = 30000;

async function waitForRenderedPortal(page, evaluator, timeout = RENDERED_PORTAL_TIMEOUT_MS, arg = undefined) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await page.evaluate(evaluator, arg).catch(() => null);
    if (value) return value;
    await sleep(350);
  }
  return null;
}

async function waitForRenderedReader(reader, timeout = RENDERED_PORTAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await reader().catch(() => null);
    if (value) return value;
    await sleep(350);
  }
  return null;
}

async function renderedWaterPolicies(page) {
  return page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const text = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('[role="row"], tr')].filter(available);
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('[role="gridcell"], td')].filter(available).map(text);
      const rowText = text(row);
      let name = cells[1] || '';
      let code = String(cells[2] || '').replace(/\D/g, '');
      const address = cells[3] || '';
      const match = rowText.match(/((?:AP|Casa)\s*\d{3})\s*[-\u2013\u2014:]\s*(\d{4,})/i);
      if (match) {
        name = match[1];
        code = match[2].replace(/\D/g, '');
      }
      if (!name || code.length < 4 || seen.has(code)) continue;
      seen.add(code);
      result.push({ name, code, address, status: cells[6] || '' });
    }
    if (result.length) return result;
    const candidates = [...document.querySelectorAll('p, li, [role="cell"]')].filter(available).map(text)
      .concat(String(document.body?.innerText || document.body?.textContent || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean));
    for (const value of candidates) {
      const match = value.match(/((?:AP|Casa)\s*\d{3})\s*[-\u2013\u2014:]\s*(\d{4,})/i);
      if (!match || result.some(item => item.code === match[2])) continue;
      result.push({ name: match[1], code: match[2].replace(/\D/g, ''), address: '', status: '' });
    }
    return result;
  }).catch(() => []);
}

async function renderedGasContracts(page) {
  return page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const text = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    const paragraphs = [...document.querySelectorAll('p')].filter(available).map(text);
    const result = [];
    const seen = new Set();
    for (let index = 0; index < paragraphs.length; index += 1) {
      const match = paragraphs[index].match(/^(.+?)\s*[-\u2013\u2014:]\s*(\d{4,})$/);
      if (!match || seen.has(match[2])) continue;
      seen.add(match[2]);
      let address = '';
      for (let cursor = index + 1; cursor < Math.min(paragraphs.length, index + 8); cursor += 1) {
        if (/direcci[oó]n del predio/i.test(paragraphs[cursor])) {
          address = paragraphs[cursor + 1] || '';
          break;
        }
      }
      result.push({ name: match[1].trim(), code: match[2], address });
    }
    if (result.length) return result;
    const bodyLines = String(document.body?.innerText || document.body?.textContent || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    for (const value of bodyLines) {
      const match = value.match(/^(.+?)\s*[-\u2013\u2014:]\s*(\d{4,})$/);
      if (!match || result.some(item => item.code === match[2])) continue;
      result.push({ name: match[1].trim(), code: match[2], address: '' });
    }
    return result;
  }).catch(() => []);
}

async function collectRenderedWaterPolicies(page) {
  const all = [];
  for (let pageNumber = 0; pageNumber < 8; pageNumber += 1) {
    const current = await waitForRenderedReader(() => renderedWaterPolicies(page), 15000);
    if (!current?.length) break;
    for (const policy of current) {
      if (!all.some(item => item.code === policy.code)) all.push(policy);
    }
    const signature = current.map(item => item.code).join(',');
    const moved = await page.evaluate(() => {
      const available = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
      };
      const button = [...document.querySelectorAll('button')].find(element =>
        available(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && /siguiente|next/i.test(element.innerText || element.getAttribute('aria-label') || '')
      );
      if (!button) return false;
      button.click();
      return true;
    }).catch(() => false);
    if (!moved) break;
    const changed = await waitForRenderedReader(async () => {
      const after = await renderedWaterPolicies(page);
      return after.length && after.map(item => item.code).join(',') !== signature ? after : null;
    }, 10000);
    if (!changed) break;
  }
  return all;
}

async function portalLoginVisible(page) {
  return page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    return Boolean([...document.querySelectorAll('input[type="password"], input[name*="password" i], input[id*="password" i]')].some(available));
  }).catch(() => false);
}

async function openAuthenticatedPortalPage({ provider, page, dataUrl, loginUrl, emailSelectors, passwordSelectors, captchaSolver }) {
  await gotoPortalPage(page, dataUrl, {
    waitUntil: 'domcontentloaded',
    timeout: PORTAL_AUTH_TIMEOUT_MS,
  }, provider).catch(() => {});
  await sleep(1500);
  if (!(await portalLoginVisible(page))) return;

  const credentials = getPortalCredentials(provider === 'Triple A' ? ['triple-a', 'water'] : ['gascaribe', 'gas']);
  await gotoPortalPage(page, loginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: PORTAL_AUTH_TIMEOUT_MS,
  }, provider);
  await submitPortalLoginForm(page, {
    provider,
    username: credentials.username,
    password: credentials.password,
    emailSelectors,
    passwordSelectors,
    prepareSubmit: async () => {
      await executePortalTurnstile(page).catch(() => false);
      if (captchaSolver) await captchaSolver.waitForSolved(60000);
      await sleep(provider === 'Gases del Caribe' ? GAS_TURNSTILE_SETTLE_DELAY_MS : 500);
    },
  });
  await gotoPortalPage(page, dataUrl, {
    waitUntil: 'domcontentloaded',
    timeout: PORTAL_AUTH_TIMEOUT_MS,
  }, provider);
  await sleep(1800);
}

function portalUiStatus(status, amount) {
  const normalized = normalizePortalText(status);
  if (amount !== null && amount > 0) return 'pending';
  if (amount === 0 || /al dia|sin deuda|paid|pagad|cancelad/.test(normalized)) return 'paid';
  if (/pendiente|mora|vencid|pending|overdue/.test(normalized)) return 'pending';
  return 'unknown';
}

async function queryRenderedTripleAPolicy(page, code) {
  const ready = await page.evaluate((paymentCode) => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const input = [...document.querySelectorAll('input[name="paymentNumber"], input[type="number"]')].find(available);
    const button = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].find(element =>
      available(element) && !element.disabled && /consultar/i.test(element.innerText || element.value || element.getAttribute('aria-label') || '')
    );
    if (!input || !button) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(paymentCode)); else input.value = String(paymentCode);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    button.click();
    return true;
  }, String(code)).catch(() => false);
  if (!ready) return { status: 'error', deudaCOP: null, error: 'Triple A no mostro el formulario de consulta autenticado.' };

  const parsed = await waitForRenderedPortal(page, (paymentCode) => {
    const body = String(document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ');
    if (/captcha|turnstile|no soy un robot/i.test(body)) return { challenge: true };
    if (!new RegExp(`\\b${String(paymentCode).replace(/\D/g, '')}\\b`).test(body) || !/total a pagar/i.test(body)) return null;
    const amountMatch = body.match(/total a pagar[^$0-9]{0,80}\$\s*([0-9][0-9.,]*)/i);
    const amount = amountMatch ? Number(amountMatch[1].replace(/\./g, '').replace(',', '.')) : null;
    const statusMatch = body.match(/pago pendiente|pago en mora|estas al dia|est[aá]s al d[ií]a/i);
    const lines = String(document.body?.innerText || document.body?.textContent || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const dueIndex = lines.findIndex(value => /^fecha de vencimiento$/i.test(value));
    return {
      amount: Number.isFinite(amount) ? Math.round(amount) : (statusMatch && /al dia|est[aá]s al d[ií]a/i.test(statusMatch[0]) ? 0 : null),
      statusText: statusMatch?.[0] || '',
      dueDate: dueIndex >= 0 ? lines[dueIndex + 1] || null : null,
      policy: String(paymentCode),
    };
  }, RENDERED_PORTAL_TIMEOUT_MS, String(code));
  if (parsed?.challenge) return { status: 'captcha', deudaCOP: null, error: 'Triple A mostro una verificacion durante la consulta.' };
  if (!parsed || parsed.amount === null) return { status: 'error', deudaCOP: null, error: `Triple A no mostro el total de la poliza ${code}.` };
  return { status: portalUiStatus(parsed.statusText, parsed.amount), deudaCOP: parsed.amount, periodo: parsed.dueDate || null };
}

async function selectRenderedGasContract(page, code) {
  const selected = await page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const selector = [...document.querySelectorAll('button')].find(element => available(element) && /^(?:ap|casa)\s*\d{3}$/i.test((element.innerText || '').trim()));
    if (!selector) return false;
    selector.click();
    return true;
  }).catch(() => false);
  if (!selected) return false;
  return Boolean(await waitForRenderedPortal(page, (contractCode) => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const item = [...document.querySelectorAll('[role="menuitem"], [role="option"], li, button')].find(element =>
      available(element) && String(element.innerText || element.textContent || '').includes(String(contractCode))
    );
    if (!item) return false;
    item.click();
    return true;
  }, 10000, String(code)));
}

async function queryRenderedGasContract(page, code) {
  if (!(await selectRenderedGasContract(page, code))) return { status: 'error', deudaCOP: null, error: `Gases del Caribe no mostro el contrato ${code}.` };
  await sleep(500);
  await page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const inicio = [...document.querySelectorAll('button')].find(element => available(element) && /^inicio$/i.test((element.innerText || '').trim()));
    if (inicio) inicio.click();
  }).catch(() => {});
  // Gascaribe separates the current invoice from financed/deferred debt. The
  // “Mis deudas/Deudas” screen is the authoritative source for the latter;
  // open it when the authenticated navigation exposes it before parsing.
  await page.evaluate(() => {
    const available = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && document.documentElement.contains(element);
    };
    const link = [...document.querySelectorAll('a,button,[role="link"],[role="menuitem"]')]
      .find(element => available(element) && /^(?:mis\s+)?deudas(?:\s+(?:diferidas|financiadas))?$/i.test((element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim()));
    if (link) { link.click(); return true; }
    return false;
  }).then(opened => opened ? sleep(700) : null).catch(() => {});
  const parsed = await waitForRenderedPortal(page, (contractCode) => {
    const body = String(document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ');
    const normalizedBody = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/captcha|turnstile|no soy un robot/i.test(body)) return { challenge: true };
    const money = value => {
      const amount = Number(String(value || '').replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(amount) ? Math.round(amount) : null;
    };
    const sectionAmount = (startPattern, endPattern, amountPattern) => {
      const start = body.search(startPattern);
      if (start < 0) return null;
      const remainder = body.slice(start);
      const end = endPattern ? remainder.search(endPattern) : -1;
      const section = end > 0 ? remainder.slice(0, end) : remainder;
      const match = section.match(amountPattern);
      return match ? money(match[1]) : null;
    };
    const totalMatch = body.match(/saldo\s+total\s*\$\s*([0-9][0-9.,]*)/i);
    const month = sectionAmount(/deuda\s+actual/i, /deuda\s+(?:financiada|diferida)/i, /saldo\s+total\s*\$\s*([0-9][0-9.,]*)/i);
    const convenio = sectionAmount(/deuda\s+(?:financiada|diferida)/i, null, /(?:saldo\s+por\s+facturar(?:\s+gas)?|saldo\s+total|valor\s+total)\s*\$\s*([0-9][0-9.,]*)/i);
    const hasPositiveCurrent = month !== null && month > 0;
    const hasPositiveAgreement = convenio !== null && convenio > 0;
    // A paid current invoice can still have a financed/deferred balance.
    // Do not return early and erase that agreement from the result.
    if (/pagad[oa]/i.test(normalizedBody) && !hasPositiveCurrent && !hasPositiveAgreement && new RegExp(String(contractCode).replace(/\D/g, '')).test(body)) {
      const paidAmountMatch = body.match(/(?:total a pagar|pagad[oa])[^$0-9]{0,80}\$\s*([0-9][0-9.,]*)/i);
      const invoiceAmount = paidAmountMatch ? money(paidAmountMatch[1]) : null;
      const invoiceMatch = body.match(/factura\s*n[^0-9]{0,8}(\d{4,})/i);
      const periodMatch = body.match(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+20\d{2}\b/i);
      return { amount: 0, total: 0, month: 0, convenio: 0, invoiceAmount, invoice: invoiceMatch?.[1] || null, dueDate: periodMatch?.[0] || null };
    }
    if (/estas al dia|sin deuda|factura pagad/i.test(normalizedBody) && !/\$\s*[1-9][0-9.,]*/.test(body)) {
      const invoiceMatch = body.match(/factura\s*n[^0-9]{0,8}(\d{4,})/i);
      const dueMatch = body.match(/vence[^.]{0,40}/i);
      return { amount: 0, total: 0, month: 0, convenio: 0, invoice: invoiceMatch?.[1] || null, dueDate: dueMatch?.[0] || null };
    }
    const hasReceiptSummary = /saldo\s+total|deuda\s+actual|total a pagar|est(?:á|a)s al d(?:í|i)a|sin deuda|factura pagad/i.test(body);
    if (!new RegExp(`contrato\\s*n[^0-9]{0,8}${String(contractCode).replace(/\D/g, '')}`).test(body) || !hasReceiptSummary) return null;
    const amountMatch = body.match(/total a pagar[^$0-9]{0,80}\$\s*([0-9][0-9.,]*)/i);
    const rawAmount = amountMatch ? money(amountMatch[1]) : (totalMatch ? money(totalMatch[1]) : null);
    const paidByText = /est(?:á|a)s al d(?:í|i)a|al d(?:í|i)a|sin deuda|factura pagad|pago realizad/i.test(body)
      && !hasPositiveCurrent && !hasPositiveAgreement;
    const amount = Number.isFinite(rawAmount) ? rawAmount : (paidByText ? 0 : null);
    const invoiceMatch = body.match(/factura\s*n[^0-9]{0,8}(\d{4,})/i);
    const dueMatch = body.match(/vence[^.]{0,40}/i);
    const current = month ?? amount;
    const total = current !== null && convenio !== null ? current + convenio : amount;
    return { amount: total, total, month: current, convenio: convenio ?? 0, invoice: invoiceMatch?.[1] || null, dueDate: dueMatch?.[0] || null };
  }, RENDERED_PORTAL_TIMEOUT_MS, String(code));
  if (parsed?.challenge) return { status: 'captcha', deudaCOP: null, error: 'Gases del Caribe mostro una verificacion durante la consulta.' };
  if (!parsed || parsed.amount === null) return { status: 'error', deudaCOP: null, error: `Gases del Caribe no mostro el total del contrato ${code}.` };
  return {
    status: parsed.amount > 0 ? 'pending' : 'paid',
    deudaCOP: parsed.total ?? parsed.amount,
    deudaTotalCOP: parsed.total ?? parsed.amount,
    deudaMesCOP: parsed.month ?? parsed.amount,
    deudaConveniosCOP: parsed.convenio ?? 0,
    factura: parsed.invoice || null,
    periodo: parsed.dueDate || null,
    facturaValorCOP: parsed.month ?? parsed.invoiceAmount ?? null,
  };
}

async function scrapeTripleAFromRenderedUi() {
  let browser;
  let page;
  let captchaSolver;
  try {
    lastWaterScrapeError = null;
    browser = await launchBrowser('water');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
    captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Triple A');
    await openAuthenticatedPortalPage({
      provider: 'Triple A', page, dataUrl: TRIPLE_A_URLS.policies, loginUrl: TRIPLE_A_URLS.login,
      emailSelectors: ['input[type="email"]', 'input[name="email" i]', 'input[autocomplete="username"]', 'input[type="text"]'],
      passwordSelectors: ['input[type="password"]', 'input[name="password" i]'], captchaSolver,
    });
    const policies = await collectRenderedWaterPolicies(page);
    if (!policies?.length) throw new Error('Triple A no mostro polizas en la sesion autenticada.');
    const opened = await page.evaluate(() => {
      const link = [...document.querySelectorAll('a')].find(element => /pagos-usuario/.test(String(element.getAttribute('href') || '')) || /^pagos$/i.test(element.innerText || ''));
      if (!link) return false;
      link.click();
      return true;
    });
    if (!opened) throw new Error('Triple A no abrio la pantalla de pagos autenticada.');
    await waitForRenderedPortal(page, () => Boolean(document.querySelector?.('input[name="paymentNumber"], input[type="number"]')), 30000).catch(() => null);
    let apiSubscriptions = [];
    const apiSubscriptionsResponse = await fetchPortalJson(page, '/bff/subscriptions');
    if (apiSubscriptionsResponse.status >= 200 && apiSubscriptionsResponse.status < 300) {
      apiSubscriptions = unwrapPortalList(parsePortalResponseBody(apiSubscriptionsResponse.body), ['subscriptions', 'policies', 'items']);
      console.log(`[TRIPLE A] API de detalle disponible en el flujo visual: ${apiSubscriptions.length} suscripción(es).`);
    }
    const targets = configuredApartmentTargets();
    const results = [];
    const used = new Set();
    for (const policy of policies) {
      const target = matchPortalApartmentForService(targets, policy, 'water');
      if (!target || used.has(String(target.apartmentId || target.apartment))) continue;
      used.add(String(target.apartmentId || target.apartment));
      const parsed = await queryRenderedTripleAPolicy(page, policy.code);
      const matchingSubscription = apiSubscriptions.find(subscription =>
        portalIdentifierValues(subscription).some(value => normalizeDigits(value) === normalizeDigits(policy.code))
      );
      const apiSummary = matchingSubscription
        ? await fetchTripleAPortalSummary(page, matchingSubscription, null).catch(error => ({ error: error.message }))
        : {};
      const total = apiSummary.deudaTotalCOP ?? parsed.deudaCOP;
      const month = apiSummary.deudaMesCOP ?? parsed.deudaCOP;
      results.push({ provider: 'Triple A', service: 'water', apartmentId: target.apartmentId, apartment: target.apartment, waterPaymentCode: policy.code, waterPaymentUrl: target.waterPaymentUrl || null, status: total > 0 ? 'pending' : parsed.status, deudaCOP: total, deudaMesCOP: month, deudaConveniosCOP: apiSummary.deudaConveniosCOP ?? apiSummary.financiadaCOP ?? null, deudaTotalCOP: total, deudaLabel: 'Deuda Total', numFacturas: apiSummary.numFacturas ?? (parsed.status === 'pending' ? 1 : 0), factura: apiSummary.factura || null, facturaValorCOP: apiSummary.facturaValorCOP ?? month, periodo: apiSummary.periodo || parsed.periodo || null, financiadaCOP: apiSummary.financiadaCOP ?? null, cuotaFinanciadaCOP: apiSummary.cuotaFinanciadaCOP ?? null, financiacion: apiSummary.financiacion || [], debtSource: apiSummary.debtSource || 'rendered_invoice', debtEndpointStatus: apiSummary.debtEndpointStatus ?? null, error: parsed.error || apiSummary.error || null, checkedAt: new Date().toISOString(), scrapedAt: new Date().toISOString() });
      console.log(`[TRIPLE A] UI ${target.apartment}: ${parsed.status} (${parsed.deudaCOP === null ? 'sin valor' : `$${parsed.deudaCOP.toLocaleString('es-CO')}`}).`);
    }
    for (const target of targets) {
      const key = String(target.apartmentId || target.apartment);
      if (used.has(key)) continue;
      results.push({ provider: 'Triple A', service: 'water', apartmentId: target.apartmentId, apartment: target.apartment, waterPaymentCode: target.waterPaymentCode || null, waterPaymentUrl: target.waterPaymentUrl || null, status: 'unknown', deudaCOP: null, deudaTotalCOP: null, deudaLabel: 'Deuda Total', numFacturas: null, error: 'Triple A no tiene esta poliza asociada en la cuenta autenticada.', checkedAt: new Date().toISOString(), scrapedAt: new Date().toISOString() });
    }
    return results;
  } catch (error) {
    lastWaterScrapeError = error.message;
    console.error('[TRIPLE A] UI scraper error:', error.message);
    return [];
  } finally {
    if (captchaSolver) await captchaSolver.close().catch(() => {});
    if (browser) await closeWaterBrowser(browser);
  }
}

async function scrapeGasFromRenderedUi() {
  let browser;
  let page;
  let captchaSolver;
  try {
    lastGasScrapeError = null;
    browser = await launchBrowser('gas');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
    captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Gases del Caribe');
    await openAuthenticatedPortalPage({
      provider: 'Gases del Caribe', page, dataUrl: GAS_PORTAL_URLS.contracts, loginUrl: GAS_PORTAL_URLS.login,
      emailSelectors: ['input[type="email"]', 'input[name="email" i]', 'input[autocomplete="username"]', 'input[type="text"]'],
      passwordSelectors: ['input[type="password"]', 'input[name="password" i]'], captchaSolver,
    });
    const contracts = await waitForRenderedReader(() => renderedGasContracts(page), RENDERED_PORTAL_TIMEOUT_MS);
    if (!contracts?.length) throw new Error('Gases del Caribe no mostro contratos en la sesion autenticada.');
    const targets = configuredApartmentTargets();
    const results = [];
    const used = new Set();
    for (const contract of contracts) {
      const target = matchPortalApartmentForService(targets, contract, 'gas');
      if (!target || used.has(String(target.apartmentId || target.apartment))) continue;
      used.add(String(target.apartmentId || target.apartment));
      const parsed = await queryRenderedGasContract(page, contract.code);
      const total = parsed.deudaTotalCOP ?? parsed.deudaCOP;
      const month = parsed.deudaMesCOP ?? parsed.facturaValorCOP ?? parsed.deudaCOP;
      results.push({ provider: 'Gases del Caribe', service: 'gas', apartmentId: target.apartmentId, apartment: target.apartment, gasPaymentCode: contract.code, gasPaymentUrl: gasContractPaymentUrl(contract.code), status: total > 0 ? 'pending' : parsed.status, deudaCOP: total, deudaMesCOP: month, deudaConveniosCOP: parsed.deudaConveniosCOP ?? 0, deudaTotalCOP: total, deudaLabel: 'Deuda Total', numFacturas: parsed.status === 'pending' ? 1 : 0, factura: parsed.factura || null, periodo: parsed.periodo || null, facturaValorCOP: month, financiadaCOP: parsed.deudaConveniosCOP ?? 0, cuotaFinanciadaCOP: null, financiacion: [], debtSource: 'rendered_debt_cards', debtEndpointStatus: null, error: parsed.error || null, checkedAt: new Date().toISOString(), scrapedAt: new Date().toISOString() });
      console.log(`[GAS] UI ${target.apartment}: ${parsed.status} (${parsed.deudaCOP === null ? 'sin valor' : `$${parsed.deudaCOP.toLocaleString('es-CO')}`}).`);
    }
    for (const target of targets) {
      const key = String(target.apartmentId || target.apartment);
      if (used.has(key)) continue;
      // The portal may omit a paid contract from its active-invoice list. It
      // is still a valid configured contract, so persist an explicit $0/al-day
      // record instead of exposing a false association error.
      results.push({ provider: 'Gases del Caribe', service: 'gas', apartmentId: target.apartmentId, apartment: target.apartment, gasPaymentCode: target.gasPaymentCode || null, gasPaymentUrl: gasContractPaymentUrl(target.gasPaymentCode), status: 'paid', deudaCOP: 0, deudaTotalCOP: 0, deudaLabel: 'Deuda Total', numFacturas: 0, portalNoInvoice: true, error: null, checkedAt: new Date().toISOString(), scrapedAt: new Date().toISOString() });
    }
    return results;
  } catch (error) {
    lastGasScrapeError = error.message;
    console.error('[GAS] UI scraper error:', error.message);
    return [];
  } finally {
    if (captchaSolver) await captchaSolver.close().catch(() => {});
    if (browser) await closeWaterBrowser(browser);
  }
}

// ── AUTHENTICATED PORTAL SCRAPERS ───────────────────────────────────────────
//
// The scheduled/manual service jobs use only the authenticated provider
// portals. QR/payment URLs are intentionally not a data-source fallback.
const PORTAL_RESPONSE_TIMEOUT_MS = 5000;
const BROWSER_CLOSE_TIMEOUT_MS = 10000;
const WATER_SCRAPE_CRON = '0 */12 * * *';
const WATER_CAPTCHA_ERROR = 'Triple A exige completar la verificación de Cloudflare Turnstile. El valor no se puede consultar automáticamente desde Render; abre el enlace en un navegador y completa la verificación manual.';

// Gases del Caribe uses the same kind of direct payment/consultation links
// saved from the apartment QR. Keep the gas flow independent from Triple A so
// one provider's Turnstile does not erase the results of the others.
const GAS_RESPONSE_TIMEOUT_MS = 5000;
// Use the same isolation rule for the gas portal: one slow/blocked contract
// must not terminate the session used by the remaining contracts.
const GAS_CAPTCHA_ERROR = 'Gases del Caribe requiere verificaciÃ³n manual de Turnstile para consultar la deuda.';

function normalizeBillText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCopAmount(raw) {
  let value = String(raw ?? '').replace(/[^0-9,.-]/g, '').replace(/-/g, '');
  if (!value) return null;

  if (value.includes(',') && value.includes('.')) {
    // Colombian format: 123.456,78.  The invoice values we display are COP,
    // so cents are discarded after normalizing the thousands separator.
    value = value.replace(/\./g, '').replace(',', '.');
  } else if (value.includes(',')) {
    const parts = value.split(',');
    value = parts[parts.length - 1].length === 2 ? `${parts.slice(0, -1).join('')}.${parts[parts.length - 1]}` : parts.join('');
  } else if (value.includes('.')) {
    value = value.replace(/\./g, '');
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

function extractWaterAmount(text) {
  const amountToken = '[0-9][0-9.,]*(?:\\s+[0-9][0-9.,]*)?';
  const label = /(?:saldo(?:\s+(?:pendiente|por\s+pagar|total))?|deuda\b(?:\s+total)?|total(?:\s+(?:(?:a|por)\s+)?pagar|\s+factura)?|valor(?:\s+(?:(?:a|por)\s+)?pagar|\s+factura)?|importe|monto|amount(?:\s+due)?|balance|debt|invoice(?:\s+total)?|total(?:to|\s+to)\s*pay|factura\s+(?:pendiente|por\s+pagar|vencida)|recibo\s+(?:pendiente|por\s+pagar|vencido))/gi;
  const labeled = new RegExp(`${label.source}[^$0-9]{0,80}(?:\\$\\s*|COP\\s*)?(${amountToken})\\s*(?:COP|pesos)?`, 'gi');
  const labeledAmounts = [...String(text || '').matchAll(labeled)]
    .map(match => parseCopAmount(match[1]))
    .filter(amount => amount !== null);
  if (labeledAmounts.length) return Math.max(...labeledAmounts);

  // Some Triple A layouts render the currency after the number, while others
  // put the amount in an input/aria label without a preceding "$".
  const currencyAmounts = [
    ...String(text || '').matchAll(new RegExp(`(?:\\$\\s*|COP\\s*)(${amountToken})\\s*(?:COP|pesos)?`, 'gi')),
    ...String(text || '').matchAll(new RegExp(`(${amountToken})\\s*(?:COP|pesos)`, 'gi')),
  ]
    .map(match => parseCopAmount(match[1]))
    .filter(amount => amount !== null);

  // Do not treat an arbitrary "$5" from the portal shell or a framework
  // payload as an invoice amount.  A fallback amount is only valid when the
  // surrounding page contains a concrete billing marker.
  const hasBillingContext = /(?:factura|recibo|saldo)\b|(?:deuda|pago|total|valor)\s+(?:pendiente|por\s+pagar|a\s+pagar|total|factura)|amount\s+due|invoice/i.test(text);
  if (!hasBillingContext) return null;
  return currencyAmounts.length ? Math.max(...currencyAmounts) : null;
}

function extractWaterInvoice(text) {
  const matches = [...text.matchAll(/(?:factura|recibo)\s*(?:n(?:umero|o\.?|ro\.?)\s*)?[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,})/gi)];
  const value = matches.map(match => match[1]).find(candidate => !/^(pendiente|pagada?|vencida?)$/i.test(candidate));
  return value || null;
}

function extractWaterPeriod(text) {
  const match = text.match(/(?:periodo|per[ií]odo|mes\s+facturado|ciclo)[^0-9]{0,20}((?:20\d{2}[-/]\d{1,2})|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+20\d{2})/i);
  return match?.[1] || null;
}

function parseWaterBillPage(pageText) {
  const text = normalizeBillText(pageText);
  const normalized = text.toLowerCase();
  const captcha = /captcha|recaptcha|verificacion en dos pasos|codigo de verificacion|no soy un robot/.test(normalized);
  const accessWall = /iniciar sesion|iniciar sesión|usuario|contrasena|contraseña|login/.test(normalized) &&
    !/factura|saldo|deuda|pago/.test(normalized);
  const amount = extractWaterAmount(text);
  const noDebtText = normalized.replace(/sin deuda|no hay deuda|sin saldo pendiente/g, '');
  const pending = /(?:factura|recibo|saldo|pago)\s+(?:pendiente|por\s+pagar|vencid[ao]|no\s+pagad[ao])|(?:deuda|saldo)\s+(?:pendiente|por\s+pagar|total)|(?:status|estado)\s*["':=]+\s*(?:pending|in_debt)|\b(?:pending|in_debt)\b/.test(noDebtText);
  const paid = /pagad[ao]|al dia|cancelad[ao]|sin deuda|no hay deuda|saldo\s*\$?\s*0\b/.test(normalized);

  let status = 'unknown';
  let error = null;
  if (captcha) {
    status = 'captcha';
    error = 'El portal de Triple A requiere CAPTCHA o verificación manual.';
  } else if (accessWall) {
    status = 'error';
    error = 'El enlace de Triple A requiere autenticación.';
  } else if (amount !== null && amount > 0) {
    status = 'pending';
  } else if (amount === 0 || (paid && !pending)) {
    status = 'paid';
  } else if (pending) {
    status = 'pending';
  }

  return {
    status,
    deudaCOP: amount,
    factura: extractWaterInvoice(text),
    periodo: extractWaterPeriod(text),
    error,
  };
}

/* QR navigation error helper removed with the QR scraper.
function waterNavigationError(target, error, checkedAt = new Date().toISOString()) {
  const message = String(error?.message || error || 'Error desconocido al consultar Triple A');
  const status = /timeout|timed out|tard[oó].*demasiado/i.test(message) ? 'timeout' : 'error';
  return waterRecord(target, { status, deudaCOP: null, error: message }, checkedAt);
}
*/

async function inspectWaterPage(page) {
  if (!page || typeof page.evaluate !== 'function') return null;
  try {
    const state = await page.evaluate(() => {
      const bodyText = document.body?.innerText || document.documentElement?.innerText || '';
      const visible = element => {
        if (!element || element.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.opacity !== '0' && !!element.getClientRects().length;
      };
      // Cloudflare always injects a hidden response input. It is not proof
      // that a Turnstile challenge is being shown. Count the token only once
      // it has a value, or count an actually visible widget/iframe.
      const tokenInput = [...document.querySelectorAll('input[name="cf-turnstile-response"]')]
        .find(input => String(input.value || '').trim());
      const turnstileNode = [
        ...document.querySelectorAll('.cf-turnstile, iframe[src*="challenges.cloudflare.com"], [id*="cf-chl-widget"]'),
      ].find(visible);
      const submit = document.querySelector('form button[type="submit"], button[type="submit"]');
      const paymentInput = document.querySelector('input[name="paymentNumber"], input[type="number"]');
      const hasBillingResult = /(?:factura|recibo)\s+(?:n(?:u|ú)mero|pendiente|pagad[ao]|vencid[ao])|(?:saldo|deuda|total|valor|monto)\s*(?:pendiente|por\s+pagar|a\s+pagar|:|\$)/i.test(bodyText);
      return {
        hasTurnstile: Boolean(tokenInput || turnstileNode),
        turnstileToken: tokenInput?.value || '',
        hasCaptchaText: /captcha|turnstile|recaptcha|verificaci[oó]n en dos pasos|no soy un robot/i.test(bodyText),
        hasBillingResult,
        hasSubmit: Boolean(submit),
        submitDisabled: submit ? Boolean(submit.disabled) : false,
        hasPaymentNumber: Boolean(paymentInput?.value),
      };
    });
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

async function closeWaterResource(resource) {
  if (!resource || typeof resource.close !== 'function') return;
  let closed = false;
  const closePromise = Promise.resolve()
    .then(() => resource.close())
    .then(() => { closed = true; })
    .catch(() => {});
  await Promise.race([closePromise, sleep(BROWSER_CLOSE_TIMEOUT_MS)]);
  return closed;
}

async function closeWaterBrowser(browser) {
  const closed = await closeWaterResource(browser);
  if (closed || typeof browser?.process !== 'function') return;
  try {
    const child = browser.process();
    if (child && !child.killed) child.kill('SIGKILL');
  } catch {}
}

async function waitForPortalTurnstile(page, waitMs = 30000) {
  let state = await inspectWaterPage(page);
  if (!state?.hasTurnstile || state.turnstileToken) return state;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(2000, Math.max(100, deadline - Date.now())));
    state = await inspectWaterPage(page);
    if (!state?.hasTurnstile || state.turnstileToken) return state;
  }
  return state;
}

async function visibleSelectorExists(page, selector) {
  const handle = await visibleHandle(page, selector, 1000);
  if (!handle) return false;
  try { await handle.dispose(); } catch {}
  return true;
}

async function portalLoginDiagnostic(page) {
  const roots = portalFrameRoots(page);
  const frames = [];
  for (const root of roots) {
    const frameUrl = typeof root?.url === 'function' ? root.url() : page?.url?.() || '';
    const safeUrl = String(frameUrl).split('?')[0].split('#')[0];
    const state = await root?.evaluate?.(() => ({
      inputs: [...document.querySelectorAll('input')].slice(0, 20).map(input => ({
        type: input.type,
        name: input.name,
        id: input.id,
        placeholder: input.placeholder,
        autocomplete: input.autocomplete,
        visible: !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length),
        disabled: Boolean(input.disabled),
      })),
      buttons: [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].slice(0, 15).map(button => ({
        type: button.type || '',
        text: (button.innerText || button.value || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 100),
        visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length),
        disabled: Boolean(button.disabled),
      })),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200),
    })).catch(() => ({ unavailable: true }));
    frames.push({ url: safeUrl, ...state });
  }
  return {
    pageUrl: await page?.url?.().catch?.(() => '') || '',
    pageTitle: await page?.title?.().catch?.(() => '') || '',
    frames,
  };
}

async function waitForPortalAuthCompletion(page, passwordSelectors, timeout = PORTAL_AUTH_SETTLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!(await visibleSelectorExists(page, passwordSelectors))) return true;
    await sleep(Math.min(1000, Math.max(100, deadline - Date.now())));
  }
  return !(await visibleSelectorExists(page, passwordSelectors));
}

async function loginPortalPage(page, {
  provider,
  username,
  password,
  emailSelectors,
  passwordSelectors,
  submitSelectors,
  turnstileError,
  captchaSolver = null,
  loginAttempts = PORTAL_LOGIN_ATTEMPTS,
}) {
  const initialPasswordHandle = await visibleHandle(page, passwordSelectors, 15000);
  const hasPassword = Boolean(initialPasswordHandle);
  if (initialPasswordHandle) {
    try { await initialPasswordHandle.dispose(); } catch {}
  }
  if (!hasPassword) return false;

  for (let attempt = 1; attempt <= loginAttempts; attempt += 1) {
    try {
      await typeVisibleField(page, emailSelectors, username, 30000);
      await typeVisibleField(page, passwordSelectors, password, 30000);
    } catch (error) {
      const diagnostic = await portalLoginDiagnostic(page);
      console.error(`[${provider}] DiagnÃ³stico de formulario (intento ${attempt}):`, JSON.stringify(diagnostic));
      if (attempt < loginAttempts) {
        console.warn(`[${provider}] El formulario cambiÃ³ o no cargÃ³; recargando (intento ${attempt + 1}/${loginAttempts}).`);
        if (typeof page.reload === 'function') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: PORTAL_AUTH_TIMEOUT_MS }).catch(() => {});
        }
        continue;
      }
      throw error;
    }
    if (captchaSolver) await captchaSolver.waitForSolved(45000);
    const challenge = await waitForPortalTurnstile(page, 60000);
    if (challenge?.hasTurnstile && !challenge.turnstileToken) {
      throw new Error(turnstileError);
    }
    const clicked = await clickVisibleButton(page, submitSelectors, 10000);
    if (!clicked) throw new Error(`No se encontró el botón de inicio de sesión de ${provider}.`);

    // A portal may navigate, update a SPA route, or leave the same document
    // while its session cookie is being established. Accept all three as long
    // as the visible password field disappears.
    const navigation = typeof page.waitForNavigation === 'function'
      ? page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: PORTAL_AUTH_SETTLE_TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(null);
    const completed = await Promise.race([
      navigation.then(() => waitForPortalAuthCompletion(page, passwordSelectors, 5000)),
      waitForPortalAuthCompletion(page, passwordSelectors, PORTAL_AUTH_SETTLE_TIMEOUT_MS),
    ]);
    if (completed || !(await visibleSelectorExists(page, passwordSelectors))) return true;

    const failedLoginDiagnostic = await portalLoginDiagnostic(page);
    console.warn(`[${provider}] Login no confirmado (intento ${attempt}):`, JSON.stringify(failedLoginDiagnostic));
    const sameFormHandle = attempt < loginAttempts
      ? await visibleHandle(page, emailSelectors, 1500)
      : null;
    if (sameFormHandle) {
      try { await sameFormHandle.dispose(); } catch {}
      if (captchaSolver?.state?.status === 'solved') {
        console.warn(`[${provider}] Turnstile ya fue resuelto; se probarÃ¡ la sesiÃ³n mediante la ruta protegida.`);
        return false;
      }
      console.warn(`[${provider}] El formulario sigue disponible; se reintenta sin recargar.`);
      continue;
    }

    if (attempt < loginAttempts) {
      console.warn(`[${provider}] El portal no confirmó el inicio de sesión; recargando (intento ${attempt + 1}/${loginAttempts}).`);
      if (typeof page.reload === 'function') {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: PORTAL_AUTH_TIMEOUT_MS }).catch(() => {});
      }
    }
  }

  const diagnostic = await portalLoginDiagnostic(page);
  console.error(`[${provider}] Diagnóstico de login:`, JSON.stringify(diagnostic));
  throw new Error(`${provider} no completó el inicio de sesión después de ${loginAttempts} intentos.`);
}

function parsePortalAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (value === null || value === undefined || value === '') return null;
  return parseCopAmount(value);
}

function portalFieldValue(value, fieldNames, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return undefined;
  const wanted = (fieldNames || []).map(field => normalizePortalText(field).replace(/ /g, ''));
  const entries = Object.entries(value);
  for (const wantedKey of wanted) {
    const match = entries.find(([key, child]) =>
      normalizePortalText(key).replace(/ /g, '') === wantedKey && child !== null && child !== undefined && child !== ''
    );
    if (match) return match[1];
  }
  for (const child of Object.values(value)) {
    const found = portalFieldValue(child, fieldNames, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function portalFieldCandidates(value, fieldNames) {
  const values = [];
  const add = candidate => {
    const text = String(candidate === null || candidate === undefined ? '' : candidate).trim();
    if (text && !values.includes(text)) values.push(text);
  };
  for (const fieldName of fieldNames || []) {
    add(portalFieldValue(value, [fieldName]));
  }
  return values;
}

function portalFieldAmounts(value, fieldNames, depth = 0, seen = new Set()) {
  if (value === null || value === undefined || depth > 6) return [];
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const wanted = (fieldNames || []).map(field => normalizePortalText(field).replace(/ /g, ''));
  const amounts = [];
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizePortalText(key).replace(/ /g, '');
    if (wanted.includes(normalizedKey) && child !== null && child !== undefined && child !== '') {
      const amount = parsePortalAmount(child);
      if (amount !== null) amounts.push(amount);
    }
    amounts.push(...portalFieldAmounts(child, fieldNames, depth + 1, seen));
  }
  return amounts;
}

function portalAmountFromFields(value, fieldNames) {
  const raw = portalFieldValue(value, fieldNames);
  return parsePortalAmount(raw);
}

function portalObjectRecords(value, depth = 0, seen = new Set(), output = []) {
  if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return output;
  seen.add(value);
  if (!Array.isArray(value)) output.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') portalObjectRecords(child, depth + 1, seen, output);
  }
  return output;
}

function portalRecordDate(value) {
  const raw = portalFieldValue(value, [
    'invoiceDate', 'expirationDate', 'dueDate', 'billingPeriod', 'periodo',
    'fechaFactura', 'fechaVencimiento', 'createdAt', 'date',
  ]);
  const date = raw ? new Date(raw) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function portalRecordIsPaid(value) {
  const paid = portalFieldValue(value, ['isPaid', 'paid', 'pagada', 'status', 'state', 'paymentStatus']);
  if (paid === true) return true;
  return /^(?:true|1|paid|pagad[ao]|cancelad[ao]|al\s*d[ií]a|sin\s*deuda)$/i.test(String(paid || ''));
}

function portalFinancingSummary(payload) {
  const explicitFinanced = portalAmountFromFields(payload, [
    'financedDebt', 'deudaFinanciada', 'saldoFinanciado', 'valorFinanciado',
    'financingValue', 'financedAmount', 'amountFinanced', 'totalFinanced',
    'totalFinancing', 'montoFinanciado', 'saldoDeudaFinanciada',
    'financedBalance', 'balanceFinanced', 'debtFinanced', 'deferredDebt',
    'deudaDiferida', 'saldoConvenio', 'deudaConvenio', 'saldoPorFacturar',
  ]);
  const explicitQuota = portalAmountFromFields(payload, [
    'quotaValue', 'cuotaValue', 'cuotaFinanciada', 'installmentValue',
    'monthlyQuota', 'valorCuota', 'valorCuotaFinanciada', 'cuotaMensual',
  ]);
  const rows = [];
  for (const record of portalObjectRecords(payload)) {
    const text = Object.entries(record)
      .map(([key, value]) => `${key}:${typeof value === 'object' ? '' : String(value || '')}`)
      .join(' ');
    const hasFinancingHint = /financ|refinanc|diferid|cuota|acuerdo|convenio|plan\s+de\s+pago|brilla|saldoPorFacturar|saldoFinanciado|debtFinanc|deferred/i.test(text);
    if (!hasFinancingHint) continue;
    const amount = portalAmountFromFields(record, [
      'pendingBalance', 'saldoPendiente', 'saldoPorFacturar', 'totalValue',
      'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'balance',
      'amount', 'value', 'financingValue', 'financedAmount',
      'financedBalance', 'balanceFinanced', 'debtFinanced', 'deferredDebt',
      'deudaDiferida', 'saldoConvenio', 'deudaConvenio',
    ]);
    const quota = portalAmountFromFields(record, [
      'quotaValue', 'cuotaValue', 'installmentValue', 'monthlyQuota', 'valorCuota',
      'nextPayment', 'proximoPago', 'nextInstallment', 'cuotaProxima',
    ]);
    if (amount === null && quota === null) continue;
    const label = portalFieldValue(record, [
      'conceptDescription', 'productDescription', 'description', 'concept',
      'name', 'type', 'status',
    ]);
    const key = `${amount ?? ''}|${quota ?? ''}|${String(label || '')}`;
    if (rows.some(row => row.key === key)) continue;
    rows.push({
      key,
      concepto: label ? String(label).replace(/\s+/g, ' ').trim().slice(0, 160) : 'Financiación',
      saldoCOP: amount,
      cuotaCOP: quota,
      cuotas: portalFieldValue(record, ['billedQuotas', 'paidQuotas', 'quotas', 'numberOfQuotas']) ?? null,
      numero: portalFieldValue(record, ['financingNumber', 'numeroFinanciacion', 'number', 'agreementNumber']) ?? null,
      fechaInicio: portalFieldValue(record, ['startDate', 'fechaInicio', 'financingStartDate']) ?? null,
      saldoInicialCOP: portalAmountFromFields(record, ['initialBalance', 'saldoInicial', 'valorInicial']) ?? null,
    });
  }
  const rowBalances = rows.map(row => row.saldoCOP).filter(value => value !== null);
  const financed = explicitFinanced ?? (rowBalances.length ? rowBalances.reduce((sum, value) => sum + value, 0) : null);
  const quota = explicitQuota ?? rows.map(row => row.cuotaCOP).find(value => value !== null) ?? null;
  return {
    financiadaCOP: financed,
    cuotaFinanciadaCOP: quota,
    financiacion: rows.slice(0, 20).map(({ key, ...row }) => row),
  };
}

function unwrapPortalList(payload, keys = []) {
  const visited = new Set();
  const find = (value, depth = 0) => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object' || depth > 5 || visited.has(value)) return [];
    visited.add(value);

    // Check the provider's known collection names at every wrapper level.
    for (const key of keys) {
      if (Array.isArray(value[key]) && value[key].length) return value[key];
      if (value[key] && typeof value[key] === 'object') {
        const nested = find(value[key], depth + 1);
        if (nested.length) return nested;
      }
    }

    // Portals commonly wrap the response in data/result/response/payload.
    for (const key of ['data', 'result', 'response', 'payload', 'content']) {
      const nested = find(value[key], depth + 1);
      if (nested.length) return nested;
    }

    // Last resort: inspect nested objects, but only for an array of records so
    // an unrelated numeric array cannot be mistaken for contracts/policies.
    for (const child of Object.values(value)) {
      const nested = find(child, depth + 1);
      if (nested.length && nested.every(item => item && typeof item === 'object' && !Array.isArray(item))) return nested;
    }
    return [];
  };
  return find(payload);
}

function portalPayloadDiagnostics(payload, items) {
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const itemKeys = [...new Set((items || []).slice(0, 5).flatMap(item =>
    item && typeof item === 'object' ? Object.keys(item) : []
  ))].slice(0, 30);
  return {
    rootKeys: Object.keys(root).slice(0, 30),
    itemCount: Array.isArray(items) ? items.length : 0,
    itemKeys,
  };
}

function portalDiagnosticReferences(item) {
  const values = portalIdentifierValues(item)
    .map(value => ({ raw: String(value), digits: normalizeDigits(value) }))
    .filter(item => item.digits.length >= 3 && item.digits.length <= 24)
    .map(item => item.digits);
  return [...new Set(values)].slice(0, 12);
}

function logUnmatchedPortalItems(provider, items, service) {
  for (const item of items || []) {
    const refs = portalDiagnosticReferences(item);
    if (refs.length) {
      console.warn(`[${provider}] Registro global sin apartamento asociado (${service}): referencias=${refs.join(',')}`);
    } else {
      console.warn(`[${provider}] Registro global sin apartamento asociado (${service}): sin referencias numéricas reconocibles.`);
    }
  }
}

async function responseTextWithTimeout(response, timeout = PORTAL_RESPONSE_TIMEOUT_MS) {
  try {
    return await Promise.race([
      response.text(),
      sleep(timeout).then(() => ''),
    ]);
  } catch {
    return '';
  }
}

function parsePortalResponseBody(body) {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

async function fetchPortalJson(page, url, headers = {}) {
  if (typeof page?.evaluate !== 'function') return { status: 0, body: '', error: 'Página sin contexto JavaScript.' };
  return page.evaluate(async ({ requestUrl, requestHeaders }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(requestUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json', ...requestHeaders },
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }, { requestUrl: url, requestHeaders: headers }).catch(error => ({
    status: 0,
    body: '',
    error: error.message,
  }));
}

async function requestPortalJson(page, url, {
  method = 'GET',
  headers = {},
  body = null,
} = {}) {
  if (typeof page?.evaluate !== 'function') return { status: 0, body: '', error: 'PÃ¡gina sin contexto JavaScript.' };
  return page.evaluate(async ({ requestUrl, requestMethod, requestHeaders, requestBody }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(requestUrl, {
        method: requestMethod,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(requestBody ? { 'Content-Type': 'application/json' } : {}),
          ...requestHeaders,
        },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }, {
    requestUrl: url,
    requestMethod: method,
    requestHeaders: headers,
    requestBody: body,
  }).catch(error => ({ status: 0, body: '', error: error.message }));
}

async function readPortalTurnstileToken(page) {
  if (typeof page?.evaluate !== 'function') return '';
  return page.evaluate(() => {
    const input = [...document.querySelectorAll('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]')]
      .find(element => String(element.value || element.textContent || '').trim());
    if (input) return String(input.value || input.textContent || '').trim();
    try {
      const value = window.turnstile?.getResponse?.();
      return typeof value === 'string' ? value.trim() : '';
    } catch {
      return '';
    }
  }).catch(() => '');
}

async function executePortalTurnstile(page) {
  if (typeof page?.evaluate !== 'function') return false;
  return page.evaluate(() => {
    const api = window.turnstile;
    if (!api || typeof api.execute !== 'function') return false;
    const hidden = document.querySelector('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]');
    const widgetId = hidden?.id?.replace(/_response$/, '') || null;
    const candidates = [
      widgetId,
      ...[...document.querySelectorAll('[data-sitekey], .cf-turnstile')].map(element => element.id || element),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        api.execute(candidate);
        return true;
      } catch {}
    }
    try {
      api.execute();
      return true;
    } catch {
      return false;
    }
  }).catch(() => false);
}

async function submitPortalLoginForm(page, {
  provider,
  username,
  password,
  emailSelectors,
  passwordSelectors,
  authState,
  prepareSubmit = null,
}) {
  await typeVisibleField(page, emailSelectors, username, 30000);
  await typeVisibleField(page, passwordSelectors, password, 30000);

  if (typeof prepareSubmit === 'function') {
    await prepareSubmit();
  }

  let submitted = false;
  for (let attempt = 1; attempt <= 2 && !submitted; attempt += 1) {
    try {
      submitted = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          return true;
        }
        const button = [...document.querySelectorAll('button, input[type="submit"]')]
          .find(element => !element.disabled && (element.type === 'submit' || /iniciar|ingresar|login|entrar/i.test(element.innerText || element.value || '')));
        if (!button) return false;
        button.click();
        return true;
      });
    } catch (error) {
      if (attempt >= 2 || !/detached|execution context|target closed/i.test(String(error?.message || error))) throw error;
      await sleep(1500);
    }
  }
  if (!submitted) throw new Error(`No se pudo enviar el formulario de inicio de sesiÃ³n de ${provider}.`);

  console.log(`[${provider}] Formulario enviado; esperando la respuesta del portal.`);
  const deadline = Date.now() + PORTAL_AUTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (authState?.done) {
      console.log(`[${provider}] Respuesta de login recibida: HTTP ${authState.status || 'sin respuesta'}; ok=${Boolean(authState.ok)}.`);
      if (!authState.ok) throw new Error(`${provider} rechazÃ³ el inicio de sesiÃ³n (HTTP ${authState.status || 'sin respuesta'}).`);
      return true;
    }
    if (!(await visibleSelectorExists(page, passwordSelectors))) return true;
    await sleep(1000);
  }
  if (authState?.ok) return true;
  throw new Error(`${provider} no confirmÃ³ el inicio de sesiÃ³n dentro del tiempo permitido.`);
}

async function loginTripleAWithGoogle(page) {
  // The portal owns the OAuth flow. We only press its official button and,
  // when NextAuth returns a redirect URL without navigating, follow that URL
  // in the same browser profile. No Google password, cookie, or token is read
  // or entered by the scraper.
  const googleResponsePromise = typeof page?.waitForResponse === 'function'
    ? page.waitForResponse(response => /\/api\/auth\/signin\/google(?:[/?#]|$)/i.test(response.url()), {
      timeout: 15000,
    }).catch(() => null)
    : Promise.resolve(null);
  const clicked = await clickVisiblePortalButtonByText(page, /continuar\s+con\s+google/i, 20000);
  if (!clicked) throw new Error('Triple A no mostró el botón oficial "Continuar con Google".');
  console.log('[TRIPLE A] Se inició el login oficial con Google; esperando la sesión del perfil Chrome.');

  const googleResponse = await googleResponsePromise;
  if (googleResponse) {
    const body = await responseTextWithTimeout(googleResponse, 10000);
    const payload = parsePortalResponseBody(body) || {};
    const redirectUrl = payload?.url || payload?.redirect || null;
    if (redirectUrl) {
      const absoluteUrl = new URL(String(redirectUrl), TRIPLE_A_URLS.login).toString();
      await page.goto(absoluteUrl, { waitUntil: 'domcontentloaded', timeout: PORTAL_AUTH_TIMEOUT_MS }).catch(() => {});
    }
  }

  const deadline = Date.now() + TRIPLE_A_GOOGLE_LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = String(typeof page?.url === 'function' ? page.url() : '');
    if (/portal\.aaa\.com\.co\/(?:inicio|polizas|pagos-usuario|deudas|facturas-usuario|transacciones|pqrs|super-cliente)(?:[/?#]|$)/i.test(currentUrl)) {
      return true;
    }
    // If the OAuth provider is asking for account selection/sign-in, leave
    // the visible Chrome window available for the owner to complete it once.
    if (/accounts\.google\.com/i.test(currentUrl)) {
      console.log('[TRIPLE A] Google requiere una sesión ya iniciada o una confirmación manual en el perfil Chrome.');
    }
    await sleep(1000);
  }

  // NextAuth may set the cookie while leaving the React login route mounted.
  // Validate the session by opening the protected route before failing.
  await gotoPortalPage(page, TRIPLE_A_URLS.policies, {
    waitUntil: 'domcontentloaded',
    timeout: PORTAL_AUTH_TIMEOUT_MS,
  }, 'Triple A').catch(() => {});
  const finalUrl = String(typeof page?.url === 'function' ? page.url() : '');
  if (/portal\.aaa\.com\.co\/(?:inicio|polizas|pagos-usuario|deudas|facturas-usuario|transacciones|pqrs|super-cliente)(?:[/?#]|$)/i.test(finalUrl)) return true;
  throw new Error('Triple A no completó el login con Google. Inicia sesión una vez en el perfil Chrome del worker y vuelve a ejecutar.');
}

async function loginTripleAWithPortalApi(page, credentials, captchaSolver) {
  await executePortalTurnstile(page);
  if (captchaSolver) await captchaSolver.waitForSolved(60000);
  const challenge = await waitForPortalTurnstile(page, 60000);
  if (challenge?.hasTurnstile && !challenge.turnstileToken) {
    throw new Error('Triple A mantiene Turnstile visible despuÃ©s de esperar a Browserless.');
  }

  const appVersion = await page.evaluate(() =>
    document.querySelector('meta[name="version-info"]')?.getAttribute('content') || 'unknown'
  ).catch(() => 'unknown');
  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const token = await readPortalTurnstileToken(page);
    if (!token) {
      await executePortalTurnstile(page);
      if (captchaSolver) await captchaSolver.waitForSolved(30000);
      await sleep(1500);
      continue;
    }
    // Triple A's current frontend authenticates against its BFF. The old
    // NextAuth callback is only an internal wrapper and returns 401 when it
    // is called directly from the scraper.
    const encodedPassword = Buffer.from(String(credentials.password || ''), 'utf8').toString('base64');
    const result = await requestPortalJson(page, '/bff/auth/login', {
      method: 'POST',
      headers: { 'x-app-version': appVersion },
      body: {
        email: credentials.username,
        password: encodedPassword,
        recaptchaToken: token,
      },
    });
    const payload = parsePortalResponseBody(result.body) || {};
    const accessToken = portalFieldValue(payload, ['accessToken', 'access_token']);
    const fallbackToken = portalFieldValue(payload, ['token', 'jwt']);
    const tokenValue = accessToken || fallbackToken;
    result.ok = result.status >= 200 && result.status < 300 && payload?.error == null;
    result.authHeader = tokenValue
      ? (/^(?:Bearer|Token)\s/i.test(String(tokenValue)) ? String(tokenValue) : `Bearer ${tokenValue}`)
      : null;
    result.hasToken = Boolean(tokenValue);
    lastResult = result;
    console.log(`[TRIPLE A] Login BFF intento ${attempt}: HTTP ${result.status || 'sin respuesta'}; sesiÃ³n ${result.ok ? 'aceptada' : 'no confirmada'}; token=${Boolean(result.hasToken)}.`);
    if (result.ok) return { ok: true, authHeader: result.authHeader, payload };
    await sleep(1500);
  }
  if (!lastResult) throw new Error('Triple A no entregÃ³ un token de Turnstile vÃ¡lido para iniciar sesiÃ³n.');
  throw new Error(`Triple A rechazÃ³ el inicio de sesiÃ³n por API (HTTP ${lastResult?.status || 'sin respuesta'}${lastResult?.error ? `: ${lastResult.error}` : ''}).`);
}

async function loginGasWithPortalApi(page, credentials, captchaSolver) {
  await executePortalTurnstile(page);
  if (captchaSolver) await captchaSolver.waitForSolved(60000);
  const challenge = await waitForPortalTurnstile(page, 60000);
  if (challenge?.hasTurnstile && !challenge.turnstileToken) {
    throw new Error('Gases del Caribe mantiene Turnstile visible despuÃ©s de esperar a Browserless.');
  }
  let token = await readPortalTurnstileToken(page);
  if (!token && captchaSolver) {
    await executePortalTurnstile(page);
    await captchaSolver.waitForSolved(30000);
    token = await readPortalTurnstileToken(page);
  }
  if (!token) throw new Error('Gases del Caribe no entregÃ³ el token de Turnstile.');

  console.log(`[GAS] Turnstile entregó el token; esperando ${Math.ceil(GAS_TURNSTILE_SETTLE_DELAY_MS / 1000)} s antes del login oficial.`);
  await sleep(GAS_TURNSTILE_SETTLE_DELAY_MS);

  const loginResponse = await page.evaluate(async ({ apiUrl, email, password, captchaToken }) => {
    const url = `${apiUrl}/login?g-recaptcha-response=${encodeURIComponent(captchaToken)}`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { status: response.status, body: await response.text() };
  }, {
    apiUrl: GAS_API_BASE,
    email: credentials.username,
    password: credentials.password,
    captchaToken: token,
  }).catch(error => ({ status: 0, body: '', error: error.message }));

  const payload = parsePortalResponseBody(loginResponse.body);
  const tokenValue = portalFieldValue(payload, ['token', 'accessToken', 'authorization', 'jwt']);
  // Gascaribe's own frontend sends the returned `data.token` verbatim in
  // the Authorization header. It is not guaranteed to use the Bearer
  // prefix, so adding one here can invalidate an otherwise valid session.
  const authHeader = tokenValue ? String(tokenValue).trim() : null;
  console.log(`[GAS] Login API: HTTP ${loginResponse.status || 'sin respuesta'}; sesiÃ³n ${loginResponse.status >= 200 && loginResponse.status < 300 ? 'aceptada' : 'no confirmada'}.`);
  if (loginResponse.status < 200 || loginResponse.status >= 300) {
    throw new Error(`Gases del Caribe rechazÃ³ el inicio de sesiÃ³n por API (HTTP ${loginResponse.status || 'sin respuesta'}).`);
  }
  return { payload, authHeader, captchaToken: token };
}

function tripleAStatusValue(subscription) {
  const raw = portalFieldValue(subscription, ['status', 'state', 'paymentStatus']);
  if (raw && typeof raw === 'object') {
    return String(raw.value || raw.code || raw.name || raw.status || raw.label || '').toLowerCase();
  }
  return String(raw || '').toLowerCase();
}

function tripleAInvoiceSummary(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const unpaid = list.filter(invoice => !portalRecordIsPaid(invoice));
  const sorted = [...list].sort((left, right) => (portalRecordDate(right)?.getTime() || 0) - (portalRecordDate(left)?.getTime() || 0));
  const latest = sorted[0] || null;
  const latestDate = portalRecordDate(latest);
  const latestPeriod = latestDate ? `${latestDate.getUTCFullYear()}-${latestDate.getUTCMonth()}` : null;
  const currentRows = latestPeriod
    ? unpaid.filter(invoice => {
      const date = portalRecordDate(invoice);
      return date && `${date.getUTCFullYear()}-${date.getUTCMonth()}` === latestPeriod;
    })
    : unpaid.slice(0, 1);
  const monthRows = currentRows.length ? currentRows : unpaid.slice(0, 1);
  const monthValues = monthRows.map(invoice => portalAmountFromFields(invoice, [
    'monthValue', 'monthlyValue', 'valorMes', 'deudaMes', 'invoiceValue',
    'valorFactura', 'currentInvoiceAmount', 'currentAmount', 'saldoActual',
    'saldoDeudaActual', 'deudaActual', 'currentBalance', 'balanceCurrent',
    'amountDue', 'pendingValue', 'pendingAmount', 'totalToPay',
  ])).filter(value => value !== null);
  const totalValues = unpaid.map(invoice => portalAmountFromFields(invoice, [
    'totalValue', 'pendingBalance', 'pendingValue', 'totalToPay', 'amountDue',
    'totalDebt', 'deudaTotal', 'balanceDue', 'balance', 'amount', 'value',
  ])).filter(value => value !== null);
  const currentTotalValues = monthRows.map(invoice => portalAmountFromFields(invoice, [
    'totalValue', 'pendingBalance', 'pendingValue', 'totalToPay', 'amountDue',
    'totalDebt', 'deudaTotal', 'balanceDue', 'balance', 'amount', 'value',
  ])).filter(value => value !== null);
  const monthDebt = monthValues.length ? monthValues.reduce((sum, value) => sum + value, 0) : null;
  const currentTotal = currentTotalValues.length
    ? currentTotalValues.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    // The portal's current/debt card is the monthly debt. A `monthValue`
    // field may be only a coupon/component, so prefer the card total when it
    // is available.
    deudaMesCOP: currentTotal ?? monthDebt,
    deudaTotalCOP: totalValues.length ? totalValues.reduce((sum, value) => sum + value, 0) : null,
    numFacturas: unpaid.length,
    factura: portalFieldValue(latest, ['invoiceNumber', 'invoiceId', 'factura', 'id']) || null,
    periodo: portalFieldValue(latest, ['invoiceDate', 'billingPeriod', 'periodo', 'expirationDate']) || null,
    status: unpaid.length ? (monthDebt === null ? 'pending' : monthDebt > 0 ? 'pending' : 'paid') : 'paid',
  };
}

function tripleARecord(target, subscription, checkedAt = new Date().toISOString(), details = {}) {
  const statusValue = tripleAStatusValue(subscription);
  const legacyAmount = parsePortalAmount(
    portalFieldValue(subscription, [
      'pendingValue', 'pendingAmount', 'debt', 'deudaTotal', 'totalDebt',
      'amountDue', 'totalDue', 'balanceDue', 'saldoTotal', 'saldoPendiente',
      'total', 'amount', 'balance', 'saldo',
    ]),
  );
  const pendingValue = portalFieldValue(subscription, ['isPending', 'pending', 'pendiente']);
  const paidValue = portalFieldValue(subscription, ['isPaid', 'paid', 'pagada']);
  const debtState = /pending|in_debt|expired|overdue|mora/.test(statusValue) ||
    pendingValue === true || /^(?:true|1|pending|pendiente|vencid[ao])$/i.test(String(pendingValue || ''));
  const paidState = /paid|al_day|up_to_date|sin_deuda/.test(statusValue) ||
    paidValue === true || /^(?:true|1|paid|pagad[ao]|al dia)$/i.test(String(paidValue || ''));
  const amount = details.deudaTotalCOP ?? details.deudaMesCOP ?? legacyAmount;
  const rawMonth = details.deudaMesCOP ?? (legacyAmount === null ? (debtState ? null : 0) : Math.max(0, legacyAmount));
  const deudaMesCOP = rawMonth === 0 && (details.deudaConveniosCOP === null || details.deudaConveniosCOP === undefined || details.deudaConveniosCOP === 0) && amount > 0
    ? amount
    : rawMonth;
  const deudaTotalCOP = details.deudaTotalCOP ?? (legacyAmount === null ? (debtState ? null : 0) : Math.max(0, legacyAmount));
  const deudaCOP = amount === null ? (debtState ? null : 0) : Math.max(0, amount);
  const status = deudaTotalCOP > 0 || (deudaTotalCOP === null && debtState)
    ? 'pending'
    : paidState || deudaTotalCOP === 0 ? 'paid' : 'unknown';
  const subscriptionCode = portalFieldValue(subscription, [
    // Prefer the visible policy number. Internal BFF identifiers must not be
    // persisted as the apartment's policy number.
    'policyNumber', 'poliza', 'policy', 'subscriptionExternalId',
    'externalId', 'subscriptionId', 'id',
  ]) || null;

  return {
    provider: 'Triple A',
    service: 'water',
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    waterPaymentUrl: target.waterPaymentUrl || null,
    waterPaymentCode: String(subscriptionCode || target.waterPaymentCode || '').trim() || null,
    status,
    deudaCOP,
    deudaMesCOP,
    deudaTotalCOP,
    deudaLabel: 'Deuda Total',
    numFacturas: details.numFacturas ?? null,
    factura: details.factura || portalFieldValue(subscription, ['invoiceNumber', 'invoiceId', 'factura']) || null,
    periodo: details.periodo || portalFieldValue(subscription, ['invoiceDate', 'billingPeriod', 'periodo']) || null,
    facturaValorCOP: details.facturaValorCOP ?? details.deudaMesCOP ?? null,
    financiadaCOP: details.financiadaCOP ?? null,
    cuotaFinanciadaCOP: details.cuotaFinanciadaCOP ?? null,
    financiacion: details.financiacion || [],
    debtSource: details.debtSource || (details.deudaTotalCOP !== undefined ? 'portal_debt' : 'subscription'),
    debtEndpointStatus: details.debtEndpointStatus ?? null,
    error: null,
    checkedAt,
    scrapedAt: checkedAt,
  };
}

function tripleASubscriptionId(subscription) {
  return portalFieldValue(subscription, ['id', 'subscriptionId', 'subscription_id']) || null;
}

async function fetchTripleAPortalSummary(page, subscription, authHeader) {
  const id = tripleASubscriptionId(subscription);
  if (!id) return { error: 'Triple A no devolvió el identificador interno de la póliza.' };
  const headers = authHeader ? { Authorization: authHeader } : {};
  const invoiceResponse = await fetchPortalJson(page, `/bff/invoices/subscription/${encodeURIComponent(String(id))}`, headers);
  if (invoiceResponse.status < 200 || invoiceResponse.status >= 300) {
    return { invoiceEndpointStatus: invoiceResponse.status || 0, error: `Triple A no devolvió las facturas de la póliza (HTTP ${invoiceResponse.status || 'sin respuesta'}).` };
  }
  const invoicePayload = parsePortalResponseBody(invoiceResponse.body);
  const invoiceSummary = tripleAInvoiceSummary(unwrapPortalList(invoicePayload, ['invoices', 'items']));
  let debtPayload = null;
  let debtEndpointStatus = 0;
  let debtRoute = '';
  // Query the ordinary balance route first. Deferred/convenio data lives in a
  // different view, so it must be queried independently instead of stopping
  // after the first successful debt response.
  for (const route of [
    `/bff/debts/subscription/${encodeURIComponent(String(id))}`,
    `/bff/debt/subscription/${encodeURIComponent(String(id))}`,
    `/bff/subscriptions/${encodeURIComponent(String(id))}/debt`,
  ]) {
    const debtResponse = await fetchPortalJson(page, route, headers);
    debtEndpointStatus = debtResponse.status || 0;
    if (debtResponse.status >= 200 && debtResponse.status < 300) {
      debtPayload = parsePortalResponseBody(debtResponse.body);
      debtRoute = route;
      break;
    }
    if (![404, 405].includes(Number(debtResponse.status))) break;
  }
  const financingPayloads = [];
  for (const route of [
    `/bff/deferred-debts/subscription/${encodeURIComponent(String(id))}`,
    `/bff/financing/subscription/${encodeURIComponent(String(id))}`,
  ]) {
    const financingResponse = await fetchPortalJson(page, route, headers);
    if (financingResponse.status >= 200 && financingResponse.status < 300) {
      financingPayloads.push(parsePortalResponseBody(financingResponse.body));
    }
  }
  const debtRows = debtPayload ? unwrapPortalList(debtPayload, ['debts', 'items']) : [];
  const debtTotal = debtPayload && !/deferred|financ/i.test(debtRoute)
    ? portalAmountFromFields(debtPayload, ['totalDebts', 'totalDebt', 'deudaTotal', 'totalPending', 'totalPendingDebt', 'totalDebtValue'])
      ?? (debtRows.length ? debtRows.map(row => portalAmountFromFields(row, ['totalValue', 'pendingBalance', 'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'amount', 'value'])).filter(value => value !== null).reduce((sum, value) => sum + value, 0) : null)
    : null;
  const debtMonth = debtPayload && !/deferred|financ/i.test(debtRoute)
    ? portalAmountFromFields(debtPayload, [
      'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
      'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
      'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
      'deudaActual', 'currentBalance', 'balanceCurrent',
    ])
    : null;
  const financing = portalFinancingSummary(financingPayloads.length ? financingPayloads : (debtPayload || invoicePayload));
  const convenio = financing.financiadaCOP;
  const invoiceTotal = invoiceSummary.deudaTotalCOP ?? invoiceSummary.deudaMesCOP;
  const rawMonth = invoiceSummary.deudaMesCOP ?? debtMonth;
  // Triple A exposes deferred/convenio balances in a separate route. When
  // the ordinary debt route returns only the current invoice, combine that
  // balance with the deferred agreement instead of silently dropping it.
  const currentTotal = invoiceTotal ?? rawMonth ?? debtTotal;
  const month = rawMonth === 0 && (convenio === null || convenio === 0) && currentTotal > 0
    ? currentTotal
    : rawMonth;
  const expectedCombined = convenio !== null && currentTotal !== null
    ? currentTotal + convenio
    : currentTotal;
  const combinedTotal = convenio !== null && convenio > 0 && debtTotal !== null && debtTotal >= expectedCombined
    ? debtTotal
    : expectedCombined;
  return {
    deudaMesCOP: month,
    deudaConveniosCOP: convenio,
    deudaTotalCOP: combinedTotal,
    numFacturas: invoiceSummary.numFacturas,
    factura: invoiceSummary.factura,
    periodo: invoiceSummary.periodo,
    facturaValorCOP: invoiceSummary.deudaMesCOP,
    financiadaCOP: convenio,
    cuotaFinanciadaCOP: financing.cuotaFinanciadaCOP,
    financiacion: financing.financiacion,
    debtSource: debtTotal !== null ? 'debt_endpoint' : 'invoice_fallback',
    debtEndpointStatus,
  };
}

async function scrapeTripleAAccount() {
  if (!/^(0|false|no)$/i.test(String(process.env.PORTAL_UI_SCRAPE || 'true'))) {
    return scrapeTripleAFromRenderedUi();
  }
  let browser;
  let page;
  let dataPage;
  let subscriptionPayload = null;
  let authHeader = null;
  let captureSubscriptions;
  let captureAuthResponse;
  let captchaSolver;
  const authState = { done: false, ok: false, status: 0 };
  try {
    lastWaterScrapeError = null;
    const credentials = getPortalCredentials('triple-a');
    const browserless = browserlessEndpointCandidates('water').length > 0;
    console.log(`[TRIPLE A] Portal global: iniciando sesión (${browserless ? 'Browserless remoto' : 'Chromium local'}).`);
    browser = await launchBrowser('water');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
    captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Triple A');

    captureSubscriptions = response => {
      if (!/\/bff\/subscriptions(?:[/?#]|$)/i.test(response.url())) return;
      responseTextWithTimeout(response, PORTAL_RESPONSE_TIMEOUT_MS)
        .then(body => {
          const parsed = parsePortalResponseBody(body);
          if (parsed) subscriptionPayload = parsed;
        })
        .catch(() => {});
    };
    captureAuthResponse = response => {
      if (!/\/api\/auth\/callback\/credentials(?:[/?#]|$)/i.test(response.url())) return;
      authState.status = response.status();
      responseTextWithTimeout(response, PORTAL_RESPONSE_TIMEOUT_MS)
        .then(body => {
          const payload = parsePortalResponseBody(body) || {};
          authState.done = true;
          authState.ok = response.status() >= 200 && response.status() < 300 && !payload.error;
          console.log(`[TRIPLE A] Respuesta de login: HTTP ${response.status()}; ok=${Boolean(authState.ok)}; campos=${Object.keys(payload).slice(0, 8).join(',') || 'sin cuerpo'}.`);
        })
        .catch(() => {
          authState.done = true;
          authState.ok = response.status() >= 200 && response.status() < 300;
          console.log(`[TRIPLE A] Respuesta de login: HTTP ${response.status()}; ok=${Boolean(authState.ok)}; cuerpo no legible.`);
        });
    };
    page.on?.('response', captureSubscriptions);
    page.on?.('response', captureAuthResponse);

    await gotoPortalPage(page, TRIPLE_A_URLS.login, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    }, 'Triple A');

    // Keep a second tab alive before submitting the React form. Some
    // Browserless sessions detach the login frame during the NextAuth redirect;
    // an already-open tab preserves the remote connection and shares cookies.
    dataPage = await browser.newPage().catch(() => null);
    if (dataPage) {
      dataPage.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
      dataPage.on?.('response', captureSubscriptions);
      console.log('[TRIPLE A] Página de trabajo preparada antes del login.');
    }

    const tripleEmailSelectors = [
      'input[name="email" i]',
      'input[id*="email" i]',
      'input[type="email"]',
      'input[autocomplete="username"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[placeholder*="correo" i]',
      'input[placeholder*="email" i]',
      'input[type="text"]',
    ];
    const triplePasswordSelectors = [
      'input[name="password" i]',
      'input[id*="password" i]',
      'input[id*="pass" i]',
      'input[type="password"]',
    ];
    let authenticatedByLogin = false;
    let authenticatedByApi = false;
    let loginError = null;
    const googleLoginRequested = /^(google|auto)$/.test(TRIPLE_A_LOGIN_METHOD);
    if (googleLoginRequested) {
      try {
        authenticatedByLogin = await loginTripleAWithGoogle(page);
        console.log('[TRIPLE A] Login oficial con Google confirmado; se conservará la misma sesión para consultar pólizas.');
      } catch (error) {
        loginError = error;
        console.warn(`[TRIPLE A] El login con Google no se confirmó: ${error.message}`);
      }
    }
    if (!authenticatedByLogin && TRIPLE_A_LOGIN_METHOD !== 'google') {
    try {
      const apiLogin = await loginTripleAWithPortalApi(page, credentials, captchaSolver);
      authHeader = apiLogin?.authHeader || null;
      authenticatedByLogin = Boolean(apiLogin?.ok);
      authenticatedByApi = authenticatedByLogin;
      if (authenticatedByApi) console.log('[TRIPLE A] Login API oficial confirmado; se conservara la misma sesion para consultar polizas.');
    } catch (error) {
      loginError = error;
      console.warn(`[TRIPLE A] El login API no se confirmo; se probara el formulario del portal: ${error.message}`);
    }
    if (!authenticatedByApi) {
      try {
      authenticatedByLogin = await submitPortalLoginForm(page, {
        provider: 'Triple A',
        username: credentials.username,
        password: credentials.password,
        emailSelectors: tripleEmailSelectors,
        passwordSelectors: triplePasswordSelectors,
        authState,
        prepareSubmit: async () => {
          const executed = await executePortalTurnstile(page).catch(error => {
            if (/detached|execution context|target closed|connection closed/i.test(String(error?.message || error))) {
              console.warn('[TRIPLE A] Turnstile cambió el contexto; se esperará el estado del navegador.');
              return false;
            }
            throw error;
          });
          if (executed) console.log('[TRIPLE A] Turnstile preparado antes de enviar el formulario.');
          if (captchaSolver) await captchaSolver.waitForSolved(60000);
          await sleep(500);
        },
      });
    } catch (error) {
      loginError = error;
      console.warn(`[TRIPLE A] El login visual no se confirmÃ³; se probarÃ¡ la ruta global autenticada: ${error.message}`);
    }
    }
    }
    if (!authenticatedByLogin && loginError && /detached|execution context|target closed|connection closed|captcha|turnstile|HTTP (?:401|422)/i.test(String(loginError.message || loginError))) {
      for (let retry = 2; retry <= PORTAL_LOGIN_ATTEMPTS && !authenticatedByLogin; retry += 1) {
        try {
          const oldPage = page;
          const oldSolver = captchaSolver;
          const retryPage = await browser.newPage();
          retryPage.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
          retryPage.on?.('response', captureSubscriptions);
          retryPage.on?.('response', captureAuthResponse);
          page = retryPage;
          captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Triple A');
          if (oldSolver) await oldSolver.close().catch(() => {});
          await oldPage?.close?.().catch?.(() => {});
          authState.done = false;
          authState.ok = false;
          authState.status = 0;
          await gotoPortalPage(page, TRIPLE_A_URLS.login, {
            waitUntil: 'domcontentloaded',
            timeout: PORTAL_AUTH_TIMEOUT_MS,
          }, 'Triple A');
          authenticatedByLogin = await submitPortalLoginForm(page, {
            provider: 'Triple A',
            username: credentials.username,
            password: credentials.password,
            emailSelectors: tripleEmailSelectors,
            passwordSelectors: triplePasswordSelectors,
            authState,
            prepareSubmit: async () => {
              await executePortalTurnstile(page);
              if (captchaSolver) await captchaSolver.waitForSolved(60000);
              await sleep(500);
            },
          });
        } catch (error) {
          loginError = error;
          console.warn(`[TRIPLE A] Reintento de login ${retry}/${PORTAL_LOGIN_ATTEMPTS}: ${error.message}`);
        }
      }
    }
    if (!authenticatedByLogin) {
      console.log('[TRIPLE A] La sesión ya estaba autenticada; se reutiliza el portal global.');
    }

    // Let NextAuth mount the protected route once so its BFF request runs in
    // the authenticated browser context. A direct fetch from a stale login
    // document can otherwise remain pending indefinitely.
    if (authenticatedByLogin && !authenticatedByApi) {
      if (dataPage) {
        const loginPage = page;
        page = dataPage;
        dataPage = null;
        await loginPage?.close?.().catch?.(() => {});
        console.log('[TRIPLE A] Se cambiÃ³ a la pÃ¡gina de trabajo conservando la sesiÃ³n autenticada.');
      } else {
      try {
        const replacement = await recreatePortalPage(browser, page, captchaSolver, 'Triple A');
        page = replacement.page;
        captchaSolver = replacement.captchaSolver;
        page.on?.('response', captureSubscriptions);
        page.on?.('response', captureAuthResponse);
        console.log('[TRIPLE A] Se creó una página nueva conservando la sesión autenticada.');
      } catch (error) {
        console.warn('[TRIPLE A] No se pudo recrear la página autenticada; se continuará con la actual:', error.message);
      }
      }
      await gotoPortalPage(page, TRIPLE_A_URLS.policies, {
        waitUntil: 'domcontentloaded',
        timeout: PORTAL_AUTH_TIMEOUT_MS,
      }, 'Triple A').catch(error => {
        console.warn('[TRIPLE A] No se pudo abrir la vista protegida; se continuará con la consulta autenticada:', error.message);
      });
      await sleep(1500);
    }
    let tripleWorkUrl = 'desconocida';
    try { tripleWorkUrl = page.url(); } catch {}
    console.log(`[TRIPLE A] Sesión lista; URL de trabajo: ${tripleWorkUrl}.`);

    // If the React page did not issue the request again (for example after a
    // cached navigation), ask the same authenticated browser session directly.
    for (let attempt = 1; !subscriptionPayload && attempt <= PORTAL_DATA_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        console.warn(`[TRIPLE A] La lista global no llegó; reintentando la consulta autenticada (${attempt}/${PORTAL_DATA_ATTEMPTS}).`);
        await sleep(PORTAL_DATA_RETRY_DELAY_MS);
      }
      const direct = await fetchPortalJson(page, '/bff/subscriptions', authHeader ? { Authorization: authHeader } : {});
      if (direct.status >= 200 && direct.status < 300) {
        subscriptionPayload = parsePortalResponseBody(direct.body);
      } else if (attempt === PORTAL_DATA_ATTEMPTS) {
        throw new Error(`Triple A rechazó la consulta global (HTTP ${direct.status || 'sin respuesta'}${direct.error ? `: ${direct.error}` : ''}).`);
      }
    }

    let subscriptions = unwrapPortalList(subscriptionPayload, ['subscriptions', 'policies', 'items']);
    if (!subscriptions.length) {
      for (let attempt = 1; attempt <= PORTAL_DATA_ATTEMPTS && !subscriptions.length; attempt += 1) {
        if (attempt > 1) await sleep(PORTAL_DATA_RETRY_DELAY_MS);
        const direct = await fetchPortalJson(page, '/bff/subscriptions', authHeader ? { Authorization: authHeader } : {});
        if (direct.status < 200 || direct.status >= 300) continue;
        const retryPayload = parsePortalResponseBody(direct.body);
        const retrySubscriptions = unwrapPortalList(retryPayload, ['subscriptions', 'policies', 'items']);
        if (retrySubscriptions.length) {
          subscriptionPayload = retryPayload;
          subscriptions = retrySubscriptions;
        }
      }
    }
    console.log('[TRIPLE A] Respuesta global:', JSON.stringify(portalPayloadDiagnostics(subscriptionPayload, subscriptions)));
    const targets = configuredApartmentTargets();
    const results = [];
    const seenApartments = new Set();
    for (const subscription of subscriptions) {
      const target = matchPortalApartmentForService(targets, subscription, 'water');
      if (!target || seenApartments.has(String(target.apartmentId || target.apartment))) continue;
      seenApartments.add(String(target.apartmentId || target.apartment));
      const portalSummary = await fetchTripleAPortalSummary(page, subscription, authHeader).catch(error => ({
        error: error.message,
        debtSource: 'subscription_fallback',
      }));
      const record = tripleARecord(target, subscription, new Date().toISOString(), portalSummary);
      if (portalSummary.error && !record.error) record.error = portalSummary.error;
      results.push(record);
      const amount = record.deudaCOP === null ? 'sin valor' : `$${record.deudaCOP.toLocaleString('es-CO')}`;
      const month = record.deudaMesCOP === null ? 'sin mes' : `$${record.deudaMesCOP.toLocaleString('es-CO')}`;
      const financed = record.financiadaCOP === null ? 'sin financiación' : `$${record.financiadaCOP.toLocaleString('es-CO')}`;
      console.log(`[TRIPLE A] Portal global ${target.apartment}: ${record.status} (mes ${month}; total ${amount}; financiada ${financed}; endpoint deuda HTTP ${record.debtEndpointStatus || 'no disponible'}).`);
    }

    if (results.length < Math.min(targets.length, subscriptions.length)) {
      logUnmatchedPortalItems('TRIPLE A', subscriptions.filter(subscription =>
        !matchPortalApartmentForService(targets, subscription, 'water')
      ), 'water');
    }
    if (!results.length) {
      lastWaterScrapeError = 'Triple A autenticó el portal, pero no se pudo asociar ninguna póliza con los apartamentos configurados.';
      console.warn('[TRIPLE A] Portal global no devolvió pólizas asociables; no se usará ningún respaldo por QR.');
    } else {
      console.log(`[TRIPLE A] Portal global: ${results.length} apartamento(s) con datos.`);
    }
    return results;
  } catch (error) {
    lastWaterScrapeError = error.message;
    console.error('[TRIPLE A] Portal global error:', error.message);
    return [];
  } finally {
    if (dataPage && captureSubscriptions) dataPage.off?.('response', captureSubscriptions);
    if (dataPage) await closeWaterResource(dataPage);
    if (page && captureSubscriptions) page.off?.('response', captureSubscriptions);
    if (page && captureAuthResponse) page.off?.('response', captureAuthResponse);
    if (captchaSolver) await captchaSolver.close();
    if (browser) await closeWaterBrowser(browser);
  }
}

/* QR fallback removed: the water scraper is portal-only.
async function scrapeWaterBills(apartments = db?.apartments || [], browserFactory = launchBrowser) {
  const targets = (apartments || []).map(waterTarget).filter(Boolean);
  if (!targets.length) {
    lastWaterScrapeError = null;
    console.log('[TRIPLE A] No hay URLs QR de agua configuradas.');
    return [];
  }

  let browser;
  const results = new Array(targets.length);
  try {
    lastWaterScrapeError = null;
    console.log(`[TRIPLE A] Consultando ${targets.length} enlace(s) QR de agua...`);
    browser = await browserFactory('water');
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const target = targets[index];
        const checkedAt = new Date().toISOString();
        let completed = false;
        let attempt = 0;
        while (!completed && attempt < WATER_CAPTCHA_MAX_ATTEMPTS) {
          attempt += 1;
          let page;
          try {
          page = await browser.newPage();
          page.setDefaultNavigationTimeout?.(WATER_TIMEOUT_MS);
          const responseBodies = [];
          const captureResponse = response => {
            const type = response.request().resourceType();
            const contentType = response.headers()['content-type'] || '';
            const responseUrl = response.url();
            // The document contains the Next.js shell and unrelated numeric
            // strings. Only retain billing-related XHR/fetch bodies, and do
            // not let a long-running analytics response block a scrape.
            if (!['xhr', 'fetch'].includes(type) || !/json|text|html/i.test(contentType)) return;
            if (!/payment|factur|saldo|deuda|invoice|amount|balance|coupon|poliza|pago/i.test(responseUrl) && !/json/i.test(contentType)) return;
            Promise.race([
              response.text(),
              sleep(WATER_RESPONSE_TIMEOUT_MS).then(() => ''),
            ])
              .then(body => {
                if (body && /factura|saldo|deuda|total|valor|monto|amount|balance|debt|invoice|pendingValue|amountDue|invoiceTotal/i.test(body)) {
                  responseBodies.push(body.slice(0, 100000));
                }
              })
              .catch(() => {});
          };
          const canCaptureResponses = typeof page.on === 'function' && typeof page.off === 'function';
          if (canCaptureResponses) page.on('response', captureResponse);
          // Triple A keeps analytics/long-running requests open, so waiting for
          // networkidle2 is unreliable. Wait for the document, then poll the
          // rendered frames/API responses until the debt or a terminal state is
          // available, without making the result depend on the whole network
          // becoming idle.
          const deadline = Date.now() + WATER_TIMEOUT_MS;
          const response = await page.goto(target.waterPaymentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: WATER_TIMEOUT_MS,
          });
          if (response && response.status() >= 400) throw new Error(`El portal respondió HTTP ${response.status()}`);
          await sleep(2200);
          const pageState = await waitForWaterTurnstile(page, deadline);
          const query = await submitWaterQueryIfReady(page, pageState);
          if (query.captcha) {
            const parsed = { status: 'captcha', deudaCOP: null, error: query.error };
            lastWaterScrapeError = query.error;
            if (attempt < WATER_CAPTCHA_MAX_ATTEMPTS) {
              console.warn(`[TRIPLE A] ${target.apartment || target.apartmentId}: captcha (Turnstile requerido); reiniciando pagina (intento ${attempt + 1}/${WATER_CAPTCHA_MAX_ATTEMPTS}).`);
            } else {
              results[index] = waterRecord(target, parsed, checkedAt);
              console.warn(`[TRIPLE A] ${target.apartment || target.apartmentId}: captcha (Turnstile requerido), agotados ${WATER_CAPTCHA_MAX_ATTEMPTS} intentos.`);
              completed = true;
            }
            continue;
          }

          const parsed = await waitForWaterBill(page, responseBodies, deadline);
          if (canCaptureResponses) page.off('response', captureResponse);
          if (parsed.status === 'captcha') {
            lastWaterScrapeError = parsed.error || WATER_CAPTCHA_ERROR;
            if (attempt < WATER_CAPTCHA_MAX_ATTEMPTS) {
              console.warn(`[TRIPLE A] ${target.apartment || target.apartmentId}: captcha (Turnstile requerido); reiniciando pagina (intento ${attempt + 1}/${WATER_CAPTCHA_MAX_ATTEMPTS}).`);
            } else {
              results[index] = waterRecord(target, parsed, checkedAt);
              console.warn(`[TRIPLE A] ${target.apartment || target.apartmentId}: captcha (Turnstile requerido), agotados ${WATER_CAPTCHA_MAX_ATTEMPTS} intentos.`);
              completed = true;
            }
            continue;
          }
          if (!waterResultReady(parsed)) {
            throw new Error(`Triple A timeout: no mostró el valor de la deuda después de ${WATER_TIMEOUT_MS / 1000} segundos.`);
          }
          results[index] = waterRecord(target, parsed, checkedAt);
          const suffix = parsed.status === 'captcha'
            ? ' (Turnstile requerido)'
            : parsed.deudaCOP !== null ? ` ($${parsed.deudaCOP.toLocaleString('es-CO')})` : '';
          console.log(`[TRIPLE A] ${target.apartment || target.apartmentId}: ${parsed.status}${suffix}`);
          completed = true;
        } catch (error) {
          lastWaterScrapeError = error.message;
          const isCaptcha = /captcha|turnstile|verification/i.test(String(error.message || ''));
          const maxAttempts = isCaptcha ? WATER_CAPTCHA_MAX_ATTEMPTS : WATER_MAX_ATTEMPTS;
          const shouldRetry = attempt < maxAttempts;
          if (shouldRetry) {
            const reason = isCaptcha
              ? 'captcha (Turnstile requerido)'
              : `sin valor despues de ${WATER_TIMEOUT_MS / 1000}s`;
            console.warn(`[TRIPLE A] ${target.apartment || target.apartmentId}: ${reason}; reiniciando pagina (intento ${attempt + 1}/${maxAttempts}).`);
          } else {
            results[index] = waterNavigationError(target, error, checkedAt);
            console.error(`[TRIPLE A] ${target.apartment || target.apartmentId}: ${error.message}`);
            completed = true;
          }
        } finally {
          if (page) await closeWaterResource(page);
        }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(WATER_WORKERS, targets.length) }, worker));
  } catch (error) {
    lastWaterScrapeError = error.message;
    console.error('[TRIPLE A] SCRAPER ERROR:', error.message);
    for (let index = 0; index < targets.length; index++) {
      if (!results[index]) results[index] = waterNavigationError(targets[index], error);
    }
  } finally {
    if (browser) await closeWaterBrowser(browser);
  }

  return results.filter(Boolean);
}
*/

function extractGasAmount(text) {
  const amountToken = '[0-9][0-9.,]*(?:\\s+[0-9][0-9.,]*)?';
  const label = /(?:saldo(?:\s+(?:pendiente|por\s+pagar|total))?|deuda\b(?:\s+total)?|total(?:\s+(?:(?:a|por)\s+)?pagar|\s+factura)?|valor(?:\s+(?:(?:a|por)\s+)?pagar|\s+factura)?|importe|monto|amount(?:\s+due)?|balance|debt|invoice(?:\s+total)?|factura\s+(?:pendiente|por\s+pagar|vencida)|recibo\s+(?:pendiente|por\s+pagar|vencido))/gi;
  const labeled = new RegExp(label.source + '[^$0-9]{0,80}(?:\\$\\s*|COP\\s*)?(' + amountToken + ')\\s*(?:COP|pesos)?', 'gi');
  const labeledAmounts = [...String(text || '').matchAll(labeled)]
    .map(match => parseCopAmount(match[1]))
    .filter(amount => amount !== null);
  if (labeledAmounts.length) return Math.max(...labeledAmounts);

  const currencyAmounts = [
    ...String(text || '').matchAll(new RegExp('(?:\\$\\s*|COP\\s*)(' + amountToken + ')\\s*(?:COP|pesos)?', 'gi')),
    ...String(text || '').matchAll(new RegExp('(' + amountToken + ')\\s*(?:COP|pesos)', 'gi')),
  ]
    .map(match => parseCopAmount(match[1]))
    .filter(amount => amount !== null);
  const hasBillingContext = /(?:factura|recibo|saldo|deuda|pago|total|valor|monto|amount|balance|debt|invoice)/i.test(text);
  if (!hasBillingContext) return null;
  return currencyAmounts.length ? Math.max(...currencyAmounts) : null;
}

function parseGasBillPage(pageText) {
  const text = normalizeBillText(pageText);
  const normalized = text.toLowerCase();
  const captcha = /captcha|recaptcha|turnstile|verificacion en dos pasos|codigo de verificacion|no soy un robot/.test(normalized);
  const accessWall = /iniciar sesion|iniciar sesión|usuario|contrasena|contraseña|login/.test(normalized) &&
    !/factura|saldo|deuda|pago/.test(normalized);
  const amount = extractGasAmount(text);
  const noDebtText = normalized.replace(/sin deuda|no hay deuda|sin saldo pendiente/g, '');
  const pending = /(?:factura|recibo|saldo|pago)\s+(?:pendiente|por\s+pagar|vencid[ao]|no\s+pagad[ao])|(?:deuda|saldo)\s+(?:pendiente|por\s+pagar|total)|(?:status|estado)\s*["':=]+\s*(?:pending|in_debt)|\b(?:pending|in_debt)\b/.test(noDebtText);
  const paid = /pagad[ao]|al dia|al día|cancelad[ao]|sin deuda|no hay deuda|saldo\s*\$?\s*0\b/.test(normalized);

  let status = 'unknown';
  let error = null;
  if (captcha) {
    status = 'captcha';
    error = 'El portal de Gases del Caribe requiere CAPTCHA o verificacion manual.';
  } else if (accessWall) {
    status = 'error';
    error = 'El enlace de Gases del Caribe requiere autenticacion.';
  } else if (amount !== null && amount > 0) {
    status = 'pending';
  } else if (amount === 0 || (paid && !pending)) {
    status = 'paid';
  } else if (pending) {
    status = 'pending';
  }

  return { status, deudaCOP: amount, error };
}

/* Individual gas-link fallback removed: the gas scraper is portal-only.
function gasTarget(apartment) {
  const paymentCode = String(apartment?.gasPaymentCode || '').trim();
  const url = String(apartment?.gasPaymentUrl || '').trim() ||
    (paymentCode ? 'https://portal.gascaribe.com/payments' : '');
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return {
    apartmentId: apartment.id,
    apartment: apartment.name,
    gasPaymentUrl: url,
    gasPaymentCode: paymentCode || null,
  };
}

function gasRecord(target, parsed, checkedAt = new Date().toISOString()) {
  return {
    provider: 'Gases del Caribe',
    service: 'gas',
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    gasPaymentUrl: gasContractPaymentUrl(target.gasPaymentCode),
    gasPaymentCode: target.gasPaymentCode,
    status: parsed.status,
    deudaCOP: parsed.deudaCOP,
    deudaTotalCOP: parsed.deudaCOP,
    deudaLabel: 'Deuda Total',
    numFacturas: parsed.status === 'pending' ? 1 : 0,
    error: parsed.error || null,
    checkedAt,
    scrapedAt: checkedAt,
  };
}

function gasNavigationError(target, error, checkedAt = new Date().toISOString()) {
  const message = String(error?.message || error || 'Error desconocido al consultar Gases del Caribe');
  const status = /timeout|timed out|tardo.*demasiado/i.test(message) ? 'timeout' : 'error';
  return gasRecord(target, { status, deudaCOP: null, error: message }, checkedAt);
}

async function waitForGasTurnstile(page, deadline) {
  let state = await inspectWaterPage(page);
  const waiting = state && state.hasTurnstile && !state.turnstileToken && !state.hasBillingResult;
  if (!waiting) return state;
  const turnstileDeadline = Math.min(deadline, Date.now() + (BROWSERLESS_SOLVE_CAPTCHAS ? 30000 : 20000));
  while (Date.now() < turnstileDeadline) {
    await sleep(Math.min(GAS_POLL_INTERVAL_MS, turnstileDeadline - Date.now()));
    state = await inspectWaterPage(page);
    if (!state || state.turnstileToken || state.hasBillingResult) return state;
  }
  return state;
}

async function submitGasQueryIfReady(page, code) {
  if (!code || typeof page?.evaluate !== 'function') return false;
  try {
    return Boolean(await page.evaluate((paymentCode) => {
      const visible = element => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && !!element.getClientRects().length;
      };
      const input = [
        '#ContractStep_input_contractId input',
        'input[id*="contractId" i]',
        'input[name*="contract" i]',
        'input[name*="susc" i]',
        'input[inputmode="numeric"]',
        'input[type="number"]',
      ].map(selector => document.querySelector(selector)).find(element => visible(element));
      if (!input || input.value) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, paymentCode);
      else input.value = paymentCode;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const button = [
        '#contractQueryForm button[type="submit"]',
        'form button[type="submit"]',
        'button',
      ].map(selector => [...document.querySelectorAll(selector)]).flat()
        .find(element => visible(element) && !element.disabled &&
          (/consultar|continuar|buscar/i.test(element.innerText || '') || element.type === 'submit'));
      if (!button) return false;
      button.click();
      return true;
    }, String(code)));
  } catch {
    return false;
  }
}

async function waitForGasBill(page, responseBodies, deadline) {
  let latest = { status: 'unknown', deudaCOP: null, error: null };
  while (true) {
    const state = await inspectWaterPage(page);
    if (state && (state.hasTurnstile || state.hasCaptchaText) && !state.turnstileToken && !state.hasBillingResult) {
      return { ...latest, status: 'captcha', error: GAS_CAPTCHA_ERROR };
    }
    const pageText = await readWaterPageText(page, responseBodies);
    if (pageText) {
      latest = parseGasBillPage(pageText);
      if (latest.status === 'paid' || latest.status === 'captcha' || latest.status === 'error' ||
          (latest.status === 'pending' && latest.deudaCOP !== null)) return latest;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return latest;
    await sleep(Math.min(GAS_POLL_INTERVAL_MS, remaining));
  }
}
*/

function gasInvoiceSummary(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const unpaid = [];
  for (const invoice of list) {
    const amount = parsePortalAmount(
      portalFieldValue(invoice, [
        'pendingValue', 'pendingAmount', 'couponValue', 'amountDue', 'totalToPay',
        'totalDebt', 'deudaTotal', 'invoiceValue', 'balanceDue', 'balance',
        'saldo', 'debt', 'total', 'amount', 'value',
      ]),
    );
    const paidValue = portalFieldValue(invoice, ['isPaid', 'paid', 'pagada', 'status']);
    const pendingValue = portalFieldValue(invoice, ['isPending', 'pending', 'pendiente', 'status']);
    const paid = paidValue === true || /^(?:true|1|paid|pagad[ao]|cancelad[ao])$/i.test(String(paidValue || ''));
    const pending = pendingValue === true || /^(?:true|1|pending|pendiente|vencid[ao]|overdue)$/i.test(String(pendingValue || ''));
    if (!paid && (pending || (amount !== null && amount > 0))) unpaid.push({ invoice, amount });
  }
  const knownAmounts = unpaid.map(item => item.amount).filter(amount => amount !== null);
  const debt = knownAmounts.length ? knownAmounts.reduce((sum, amount) => sum + amount, 0) : null;
  const sorted = [...list].sort((left, right) => (portalRecordDate(right)?.getTime() || 0) - (portalRecordDate(left)?.getTime() || 0));
  const latest = sorted[0] || null;
  const latestDate = portalRecordDate(latest);
  const latestPeriod = latestDate ? `${latestDate.getUTCFullYear()}-${latestDate.getUTCMonth()}` : null;
  const currentRows = latestPeriod
    ? unpaid.filter(item => {
      const date = portalRecordDate(item.invoice);
      return date && `${date.getUTCFullYear()}-${date.getUTCMonth()}` === latestPeriod;
    })
    : unpaid.slice(0, 1);
  const current = currentRows.length ? currentRows : unpaid.slice(0, 1);
  const monthValues = current.map(item => portalAmountFromFields(item.invoice, [
    'monthValue', 'monthlyValue', 'valorMes', 'deudaMes', 'invoiceValue',
    'valorFactura', 'invoiceAmount', 'totalToPay', 'amountDue', 'pendingValue',
    'pendingAmount', 'couponValue',
  ])).filter(value => value !== null);
  const monthDebt = monthValues.length ? monthValues.reduce((sum, amount) => sum + amount, 0) : null;
  const receipt = latest || unpaid[0]?.invoice || list[0] || null;
  return {
    status: debt > 0 || (debt === null && unpaid.length) ? 'pending' : 'paid',
    deudaCOP: debt === null && !unpaid.length ? 0 : debt,
    deudaMesCOP: monthDebt,
    deudaTotalCOP: debt,
    numFacturas: unpaid.length,
    factura: portalFieldValue(receipt, ['id', 'invoiceNumber', 'factura']) || null,
    expirationDate: portalFieldValue(receipt, ['expirationDate', 'dueDate', 'fechaVencimiento']) || null,
    periodo: portalFieldValue(receipt, ['periodo', 'billingPeriod', 'invoiceDate', 'expirationDate']) || null,
    facturaValorCOP: monthDebt,
  };
}

function gasRecord(target, parsed, checkedAt = new Date().toISOString()) {
  const month = parsed.deudaMesCOP ?? parsed.facturaValorCOP ?? parsed.deudaTotalCOP ?? parsed.deudaCOP ?? null;
  const convenio = parsed.deudaConveniosCOP ?? parsed.financiadaCOP ?? null;
  const rawTotal = parsed.deudaTotalCOP ?? parsed.deudaCOP;
  const total = rawTotal ?? (
    month !== null && convenio !== null ? month + convenio : month
  );
  return {
    provider: 'Gases del Caribe',
    service: 'gas',
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    gasPaymentUrl: target.gasPaymentUrl,
    gasPaymentCode: target.gasPaymentCode,
    status: parsed.status,
    deudaCOP: total,
    deudaMesCOP: month,
    deudaConveniosCOP: convenio,
    deudaTotalCOP: total,
    deudaLabel: 'Deuda Total',
    numFacturas: parsed.numFacturas ?? (parsed.status === 'pending' ? 1 : 0),
    factura: parsed.factura || null,
    periodo: parsed.periodo || parsed.expirationDate || null,
    facturaValorCOP: parsed.facturaValorCOP ?? month,
    financiadaCOP: parsed.financiadaCOP ?? null,
    cuotaFinanciadaCOP: parsed.cuotaFinanciadaCOP ?? null,
    financiacion: parsed.financiacion || [],
    debtSource: parsed.debtSource || 'invoice_fallback',
    debtEndpointStatus: parsed.debtEndpointStatus ?? null,
    error: parsed.error || null,
    checkedAt,
    scrapedAt: checkedAt,
  };
}

function gasDebtSummary(payload) {
  if (!payload) return { total: null, financing: portalFinancingSummary(null) };
  const rows = unwrapPortalList(payload, ['debts', 'items', 'invoices', 'contracts']);
  const explicitTotal = portalAmountFromFields(payload, [
    'totalDebts', 'totalDebt', 'deudaTotal', 'totalDebtValue', 'totalToPay',
    'totalValue', 'totalAmount', 'saldoTotal', 'totalCurrentDebt', 'total',
  ]);
  const rowTotal = rows.map(row => portalAmountFromFields(row, [
    'pendingBalance', 'saldoPendiente', 'saldoPorFacturar', 'totalValue',
    'totalDebt', 'deudaTotal', 'amountDue', 'balanceDue', 'totalToPay',
    'amount', 'value',
  ])).filter(value => value !== null);
  const financing = portalFinancingSummary(payload);
  const month = portalAmountFromFields(payload, [
    'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
    'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
    'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
    'deudaActual', 'currentBalance', 'balanceCurrent',
  ]) ?? (rows.length
    ? portalAmountFromFields(rows[0], [
      'deudaMes', 'monthDebt', 'monthlyDebt', 'currentDebt', 'currentMonthDebt',
      'currentInvoice', 'currentInvoiceValue', 'currentInvoiceAmount', 'currentAmount',
      'invoiceValue', 'valorMes', 'valorFactura', 'saldoActual', 'saldoDeudaActual',
      'deudaActual', 'currentBalance', 'balanceCurrent',
    ])
    : null);
  const baseTotal = explicitTotal ?? (rowTotal.length ? rowTotal.reduce((sum, value) => sum + value, 0) : null);
  const total = baseTotal ?? (
    month !== null && financing.financiadaCOP !== null
      ? month + financing.financiadaCOP
      : month
  );
  return {
    total,
    month,
    financing,
  };
}

async function fetchGasDebtSummary(page, contractId, authHeader) {
  if (!contractId) return { debtEndpointStatus: 0, debtSource: 'invoice_fallback' };
  const response = await fetchPortalJson(
    page,
    `${GAS_API_BASE}/contracts/debt/${encodeURIComponent(String(contractId))}`,
    authHeader ? { Authorization: authHeader } : {},
  );
  const status = response.status || 0;
  if (status < 200 || status >= 300) {
    return { debtEndpointStatus: status, debtSource: 'invoice_fallback' };
  }
  const payload = parsePortalResponseBody(response.body);
  const summary = gasDebtSummary(payload);
  return {
    deudaTotalCOP: summary.total,
    deudaMesCOP: summary.month,
    deudaConveniosCOP: summary.financing.financiadaCOP,
    financiadaCOP: summary.financing.financiadaCOP,
    cuotaFinanciadaCOP: summary.financing.cuotaFinanciadaCOP,
    financiacion: summary.financing.financiacion,
    debtSource: summary.total !== null ? 'debt_endpoint' : 'invoice_fallback',
    debtEndpointStatus: status,
  };
}

async function scrapeGasAccount() {
  if (!/^(0|false|no)$/i.test(String(process.env.PORTAL_UI_SCRAPE || 'true'))) {
    return scrapeGasFromRenderedUi();
  }
  let browser;
  let page;
  let dataPage;
  let contractsPayload = null;
  let authHeader = null;
  let gasCaptchaToken = '';
  let captureContracts;
  let captureAuth;
  let captureLoginResponse;
  let captchaSolver;
  const authState = { done: false, ok: false, status: 0 };
  try {
    lastGasScrapeError = null;
    const credentials = getPortalCredentials('gascaribe');
    const browserless = browserlessEndpointCandidates('gas').length > 0;
    console.log(`[GAS] Portal global: iniciando sesión (${browserless ? 'Browserless remoto' : 'Chromium local'}).`);
    browser = await launchBrowser('gas');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
    captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Gases del Caribe');

    captureAuth = request => {
      const requestUrl = request.url();
      if (!/pagosweb-production-api\.innovacion-gascaribe\.com/i.test(requestUrl)) return;
      const pathname = (() => {
        try { return new URL(requestUrl).pathname; } catch { return ''; }
      })();
      if (/\/contracts\/?$/i.test(pathname)) {
        authHeader = request.headers()?.authorization || authHeader;
      }
    };
    captureContracts = response => {
      const responseUrl = response.url();
      let pathname = '';
      try { pathname = new URL(responseUrl).pathname; } catch {}
      if (!/pagosweb-production-api\.innovacion-gascaribe\.com/i.test(responseUrl) || !/\/contracts\/?$/i.test(pathname)) return;
      responseTextWithTimeout(response, GAS_RESPONSE_TIMEOUT_MS)
        .then(body => {
          const parsed = parsePortalResponseBody(body);
          if (parsed) contractsPayload = parsed;
        })
        .catch(() => {});
    };
    captureLoginResponse = response => {
      const responseUrl = response.url();
      let pathname = '';
      try { pathname = new URL(responseUrl).pathname; } catch {}
      if (!/pagosweb-production-api\.innovacion-gascaribe\.com/i.test(responseUrl) || !/\/login\/?$/i.test(pathname)) return;
      authState.status = response.status();
      responseTextWithTimeout(response, GAS_RESPONSE_TIMEOUT_MS)
        .then(body => {
          const payload = parsePortalResponseBody(body) || {};
          const token = portalFieldValue(payload, ['token', 'appToken', 'accessToken', 'authorization', 'jwt']);
          if (!authHeader && token) authHeader = String(token).trim();
          authState.done = true;
          authState.ok = response.status() >= 200 && response.status() < 300;
          console.log(`[GAS] Respuesta de login: HTTP ${response.status()}; ok=${Boolean(authState.ok)}; token=${Boolean(token)}; campos=${Object.keys(payload).slice(0, 8).join(',') || 'sin cuerpo'}.`);
        })
        .catch(() => {
          authState.done = true;
          authState.ok = response.status() >= 200 && response.status() < 300;
          console.log(`[GAS] Respuesta de login: HTTP ${response.status()}; ok=${Boolean(authState.ok)}; cuerpo no legible.`);
        });
    };
    page.on?.('request', captureAuth);
    page.on?.('response', captureContracts);
    page.on?.('response', captureLoginResponse);

    await gotoPortalPage(page, GAS_PORTAL_URLS.login, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    }, 'Gases del Caribe');

    // Keep a second tab open before submitting the React/Turnstile form. The
    // portal can detach the login frame during the redirect; this spare tab
    // preserves the Browserless session and shares the authenticated cookies.
    dataPage = await browser.newPage().catch(() => null);
    if (dataPage) {
      dataPage.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);
      dataPage.on?.('request', captureAuth);
      dataPage.on?.('response', captureContracts);
      console.log('[GAS] Página de trabajo preparada antes del login.');
    }

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[placeholder*="correo" i]',
      'input[placeholder*="email" i]',
      'input[type="text"]',
    ];
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password" i]',
      'input[id*="password" i]',
      'input[id*="pass" i]',
    ];
    let authenticatedByLogin = false;
    let authenticatedByApi = false;
    let loginError = null;
    try {
      const apiLogin = await loginGasWithPortalApi(page, credentials, captchaSolver);
      authHeader = apiLogin.authHeader || authHeader;
      gasCaptchaToken = apiLogin.captchaToken || '';
      authenticatedByLogin = true;
      authenticatedByApi = true;
      console.log('[GAS] Login API oficial confirmado; se conservara la misma sesion para consultar contratos.');
    } catch (error) {
      loginError = error;
      console.warn(`[GAS] El login API no se confirmo; se probara el formulario del portal: ${error.message}`);
    }
    if (!authenticatedByApi) {
      try {
        await submitPortalLoginForm(page, {
        provider: 'Gases del Caribe',
        username: credentials.username,
        password: credentials.password,
        emailSelectors,
        passwordSelectors,
        authState,
        prepareSubmit: async () => {
          const executed = await executePortalTurnstile(page).catch(error => {
            if (/detached|execution context|target closed|connection closed/i.test(String(error?.message || error))) {
              console.warn('[GAS] Turnstile cambió el contexto; se esperará el estado del navegador.');
              return false;
            }
            throw error;
          });
          if (executed) console.log('[GAS] Turnstile preparado antes de enviar el formulario.');
          if (captchaSolver) await captchaSolver.waitForSolved(60000);
          const gasChallenge = await waitForPortalTurnstile(page, 30000);
          gasCaptchaToken = gasChallenge?.turnstileToken || await readPortalTurnstileToken(page);
          if (!gasCaptchaToken) throw new Error('Gases del Caribe no entregó el token de Turnstile antes de enviar el formulario.');
          console.log(`[GAS] Turnstile preparado; esperando ${Math.ceil(GAS_TURNSTILE_SETTLE_DELAY_MS / 1000)} s antes de enviar el formulario.`);
          await sleep(GAS_TURNSTILE_SETTLE_DELAY_MS);
        },
      });
      authenticatedByLogin = true;
      gasCaptchaToken = await readPortalTurnstileToken(page);
    } catch (error) {
      loginError = error;
      console.warn(`[GAS] El login API no se confirmÃ³; se probarÃ¡ la ruta global autenticada: ${error.message}`);
    }
    if (!authenticatedByLogin) {
      console.log('[GAS] Se probarÃ¡ la sesiÃ³n existente del portal global.');
    }

    }
    // A detached login frame does not necessarily mean the session was lost:
    // Browserless can close the React login document after setting the
    // authenticated cookie. Try the spare page for transient browser errors
    // before declaring the portal unavailable.
    const canUseSparePage = !authenticatedByApi && Boolean(dataPage) && (
      authenticatedByLogin || (loginError && isTransientPortalRunError(loginError.message))
    );
    if (canUseSparePage) {
      if (dataPage) {
        const loginPage = page;
        page = dataPage;
        dataPage = null;
        await loginPage?.close?.().catch?.(() => {});
        console.log(`[GAS] Se cambiÃ³ a la pÃ¡gina de trabajo conservando la sesiÃ³n${authenticatedByLogin ? ' autenticada' : ' potencialmente autenticada'}.`);
      } else {
        try {
          const replacement = await recreatePortalPage(browser, page, captchaSolver, 'Gases del Caribe');
          page = replacement.page;
          captchaSolver = replacement.captchaSolver;
          page.on?.('request', captureAuth);
          page.on?.('response', captureContracts);
          console.log('[GAS] Se creÃ³ una pÃ¡gina nueva conservando la sesiÃ³n autenticada.');
        } catch (error) {
          console.warn('[GAS] No se pudo recrear la pÃ¡gina autenticada; se continuarÃ¡ con la actual:', error.message);
        }
      }
    }

    if (!authenticatedByApi && (authenticatedByLogin || canUseSparePage)) {
      await gotoPortalPage(page, GAS_PORTAL_URLS.contracts, {
        waitUntil: 'domcontentloaded',
        timeout: PORTAL_AUTH_TIMEOUT_MS,
      }, 'Gases del Caribe').catch(error => {
        console.warn('[GAS] No se pudo abrir la vista protegida; se continuará con la consulta autenticada:', error.message);
      });
      await sleep(1500);
    }
    let gasWorkUrl = 'desconocida';
    try { gasWorkUrl = page.url(); } catch {}
    console.log(`[GAS] Sesión lista; URL de trabajo: ${gasWorkUrl}.`);

    for (let attempt = 1; !contractsPayload && attempt <= PORTAL_DATA_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        console.warn(`[GAS] La lista global no llegó; reintentando la consulta autenticada (${attempt}/${PORTAL_DATA_ATTEMPTS}).`);
        await sleep(PORTAL_DATA_RETRY_DELAY_MS);
      }
      const direct = await fetchPortalJson(page, `${GAS_API_BASE}/contracts`, authHeader ? { Authorization: authHeader } : {});
      if (direct.status >= 200 && direct.status < 300) {
        contractsPayload = parsePortalResponseBody(direct.body);
      } else if (attempt === PORTAL_DATA_ATTEMPTS) {
        throw new Error(`Gases del Caribe rechazó la consulta global (HTTP ${direct.status || 'sin respuesta'}${direct.error ? `: ${direct.error}` : ''}).`);
      }
    }
    if (!contractsPayload) throw new Error('No se recibió la lista global de contratos de Gases del Caribe.');

    const token = portalFieldValue(contractsPayload, ['token', 'appToken', 'accessToken', 'authorization']);
    if (!authHeader && token) authHeader = String(token).trim();
    if (!authHeader) throw new Error('El portal de Gases del Caribe no entregó el token de consulta.');

    let contracts = unwrapPortalList(contractsPayload, ['contracts', 'items']);
    if (!contracts.length) {
      for (let attempt = 1; attempt <= PORTAL_DATA_ATTEMPTS && !contracts.length; attempt += 1) {
        if (attempt > 1) await sleep(PORTAL_DATA_RETRY_DELAY_MS);
        const direct = await fetchPortalJson(page, `${GAS_API_BASE}/contracts`, authHeader ? { Authorization: authHeader } : {});
        if (direct.status < 200 || direct.status >= 300) continue;
        const retryPayload = parsePortalResponseBody(direct.body);
        const retryContracts = unwrapPortalList(retryPayload, ['contracts', 'items']);
        if (retryContracts.length) {
          contractsPayload = retryPayload;
          contracts = retryContracts;
        }
      }
    }
    const refreshedToken = portalFieldValue(contractsPayload, ['token', 'appToken', 'accessToken', 'authorization']);
    if (!authHeader && refreshedToken) {
      authHeader = String(refreshedToken).trim();
    }
    if (!authHeader) throw new Error('El portal de Gases del Caribe no entregó el token de consulta.');
    console.log('[GAS] Respuesta global:', JSON.stringify(portalPayloadDiagnostics(contractsPayload, contracts)));
    const targets = configuredApartmentTargets();
    const results = [];
    const seenApartments = new Set();
    for (const contract of contracts) {
      const target = matchPortalApartmentForService(targets, contract, 'gas');
      if (!target || seenApartments.has(String(target.apartmentId || target.apartment))) continue;
      const contractId = String(
        target.gasPaymentCode ||
        portalFieldValue(contract, ['contractNumber', 'number', 'code', 'externalId', 'contractId']) ||
        '',
      ).trim();
      const invoiceIdCandidates = [
        ...portalFieldCandidates(contract, ['id', 'contractId', 'contractNumber', 'number', 'subscriptionId', 'externalId', 'code']),
        ...portalFieldCandidates(target, ['gasPaymentCode', 'gasAccountId']),
      ];
      if (!invoiceIdCandidates.length) continue;

      let invoiceResponse = null;
      let invoiceId = '';
      for (const candidate of invoiceIdCandidates) {
        invoiceId = candidate;
        invoiceResponse = await fetchPortalJson(
          page,
          `${GAS_API_BASE}/invoices/${encodeURIComponent(candidate)}${gasCaptchaToken ? `?g-recaptcha-response=${encodeURIComponent(gasCaptchaToken)}` : ''}`,
          { Authorization: authHeader },
        );
        if (invoiceResponse.status >= 200 && invoiceResponse.status < 300) break;
        if (![400, 404, 422].includes(Number(invoiceResponse.status))) break;
        console.warn(`[GAS] Identificador ${candidate} no fue aceptado para ${contractId || 'contrato'} (HTTP ${invoiceResponse.status}); probando el siguiente.`);
      }
      if (!invoiceResponse || invoiceResponse.status < 200 || invoiceResponse.status >= 300) {
        // A paid contract may have no active invoice resource. Keep it as a
        // confirmed zero rather than aborting the entire gas run.
        if ([404, 422].includes(Number(invoiceResponse?.status))) {
          const debtIdentifier = String(
            portalFieldValue(contract, ['id', 'contractId', 'contractNumber', 'number', 'externalId', 'code']) ||
            contractId || invoiceId || '',
          ).trim();
          const debtSummary = await fetchGasDebtSummary(page, debtIdentifier, authHeader).catch(() => ({}));
          const total = debtSummary.deudaTotalCOP ?? 0;
          const paidRecord = gasRecord({
            ...target,
            gasPaymentCode: String(contractId || invoiceId),
            gasPaymentUrl: gasContractPaymentUrl(contractId || invoiceId),
          }, {
            status: total > 0 ? 'pending' : 'paid',
            deudaCOP: total,
            deudaMesCOP: debtSummary.deudaMesCOP ?? 0,
            deudaTotalCOP: total,
            financiadaCOP: debtSummary.financiadaCOP ?? null,
            cuotaFinanciadaCOP: debtSummary.cuotaFinanciadaCOP ?? null,
            financiacion: debtSummary.financiacion || [],
            debtSource: debtSummary.debtSource || 'no_current_invoice',
            debtEndpointStatus: debtSummary.debtEndpointStatus ?? null,
            numFacturas: 0,
            factura: portalFieldValue(contract, ['invoiceNumber', 'invoiceId', 'factura']) || null,
            periodo: portalFieldValue(contract, ['expirationDate', 'dueDate', 'fechaVencimiento']) || null,
            error: null,
          });
          seenApartments.add(String(target.apartmentId || target.apartment));
          results.push(paidRecord);
          console.log(`[GAS] Portal global ${target.apartment}: ${paidRecord.status} (mes $0; total $${total.toLocaleString('es-CO')}; no current invoice).`);
          continue;
        }
        throw new Error(`Gases del Caribe rechazó el contrato ${contractId || invoiceId} (HTTP ${invoiceResponse?.status || 'sin respuesta'}).`);
      }
      const invoicePayload = parsePortalResponseBody(invoiceResponse.body);
      const invoices = unwrapPortalList(invoicePayload, ['invoices', 'items']);
      const summary = gasInvoiceSummary(invoices);
      const debtIdentifier = String(
        portalFieldValue(contract, ['id', 'contractId', 'contractNumber', 'number', 'externalId', 'code']) ||
        contractId || invoiceId || '',
      ).trim();
      const debtSummary = await fetchGasDebtSummary(page, debtIdentifier, authHeader).catch(error => ({
        debtSource: 'invoice_fallback',
        debtEndpointStatus: 0,
        error: error.message,
      }));
      const record = gasRecord({
        ...target,
        gasPaymentCode: String(contractId || invoiceId),
        gasPaymentUrl: gasContractPaymentUrl(contractId || invoiceId),
      }, {
        ...summary,
        ...debtSummary,
        error: null,
      });
      seenApartments.add(String(target.apartmentId || target.apartment));
      results.push(record);
      const amount = record.deudaCOP === null ? 'sin valor' : `$${record.deudaCOP.toLocaleString('es-CO')}`;
      const month = record.deudaMesCOP === null ? 'sin mes' : `$${record.deudaMesCOP.toLocaleString('es-CO')}`;
      const financed = record.financiadaCOP === null ? 'sin financiación' : `$${record.financiadaCOP.toLocaleString('es-CO')}`;
      console.log(`[GAS] Portal global ${target.apartment}: ${record.status} (mes ${month}; total ${amount}; financiada ${financed}; endpoint deuda HTTP ${record.debtEndpointStatus || 'no disponible'}).`);
    }

    if (results.length < Math.min(targets.length, contracts.length)) {
      logUnmatchedPortalItems('GAS', contracts.filter(contract =>
        !matchPortalApartmentForService(targets, contract, 'gas')
      ), 'gas');
    }
    if (!results.length) {
      lastGasScrapeError = 'Gases del Caribe autenticó el portal, pero no se pudo asociar ningún contrato con los apartamentos configurados.';
      console.warn('[GAS] Portal global no devolvió contratos asociables; no se usará ningún respaldo individual.');
    } else {
      console.log(`[GAS] Portal global: ${results.length} apartamento(s) con datos.`);
    }
    return results;
  } catch (error) {
    lastGasScrapeError = error.message;
    console.error('[GAS] Portal global error:', error.message);
    return [];
  } finally {
    if (dataPage && captureAuth) dataPage.off?.('request', captureAuth);
    if (dataPage && captureContracts) dataPage.off?.('response', captureContracts);
    if (dataPage && captureLoginResponse) dataPage.off?.('response', captureLoginResponse);
    if (dataPage) await closeWaterResource(dataPage);
    if (page && captureAuth) page.off?.('request', captureAuth);
    if (page && captureContracts) page.off?.('response', captureContracts);
    if (page && captureLoginResponse) page.off?.('response', captureLoginResponse);
    if (captchaSolver) await captchaSolver.close();
    if (browser) await closeWaterBrowser(browser);
  }
}

/* Individual gas-link fallback removed: the gas scraper is portal-only.
*/
// ── AIR-E SCRAPER ──────────────────────────────────────────────────────────
//
// New approach (2026): Air-e exposes an authenticated JSON API that returns
// every invoice for the whole contract in ONE call. This replaces the fragile
// per-NIC md-autocomplete scraping. Flow:
//
//  1. Log in with email + password (the portal no longer forces OTP).
//  2. Navigate to the "Listado de Facturas" page so the Angular module runs
//     `Documento/Get?cd_Contrato=...` and reveals the contract UUID.
//  3. Re-call the same internal API directly (page.fetch) with a large pageSize
//     so all invoices for all NICs arrive in a single response.
//  4. Group by NIC, keep only unpaid/partial entries, and read Deuda Total.
//
// `cd_Contrato` is a stable, per-account UUID. We read it from the page's own
// request instead of hardcoding it, so it survives account/contract changes.

const AIR_E_GET_ENDPOINT =
  'https://portal.air-e.com/DesktopModules/GatewayOficinaVirtual.Maestro.MisFacturas/API/Documento/Get';
const AIR_E_CONTRATO_RE = /cd_Contrato=([0-9A-Fa-f-]{36})/i;

async function contractFromAirEResources(page) {
  if (typeof page?.evaluate !== 'function') return null;
  return page.evaluate((pattern) => {
    for (const entry of performance.getEntriesByType('resource')) {
      const match = new RegExp(pattern, 'i').exec(entry.name || '');
      if (match?.[1]) return match[1];
    }
    return null;
  }, AIR_E_CONTRATO_RE.source).catch(() => null);
}

function parseAirEAmount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (value === null || value === undefined || value === '') return null;

  const text = String(value).trim();
  // API responses commonly use an integer string, but accept a conventional
  // decimal string before falling back to the Colombian currency parser.
  if (/^\d+(?:\.\d{1,2})?$/.test(text)) {
    const amount = Number(text);
    if (Number.isFinite(amount)) return Math.round(amount);
  }
  return parseCopAmount(text);
}

function aggregateAirEInvoices(items) {
  const grouped = {};

  for (const invoice of Array.isArray(items) ? items : []) {
    const nic = String(invoice?.cd_Poliza || '').trim();
    if (!nic) continue;

    const status = String(invoice.cd_EstadosPagoDocumento || 'PAGADO').toUpperCase();
    if (status === 'PAGADO' || status === 'PAGADA') continue;

    const group = grouped[nic] || { totalValues: [], balanceValues: [], monthRows: [], invoices: [] };
    const totalDebt = parseAirEAmount(
      invoice.amt_DeudaTotal ?? invoice.deudaTotal ?? invoice.DeudaTotal,
    );
    const balance = parseAirEAmount(
      invoice.amt_SaldoConsulta ?? invoice.saldoConsulta ?? invoice.SaldoConsulta,
    );

    const monthValue = parseAirEAmount(
      // “Total Mes” is the current-period amount shown on the Air-e receipt;
      // “Energía Mes” may omit the security/public-light charge.
      invoice.amt_TotalMes ?? invoice.totalMes ?? invoice.TotalMes ??
      invoice.amt_ValorMes ?? invoice.valorMes ?? invoice.ValorMes ??
      invoice.amt_TotalMesSinTasa ?? invoice.totalMesSinTasa ??
      invoice.amt_ValorFactura ?? invoice.valorFactura ?? invoice.ValorFactura ??
      invoice.amt_EnergiaMes ?? invoice.energiaMes ??
      invoice.amt_Valor ?? invoice.valor ?? invoice.Valor,
    );
    const financedValue = parseAirEAmount(
      invoice.amt_ValorFinanciado ?? invoice.valorFinanciado ?? invoice.saldoFinanciado ??
      invoice.deudaFinanciada ?? invoice.financedDebt ?? invoice.financingValue,
    );
    const quotaValue = parseAirEAmount(
      invoice.amt_ValorCuota ?? invoice.valorCuota ?? invoice.cuotaFinanciada ?? invoice.quotaValue,
    );
    if (totalDebt !== null) group.totalValues.push(totalDebt);
    else if (balance !== null) group.balanceValues.push(balance);
    group.monthRows.push({
      invoice,
      amount: monthValue,
      date: portalRecordDate(invoice),
      financed: financedValue,
      quota: quotaValue,
    });
    group.invoices.push(invoice);
    grouped[nic] = group;
  }

  return Object.fromEntries(Object.entries(grouped).map(([nic, group]) => {
    const hasTotalField = group.totalValues.length > 0;
    const debt = hasTotalField
      // Air-e returns one Deuda Total per unpaid invoice. Sum the rows so
      // overdue and partially paid periods are not hidden.
      ? group.totalValues.reduce((sum, amount) => sum + amount, 0)
      // Older responses may omit Deuda Total; sum the per-invoice balance as a
      // compatibility fallback so the apartment still gets a useful result.
      : group.balanceValues.reduce((sum, amount) => sum + amount, 0);
    const rows = [...group.monthRows].sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0));
    const latest = rows[0] || null;
    const latestPeriod = latest?.date ? `${latest.date.getUTCFullYear()}-${latest.date.getUTCMonth()}` : null;
    const currentRows = latestPeriod
      ? rows.filter(row => row.date && `${row.date.getUTCFullYear()}-${row.date.getUTCMonth()}` === latestPeriod)
      : rows.slice(0, 1);
    const monthlyRows = currentRows.length ? currentRows : rows.slice(0, 1);
    const monthValues = monthlyRows.map(row => row.amount).filter(value => value !== null);
    const financedValues = rows.map(row => row.financed).filter(value => value !== null);
    const quotaValues = rows.map(row => row.quota).filter(value => value !== null);
    const financingPayload = portalFinancingSummary(group.invoices);
    const factura = portalFieldValue(latest?.invoice, ['invoiceNumber', 'invoiceId', 'factura', 'id']) || null;
    return [nic, {
      debt,
      source: hasTotalField ? 'Deuda Total' : 'SaldoConsulta',
      deudaMesCOP: monthValues.length ? monthValues.reduce((sum, amount) => sum + amount, 0) : null,
      deudaTotalCOP: debt,
      numFacturas: group.invoices.length,
      factura,
      periodo: portalFieldValue(latest?.invoice, ['invoiceDate', 'billingPeriod', 'periodo', 'fechaFactura']) || null,
      // Air-e's Estado de Cuenta is accumulated debt, not a convenio. Only
      // explicit financing fields belong in this column.
      financiadaCOP: financedValues.length ? Math.max(...financedValues) : (financingPayload.financiadaCOP ?? 0),
      cuotaFinanciadaCOP: quotaValues.length ? Math.max(...quotaValues) : financingPayload.cuotaFinanciadaCOP,
      financiacion: financingPayload.financiacion,
    }];
  }));
}

async function scrapeAirE() {
  const results = [];
  let browser;
  let captchaSolver;

  try {
    lastScrapeError = null;
    const useFullChrome = FULL_CHROME_ENABLED;
    const browserless = browserlessEndpointCandidates('air-e').length > 0;
    const runtime = browserless
      ? 'Browserless remoto'
      : useFullChrome ? 'full Chrome + Xvfb' : 'serverless Chromium';
    console.log(`[AIR-E] Launching browser (${runtime})...`);
    const creds = getAirECredentials();
    // Air-e serves an incomplete login shell to headless Chromium on Render.
    // The Docker deployment provides a real Chrome display through Xvfb, so
    // use it there while retaining the lightweight local fallback on Windows.
    browser = await launchBrowser('air-e', useFullChrome);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    captchaSolver = await attachBrowserlessCaptchaSolver(page, 'Air-e');

    // 1. Login (no OTP on the portal anymore).
    console.log('[AIR-E] Navigating to login...');
    await gotoPortalPage(page, AIR_E_URLS.login, { waitUntil: 'domcontentloaded', timeout: 60000 }, 'Air-e');

    const edgeBlocked = await page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
      return /(?:service unavailable|the request is blocked|request is blocked)/i.test(text);
    }).catch(() => false);
    if (edgeBlocked) {
      const msg = browserless
        ? 'Air-e bloqueó también la sesión de Browserless antes del login.'
        : 'Air-e bloqueó la IP de Render antes del login (Azure Front Door). Se requiere Browserless o un egreso autorizado.';
      lastScrapeError = msg;
      console.error('[AIR-E]', msg);
      return [];
    }

    await waitAndType(page, 'input[id="dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_txtUsername"], input[name*="txtUsername"], input[name="email"]', creds.email);
    await waitAndType(page, 'input[id="dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_txtPassword"], input[name*="txtPassword"], input[name="password"]', creds.password);

    // Capture the cd_Contrato from the first Document/Get call the page fires
    // after login. This is the current account's contract UUID.
    let cdContrato = null;
    const onResponse = (resp) => {
      if (cdContrato) return;
      const match = AIR_E_CONTRATO_RE.exec(resp.url());
      if (match) cdContrato = match[1];
    };
    page.on('response', onResponse);

    const loginBtn =
      (await page.$('[id="dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayProvider_cmdLogin"]')) ||
      (await page.$('[id="dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_cmdLogin"]')) ||
      (await page.$('button::-p-text("Ingresar")'));
    if (loginBtn) await loginBtn.click();
    await sleep(3000);

    // Detect OTP/captcha challenges that block fully-automated scraping and
    // surface a clear message instead of failing silently.
    const blocked = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const visible = element => {
        if (!element || element.getAttribute('aria-hidden') === 'true') return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          style.opacity !== '0' && !!element.getClientRects().length;
      };
      const otpInput = [...document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="Code" i], input[maxlength="6"]'
      )].find(visible);
      return {
        hasOtpInput: !!otpInput,
        looksBlocked: /c[oó]digo\s+de\s+verificaci[oó]n|captcha|verificaci[oó]n\s+en\s+dos\s+pasos/i.test(bodyText.slice(0, 3000)),
      };
    }).catch(() => ({ hasOtpInput: false, looksBlocked: false }));
    if (blocked.hasOtpInput || blocked.looksBlocked) {
      const msg = 'Air-e pide un código OTP o captcha. El scrape automático no puede completar el login; ingresa manualmente desde "Portal Energía".';
      lastScrapeError = msg;
      console.error('[AIR-E] Login blocked:', msg);
      return [];
    }

    let currentUrl = page.url();
    console.log('[AIR-E] Current URL:', currentUrl);

    // 2. Land on the listado so the Angular module issues Document/Get.
    // The login redirect can already leave us on Mis-Facturas before the
    // response listener is attached. Reload the module whenever the contract
    // was not captured during login so the request is observable.
    if (!cdContrato) {
      await gotoPortalPage(page, AIR_E_URLS.listado, { waitUntil: 'domcontentloaded', timeout: 30000 }, 'Air-e');
      await sleep(2500);
      console.log('[AIR-E] Current URL after loading invoices:', page.url());
    }

    // Give the module a moment to fire the request if the same page was reused.
    const listenStart = Date.now();
    while (!cdContrato && Date.now() - listenStart < 30000) {
      cdContrato = await contractFromAirEResources(page);
      if (cdContrato) break;
      await sleep(500);
    }
    page.off('response', onResponse);

    if (!cdContrato) {
      const msg = 'No se pudo resolver el contrato (cd_Contrato) del portal Air-e tras el login.';
      lastScrapeError = msg;
      console.error('[AIR-E]', msg);
      return [];
    }

    // 3. Pull the account data for all NICs in one call. The response contains
    // Deuda Total per invoice/NIC; the aggregation below uses that field as
    // the authoritative value and only falls back to SaldoConsulta when the
    // portal omits it.
    const invoices = await page.evaluate(async (endpoint, contrato) => {
      const url = `${endpoint}?cd_Contrato=${encodeURIComponent(contrato)}&pageIndex=1&pageSize=1000`;
      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = await res.json();
      return { ok: true, items: json.items || [] };
    }, AIR_E_GET_ENDPOINT, cdContrato);

    if (!invoices.ok) {
      const msg = `El portal Air-e rechazó la consulta de facturas (HTTP ${invoices.status}).`;
      lastScrapeError = msg;
      console.error('[AIR-E]', msg);
      return [];
    }
    console.log('[AIR-E] Deuda Total recibida para todos los NIC en una sola consulta.');

    const byNic = aggregateAirEInvoices(invoices.items);
    const targets = configuredAirETargets();
    console.log(`[AIR-E] NIC configurados en Laujim: ${targets.length}.`);

    // 4. Emit one record per NIC configured in the apartments collection.
    // This means a newly associated apartment is picked up without a code
    // change or a redeploy.
    for (const target of targets) {
      const nic = target.nic;
      const aptoName = target.apartment;
      const agg = byNic[nic] || { debt: 0, source: 'Deuda Total', deudaMesCOP: 0, deudaTotalCOP: 0, numFacturas: 0, financiadaCOP: null, cuotaFinanciadaCOP: null, financiacion: [] };
      const debtText = agg.debt > 0
        ? `Deuda Total del NIC: $${agg.debt.toLocaleString('es-CO')}.`
        : 'Deuda Total del NIC: $0 (al día).';
      const month = agg.deudaMesCOP === null ? 'sin mes' : `$${agg.deudaMesCOP.toLocaleString('es-CO')}`;
      const financed = agg.financiadaCOP === null ? 'sin financiación' : `$${agg.financiadaCOP.toLocaleString('es-CO')}`;
      console.log(`[AIR-E]   NIC ${nic} → ${aptoName}: mes ${month}; total $${agg.debt.toLocaleString('es-CO')}; financiada ${financed} [${agg.source}]`);

      results.push({
        provider: 'Air-e',
        apartmentId: target.apartmentId || null,
        nic,
        apartment: aptoName,
        deudaCOP: agg.debt,
        deudaMesCOP: agg.deudaMesCOP,
        deudaConveniosCOP: agg.financiadaCOP ?? 0,
        deudaTotalCOP: agg.deudaTotalCOP ?? agg.debt,
        deudaLabel: 'Deuda Total',
        status: (agg.deudaTotalCOP ?? agg.debt) > 0 ? 'pending' : 'paid',
        numFacturas: agg.numFacturas,
        factura: agg.factura || null,
        periodo: agg.periodo || null,
        financiadaCOP: agg.financiadaCOP,
        cuotaFinanciadaCOP: agg.cuotaFinanciadaCOP,
        financiacion: agg.financiacion || [],
        debtSource: 'invoice_fields',
        deudaText: debtText,
        scrapedAt: new Date().toISOString(),
      });
    }

  } catch (e) {
    lastScrapeError = e.message;
    console.error('[AIR-E] SCRAPER ERROR:', e.message);
  } finally {
    if (captchaSolver) await captchaSolver.close();
    if (browser) {
      await browser.close().catch(() => {});
      console.log('[AIR-E] Browser closed.');
    }
  }

  return results;
}

// ── SCHEDULER ──────────────────────────────────────────────────────────────

let cronJob = null;
let waterCronJob = null;
let bootTimer = null;
let waterBootTimer = null;
let airEScrapePromise = null;
let waterScrapePromise = null;
let gasScrapePromise = null;
let serviceBrowserQueue = Promise.resolve();

// All providers share the same limited browser/runtime budget. A single
// queue avoids the mutual-wait deadlock that could occur when Render's
// scheduler and a portable worker started different providers together.
function enqueueServiceBrowserRun(task) {
  const previous = serviceBrowserQueue;
  let release;
  serviceBrowserQueue = new Promise(resolve => { release = resolve; });
  return previous.catch(() => {}).then(task).finally(() => release());
}

function runScrapeOnce(reason) {
  if (airEScrapePromise) {
    console.log('[SERVICES] Air-e scrape already running; skipping overlapping run.');
    return airEScrapePromise;
  }
  airEScrapePromise = enqueueServiceBrowserRun(async () => {
    console.log(`[SERVICES] Running Air-e scrape (${reason})...`);
    try {
      let results = await scrapeAirE();
      if (!results.length && isTransientPortalRunError(lastScrapeError)) {
        console.warn('[SERVICES] Air-e tuvo un error transitorio de navegador; reintentando el portal una vez.');
        await sleep(PORTAL_DATA_RETRY_DELAY_MS);
        results = await scrapeAirE();
      }
      if (db && saveData && results.length) persistResults(results);
      return results;
    } catch (e) {
      console.error('[SERVICES] Air-e scrape error:', e.message);
      return [];
    } finally {
      airEScrapePromise = null;
    }
  });
  return airEScrapePromise;
}

function persistWaterResults(results) {
  if (!db || !results?.length) return;
  if (!Array.isArray(db.utilityRecords)) db.utilityRecords = [];

  for (const result of results) {
    const idx = db.utilityRecords.findIndex(record =>
      record.provider === 'Triple A' && record.service === 'water' &&
      (Number(record.apartmentId) === Number(result.apartmentId) || record.apartment === result.apartment)
    );
    if (idx >= 0) db.utilityRecords[idx] = { ...db.utilityRecords[idx], ...result };
    else db.utilityRecords.push(result);
  }
  saveData?.();
  console.log(`[SERVICES] Persisted ${results.length} Triple A water record(s).`);
}

function serviceResultMatchesApartment(result, apartment) {
  return (result?.apartmentId !== null && result?.apartmentId !== undefined &&
    apartment?.id !== null && apartment?.id !== undefined &&
    Number(result.apartmentId) === Number(apartment.id)) ||
    String(result?.apartment || '').trim() === String(apartment?.name || '').trim();
}

function portalFailureResult(service, target, message, checkedAt = new Date().toISOString()) {
  const provider = service === 'water' ? 'Triple A' : 'Gases del Caribe';
  const status = /captcha|turnstile|verificaci[oó]n/i.test(String(message || ''))
    ? 'captcha'
    : /timeout|agot[oó]|tard[oó]/i.test(String(message || '')) ? 'timeout' : 'error';
  const result = {
    provider,
    service,
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    status,
    deudaCOP: null,
    deudaTotalCOP: null,
    deudaLabel: 'Deuda Total',
    numFacturas: null,
    error: String(message || `Portal global de ${provider} no devolvió datos.`),
    checkedAt,
    scrapedAt: checkedAt,
  };
  if (service === 'water') {
    result.waterPaymentUrl = target.waterPaymentUrl || null;
    result.waterPaymentCode = target.waterPaymentCode || null;
  } else {
    result.gasPaymentCode = target.gasPaymentCode || null;
    result.gasPaymentUrl = gasContractPaymentUrl(target.gasPaymentCode);
  }
  return result;
}

function completePortalResults(service, globalResults, runError) {
  const provider = service === 'water' ? 'Triple A' : 'Gases del Caribe';
  const targets = configuredApartmentTargets();
  const results = Array.isArray(globalResults) ? [...globalResults] : [];
  const missing = targets.filter(target => !results.some(result => serviceResultMatchesApartment(result, target)));
  for (const target of missing) {
    const message = results.length
      ? `El portal global de ${provider} no devolvió datos para el apartamento ${target.apartment} en esta consulta.`
      : (runError || `El portal global de ${provider} no devolvió datos en esta consulta.`);
    if (service === 'gas' && results.length > 0) {
      results.push({
        ...portalFailureResult(service, target, message),
        status: 'paid',
        deudaCOP: 0,
        deudaTotalCOP: 0,
        numFacturas: 0,
        portalNoInvoice: true,
        error: null,
      });
    } else {
      results.push(portalFailureResult(service, target, message));
    }
  }
  if (targets.length) {
    const successCount = results.filter(result => !['error', 'timeout', 'captcha'].includes(result.status)).length;
    console.log(`[${provider}] Resultado portal-only: ${successCount}/${targets.length} apartamento(s) con datos confirmados; ${missing.length} sin datos en esta ejecución.`);
  }
  return results;
}

function isTransientPortalRunError(message) {
  return /target closed|connection closed|detached frame|execution context|failed to fetch|protocol error/i.test(
    String(message || ''),
  );
}

function runWaterScrapeOnce(reason) {
  if (waterScrapePromise) {
    console.log('[SERVICES] Triple A water scrape already running; skipping overlapping run.');
    return waterScrapePromise;
  }
  waterScrapePromise = enqueueServiceBrowserRun(async () => {
    console.log(`[SERVICES] Running Triple A water scrape (${reason})...`);
    try {
      let globalResults = await scrapeTripleAAccount();
      if (!globalResults.length && isTransientPortalRunError(lastWaterScrapeError)) {
        console.warn('[SERVICES] Triple A tuvo un error transitorio de navegador; reintentando el portal una vez.');
        await sleep(PORTAL_DATA_RETRY_DELAY_MS);
        globalResults = await scrapeTripleAAccount();
      }
      // Portal-only by design: every configured apartment must come from the
      // authenticated global account. Missing records are persisted as errors
      // for this run so a previous QR amount cannot look current.
      const results = completePortalResults('water', globalResults, lastWaterScrapeError);
      if (db && saveData && results.length) persistWaterResults(results);
      return results;
    } catch (e) {
      console.error('[SERVICES] Triple A water scrape error:', e.message);
      return [];
    } finally {
      waterScrapePromise = null;
    }
  });
  return waterScrapePromise;
}

function persistGasResults(results) {
  if (!db || !results?.length) return;
  if (!Array.isArray(db.utilityRecords)) db.utilityRecords = [];

  for (const result of results) {
    const idx = db.utilityRecords.findIndex(record =>
      record.provider === 'Gases del Caribe' && record.service === 'gas' &&
      (Number(record.apartmentId) === Number(result.apartmentId) || record.apartment === result.apartment)
    );
    if (idx >= 0) db.utilityRecords[idx] = { ...db.utilityRecords[idx], ...result };
    else db.utilityRecords.push(result);
  }
  saveData?.();
  console.log(`[SERVICES] Persisted ${results.length} Gases del Caribe record(s).`);
}

function runGasScrapeOnce(reason) {
  if (gasScrapePromise) {
    console.log('[SERVICES] Gases del Caribe scrape already running; skipping overlapping run.');
    return gasScrapePromise;
  }
  gasScrapePromise = enqueueServiceBrowserRun(async () => {
    console.log(`[SERVICES] Running Gases del Caribe scrape (${reason})...`);
    try {
      let globalResults = await scrapeGasAccount();
      if (!globalResults.length && isTransientPortalRunError(lastGasScrapeError)) {
        console.warn('[SERVICES] Gases del Caribe tuvo un error transitorio de navegador; reintentando el portal una vez.');
        await sleep(PORTAL_DATA_RETRY_DELAY_MS);
        globalResults = await scrapeGasAccount();
      }
      // Portal-only by design: do not consult public payment links when an
      // account is absent or a contract cannot be matched.
      const results = completePortalResults('gas', globalResults, lastGasScrapeError);
      if (db && saveData && results.length) persistGasResults(results);
      return results;
    } catch (error) {
      console.error('[SERVICES] Gases del Caribe scrape error:', error.message);
      return [];
    } finally {
      gasScrapePromise = null;
    }
  });
  return gasScrapePromise;
}

function startScheduler() {
  if (cronJob || waterCronJob) return;
  const intervalHours = Math.max(1, Math.floor(Number(process.env.SERVICES_SCRAPE_INTERVAL_HOURS || 12)));
  const timezone = process.env.SERVICES_TIMEZONE || 'America/Bogota';
  console.log(`[SERVICES] Starting scheduler (Air-e, Triple A y Gases del Caribe cada ${intervalHours}h; timezone ${timezone})...`);

  // Scrape shortly after boot so every deploy refreshes the debt data even
  // though Render free instances sleep between requests (cron alone would
  // never fire while the instance is asleep). Start Air-e first because it
  // uses one authenticated browser; Triple A then runs behind the shared
  // browser lock and cannot compete for the free instance's memory.
  bootTimer = setTimeout(() => runScrapeOnce('boot')
    .then(() => runWaterScrapeOnce('boot'))
    .then(() => runGasScrapeOnce('boot'))
    .catch(error => console.error('[SERVICES] boot scrape error:', error.message)), 60 * 1000);
  if (bootTimer.unref) bootTimer.unref();

  // Run providers serially. One cron callback avoids the deadlock that occurs
  // when Air-e waits for water while water waits for Air-e.
  cronJob = cron.schedule(`0 */${intervalHours} * * *`, () => runScrapeOnce('schedule')
    .then(() => runWaterScrapeOnce('schedule'))
    .then(() => runGasScrapeOnce('schedule'))
    .catch(error => console.error('[SERVICES] scheduled scrape error:', error.message)), { timezone });
}

function stopScheduler() {
  cronJob?.stop();
  waterCronJob?.stop();
  cronJob = null;
  waterCronJob = null;
  if (bootTimer) clearTimeout(bootTimer);
  if (waterBootTimer) clearTimeout(waterBootTimer);
  bootTimer = null;
  waterBootTimer = null;
}

function persistResults(results) {
  if (!db) return;
  if (!db.utilityRecords) db.utilityRecords = [];

  for (const r of results) {
    // Keep one current-debt record per apartment. A shared NIC is expected to
    // appear more than once when it belongs to multiple apartments.
    r.provider = 'Air-e';
    const idx = db.utilityRecords.findIndex(
      (u) => {
        if (u.provider !== 'Air-e') return false;
        const sameApartmentId = r.apartmentId !== null && r.apartmentId !== undefined &&
          u.apartmentId !== null && u.apartmentId !== undefined &&
          Number(u.apartmentId) === Number(r.apartmentId);
        const sameApartmentName = String(r.apartment || '').trim() &&
          String(u.apartment || '').trim() === String(r.apartment || '').trim();
        if (sameApartmentId || sameApartmentName) return true;
        // Legacy records without apartment identity can still be refreshed by
        // NIC, but never use NIC as the key when either record has an apartment.
        return !r.apartmentId && !r.apartment && !u.apartmentId && !u.apartment &&
          u.nic === r.nic;
      }
    );
    if (idx >= 0) {
      db.utilityRecords[idx] = { ...db.utilityRecords[idx], ...r };
    } else {
      db.utilityRecords.push(r);
    }
  }
  saveData();
  console.log(`[SERVICES] Persisted ${results.length} Air-e records.`);
}

// ── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  launchLocalBrowser,
  scrapeAirE,
  scrapeTripleAAccount,
  scrapeGasAccount,
  parseCopAmount,
  extractWaterAmount,
  extractGasAmount,
  aggregateAirEInvoices,
  gasInvoiceSummary,
  tripleAInvoiceSummary,
  portalFinancingSummary,
  parseWaterBillPage,
  parseGasBillPage,
  persistWaterResults,
  persistGasResults,
  runScrapeOnce,
  runWaterScrapeOnce,
  runGasScrapeOnce,
  startScheduler,
  stopScheduler,
  AIR_E_NIC_MAP,
  WATER_SCRAPE_CRON,
  getLastScrapeError,
  getLastWaterScrapeError,
  getLastGasScrapeError,
};
