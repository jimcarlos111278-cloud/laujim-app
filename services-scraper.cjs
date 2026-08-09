/**
 * services-scraper.cjs
 *
 * Automated checker for public service bills (Air-e, Triple A, Gases del Caribe).
 * Uses puppeteer-core + @sparticuz/chromium (lightweight Chromium for Render).
 */

const fs = require('fs');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveChromium() {
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

async function launchBrowser() {
  const cfg = await resolveChromium();
  return await puppeteer.launch({
    args: cfg.args,
    defaultViewport: { width: 1366, height: 768 },
    executablePath: cfg.executablePath,
    headless: cfg.headless,
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

const WATER_TIMEOUT_MS = 30000;
const WATER_WORKERS = 3;
const WATER_SCRAPE_CRON = '0 * * * *';

function normalizeBillText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCopAmount(raw) {
  let value = String(raw || '').replace(/[^0-9,.-]/g, '').replace(/-/g, '');
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
  const labeled = text.match(/(?:saldo|deuda|total\s+(?:a\s+)?pagar|valor\s+(?:a\s+)?pagar|importe|monto)[^$0-9]{0,50}(?:\$\s*|COP\s*)?([0-9][0-9.,]*)\s*(?:COP|pesos)?/i);
  const labeledAmount = parseCopAmount(labeled?.[1]);
  if (labeledAmount !== null) return labeledAmount;

  const matches = [...text.matchAll(/(?:\$\s*|COP\s*)([0-9][0-9.,]*)\s*(?:COP|pesos)?/gi)]
    .map(match => parseCopAmount(match[1]))
    .filter(amount => amount !== null);
  return matches.length ? Math.max(...matches) : null;
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
  const pending = /pendiente|por pagar|vencid[ao]|no pagad[ao]|deuda/.test(noDebtText);
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
    browser = await browserFactory();
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= targets.length) return;
        const target = targets[index];
        const checkedAt = new Date().toISOString();
        let page;
        try {
          page = await browser.newPage();
          page.setDefaultNavigationTimeout?.(WATER_TIMEOUT_MS);
          const response = await page.goto(target.waterPaymentUrl, { waitUntil: 'networkidle2', timeout: WATER_TIMEOUT_MS });
          if (response && response.status() >= 400) throw new Error(`El portal respondió HTTP ${response.status()}`);
          await sleep(1200);
          const pageText = await page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || '');
          if (!pageText.trim()) throw new Error('El enlace de Triple A no devolvió contenido visible.');
          const parsed = parseWaterBillPage(pageText);
          if (parsed.status === 'unknown') parsed.error = 'No se pudo identificar el estado de la factura en el portal.';
          results[index] = waterRecord(target, parsed, checkedAt);
          console.log(`[TRIPLE A] ${target.apartment || target.apartmentId}: ${parsed.status}${parsed.deudaCOP !== null ? ` ($${parsed.deudaCOP.toLocaleString('es-CO')})` : ''}`);
        } catch (error) {
          results[index] = waterNavigationError(target, error, checkedAt);
          lastWaterScrapeError = error.message;
          console.error(`[TRIPLE A] ${target.apartment || target.apartmentId}: ${error.message}`);
        } finally {
          if (page) await page.close().catch(() => {});
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
    if (browser) await browser.close().catch(() => {});
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
    console.log('[AIR-E] Launching browser (sparticuz chromium)...');
    const creds = getAirECredentials();
    browser = await launchBrowser();
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
