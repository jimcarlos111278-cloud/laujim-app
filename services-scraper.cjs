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

// NIC → apartment mapping (from Air-e portal "Grupo" column + manual 403=7889039)
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

// ── DB REF (set by server.cjs) ─────────────────────────────────────────────
let db = null;
let saveData = null;
let lastScrapeError = null;
let lastWaterScrapeError = null;

function getLastScrapeError() {
  return lastScrapeError;
}

function getLastWaterScrapeError() {
  return lastWaterScrapeError;
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

// ── BROWSER LAUNCH (Render-compatible) ─────────────────────────────────────

async function launchBrowser(profileName = 'services', useFullChrome = FULL_CHROME_ENABLED) {
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

async function waitAndType(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector);
  await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.value = ''; }, selector);
  await page.type(selector, text, { delay: 50 });
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
const WATER_TURNSTILE_WAIT_MS = 20000;
const WATER_POLL_INTERVAL_MS = 2000;
const WATER_RESPONSE_TIMEOUT_MS = 5000;
const WATER_CLOSE_TIMEOUT_MS = 10000;
const WATER_WORKERS = 3;
const WATER_SCRAPE_CRON = '0 * * * *';
const WATER_CAPTCHA_ERROR = 'Triple A exige completar la verificación de Cloudflare Turnstile. El valor no se puede consultar automáticamente desde Render; abre el enlace en un navegador y completa la verificación manual.';

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
    numFacturas: parsed.status === 'pending' ? 1 : 0,
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
      const tokenInput = document.querySelector('input[name="cf-turnstile-response"]');
      const turnstileNode = document.querySelector(
        '.cf-turnstile, iframe[src*="challenges.cloudflare.com"], [id*="cf-chl-widget"]'
      );
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
  const invisibleTurnstilePending = state && state.hasTurnstile &&
    !state.turnstileToken && !state.hasBillingResult && !state.hasCaptchaText;
  if (!invisibleTurnstilePending) return state;

  const turnstileDeadline = Math.min(deadline, Date.now() + WATER_TURNSTILE_WAIT_MS);
  while (Date.now() < turnstileDeadline) {
    await sleep(Math.min(WATER_POLL_INTERVAL_MS, turnstileDeadline - Date.now()));
    state = await inspectWaterPage(page);
    if (!state || state.turnstileToken || state.hasBillingResult || state.hasCaptchaText) return state;
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
    browser = await browserFactory('triple-a');
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
//  4. Group by NIC, keep only unpaid/partial invoices, sum the debt.
//
// `cd_Contrato` is a stable, per-account UUID. We read it from the page's own
// request instead of hardcoding it, so it survives account/contract changes.

const AIR_E_GET_ENDPOINT =
  'https://portal.air-e.com/DesktopModules/GatewayOficinaVirtual.Maestro.MisFacturas/API/Documento/Get';
const AIR_E_CONTRATO_RE = /cd_Contrato=([0-9A-Fa-f-]{36})/i;

async function scrapeAirE() {
  const results = [];
  let browser;

  try {
    lastScrapeError = null;
    console.log(`[AIR-E] Launching browser (sparticuz Chromium)...`);
    const creds = getAirECredentials();
    browser = await launchBrowser('air-e', false);
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // 1. Login (no OTP on the portal anymore).
    console.log('[AIR-E] Navigating to login...');
    await page.goto(AIR_E_URLS.login, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    await waitAndType(page, 'input[name*="txtUsername"], input[name*="Login$"]', creds.email);
    await waitAndType(page, 'input[name*="txtPassword"]', creds.password);

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
      (await page.$('#dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_cmdLogin')) ||
      (await page.$('button::-p-text("Ingresar")'));
    if (loginBtn) await loginBtn.click();
    await sleep(3000);

    // Detect OTP/captcha challenges that block fully-automated scraping and
    // surface a clear message instead of failing silently.
    const blocked = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const otpInput = document.querySelector(
        'input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="Code" i], input[maxlength="6"]'
      );
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
    if (!currentUrl.includes('Mis-Facturas')) {
      await page.goto(AIR_E_URLS.listado, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(2500);
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

    // 3. Pull EVERY invoice for all NICs in one call.
    const invoices = await page.evaluate(async (endpoint, contrato) => {
      const url = `${endpoint}?cd_Contrato=${encodeURIComponent(contrato)}&pageIndex=1&pageSize=1000`;
      const res = await fetch(url, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = await res.json();
      return { ok: true, items: json.items || [], total: json.totalItemCount };
    }, AIR_E_GET_ENDPOINT, cdContrato);

    if (!invoices.ok) {
      const msg = `El portal Air-e rechazó la consulta de facturas (HTTP ${invoices.status}).`;
      lastScrapeError = msg;
      console.error('[AIR-E]', msg);
      return [];
    }
    console.log(`[AIR-E] Got ${invoices.total} invoices in one call.`);

    // 3. Group invoices by NIC (cd_Poliza). Keep only unpaid/partial ones and
    //    report the MAXIMUM single-invoice debt (the value the Air-e portal
    //    highlights), not the sum of every pending invoice.
    const byNic = {};
    for (const inv of invoices.items) {
      const nic = (inv.cd_Poliza || '').trim();
      if (!nic) continue;
      const pending = (inv.cd_EstadosPagoDocumento || 'PAGADO').toUpperCase() !== 'PAGADO';
      const debt = Number(inv.amt_SaldoConsulta || inv.amt_DeudaTotal || 0);
      if (!byNic[nic]) byNic[nic] = { debt: 0, count: 0 };
      if (pending) {
        byNic[nic].debt = Math.max(byNic[nic].debt, debt);
        byNic[nic].count += 1;
      }
    }

    // 4. Emit one record per NIC mapped to its apartment.
    for (const nic of Object.keys(AIR_E_NIC_MAP)) {
      const aptoName = AIR_E_NIC_MAP[nic];
      const agg = byNic[nic] || { debt: 0, count: 0 };
      const debtText = agg.debt > 0
        ? `La deuda del NIC es $${agg.debt.toLocaleString('es-CO')} correspondiente a ${agg.count} factura${agg.count === 1 ? '' : 's'}.`
        : `La deuda del NIC es $0 correspondiente a 0 facturas.`;
      console.log(`[AIR-E]   NIC ${nic} → ${aptoName}: deuda $${agg.debt.toLocaleString('es-CO')} (${agg.count} facturas)`);

      results.push({
        provider: 'Air-e',
        nic,
        apartment: aptoName,
        deudaCOP: agg.debt,
        numFacturas: agg.count,
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

function runScrapeOnce(reason) {
  if (airEScrapePromise) {
    console.log('[SERVICES] Air-e scrape already running; skipping overlapping run.');
    return airEScrapePromise;
  }
  airEScrapePromise = (async () => {
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

function runWaterScrapeOnce(reason) {
  if (waterScrapePromise) {
    console.log('[SERVICES] Triple A water scrape already running; skipping overlapping run.');
    return waterScrapePromise;
  }
  waterScrapePromise = (async () => {
    console.log(`[SERVICES] Running Triple A water scrape (${reason})...`);
    try {
      const results = await scrapeWaterBills();
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

function startScheduler() {
  if (cronJob || waterCronJob) return;
  const intervalHours = Math.max(1, Math.floor(Number(process.env.SERVICES_SCRAPE_INTERVAL_HOURS || 24)));
  const timezone = process.env.SERVICES_TIMEZONE || 'America/Bogota';
  console.log(`[SERVICES] Starting scheduler (Triple A every hour; Air-e every ${intervalHours}h; timezone ${timezone})...`);

  // Scrape shortly after boot so every deploy refreshes the debt data even
  // though Render free instances sleep between requests (cron alone would
  // never fire while the instance is asleep).
  waterBootTimer = setTimeout(() => runWaterScrapeOnce('boot'), 60 * 1000);
  if (waterBootTimer.unref) waterBootTimer.unref();
  bootTimer = setTimeout(() => runScrapeOnce('boot'), 120 * 1000);
  if (bootTimer.unref) bootTimer.unref();

  // node-cron fires on the hour while the instance is awake.
  waterCronJob = cron.schedule(WATER_SCRAPE_CRON, () => runWaterScrapeOnce('schedule'), { timezone });
  cronJob = cron.schedule(`0 */${intervalHours} * * *`, () => runScrapeOnce('schedule'), { timezone });
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
  scrapeWaterBills,
  parseCopAmount,
  extractWaterAmount,
  parseWaterBillPage,
  waterNavigationError,
  persistWaterResults,
  runWaterScrapeOnce,
  startScheduler,
  stopScheduler,
  AIR_E_NIC_MAP,
  WATER_SCRAPE_CRON,
  getLastScrapeError,
  getLastWaterScrapeError,
};
