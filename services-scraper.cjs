/**
 * services-scraper.cjs
 *
 * Automated 24h checker for public service bills (Air-e, Triple A, Gases del Caribe).
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
      console.error('[AIR-E] Login blocked: Air-e pidió un código OTP o captcha. El scrape automático no puede completar el login; ingresa manualmente desde "Portal Energía".');
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
      console.error('[AIR-E] Could not resolve cd_Contrato from network traffic.');
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
      console.error(`[AIR-E] Fetch failed with status ${invoices.status}.`);
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
let bootTimer = null;

function runScrapeOnce(reason) {
  console.log(`[SERVICES] Running scrape (${reason})...`);
  return scrapeAirE()
    .then((results) => {
      if (db && saveData) persistResults(results);
      return results;
    })
    .catch((e) => console.error('[SERVICES] Scrape error:', e.message));
}

function startScheduler() {
  if (cronJob) return;
  const intervalHours = Math.max(1, Number(process.env.SERVICES_SCRAPE_INTERVAL_HOURS || 24));
  console.log(`[SERVICES] Starting scheduler (every ${intervalHours}h + on boot)...`);

  // Scrape shortly after boot so every deploy refreshes the debt data even
  // though Render free instances sleep between requests (cron alone would
  // never fire while the instance is asleep).
  bootTimer = setTimeout(() => runScrapeOnce('boot'), 60 * 1000);
  if (bootTimer.unref) bootTimer.unref();

  // node-cron fires on the hour while the instance is awake.
  cronJob = cron.schedule(`0 */${intervalHours} * * *`, () => runScrapeOnce('schedule'));
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
  startScheduler,
  AIR_E_NIC_MAP,
};