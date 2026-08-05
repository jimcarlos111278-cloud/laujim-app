/**
 * services-scraper.cjs
 *
 * Automated 24h checker for public service bills (Air-e, Triple A, Gases del Caribe).
 * Runs headless Puppeteer on Render to log into each provider portal, extract
 * bill data per apartment NIC/policy, and store results in the application DB.
 *
 * Entry points:
 *   - scrapeAirE()          → logs into portal.air-e.com, filters by NIC, extracts facturas
 *   - runAll()              → orchestrates all providers and persists results
 *   - Schedule (node-cron)  → every 24h
 */

const puppeteer = require('puppeteer');
const cron = require('node-cron');

// ─── CONFIG ─────────────────────────────────────────────────────────────────

const AIR_E_CREDENTIALS = {
  email: 'arriendo.apartamentos.la.victoria@gmail.com',
  password: 'Laujim1011.',
};

const AIR_E_URLS = {
  login: 'https://portal.air-e.com/Login?returnurl=%2fMis-Facturas%2fListado-de-Facturas',
  listado: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List',
};

// Known NIC → apartment mapping (from Air-e portal "Grupo" column + manual fixes)
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

// ── STATE KEY ─────────────────────────────────────────────────────────────
const STATE_MAP = {
  // Estados del portal Air-e (convenciones observadas en la leyenda)
  'PENDING':   'pending',    // attach_money visible → por pagar
  'PAID':      'paid',       // sin link de pago, ícono ✓
  'PARTIAL':   'partial',
  'BLOCKED':   'blocked',
  'IN_PROCESS':'processing',
};

// ── DB REF (set by server.cjs) ─────────────────────────────────────────────
let db = null;
let saveData = null;

function init(dbRef, saveFn) {
  db = dbRef;
  saveData = saveFn;
}

// ── PUPPETEER HELPERS ──────────────────────────────────────────────────────

async function launchBrowser() {
  return await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
}

async function waitForText(page, text, timeout = 15000) {
  await page.waitForFunction(
    (txt) => document.body.innerText.includes(txt),
    { timeout },
    text,
  );
}

async function waitAndClick(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { visible: true, timeout });
  await page.click(selector);
}

async function waitAndType(page, selector, text) {
  await page.waitForSelector(selector, { visible: true });
  await page.click(selector);
  await page.evaluate((s) => { document.querySelector(s).value = ''; }, selector);
  await page.type(selector, text, { delay: 50 });
}

// ── AIR-E SCRAPER ──────────────────────────────────────────────────────────

async function scrapeAirE() {
  const results = [];
  let browser;

  try {
    console.log('[AIR-E] Launching browser...');
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // 1. Login
    console.log('[AIR-E] Navigating to login...');
    await page.goto(AIR_E_URLS.login, { waitUntil: 'networkidle2', timeout: 30000 });

    await waitAndType(page, 'input[type="email"], input[ng-model="$ctrl.logIn.Username"]', AIR_E_CREDENTIALS.email);
    await waitAndType(page, 'input[type="password"], input[ng-model="$ctrl.logIn.Password"]', AIR_E_CREDENTIALS.password);
    await page.click('button:has-text("INGRESAR")');

    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });

    // Check if we landed on the listado page
    const currentUrl = page.url();
    if (!currentUrl.includes('Listado-de-Facturas')) {
      console.log('[AIR-E] Login may have failed or redirect issue. URL:', currentUrl);
    }

    // 2. Scrape each NIC
    const nicsToCheck = Object.keys(AIR_E_NIC_MAP);
    console.log(`[AIR-E] Checking ${nicsToCheck.length} NICs...`);

    for (const nic of nicsToCheck) {
      const apartmentName = AIR_E_NIC_MAP[nic];
      console.log(`[AIR-E]   NIC ${nic} → ${apartmentName}`);

      // Navigate to listado (or reload if already there)
      await page.goto(AIR_E_URLS.listado, { waitUntil: 'networkidle2', timeout: 20000 });
      await page.waitForTimeout(2000);

      // Open filters panel
      await clickIfExists(page, 'button:has-text("filter_list")', 3000);
      await page.waitForTimeout(1000);

      // Check if NIC filter button exists
      const filroNicBtn = await page.$('button:has-text("NIC")');
      if (filtroNicBtn) {
        await filtroNicBtn.click();
        await page.waitForTimeout(500);

        // The NIC filter opens a searchbox; type the NIC
        const searchbox = await page.$('md-autocomplete input');
        if (searchbox) {
          await searchbox.click();
          await page.waitForTimeout(300);
          await page.keyboard.type(nic, { delay: 80 });
          await page.waitForTimeout(1500);

          // Wait for autocomplete match and click it
          try {
            const match = await page.waitForSelector('md-autocomplete-parent-scope button, md-autocomplete [role="option"], .md-autocomplete-suggestion button', { visible: true, timeout: 5000 });
            if (match) {
              await match.click();
              await page.waitForTimeout(1000);
            }
          } catch (e) {
            console.log(`[AIR-E]   Autocomplete match not found for NIC ${nic}, trying direct enter...`);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(1500);
          }
        }
      }

      // Click "Consultar"
      await clickIfExists(page, 'button:has-text("Consultar")', 2000);
      await page.waitForTimeout(2000);

      // Now parse the filtered table
      const facturas = await extractTable(page);
      for (const f of facturas) {
        // Determine state
        const estado = determineEstado(f.acciones, f.estado);
        f.nic = nic;
        f.apartment = apartmentName;
        f.provider = 'Air-e';
        results.push({
          nic,
          apartment: f.grupo || AIR_E_NIC_MAP[nic],
          factura: f.factura,
          periodo: f.periodo,
          vence: f.vence,
          valor: f.valor,
          estado: f.estado,
          scrapedAt: new Date().toISOString(),
        });
      }

      // Close filter panel for next iteration
      await clickIfExists(page, 'button:has-text("close"), button[aria-label="close,"] .close', 1000);
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.error('[AIR-E] Scraper error:', e.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('[AIR-E] Browser closed.');
    }
  }

  return results;
}

// ── TABLE PARSER ───────────────────────────────────────────────────────────

async function extractTable(page) {
  return await page.evaluate(() => {
    const rows = [];
    const table = document.querySelector('table');
    if (!table) return rows;

    const tbody = table.querySelector('tbody');
    if (!tbody) return rows;

    const trs = tbody.querySelectorAll('tr');
    trs.forEach((tr) => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 10) return;

      // Air-e table columns (indexed after md-checkbox and spacer):
      //   0: checkbox, 1: spacer, 2: estado icon, 3: estado text?
      //   4: factura, 5: NIC, 6: Periodo, 7: vence,
      //   8: valor, 9: grupo, 10: acciones

      const factura = cells[5]?.innerText?.trim();
      const nic     = cells[6]?.innerText?.trim();
      const periodo  = cells[7]?.innerText?.trim();
      const vence   = cells[8]?.innerText?.trim();
      const valor   = cells[9]?.innerText?.trim();
      const grupo   = cells[10]?.innerText?.trim();
      const acciones = cells[11]?.innerHTML || '';

      // Determine estado from icons in column 3 (estado)
      const estadoCell = cells[3]?.innerHTML || '';
      const hasPaidIcon = estadoCell?.includes('check') || estadoCell.includes('done');
      const hasPayLink  = acciones.includes('attach_money') || acciones.includes('pagar');

      let estado = 'pendiente';
      if (hasPaidIcon) estado = 'pagado';
      else if (hasPayLink) estado = 'pendiente';

      rows.push({
        factura, nic, periodo, vence, valor, grupo, acciones, estado,
      });
    });

    return rows;
  });
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

async function clickIfExists(page, selector, timeout = 3000) {
  try {
    const el = await page.waitForSelector(selector, { visible: true, timeout });
    if (el) {
      await el.click();
      return true;
    }
  } catch (e) {
    return false;
  }
}

async function waitAndType(page, selector, text) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.click(selector);
  await page.evaluate((s) => { document.querySelector(s).value = ''; }, selector);
  await page.type(selector, text, { delay: 50 });
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
      if (db && saveData) {
        persistResults(results);
      }
    } catch (e) {
      console.error('[SERVICES] Schedule error:', e.message);
    }
  });
}

function persistResults(results) {
  if (!db) return;
  if (!db.utilityRecords) db.utilityRecords = [];

  for (const r of results) {
    const existing = db.utilityRecords.findIndex(
      (u) => u.apartment === r.apartment &&
             u.provider === 'Air-e' &&
             u.periodo === r.periodo
    );
    if (existing >= 0) {
      // Update existing record
      db.utilityRecords[existing] = { ...db.utilityRecords[existing], ...r };
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