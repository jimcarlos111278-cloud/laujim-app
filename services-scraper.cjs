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
  // Serverless / Linux: use sparticuz chromium (ESM default export).
  const mod = require('@sparticuz/chromium');
  const chromium = mod.default ?? mod;
  return {
    executablePath: await chromium.executablePath(),
    // headless:'shell' selects the optimized headless build for serverless.
    headless: 'shell',
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
  };
}

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const AIR_E_CREDENTIALS = {
  email: 'arriendo.apartamentos.la.victoria@gmail.com',
  password: 'Laujim1011.',
};

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

async function scrapeAirE() {
  const results = [];
  let browser;

  try {
    console.log('[AIR-E] Launching browser (sparticuz chromium)...');
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // 1. Login
    console.log('[AIR-E] Navigating to login...');
    await page.goto(AIR_E_URLS.login, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Fill login form (Air-e is DotNetNuke WebForms; select by stable name attributes)
    await waitAndType(page, 'input[name*="txtUsername"], input[name*="Login$"]', AIR_E_CREDENTIALS.email);
    await waitAndType(page, 'input[name*="txtPassword"]', AIR_E_CREDENTIALS.password);
    const loginBtn = await page.$('#dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_cmdLogin') ||
                     await page.$('button::-p-text("Ingresar")');
    if (loginBtn) await loginBtn.click();
    await sleep(3000);

    let currentUrl = page.url();
    console.log('[AIR-E] Current URL:', currentUrl);

    // Air-e now enforces email OTP. If the OTP panel shows up, wait (timeboxed)
    // for the user to enter the code — automation cannot read the mailbox.
    const otpVisible = await page.$('#dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_txtOtpCode').then((el) => {
      if (!el) return false;
      return el.isVisible().catch(() => true);
    }).catch(() => false);

    if (otpVisible) {
      console.log('[AIR-E] OTP required. Waiting up to 90s for manual code entry...');
      const otpStart = Date.now();
      const otpBtn = await page.$('#dnn_ctr_Login_Login_DotNetNuke.Membership.GatewayMembershipProvider_cmdVerifyOtp');
      while (Date.now() - otpStart < 90000) {
        await sleep(2000);
        if (otpBtn && await otpBtn.evaluate((b) => !b.disabled && (b.textContent || '').toLowerCase().includes('verificar'))) {
          // try to click once code is filled
        }
        const code = await page.$eval('input[name*="txtOtpCode"]', (i) => i.value).catch(() => '');
        if (code && code.length >= 5) {
          if (otpBtn) await otpBtn.click();
          await sleep(3000);
          break;
        }
      }
    }

    currentUrl = page.url();
    console.log('[AIR-E] Post-auth URL:', currentUrl);
    if (!currentUrl.includes('Listado-de-Facturas') && !currentUrl.includes('Mis-Facturas')) {
      console.log('[AIR-E] Login may have failed or redirected elsewhere.');
    }

    // 2. Iterate NICs: select each NIC in the combobox and read the current debt
    //    ("La deuda del NIC es $X correspondiente a N facturas."). The table shows
    //    the full history (691 rows), so paginating it is unnecessary for the app.
    const nicsToCheck = Object.keys(AIR_E_NIC_MAP);
    console.log(`[AIR-E] Checking ${nicsToCheck.length} NICs...`);

    for (const nic of nicsToCheck) {
      const aptoName = AIR_E_NIC_MAP[nic];
      console.log(`[AIR-E]   NIC ${nic} → ${aptoName}`);

      // Navigate to listado (fresh state each NIC)
      await page.goto(AIR_E_URLS.listado, { waitUntil: 'networkidle2', timeout: 20000 });
      await sleep(2500);

      // The NIC picker is an Angular Material md-autocomplete with a search input
      // and a clear button. Type the NIC, then click the matching suggestion.
      const autoInput = await page.$('md-autocomplete input');
      if (!autoInput) {
        console.log(`[AIR-E]   NIC ${nic}: autocomplete not found, skipping.`);
        continue;
      }
      await autoInput.click();
      await sleep(400);

      // Clear previous value if any (md-autocomplete keeps the last selection).
      // The clear button is a <button> whose only text is "Clear" (no aria-label).
      const clearBtn = await page.evaluateHandle(() => {
        const b = [...document.querySelectorAll('md-autocomplete button')].find((x) => (x.textContent || '').trim() === 'Clear');
        return b || null;
      });
      const clearEl = clearBtn.asElement();
      if (clearEl && await clearEl.isVisible().catch(() => false)) {
        await clearEl.click();
        await sleep(400);
      }
      clearBtn.dispose();
      const inputValue = await page.$eval('md-autocomplete input', (i) => i.value).catch(() => '');
      if (inputValue) {
        // fallback clear: select all + delete
        await autoInput.click();
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await sleep(400);
      }

      await page.keyboard.type(nic, { delay: 60 });
      await sleep(1200);

      // Click the suggestion row whose text equals the NIC
      const clicked = await page.evaluate((targetNIC) => {
        const items = [...document.querySelectorAll('md-autocomplete-parent-scope, .md-autocomplete-suggestion, md-virtual-repeat-container button, md-autocomplete li, md-autocomplete button')];
        const el = items.find((e) => (e.textContent || '').trim() === targetNIC);
        if (el) { el.click(); return true; }
        return false;
      }, nic);
      if (!clicked) {
        // Fallback: press Enter to accept the highlighted suggestion
        await page.keyboard.press('Enter');
      }
      await sleep(1800);

      // Read the debt summary line. Example:
      //   "La deuda del NIC es $103.230 correspondiente a 1 facturas."
      // A zero balance shows "$000.000,00 correspondiente a 0 facturas."
      const debtLine = await page.evaluate(() => {
        const els = [...document.querySelectorAll('*')];
        const el = els.find((e) => e.childElementCount === 0 && /La deuda del NIC es/.test((e.textContent || '')));
        return el ? el.textContent.trim() : '';
      });
      const debtMatch = debtLine.match(/\$([\d.,]+)/);
      const countMatch = debtLine.match(/correspondiente a\s+(\d+)\s+facturas?/);
      const deudaCOP = debtMatch ? parseFloat(debtMatch[1].replace(/\./g, '').replace(/,/g, '.')) : null;
      const numFacturas = countMatch ? parseInt(countMatch[1], 10) : 0;

      console.log(`[AIR-E]   NIC ${nic} → ${aptoName}: deuda $${deudaCOP ?? 'N/A'} (${numFacturas} facturas)`);

      results.push({
        provider: 'Air-e',
        nic: nic,
        apartment: aptoName,
        deudaCOP,
        numFacturas,
        deudaText: debtLine,
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

function startScheduler() {
  if (cronJob) return;
  console.log('[SERVICES] Starting 24h scheduler...');
  cronJob = cron.schedule('0 */24 * * *', async () => {
    console.log('[SERVICES] Running scheduled scrape...');
    try {
      const results = await scrapeAirE();
      if (db && saveData) persistResults(results);
    } catch (e) {
      console.error('[SERVICES] Schedule error:', e.message);
    }
  });
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