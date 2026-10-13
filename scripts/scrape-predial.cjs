#!/usr/bin/env node
/**
 * scrape-predial.cjs
 *
 * Consulta el portal Orion (Barranquilla) por referencia catastral, extrae
 * datos básicos del predio + vigencias con saldo y ejecuta la liquidación
 * oficial (actLiquidar.do) con Puppeteer para obtener los descuentos vigentes
 * y el valor real a pagar.
 * Uso: node scripts/scrape-predial.cjs --ref <REFERENCIA>
 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const PREDIAL_URL = 'https://orion.barranquilla.gov.co:8787/Predial/BuscarPredioLiq.do?txtDato=REFCAT&txtTipoBusqueda=PorReferencia';

const CHROME_CANDIDATES = [
  process.env.CHROME_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter(Boolean);

const LABELS = [
  ['referencia', 'Referencia Catastral:'],
  ['direccion', 'Dirección:'],
  ['postal', 'Código Postal:'],
  ['terreno', 'Área Terreno:'],
  ['construida', 'Área Construida:'],
  ['matricula', 'Matricula inmobiliaria:'],
  ['destino', 'Destino:'],
  ['estrato', 'Estrato:'],
];

function resolveChromeExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No se encontró ejecutable de Chrome/Chromium para liquidar Predial.');
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function fieldAfter(html, label) {
  const idx = html.indexOf(label);
  if (idx < 0) return '';
  const slice = html.slice(idx + label.length, idx + label.length + 900);
  const cells = [...slice.matchAll(/<td[^>]*>([^<>]*)<\/td>/g)]
    .map(z => cleanText(z[1].replace(/&nbsp;/g, ' ')))
    .filter(z => z);
  return cells[0] || '';
}

function parseVigencias(html) {
  const rows = [];
  const marks = [...html.matchAll(/value='(\d{4})01'/g)];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].index;
    const end = k + 1 < marks.length ? marks[k + 1].index : start + 15000;
    const chunk = html.slice(start, end);
    const yearMatch = chunk.match(/>(\d{4})<\/td>/);
    const nums = [];
    const numRe = /<td width="90%" align="right">([\d.]+)<\/td>/g;
    let numMatch;
    while ((numMatch = numRe.exec(chunk)) !== null && nums.length < 4) {
      nums.push(parseMoney(numMatch[1]));
    }
    if (yearMatch && nums.length === 4) {
      rows.push({
        vigencia: yearMatch[1],
        capital: nums[0],
        intereses: nums[1],
        descuento: nums[2],
        total: nums[3],
      });
    }
  }
  return rows;
}

function getBogotaDateStr() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.day}/${map.month}/${map.year}`;
}

async function createPredialBrowser() {
  const executablePath = resolveChromeExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768',
    ],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  return { browser, page };
}

async function waitForCfClearance(page, maxWaitMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const cookies = await page.cookies();
    if (cookies.some(c => c.name === 'cf_clearance')) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

async function liquidateVigenciasWithPage(page, cleanRef, vigencias) {
  const url = PREDIAL_URL.replace('REFCAT', encodeURIComponent(cleanRef));
  const dateStr = getBogotaDateStr();

  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitForCfClearance(page, attempt === 1 ? 4500 : 6000);
    await new Promise(r => setTimeout(r, 400));

    const hasForm = await page.evaluate((dStr) => {
      const cbs = document.querySelectorAll("input[name='checkBoxes']");
      if (!cbs.length) return false;
      cbs.forEach(cb => { cb.checked = true; });
      const dp = document.querySelector("input[name='txtFechaVencimiento']");
      if (dp) {
        dp.removeAttribute('readonly');
        dp.value = dStr;
      }
      return true;
    }, dateStr);

    if (!hasForm) return null;

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}),
      page.click("input[type='submit'][value='Liquidar']"),
    ]);

    const liqHtml = await page.content();
    if (liqHtml.includes('Attention Required') || !liqHtml.includes('TOTAL A PAGAR')) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2500));
        continue;
      }
      return null;
    }

    const liqCapital = parseMoney(fieldAfter(liqHtml, 'Valor Capital:'));
    const liqIntereses = parseMoney(fieldAfter(liqHtml, 'Valor Intereses:'));
    const liqDescuento = parseMoney(fieldAfter(liqHtml, 'Descuentos:'));
    const liqTotal = parseMoney(fieldAfter(liqHtml, 'TOTAL A PAGAR:'));
    const recibo = fieldAfter(liqHtml, 'No. Recibo:');
    const avaluo = fieldAfter(liqHtml, 'Avaluó:');

    if (vigencias.length === 1) {
      const v = vigencias[0];
      const cap = liqCapital || v.capital;
      const int = liqIntereses || v.intereses;
      const desc = liqDescuento;
      const tot = liqTotal || Math.max(0, cap + int - desc);
      vigencias[0] = { ...v, capital: cap, intereses: int, descuento: desc, total: tot };
    } else if (vigencias.length > 1 && (liqDescuento > 0 || liqTotal > 0)) {
      const sumInt = vigencias.reduce((acc, v) => acc + (v.intereses || 0), 0);
      let remDesc = liqDescuento;
      for (let i = 0; i < vigencias.length; i++) {
        const v = vigencias[i];
        const share = i === vigencias.length - 1
          ? remDesc
          : (sumInt > 0 ? Math.round((liqDescuento * (v.intereses || 0)) / sumInt) : 0);
        remDesc -= share;
        const tot = Math.max(0, (v.capital || 0) + (v.intereses || 0) - share);
        vigencias[i] = { ...v, descuento: share, total: tot };
      }
    }

    return { recibo, avaluo, fechaLiquidacion: dateStr };
  }
  return null;
}

async function scrapePredial(ref, options = {}) {
  const cleanRef = String(ref || '').replace(/\s/g, '');
  if (!cleanRef) throw new Error('Falta la referencia catastral.');
  const res = await fetch(PREDIAL_URL.replace('REFCAT', encodeURIComponent(cleanRef)), {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Portal Orion respondió ${res.status}.`);
  const html = Buffer.from(await res.arrayBuffer()).toString('latin1');
  if (html.includes('Paz y Salvo')) {
    return { ref: cleanRef, datos: {}, vigencias: [], pazYSalvo: true, consultadoEn: new Date().toISOString() };
  }
  if (!html.includes('Referencia Catastral')) {
    throw new Error('Respuesta sin datos del predio (referencia inválida o portal caído).');
  }
  const datos = {};
  for (const [key, label] of LABELS) {
    datos[key] = fieldAfter(html, label);
  }
  const vigencias = parseVigencias(html);

  if (vigencias.length > 0) {
    let ownBrowser = null;
    try {
      let page = options.page;
      if (!page) {
        ownBrowser = await createPredialBrowser();
        page = ownBrowser.page;
      }
      const extra = await liquidateVigenciasWithPage(page, cleanRef, vigencias);
      if (extra) {
        if (extra.recibo) datos.recibo = extra.recibo;
        if (extra.avaluo) datos.avaluo = extra.avaluo;
      }
    } catch (liqErr) {
      console.warn(`[scrape-predial] No se pudo liquidar descuento para ${cleanRef}: ${liqErr.message}`);
    } finally {
      if (ownBrowser?.browser) {
        await ownBrowser.browser.close().catch(() => {});
      }
    }
  }

  return { ref: cleanRef, datos, vigencias, consultadoEn: new Date().toISOString() };
}

async function main() {
  const idx = process.argv.indexOf('--ref');
  const ref = idx >= 0 ? process.argv[idx + 1] : '';
  try {
    const result = await scrapePredial(ref);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[scrape-predial] ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { scrapePredial, createPredialBrowser };
