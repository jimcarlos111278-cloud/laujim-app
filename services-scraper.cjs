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
const BROWSERLESS_TOKEN = String(process.env.BROWSERLESS_TOKEN || '').trim();
const BROWSERLESS_WS_ENDPOINT = String(process.env.BROWSERLESS_WS_ENDPOINT || '').trim();
const BROWSERLESS_REGION = String(process.env.BROWSERLESS_REGION || 'production-sfo').trim();
const BROWSERLESS_PROFILES = String(process.env.BROWSERLESS_PROFILES || 'air-e,water,gas')
  .split(',')
  .map((profile) => profile.trim().toLowerCase())
  .filter(Boolean);
const BROWSERLESS_SOLVE_CAPTCHAS = /^(1|true|yes)$/i.test(
  process.env.BROWSERLESS_SOLVE_CAPTCHAS || '',
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const seen = new Set();
  const ordered = [...(apartments || [])].sort((left, right) => {
    const leftConfigured = left?.status === 'occupied' ? 0 : 1;
    const rightConfigured = right?.status === 'occupied' ? 0 : 1;
    return leftConfigured - rightConfigured || String(left?.name || '').localeCompare(String(right?.name || ''), 'es', { numeric: true });
  });

  for (const apartment of ordered) {
    const nic = String(apartment?.electricityPaymentCode || apartment?.nic || '').replace(/\D/g, '');
    if (!nic || seen.has(nic)) continue;
    seen.add(nic);
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

function browserlessEndpointFor(profileName) {
  const profile = String(profileName || '').trim().toLowerCase();
  if (!BROWSERLESS_PROFILES.includes(profile)) return null;
  if (!BROWSERLESS_TOKEN && !BROWSERLESS_WS_ENDPOINT) return null;

  try {
    const endpoint = new URL(BROWSERLESS_WS_ENDPOINT || `wss://${BROWSERLESS_REGION}.browserless.io`);
    if (BROWSERLESS_TOKEN && !endpoint.searchParams.has('token')) {
      endpoint.searchParams.set('token', BROWSERLESS_TOKEN);
    }
    if (/^(1|true|yes)$/i.test(process.env.BROWSERLESS_STEALTH || '')) {
      endpoint.searchParams.set('stealth', 'true');
    }
    if (BROWSERLESS_SOLVE_CAPTCHAS) {
      endpoint.searchParams.set('solveCaptchas', 'true');
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

async function launchBrowser(profileName = 'services', useFullChrome = FULL_CHROME_ENABLED) {
  const browserlessEndpoint = browserlessEndpointFor(profileName);
  if (browserlessEndpoint) {
    console.log(`[BROWSERLESS] Connecting remote browser for ${profileName}...`);
    try {
      return await puppeteer.connect({
        browserWSEndpoint: browserlessEndpoint,
        protocolTimeout: 60000,
      });
    } catch (error) {
      // Keep the local Render browser as a safe fallback if Browserless is unavailable.
      console.error('[BROWSERLESS] Connection failed; falling back to local browser:', error.message);
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

// ── HELPERS ─────────────────────────────────────────────────────────────────

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

async function visibleHandle(page, selectors, timeout = 15000) {
  const list = Array.isArray(selectors) ? selectors : [selectors];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of list) {
      const handles = await page.$$(selector).catch(() => []);
      for (const handle of handles) {
        const box = await handle.boundingBox().catch(() => null);
        if (box && box.width > 0 && box.height > 0) return handle;
        try { await handle.dispose(); } catch {}
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
  await handle.click({ clickCount: 3 });
  await handle.type(String(value ?? ''), { delay: 35 });
  return handle;
}

async function clickVisibleButton(page, selectors, timeout = 20000) {
  const handle = await visibleHandle(page, selectors, timeout);
  if (!handle) return false;
  await handle.click();
  return true;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function apartmentNumberFrom(value) {
  const match = String(value || '').match(/\b([1-9]\d{2})\b/);
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
      gasPaymentUrl: apartment.gasPaymentUrl || null,
      gasPaymentCode: apartment.gasPaymentCode || null,
    }));
}

function matchPortalApartment(targets, identifiers = []) {
  const values = (Array.isArray(identifiers) ? identifiers : [identifiers])
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const digitValues = values.map(normalizeDigits).filter(Boolean);
  const apartmentNumber = values.map(apartmentNumberFrom).find(Boolean) || null;

  return (targets || []).find(target => {
    const targetCode = normalizeDigits(target.waterPaymentCode || target.gasPaymentCode);
    const targetNumber = target.apartmentNumber || apartmentNumberFrom(target.apartment);
    return (targetCode && digitValues.includes(targetCode)) ||
      (apartmentNumber && targetNumber === apartmentNumber);
  }) || null;
}

// ── TRIPLE A WATER BILL SCRAPER ─────────────────────────────────────────────
//
// The URL saved from the apartment's QR code is treated as a read-only page.
// We never click a payment action and we do not submit credentials.  Triple A
// has used more than one page layout, so the parser deliberately relies on
// visible text and labels instead of brittle CSS selectors.

// Give each QR page up to three minutes to render the debt. A fresh page is
// opened once when that attempt returns no usable value. Turnstile is handled
// differently: it is detected quickly and the page can be reopened up to four
// total attempts in case the challenge was only transient.
const WATER_TIMEOUT_MS = 180000;
const WATER_MAX_ATTEMPTS = 2;
const WATER_CAPTCHA_MAX_ATTEMPTS = 4;
const WATER_TURNSTILE_WAIT_MS = BROWSERLESS_SOLVE_CAPTCHAS ? 30000 : 20000;
const WATER_POLL_INTERVAL_MS = 2000;
const WATER_RESPONSE_TIMEOUT_MS = 5000;
const WATER_CLOSE_TIMEOUT_MS = 10000;
// Browserless/Chromium can close the shared session when one long-running QR
// page exhausts its deadline. Serializing the pages keeps one timeout from
// turning the remaining apartments into "Connection closed" records.
const WATER_WORKERS = 1;
const WATER_SCRAPE_CRON = '0 */12 * * *';
const WATER_CAPTCHA_ERROR = 'Triple A exige completar la verificación de Cloudflare Turnstile. El valor no se puede consultar automáticamente desde Render; abre el enlace en un navegador y completa la verificación manual.';

// Gases del Caribe uses the same kind of direct payment/consultation links
// saved from the apartment QR. Keep the gas flow independent from Triple A so
// one provider's Turnstile does not erase the results of the others.
const GAS_TIMEOUT_MS = 180000;
const GAS_MAX_ATTEMPTS = 2;
const GAS_CAPTCHA_MAX_ATTEMPTS = 4;
const GAS_POLL_INTERVAL_MS = 2000;
const GAS_RESPONSE_TIMEOUT_MS = 5000;
// Use the same isolation rule for the gas portal: one slow/blocked contract
// must not terminate the session used by the remaining contracts.
const GAS_WORKERS = 1;
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

function waterTarget(apartment) {
  const url = String(apartment?.waterPaymentUrl || '').trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return { apartmentId: apartment.id, apartment: apartment.name, waterPaymentUrl: url, waterPaymentCode: apartment.waterPaymentCode || null };
}

function waterRecord(target, parsed, checkedAt = new Date().toISOString()) {
  return {
    provider: 'Triple A',
    service: 'water',
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    waterPaymentUrl: target.waterPaymentUrl,
    waterPaymentCode: target.waterPaymentCode,
    status: parsed.status,
    deudaCOP: parsed.deudaCOP,
    deudaTotalCOP: parsed.deudaCOP,
    deudaLabel: 'Deuda Total',
    numFacturas: parsed.numFacturas ?? (parsed.status === 'pending' ? 1 : 0),
    factura: parsed.factura || null,
    periodo: parsed.periodo || null,
    error: parsed.error || null,
    checkedAt,
    scrapedAt: checkedAt,
  };
}

function waterNavigationError(target, error, checkedAt = new Date().toISOString()) {
  const message = String(error?.message || error || 'Error desconocido al consultar Triple A');
  const status = /timeout|timed out|tard[oó].*demasiado/i.test(message) ? 'timeout' : 'error';
  return waterRecord(target, { status, deudaCOP: null, error: message }, checkedAt);
}

async function readWaterFrameText(frame) {
  try {
    return await frame.evaluate(() => {
      const roots = [document];
      for (let index = 0; index < roots.length; index++) {
        const root = roots[index];
        for (const element of root.querySelectorAll?.('*') || []) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
        }
      }
      const values = [];
      for (const root of roots) {
        values.push(root.body?.innerText || root.documentElement?.innerText || '');
        for (const element of root.querySelectorAll?.('input:not([type="password"]), textarea, select, [aria-label], [title]') || []) {
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || !element.getClientRects().length) continue;
          values.push(element.getAttribute('aria-label'), element.getAttribute('title'));
          if ('value' in element) values.push(element.value);
        }
      }
      return [...new Set(values.filter(Boolean))].join(' ').trim();
    });
  } catch {
    return '';
  }
}

function waterResultReady(parsed) {
  return parsed.status === 'paid' ||
    parsed.status === 'captcha' ||
    parsed.status === 'error' ||
    (parsed.status === 'pending' && parsed.deudaCOP !== null);
}

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

async function submitWaterQueryIfReady(page, state) {
  if (!state || state.hasBillingResult) return { submitted: false, captcha: false };
  if ((state.hasTurnstile || state.hasCaptchaText) && !state.turnstileToken) {
    return { submitted: false, captcha: true, error: WATER_CAPTCHA_ERROR };
  }
  if (!state.hasSubmit || !state.hasPaymentNumber || state.submitDisabled || typeof page?.evaluate !== 'function') {
    return { submitted: false, captcha: false };
  }

  try {
    const submitted = await page.evaluate(() => {
      const submit = document.querySelector('form button[type="submit"], button[type="submit"]');
      if (!submit || submit.disabled) return false;
      submit.click();
      return true;
    });
    return { submitted: Boolean(submitted), captcha: false };
  } catch {
    return { submitted: false, captcha: false };
  }
}

async function waitForWaterTurnstile(page, deadline) {
  let state = await inspectWaterPage(page);
  const browserlessSolvePending = BROWSERLESS_SOLVE_CAPTCHAS && state &&
    state.hasTurnstile && !state.turnstileToken && !state.hasBillingResult;
  const invisibleTurnstilePending = state && state.hasTurnstile &&
    !state.turnstileToken && !state.hasBillingResult && !state.hasCaptchaText;
  if (!invisibleTurnstilePending && !browserlessSolvePending) return state;

  const turnstileDeadline = Math.min(deadline, Date.now() + WATER_TURNSTILE_WAIT_MS);
  while (Date.now() < turnstileDeadline) {
    await sleep(Math.min(WATER_POLL_INTERVAL_MS, turnstileDeadline - Date.now()));
    state = await inspectWaterPage(page);
    if (!state || state.turnstileToken || state.hasBillingResult) return state;
    if (!browserlessSolvePending && state.hasCaptchaText) return state;
  }
  return state;
}

async function closeWaterResource(resource) {
  if (!resource || typeof resource.close !== 'function') return;
  let closed = false;
  const closePromise = Promise.resolve()
    .then(() => resource.close())
    .then(() => { closed = true; })
    .catch(() => {});
  await Promise.race([closePromise, sleep(WATER_CLOSE_TIMEOUT_MS)]);
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

function parsePortalAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (value === null || value === undefined || value === '') return null;
  return parseCopAmount(value);
}

function unwrapPortalList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (payload?.data && typeof payload.data === 'object') {
    if (Array.isArray(payload.data)) return payload.data;
    for (const key of keys) {
      if (Array.isArray(payload.data?.[key])) return payload.data[key];
    }
  }
  return [];
}

async function responseTextWithTimeout(response, timeout = WATER_RESPONSE_TIMEOUT_MS) {
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

function tripleAStatusValue(subscription) {
  const raw = subscription?.status;
  if (raw && typeof raw === 'object') {
    return String(raw.value || raw.code || raw.name || raw.status || raw.label || '').toLowerCase();
  }
  return String(raw || '').toLowerCase();
}

function tripleARecord(target, subscription, checkedAt = new Date().toISOString()) {
  const statusValue = tripleAStatusValue(subscription);
  const amount = parsePortalAmount(
    subscription?.pendingValue ?? subscription?.debt ?? subscription?.deudaTotal ?? subscription?.amountDue,
  );
  const debtState = /pending|in_debt|expired|overdue|mora/.test(statusValue);
  const paidState = /paid|al_day|up_to_date|sin_deuda/.test(statusValue);
  const deudaCOP = amount === null ? (debtState ? null : 0) : Math.max(0, amount);
  const status = deudaCOP > 0 || (deudaCOP === null && debtState)
    ? 'pending'
    : paidState || deudaCOP === 0 ? 'paid' : 'unknown';
  const subscriptionCode = subscription?.subscriptionExternalId ||
    subscription?.externalId || subscription?.subscriptionId || subscription?.id || null;

  return {
    provider: 'Triple A',
    service: 'water',
    apartmentId: target.apartmentId,
    apartment: target.apartment,
    waterPaymentUrl: target.waterPaymentUrl || TRIPLE_A_URLS.policies,
    waterPaymentCode: String(subscriptionCode || target.waterPaymentCode || '').trim() || null,
    status,
    deudaCOP,
    deudaTotalCOP: deudaCOP,
    deudaLabel: 'Deuda Total',
    numFacturas: null,
    factura: subscription?.invoiceNumber || null,
    periodo: subscription?.invoiceDate || null,
    error: null,
    checkedAt,
    scrapedAt: checkedAt,
  };
}

async function scrapeTripleAAccount() {
  let browser;
  let page;
  let subscriptionPayload = null;
  let captureSubscriptions;
  try {
    lastWaterScrapeError = null;
    const credentials = getPortalCredentials('triple-a');
    const browserless = Boolean(browserlessEndpointFor('water'));
    console.log(`[TRIPLE A] Portal global: iniciando sesión (${browserless ? 'Browserless remoto' : 'Chromium local'}).`);
    browser = await launchBrowser('water');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);

    captureSubscriptions = response => {
      if (!/\/bff\/subscriptions(?:[/?#]|$)/i.test(response.url())) return;
      responseTextWithTimeout(response, WATER_RESPONSE_TIMEOUT_MS)
        .then(body => {
          const parsed = parsePortalResponseBody(body);
          if (parsed) subscriptionPayload = parsed;
        })
        .catch(() => {});
    };
    page.on?.('response', captureSubscriptions);

    await page.goto(TRIPLE_A_URLS.login, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    });

    const emailField = await visibleHandle(page, 'input[name="email"]', 8000);
    const passwordField = await visibleHandle(page, 'input[name="password"]', 8000);
    if (emailField && passwordField) {
      try { await emailField.dispose(); } catch {}
      try { await passwordField.dispose(); } catch {}
      await typeVisibleField(page, 'input[name="email"]', credentials.username, 5000);
      await typeVisibleField(page, 'input[name="password"]', credentials.password, 5000);
      const challenge = await waitForPortalTurnstile(page, 30000);
      if (challenge?.hasTurnstile && !challenge.turnstileToken) {
        throw new Error('Triple A mantiene Turnstile visible después de esperar a Browserless.');
      }
      const clicked = await clickVisibleButton(page, 'button[type="submit"]', 10000);
      if (!clicked) throw new Error('No se encontró el botón de inicio de sesión de Triple A.');
      await sleep(5000);
    } else {
      console.log('[TRIPLE A] La sesión ya estaba autenticada; se reutiliza el portal global.');
    }

    if (await visibleSelectorExists(page, 'input[name="password"]')) {
      throw new Error('Triple A no completó el inicio de sesión.');
    }

    await page.goto(TRIPLE_A_URLS.policies, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    });
    const dataDeadline = Date.now() + PORTAL_DATA_TIMEOUT_MS;
    while (!subscriptionPayload && Date.now() < dataDeadline) await sleep(1000);

    // If the React page did not issue the request again (for example after a
    // cached navigation), ask the same authenticated browser session directly.
    if (!subscriptionPayload) {
      const direct = await page.evaluate(async () => {
        const response = await fetch('/bff/subscriptions', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        return { status: response.status, body: await response.text() };
      });
      if (direct.status >= 200 && direct.status < 300) {
        subscriptionPayload = parsePortalResponseBody(direct.body);
      } else {
        throw new Error(`Triple A rechazó la consulta global (HTTP ${direct.status}).`);
      }
    }

    const subscriptions = unwrapPortalList(subscriptionPayload, ['subscriptions', 'policies', 'items']);
    const targets = configuredApartmentTargets();
    const results = [];
    const seenApartments = new Set();
    for (const subscription of subscriptions) {
      const target = matchPortalApartment(targets, [
        subscription?.subscriptionExternalId,
        subscription?.externalId,
        subscription?.subscriptionId,
        subscription?.name,
        subscription?.alias,
        subscription?.subscriptionAddress,
        subscription?.id,
      ]);
      if (!target || seenApartments.has(String(target.apartmentId || target.apartment))) continue;
      seenApartments.add(String(target.apartmentId || target.apartment));
      const record = tripleARecord(target, subscription);
      results.push(record);
      const amount = record.deudaCOP === null ? 'sin valor' : `$${record.deudaCOP.toLocaleString('es-CO')}`;
      console.log(`[TRIPLE A] Portal global ${target.apartment}: ${record.status} (${amount}).`);
    }

    if (!results.length) {
      lastWaterScrapeError = 'Triple A autenticó el portal, pero no se pudo asociar ninguna póliza con los apartamentos configurados.';
      console.warn('[TRIPLE A] Portal global no devolvió pólizas asociables; se usará el respaldo QR.');
    } else {
      console.log(`[TRIPLE A] Portal global: ${results.length} apartamento(s) con datos.`);
    }
    return results;
  } catch (error) {
    lastWaterScrapeError = error.message;
    console.error('[TRIPLE A] Portal global error:', error.message);
    return [];
  } finally {
    if (page && captureSubscriptions) page.off?.('response', captureSubscriptions);
    if (browser) await closeWaterBrowser(browser);
  }
}

async function readWaterPageText(page, responseBodies) {
  const frames = typeof page.frames === 'function' ? page.frames() : [page];
  const frameTexts = await Promise.all(frames.map(readWaterFrameText));
  return [...frameTexts, ...responseBodies].filter(Boolean).join(' ').trim();
}

async function waitForWaterBill(page, responseBodies, deadline) {
  let latest = { status: 'unknown', deudaCOP: null, factura: null, periodo: null, error: null };

  while (true) {
    const state = await inspectWaterPage(page);
    if (state && (state.hasTurnstile || state.hasCaptchaText) && !state.turnstileToken && !state.hasBillingResult) {
      return { ...latest, status: 'captcha', error: WATER_CAPTCHA_ERROR };
    }

    const pageText = await readWaterPageText(page, responseBodies);
    if (pageText) {
      latest = parseWaterBillPage(pageText);
      if (waterResultReady(latest)) return latest;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return latest;
    await sleep(Math.min(WATER_POLL_INTERVAL_MS, remaining));
  }
}

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
    gasPaymentUrl: target.gasPaymentUrl,
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

function gasInvoiceSummary(invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const unpaid = [];
  for (const invoice of list) {
    const amount = parsePortalAmount(
      invoice?.couponValue ?? invoice?.amountDue ?? invoice?.totalToPay ?? invoice?.total,
    );
    const paid = invoice?.isPaid === true || /^true|1|paid$/i.test(String(invoice?.isPaid || ''));
    const pending = invoice?.isPending === true || /^true|1|pending$/i.test(String(invoice?.isPending || ''));
    if (!paid && (pending || (amount !== null && amount > 0))) unpaid.push({ invoice, amount });
  }
  const knownAmounts = unpaid.map(item => item.amount).filter(amount => amount !== null);
  const debt = knownAmounts.length ? knownAmounts.reduce((sum, amount) => sum + amount, 0) : null;
  return {
    status: debt > 0 || (debt === null && unpaid.length) ? 'pending' : 'paid',
    deudaCOP: debt === null && !unpaid.length ? 0 : debt,
    numFacturas: unpaid.length,
    factura: unpaid[0]?.invoice?.id || unpaid[0]?.invoice?.invoiceNumber || null,
    expirationDate: unpaid[0]?.invoice?.expirationDate || null,
  };
}

async function scrapeGasAccount() {
  let browser;
  let page;
  let contractsPayload = null;
  let authHeader = null;
  let captureContracts;
  let captureAuth;
  try {
    lastGasScrapeError = null;
    const credentials = getPortalCredentials('gascaribe');
    const browserless = Boolean(browserlessEndpointFor('gas'));
    console.log(`[GAS] Portal global: iniciando sesión (${browserless ? 'Browserless remoto' : 'Chromium local'}).`);
    browser = await launchBrowser('gas');
    page = await browser.newPage();
    page.setDefaultNavigationTimeout?.(PORTAL_AUTH_TIMEOUT_MS);

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
    page.on?.('request', captureAuth);
    page.on?.('response', captureContracts);

    await page.goto(GAS_PORTAL_URLS.login, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    });

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[autocomplete="email"]',
      'input[name="username"]',
      'input[type="text"]',
    ];
    const passwordSelectors = ['input[type="password"]', 'input[name="password"]'];
    const emailField = await visibleHandle(page, emailSelectors, 8000);
    const passwordField = await visibleHandle(page, passwordSelectors, 8000);
    if (emailField && passwordField) {
      try { await emailField.dispose(); } catch {}
      try { await passwordField.dispose(); } catch {}
      await typeVisibleField(page, emailSelectors, credentials.username, 5000);
      await typeVisibleField(page, passwordSelectors, credentials.password, 5000);
      const challenge = await waitForPortalTurnstile(page, 30000);
      if (challenge?.hasTurnstile && !challenge.turnstileToken) {
        throw new Error('Gases del Caribe mantiene Turnstile visible después de esperar a Browserless.');
      }
      const clicked = await clickVisibleButton(page, ['button[type="submit"]', 'button'], 10000);
      if (!clicked) throw new Error('No se encontró el botón de inicio de sesión de Gases del Caribe.');
      await sleep(5000);
    } else {
      console.log('[GAS] La sesión ya estaba autenticada; se reutiliza el portal global.');
    }

    if (await visibleSelectorExists(page, passwordSelectors)) {
      throw new Error('Gases del Caribe no completó el inicio de sesión.');
    }

    await page.goto(GAS_PORTAL_URLS.contracts, {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_AUTH_TIMEOUT_MS,
    });
    const dataDeadline = Date.now() + PORTAL_DATA_TIMEOUT_MS;
    while (!contractsPayload && Date.now() < dataDeadline) await sleep(1000);
    if (!contractsPayload) throw new Error('No se recibió la lista global de contratos de Gases del Caribe.');

    const token = contractsPayload.token || contractsPayload.appToken ||
      contractsPayload.data?.token || contractsPayload.data?.appToken;
    if (!authHeader && token) authHeader = /^Bearer\s/i.test(String(token)) ? String(token) : `Bearer ${token}`;
    if (!authHeader) throw new Error('El portal de Gases del Caribe no entregó el token de consulta.');

    const contracts = unwrapPortalList(contractsPayload, ['contracts', 'items']);
    const targets = configuredApartmentTargets();
    const results = [];
    const seenApartments = new Set();
    for (const contract of contracts) {
      const target = matchPortalApartment(targets, [
        contract?.id,
        contract?.contractId,
        contract?.alias,
        contract?.address,
      ]);
      if (!target || seenApartments.has(String(target.apartmentId || target.apartment))) continue;
      const contractId = contract?.id || contract?.contractId;
      if (!contractId) continue;
      const invoiceResponse = await page.evaluate(async ({ apiBase, id, authorization }) => {
        const url = `${apiBase}/invoices/${encodeURIComponent(id)}?g-recaptcha-response=-`;
        const response = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json', Authorization: authorization },
        });
        return { status: response.status, body: await response.text() };
      }, { apiBase: GAS_API_BASE, id: contractId, authorization: authHeader });
      if (invoiceResponse.status < 200 || invoiceResponse.status >= 300) {
        throw new Error(`Gases del Caribe rechazó el contrato ${contractId} (HTTP ${invoiceResponse.status}).`);
      }
      const invoicePayload = parsePortalResponseBody(invoiceResponse.body);
      const invoices = unwrapPortalList(invoicePayload, ['invoices', 'items']);
      const summary = gasInvoiceSummary(invoices);
      const record = gasRecord({
        ...target,
        gasPaymentUrl: target.gasPaymentUrl || GAS_PORTAL_URLS.payments,
        gasPaymentCode: String(contractId),
      }, {
        ...summary,
        error: null,
      });
      seenApartments.add(String(target.apartmentId || target.apartment));
      results.push(record);
      const amount = record.deudaCOP === null ? 'sin valor' : `$${record.deudaCOP.toLocaleString('es-CO')}`;
      console.log(`[GAS] Portal global ${target.apartment}: ${record.status} (${amount}).`);
    }

    if (!results.length) {
      lastGasScrapeError = 'Gases del Caribe autenticó el portal, pero no se pudo asociar ningún contrato con los apartamentos configurados.';
      console.warn('[GAS] Portal global no devolvió contratos asociables; se usará el respaldo individual.');
    } else {
      console.log(`[GAS] Portal global: ${results.length} apartamento(s) con datos.`);
    }
    return results;
  } catch (error) {
    lastGasScrapeError = error.message;
    console.error('[GAS] Portal global error:', error.message);
    return [];
  } finally {
    if (page && captureAuth) page.off?.('request', captureAuth);
    if (page && captureContracts) page.off?.('response', captureContracts);
    if (browser) await closeWaterBrowser(browser);
  }
}

async function scrapeGasBills(apartments = db?.apartments || [], browserFactory = launchBrowser) {
  const targets = (apartments || []).map(gasTarget).filter(Boolean);
  if (!targets.length) {
    lastGasScrapeError = null;
    console.log('[GAS] No hay URLs de pago de Gases del Caribe configuradas.');
    return [];
  }

  let browser;
  const results = new Array(targets.length);
  try {
    lastGasScrapeError = null;
    console.log('[GAS] Consultando ' + targets.length + ' enlace(s) de Gases del Caribe...');
    browser = await browserFactory('gas');
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const target = targets[index];
        const checkedAt = new Date().toISOString();
        let completed = false;
        let attempt = 0;
        while (!completed && attempt < GAS_CAPTCHA_MAX_ATTEMPTS) {
          attempt += 1;
          let page;
          try {
            page = await browser.newPage();
            page.setDefaultNavigationTimeout?.(GAS_TIMEOUT_MS);
            const responseBodies = [];
            const captureResponse = response => {
              const type = response.request().resourceType();
              const contentType = response.headers()['content-type'] || '';
              const responseUrl = response.url();
              if (!['xhr', 'fetch'].includes(type) || !/json|text|html/i.test(contentType)) return;
              if (!/payment|factur|saldo|deuda|invoice|amount|balance|contrat|pago/i.test(responseUrl) && !/json/i.test(contentType)) return;
              Promise.race([
                response.text(),
                sleep(GAS_RESPONSE_TIMEOUT_MS).then(() => ''),
              ]).then(body => {
                if (body && /factura|saldo|deuda|total|valor|monto|amount|balance|debt|invoice|pendingValue|amountDue|invoiceTotal/i.test(body)) {
                  responseBodies.push(body.slice(0, 100000));
                }
              }).catch(() => {});
            };
            const canCaptureResponses = typeof page.on === 'function' && typeof page.off === 'function';
            if (canCaptureResponses) page.on('response', captureResponse);
            const deadline = Date.now() + GAS_TIMEOUT_MS;
            const response = await page.goto(target.gasPaymentUrl, {
              waitUntil: 'domcontentloaded',
              timeout: GAS_TIMEOUT_MS,
            });
            if (response && response.status() >= 400) throw new Error('El portal respondio HTTP ' + response.status());
            await sleep(2200);
            const pageState = await waitForGasTurnstile(page, deadline);
            if (pageState && (pageState.hasTurnstile || pageState.hasCaptchaText) &&
                !pageState.turnstileToken && !pageState.hasBillingResult) {
              lastGasScrapeError = GAS_CAPTCHA_ERROR;
              if (attempt >= GAS_CAPTCHA_MAX_ATTEMPTS) {
                results[index] = gasRecord(target, { status: 'captcha', deudaCOP: null, error: GAS_CAPTCHA_ERROR }, checkedAt);
                completed = true;
              } else {
                console.warn('[GAS] ' + (target.apartment || target.apartmentId) + ': Turnstile detectado; reiniciando pagina (intento ' + (attempt + 1) + '/' + GAS_CAPTCHA_MAX_ATTEMPTS + ').');
              }
              continue;
            }
            await submitGasQueryIfReady(page, target.gasPaymentCode);
            const parsed = await waitForGasBill(page, responseBodies, deadline);
            if (canCaptureResponses) page.off('response', captureResponse);
            if (parsed.status === 'captcha') {
              lastGasScrapeError = parsed.error || GAS_CAPTCHA_ERROR;
              if (attempt >= GAS_CAPTCHA_MAX_ATTEMPTS) {
                results[index] = gasRecord(target, parsed, checkedAt);
                completed = true;
              } else {
                console.warn('[GAS] ' + (target.apartment || target.apartmentId) + ': Turnstile detectado; reiniciando pagina (intento ' + (attempt + 1) + '/' + GAS_CAPTCHA_MAX_ATTEMPTS + ').');
              }
              continue;
            }
            if (parsed.status === 'unknown') {
              throw new Error('Gases del Caribe timeout: no mostro el valor de la deuda despues de ' + (GAS_TIMEOUT_MS / 1000) + ' segundos.');
            }
            results[index] = gasRecord(target, parsed, checkedAt);
            const suffix = parsed.deudaCOP !== null ? ' ($' + parsed.deudaCOP.toLocaleString('es-CO') + ')' : '';
            console.log('[GAS] ' + (target.apartment || target.apartmentId) + ': ' + parsed.status + suffix);
            completed = true;
          } catch (error) {
            lastGasScrapeError = error.message;
            const isCaptcha = /captcha|turnstile|verification/i.test(String(error.message || ''));
            const maxAttempts = isCaptcha ? GAS_CAPTCHA_MAX_ATTEMPTS : GAS_MAX_ATTEMPTS;
            if (attempt < maxAttempts) {
              const reason = isCaptcha ? 'Turnstile detectado' : 'sin valor despues de ' + (GAS_TIMEOUT_MS / 1000) + 's';
              console.warn('[GAS] ' + (target.apartment || target.apartmentId) + ': ' + reason + '; reiniciando pagina (intento ' + (attempt + 1) + '/' + maxAttempts + ').');
            } else {
              results[index] = gasNavigationError(target, error, checkedAt);
              console.error('[GAS] ' + (target.apartment || target.apartmentId) + ': ' + error.message);
              completed = true;
            }
          } finally {
            if (page) await closeWaterResource(page);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(GAS_WORKERS, targets.length) }, worker));
  } catch (error) {
    lastGasScrapeError = error.message;
    console.error('[GAS] SCRAPER ERROR:', error.message);
    for (let index = 0; index < targets.length; index++) {
      if (!results[index]) results[index] = gasNavigationError(targets[index], error);
    }
  } finally {
    if (browser) await closeWaterBrowser(browser);
  }
  return results.filter(Boolean);
}

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

    const group = grouped[nic] || { totalValues: [], balanceValues: [] };
    const totalDebt = parseAirEAmount(
      invoice.amt_DeudaTotal ?? invoice.deudaTotal ?? invoice.DeudaTotal,
    );
    const balance = parseAirEAmount(
      invoice.amt_SaldoConsulta ?? invoice.saldoConsulta ?? invoice.SaldoConsulta,
    );

    if (totalDebt !== null) group.totalValues.push(totalDebt);
    else if (balance !== null) group.balanceValues.push(balance);
    grouped[nic] = group;
  }

  return Object.fromEntries(Object.entries(grouped).map(([nic, group]) => {
    const hasTotalField = group.totalValues.length > 0;
    const debt = hasTotalField
      // Deuda Total is often repeated once per invoice; use it once per NIC.
      ? Math.max(...group.totalValues)
      // Older responses may omit Deuda Total; sum the per-invoice balance as a
      // compatibility fallback so the apartment still gets a useful result.
      : group.balanceValues.reduce((sum, amount) => sum + amount, 0);
    return [nic, {
      debt,
      source: hasTotalField ? 'Deuda Total' : 'SaldoConsulta',
    }];
  }));
}

async function scrapeAirE() {
  const results = [];
  let browser;

  try {
    lastScrapeError = null;
    const useFullChrome = FULL_CHROME_ENABLED;
    const browserless = Boolean(browserlessEndpointFor('air-e'));
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

    // 1. Login (no OTP on the portal anymore).
    console.log('[AIR-E] Navigating to login...');
    await page.goto(AIR_E_URLS.login, { waitUntil: 'domcontentloaded', timeout: 60000 });

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
      await page.goto(AIR_E_URLS.listado, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2500);
      console.log('[AIR-E] Current URL after loading invoices:', page.url());
    }

    // Give the module a moment to fire the request if the same page was reused.
    const listenStart = Date.now();
    while (!cdContrato && Date.now() - listenStart < 10000) {
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
      const agg = byNic[nic] || { debt: 0, source: 'Deuda Total' };
      const debtText = agg.debt > 0
        ? `Deuda Total del NIC: $${agg.debt.toLocaleString('es-CO')}.`
        : 'Deuda Total del NIC: $0 (al día).';
      console.log(`[AIR-E]   NIC ${nic} → ${aptoName}: Deuda Total $${agg.debt.toLocaleString('es-CO')} [${agg.source}]`);

      results.push({
        provider: 'Air-e',
        apartmentId: target.apartmentId || null,
        nic,
        apartment: aptoName,
        deudaCOP: agg.debt,
        deudaTotalCOP: agg.debt,
        deudaLabel: 'Deuda Total',
        status: agg.debt > 0 ? 'pending' : 'paid',
        numFacturas: null,
        deudaText: debtText,
        scrapedAt: new Date().toISOString(),
      });
    }

  } catch (e) {
    lastScrapeError = e.message;
    console.error('[AIR-E] SCRAPER ERROR:', e.message);
  } finally {
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

function runScrapeOnce(reason) {
  if (airEScrapePromise) {
    console.log('[SERVICES] Air-e scrape already running; skipping overlapping run.');
    return airEScrapePromise;
  }
  airEScrapePromise = (async () => {
    if (waterScrapePromise) {
      console.log('[SERVICES] Air-e waiting for Triple A to finish before opening Chrome.');
      await waterScrapePromise.catch(() => {});
    }
    console.log(`[SERVICES] Running Air-e scrape (${reason})...`);
    try {
      const results = await scrapeAirE();
      if (db && saveData && results.length) persistResults(results);
      return results;
    } catch (e) {
      console.error('[SERVICES] Air-e scrape error:', e.message);
      return [];
    } finally {
      airEScrapePromise = null;
    }
  })();
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

function runWaterScrapeOnce(reason) {
  if (waterScrapePromise) {
    console.log('[SERVICES] Triple A water scrape already running; skipping overlapping run.');
    return waterScrapePromise;
  }
  waterScrapePromise = (async () => {
    if (airEScrapePromise) {
      console.log('[SERVICES] Triple A waiting for Air-e to finish before opening browsers.');
      await airEScrapePromise.catch(() => {});
    }
    console.log(`[SERVICES] Running Triple A water scrape (${reason})...`);
    try {
      // The authenticated Triple A portal is the primary path. Only the
      // apartments absent from that account fall back to their legacy QR URL.
      const globalResults = await scrapeTripleAAccount();
      const missingApartments = (db?.apartments || []).filter(apartment =>
        !globalResults.some(result => serviceResultMatchesApartment(result, apartment))
      );
      let results = globalResults;
      if (missingApartments.length) {
        console.log(`[TRIPLE A] Respaldo QR para ${missingApartments.length} apartamento(s) no asociados en el portal global.`);
        const fallbackResults = await scrapeWaterBills(missingApartments);
        results = [...globalResults, ...fallbackResults];
      }
      if (db && saveData && results.length) persistWaterResults(results);
      return results;
    } catch (e) {
      console.error('[SERVICES] Triple A water scrape error:', e.message);
      return [];
    } finally {
      waterScrapePromise = null;
    }
  })();
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
  gasScrapePromise = (async () => {
    if (airEScrapePromise) await airEScrapePromise.catch(() => {});
    if (waterScrapePromise) await waterScrapePromise.catch(() => {});
    console.log(`[SERVICES] Running Gases del Caribe scrape (${reason})...`);
    try {
      // The authenticated contracts/invoices API is the primary path. Keep
      // the public payment form as a per-apartment fallback for new records
      // that have not been associated in the account yet.
      const globalResults = await scrapeGasAccount();
      const missingApartments = (db?.apartments || []).filter(apartment =>
        !globalResults.some(result => serviceResultMatchesApartment(result, apartment))
      );
      let results = globalResults;
      if (missingApartments.length) {
        console.log(`[GAS] Respaldo individual para ${missingApartments.length} apartamento(s) no asociados en el portal global.`);
        const fallbackResults = await scrapeGasBills(missingApartments);
        results = [...globalResults, ...fallbackResults];
      }
      if (db && saveData && results.length) persistGasResults(results);
      return results;
    } catch (error) {
      console.error('[SERVICES] Gases del Caribe scrape error:', error.message);
      return [];
    } finally {
      gasScrapePromise = null;
    }
  })();
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
    // One current-debt record per NIC
    r.provider = 'Air-e';
    const idx = db.utilityRecords.findIndex(
      (u) => u.nic === r.nic && u.provider === 'Air-e'
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
  scrapeAirE,
  scrapeTripleAAccount,
  scrapeWaterBills,
  scrapeGasAccount,
  scrapeGasBills,
  parseCopAmount,
  extractWaterAmount,
  extractGasAmount,
  aggregateAirEInvoices,
  gasInvoiceSummary,
  parseWaterBillPage,
  parseGasBillPage,
  waterNavigationError,
  gasNavigationError,
  persistWaterResults,
  persistGasResults,
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
