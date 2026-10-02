'use strict';

// Publicador de Facebook Marketplace en la VM (sin teléfono).
// Habla con la cola del servidor (/worker/v1/marketplace/...) y publica
// arriendos con Chromium + perfil persistente.
//
//   FB_VM_SERVER_URL    base del servidor (default http://127.0.0.1:10000)
//   FB_VM_WORKER_TOKEN  mismo SCRAPER_WORKER_TOKEN del servidor (requerido)
//   FB_VM_DEVICE_ID     default vm-facebook
//   FB_VM_PROFILE_DIR   perfil con la sesión (requerido)
//   FB_VM_POLL_SECONDS  intervalo de cola (default 60, mín 15)
//   FB_VM_HEADLESS      1 = headless
//
//   node scripts/fb-publisher.cjs --login          (iniciar sesión una vez)
//   node scripts/fb-publisher.cjs --check-session  (diagnóstico)
//   node scripts/fb-publisher.cjs --once           (un job y sale)

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = String(process.env.FB_VM_SERVER_URL || 'http://127.0.0.1:10000').trim().replace(/\/+$/, '');
const TOKEN = String(process.env.FB_VM_WORKER_TOKEN || '').trim();
const DEVICE = String(process.env.FB_VM_DEVICE_ID || 'vm-facebook').trim();
const PROFILE = path.resolve(process.env.FB_VM_PROFILE_DIR || path.join(os.homedir(), '.laujim-fb-profile'));
const POLL = Math.max(15, Number(process.env.FB_VM_POLL_SECONDS || 60));
const HEADLESS = /^(1|true|yes)$/i.test(String(process.env.FB_VM_HEADLESS || 'false'));
const LOGIN_MIN = Math.max(5, Number(process.env.FB_VM_LOGIN_MINUTES || 30));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

if (!TOKEN) throw new Error('Falta FB_VM_WORKER_TOKEN.');
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(DEVICE)) throw new Error('FB_VM_DEVICE_ID inválido.');
fs.mkdirSync(PROFILE, { recursive: true });

const ARGS = new Set(process.argv.slice(2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function api(endpoint, options = {}) {
  const res = await fetch(SERVER + endpoint, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Worker-Token': TOKEN, 'X-Worker-Id': DEVICE, ...(options.headers || {}) },
  });
  const text = await res.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${endpoint}`);
  return body;
}

function chromeBin() {
  const exp = String(process.env.CHROME_EXECUTABLE_PATH || '').trim();
  if (exp && fs.existsSync(exp)) return exp;
  for (const c of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('No hay Chromium instalado.');
}

async function openBrowser() {
  const puppeteer = require('puppeteer-core');
  return puppeteer.launch({
    executablePath: chromeBin(),
    userDataDir: PROFILE,
    headless: HEADLESS ? 'shell' : false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=es-ES'],
  });
}

async function hasSession(page) {
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  if (/\/login/i.test(page.url())) return false;
  const loginBox = await page.$('input[name="email"], input#email').catch(() => null);
  return !loginBox;
}

async function tell(jobId, events) {
  try {
    await api(`/worker/v1/marketplace/jobs/${jobId}/events`, { method: 'POST', body: JSON.stringify({ deviceId: DEVICE, events }) });
  } catch (e) { console.error('[FB] eventos:', e.message); }
}

async function setStatus(jobId, status, extra = {}) {
  try {
    await api(`/worker/v1/marketplace/jobs/${jobId}/status`, { method: 'POST', body: JSON.stringify({ deviceId: DEVICE, status, ...extra }) });
  } catch (e) { console.error('[FB] estado:', e.message); }
}

async function heartbeat(session, lastJobId) {
  try {
    await api('/worker/v1/facebook/heartbeat', { method: 'POST', body: JSON.stringify({ deviceId: DEVICE, session, lastJobId: lastJobId || null, version: 'fb-publisher-1' }) });
  } catch (e) { console.error('[FB] heartbeat:', e.message); }
}

// Escribe valor en un campo React (setter nativo + eventos).
async function writeField(page, handle, value) {
  return page.evaluate((el, val) => {
    try {
      el.focus();
      const proto = el.tagName.toLowerCase() === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch { return false; }
  }, handle, String(value)).catch(() => false);
}

// Junta placeholder + aria + texto de hermanas + texto del bloque padre (normalizado sin tildes).
async function fieldContext(page, handle) {
  return page.evaluate(el => {
    const foldText = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const parts = [el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || ''];
    let sib = el.previousElementSibling;
    for (let i = 0; i < 2 && sib; i++) { parts.push(sib.innerText || ''); sib = sib.previousElementSibling; }
    let up = el;
    for (let i = 0; i < 6 && up; i++) {
      up = up.parentElement;
      if (!up) break;
      const t = (up.innerText || '').replace(/\s+/g, ' ').trim();
      if (t.length > 4) { parts.push(t.slice(0, 250)); break; }
    }
    return foldText(parts.join(' '));
  }, handle).catch(() => '');
}

async function findField(page, words, selector) {
  const handles = await page.$$(selector);
  const normalizedWords = words.map(w => norm(w));
  for (const h of handles) {
    const box = await h.boundingBox().catch(() => null);
    if (!box || box.width < 100) continue;
    const ctx = await fieldContext(page, h);
    if (normalizedWords.some(w => ctx.includes(w))) return h;
  }
  return null;
}

async function fillOne(page, jobId, name, words, value, selector) {
  const clean = String(value === null || value === undefined ? '' : value).trim();
  if (!clean) return false;
  let h = await findField(page, words, selector || 'input[type="text"], input:not([type])');
  if (!h) {
    // 1. Selector CSS directo por aria-label o placeholder
    for (const w of words) {
      h = await page.$(`input[aria-label*="${w}" i], input[placeholder*="${w}" i], textarea[aria-label*="${w}" i], textarea[placeholder*="${w}" i]`).catch(() => null);
      if (h) break;
    }
  }
  if (!h) {
    // 2. Localizar por label contenedor o elemento de texto padre
    const handle = await page.evaluateHandle(wants => {
      const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      const normWants = wants.map(w => fold(w));
      const candidates = [...document.querySelectorAll('label, div, span')].filter(el => {
        const t = (el.innerText || '').trim();
        if (t.length === 0 || t.length > 50) return false;
        const f = fold(t);
        return normWants.some(w => f === w || f.includes(w));
      });
      for (const el of candidates) {
        const direct = el.querySelector('input[type="text"], input:not([type]), textarea');
        if (direct && (direct.getAttribute('role') !== 'combobox')) return direct;
        const parentLabel = el.closest('label');
        if (parentLabel) {
          const inLabel = parentLabel.querySelector('input[type="text"], input:not([type]), textarea');
          if (inLabel && (inLabel.getAttribute('role') !== 'combobox')) return inLabel;
        }
      }
      return null;
    }, words).catch(() => null);
    const el = handle && handle.asElement ? handle.asElement() : null;
    if (el) h = el;
  }
  if (!h) return false;
  if (!(await writeField(page, h, clean.slice(0, 4000)))) throw new Error(`no se pudo escribir ${name}`);
  await sleep(500);
  await tell(jobId, [{ stage: `campo_${name}`, level: 'info', message: `${name} listo.` }]);
  return true;
}

async function pickOption(page, jobId, rowLabel, wantedText) {
  const want = norm(wantedText);
  void jobId;
  // Cierra cualquier menú abierto de una fila anterior.
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
  // Localiza la fila por texto normalizado (sin tildes): sube hasta la caja
  // ancha de la fila (el contenedor con borde) y devuelve un punto a la
  // derecha (donde está el chevron). Click por CDP.
  const clicked = await page.evaluate(label => {
    const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const els = [...document.querySelectorAll('div, span')];
    const hits = els.filter(el => {
      const t = (el.innerText || '').trim();
      if (t.length === 0 || t.length > 60) return false;
      const f = fold(t);
      return f === label || f.startsWith(label);
    });
    if (!hits.length) return null;
    hits.sort((a, b) => a.innerText.length - b.innerText.length);
    // Sube hasta la caja ancha de la fila (la tarjeta con borde): el click
    // va a la derecha donde está el chevron, no sobre el texto.
    let row = hits[0];
    for (let i = 0; i < 6 && row && row.parentElement; i++) {
      const rr = row.getBoundingClientRect();
      if (rr.width > 400) break;
      row = row.parentElement;
    }
    const target = row || hits[0];
    try { target.scrollIntoView({ block: 'center' }); } catch {}
    const r = target.getBoundingClientRect();
    if (!r || r.width < 100) return null;
    return { x: r.x + r.width - 30, y: r.y + r.height / 2, w: r.width };
  }, rowLabel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()).catch(() => null);
  if (!clicked || !clicked.w) throw new Error(`fila ${rowLabel} sin caja visible (¿bajo el fold?)`);
  await page.mouse.click(clicked.x, clicked.y);
  await sleep(2200);
  const options = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"]').forEach(el => {
      const r = el.getBoundingClientRect();
      const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (r.width > 50 && t && t.length < 80 && !out.includes(t)) out.push(t);
    });
    return out;
  }).catch(() => []);
  for (const opt of options) {
    const n = norm(opt);
    if (n === want || n.includes(want) || want.includes(n)) {
      const ok = await page.evaluate(text => {
        const hit = [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"]')]
          .find(el => (el.innerText || '').replace(/\s+/g, ' ').trim() === text);
        if (hit) { hit.click(); return true; }
        return false;
      }, opt).catch(() => false);
      if (ok) {
        await sleep(1000);
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(800);
        return opt;
      }
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  throw new Error(`sin opción "${wantedText}" en ${rowLabel}. Hay: ${options.slice(0, 8).join(' | ') || 'ninguna'}`);
}

async function clickTextButton(page, text) {
  const btns = await page.$$('div[role="button"], button');
  for (const b of btns) {
    const box = await b.boundingBox().catch(() => null);
    if (!box || box.width < 40) continue;
    const t = String(await page.evaluate(el => el.innerText || '', b).catch(() => '')).trim().toLowerCase();
    if (t === text) {
      await page.evaluate(el => el.scrollIntoView({ block: 'center' }), b).catch(() => {});
      await sleep(500);
      await b.click();
      return true;
    }
  }
  return false;
}

async function downloadAll(urls, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  let n = 0;
  for (const raw of (urls || []).slice(0, 10)) {
    n += 1;
    let url = String(raw || '').trim();
    if (!url) continue;
    if (url.startsWith('/')) url = SERVER + url;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error('vacía');
      const file = path.join(dir, `foto-${n}.jpg`);
      fs.writeFileSync(file, buf);
      files.push(file);
    } catch (e) { console.error(`[FB] foto ${n}:`, e.message); }
  }
  return files;
}

async function publish(page, job) {
  const ad = job.listing || {};
  const fail = async (step, err) => {
    const msg = `Paso ${step}: ${String(err && err.message || err).slice(0, 220)}`;
    await tell(job.id, [{ stage: `falla_${step}`, level: 'error', message: msg }]);
    try { await page.screenshot({ path: `/tmp/fb-fail-${job.id}.png` }); } catch {}
    throw new Error(msg);
  };

  try {
    await page.goto('https://www.facebook.com/marketplace/create/rental', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);
    const rental = await page.evaluate(() => {
      const t = (document.body.innerText || '').toLowerCase();
      return t.includes('tipo de propiedad en alquiler') && t.includes('precio al mes');
    }).catch(() => false);
    if (!rental) throw new Error('no cargó el formulario de arriendo');
    await tell(job.id, [{ stage: 'formulario', level: 'info', message: 'Formulario de arriendo listo.' }]);
  } catch (e) { return fail('formulario', e); }

  const must = [
    ['titulo', ['titulo', 'title'], ad.title || `Arriendo ${ad.apartmentName || ''}`.trim()],
    ['precio', ['precio al mes', 'precio', 'price'], ad.price],
    ['descripcion', ['descripcion de la propiedad', 'descripcion', 'description'], ad.description, 'textarea'],
    ['habitaciones', ['numero de habitaciones', 'habitaciones', 'bedrooms'], ad.bedrooms],
    ['banos', ['numero de banos', 'banos', 'bathrooms'], ad.bathrooms],
    ['area', ['pies cuadrados', 'square feet', 'metros cuadrados'], ad.propertySquareFeet || ad.area],
    ['disponibilidad', ['fecha disponible', 'disponibilidad', 'date available'], ad.availability],
  ];
  for (const [name, words, value, selector] of must) {
    try {
      if (name === 'titulo') {
        const ok = await fillOne(page, job.id, name, words, value, selector);
        if (!ok) {
          // El formulario de arriendos de Facebook suele autogenerar el título con tipo + habitaciones
          await tell(job.id, [{ stage: 'campo_titulo_auto', level: 'info', message: 'Título autogenerado o no requerido en formulario de arriendo.' }]);
        }
      } else if (name === 'precio' || name === 'descripcion') {
        const ok = await fillOne(page, job.id, name, words, value, selector);
        if (!ok) throw new Error(`campo ${name} obligatorio no encontrado en el formulario`);
      } else {
        await fillOne(page, job.id, name, words, value, selector);
      }
    } catch (e) { return fail(name, e); }
  }

  try {
    const address = [ad.address, ad.city].filter(Boolean).join(', ') || 'Barranquilla';
    const field = await page.$('input[role="combobox"][aria-autocomplete="list"][type="text"]').catch(() => null)
      || await findField(page, ['lugar', 'ubicacion', 'location', 'direccion'], 'input[type="text"], input:not([type])');
    if (!field) throw new Error('sin campo de ubicación');
    await writeField(page, field, address);
    await sleep(2500);
    const picked = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('[role="option"], [role="listbox"] li')].filter(el => el.getBoundingClientRect().width > 50);
      const hit = opts.find(el => {
        const t = (el.textContent || '').toLowerCase();
        return t && !t.includes('ubicacion actual') && !t.includes('current location');
      });
      if (hit) { hit.click(); return (hit.textContent || '').trim().slice(0, 100); }
      return '';
    }).catch(() => '');
    if (!picked) throw new Error('sin sugerencia para ' + address.slice(0, 60));
    await tell(job.id, [{ stage: 'campo_ubicacion', level: 'info', message: `Ubicación: ${picked}.` }]);
  } catch (e) { return fail('ubicacion', e); }

  try {
    let rent = norm(ad.rentalType);
    if (!rent || /departamento|apartamento|piso|condominio/.test(rent)) rent = 'apartamento o piso';
    const chosen = await pickOption(page, job.id, 'tipo de propiedad en alquiler', rent);
    await tell(job.id, [{ stage: 'campo_tipo', level: 'info', message: `Tipo: ${chosen}.` }]);
    // Opciones exactas descubiertas del navegador real (ver --discover).
    // 'Ninguno' del anuncio = 'No' en Facebook.
    const noIfNone = v => {
      const n = norm(v);
      if (!n) return '';
      if (/^(ninguno|none|no tiene|sin|no)$/.test(n)) return 'No';
      return String(v);
    };
    for (const [row, val] of [
      ['tipo de lavanderia', ad.laundryType], ['tipo de aparcamiento', ad.parkingType],
      ['tipo de aire acondicionado', ad.airConditioningType], ['tipo de calefaccion', ad.heatingType],
    ]) {
      const mapped = noIfNone(val);
      if (!mapped) continue;
      try {
        const chosen = await pickOption(page, job.id, row, mapped);
        await tell(job.id, [{ stage: 'lista_ok', level: 'info', message: `${row}: ${chosen}.` }]);
      } catch (e) {
        await tell(job.id, [{ stage: 'lista_opcional', level: 'warn', message: `${row}: ${String(e.message).slice(0, 140)}` }]);
      }
    }
  } catch (e) { return fail('listas', e); }

  try {
    const files = await downloadAll(ad.photoUrls, path.join(os.tmpdir(), `fb-ad-${job.id}`));
    if (!files.length) throw new Error('sin fotos descargables');
    const chooserP = page.waitForFileChooser({ timeout: 12000 }).catch(() => null);
    if (await clickTextButton(page, 'añadir fotos')) await sleep(1500);
    const chooser = await chooserP;
    if (chooser) await chooser.accept(files);
    else {
      const inputs = await page.$$('input[type="file"]');
      if (!inputs.length) throw new Error('sin selector de archivos');
      await inputs[0].uploadFile(...files);
    }
    await sleep(8000);
    await tell(job.id, [{ stage: 'fotos', level: 'info', message: `${files.length} fotos enviadas.` }]);
  } catch (e) { return fail('fotos', e); }

  try {
    if (!(await clickTextButton(page, 'siguiente'))) throw new Error('sin botón Siguiente');
    await sleep(6000);
    const end = Date.now() + 90000;
    let sent = false;
    while (Date.now() < end) {
      if (await clickTextButton(page, 'publicar')) { sent = true; break; }
      await sleep(1500);
    }
    if (!sent) throw new Error('Publicar no se habilitó');
    const end2 = Date.now() + 90000;
    while (Date.now() < end2) {
      const m = page.url().match(/facebook\.com\/marketplace\/item\/(\d+)/i);
      if (m) return `https://www.facebook.com/marketplace/item/${m[1]}/`;
      if (/login|checkpoint|two_factor/i.test(page.url())) throw new Error('Facebook pidió verificación extra');
      await sleep(2000);
    }
    throw new Error('sin URL confirmada');
  } catch (e) { return fail('publicar', e); }
}

async function handleJob(browser, job) {
  console.log(`[FB] anúncio ${job.id} (${job.apartmentName || '?'})`);
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await heartbeat('unknown', job.id);
    if (!(await hasSession(page))) {
      await setStatus(job.id, 'needs_login', { message: 'Sin sesión de Facebook en la VM.' });
      return;
    }
    await heartbeat('ok', job.id);
    await setStatus(job.id, 'processing', { message: 'Publicando desde la VM.' });
    const url = await publish(page, job);
    if (url) {
      await setStatus(job.id, 'published', { message: 'Publicado desde la VM.', listingUrl: url });
      console.log(`[FB] publicado: ${url}`);
    } else {
      await setStatus(job.id, 'needs_review', { message: 'Revisar en Facebook.' });
    }
  } catch (e) {
    console.error('[FB] job:', e.message);
    try { await setStatus(job.id, 'needs_review', { message: String(e.message).slice(0, 300) }); } catch {}
  } finally {
    await page.close().catch(() => {});
  }
}

async function discover(page) {
  await page.goto('https://www.facebook.com/marketplace/create/rental', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(8000);
  const fields = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 120) return;
      let up = el, ctx = '';
      for (let i = 0; i < 6 && up; i++) {
        up = up.parentElement;
        if (!up) break;
        ctx = (up.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 150);
        if (ctx.length > 5) break;
      }
      out.push({ tag: el.tagName, type: el.getAttribute('type') || '', ph: el.getAttribute('placeholder') || '', ctx });
    });
    return out.slice(0, 25);
  }).catch(e => ({ err: e.message }));
  const report = { url: page.url(), fields };
  const rows = ['tipo de propiedad en alquiler', 'tipo de lavanderia', 'tipo de aparcamiento', 'tipo de aire acondicionado', 'tipo de calefaccion', 'disponibilidad'];
  const foldRow = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (const row of rows) {
    const pt = await page.evaluate(label => {
      const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const hits = [...document.querySelectorAll('div, span')].filter(el => {
        const t = (el.innerText || '').trim();
        if (t.length === 0 || t.length > 60) return false;
        const f = fold(t);
        return f === label || f.startsWith(label);
      });
      if (!hits.length) return null;
      hits.sort((a, b) => a.innerText.length - b.innerText.length);
      let r = hits[0];
      for (let i = 0; i < 6 && r && r.parentElement; i++) {
        if (r.getBoundingClientRect().width > 400) break;
        r = r.parentElement;
      }
      try { r.scrollIntoView({ block: 'center' }); } catch {}
      const b = r.getBoundingClientRect();
      if (!b || b.width < 100) return null;
      return { x: b.x + b.width - 30, y: b.y + b.height / 2 };
    }, foldRow(row)).catch(() => null);
    let opened = false;
    if (pt) {
      await page.mouse.click(pt.x, pt.y).catch(() => {});
      await sleep(2200);
      opened = true;
    }
    const options = opened ? await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"]').forEach(el => {
        const r = el.getBoundingClientRect();
        const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (r.width > 50 && t && t.length < 80 && !out.includes(t)) out.push(t);
      });
      return out;
    }).catch(() => []) : [];
    report[row] = { opened, options };
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1200);
  }
  console.log('DISCOVER=' + JSON.stringify(report).slice(0, 4000));
  await page.screenshot({ path: '/tmp/fb-discover.png' }).catch(() => {});
}

async function main() {
  if (ARGS.has('--discover')) {
    const browser = await openBrowser();
    try {
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      if (!(await hasSession(page))) { console.log('DISCOVER-needs_login'); return; }
      await discover(page);
    } finally {
      await browser.close().catch(() => {});
    }
    return;
  }
  if (ARGS.has('--login')) {
    const browser = await openBrowser();
    const page = await browser.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log(`Inicia sesión. Tienes ${LOGIN_MIN} min. Perfil: ${PROFILE}`);
    await sleep(LOGIN_MIN * 60 * 1000);
    await browser.close().catch(() => {});
    return;
  }
  if (ARGS.has('--check-session')) {
    const browser = await openBrowser();
    try {
      const page = await browser.newPage();
      const ok = await hasSession(page);
      console.log('Sesión Facebook en la VM:', ok ? 'ok' : 'needs_login');
      await heartbeat(ok ? 'ok' : 'needs_login', null);
    } finally {
      await browser.close().catch(() => {});
    }
    return;
  }
  const browser = await openBrowser();
  console.log(`[FB] ${DEVICE} → ${SERVER} cada ${POLL}s. Perfil: ${PROFILE}`);
  try {
    for (;;) {
      try {
        await heartbeat('unknown', null);
        const next = await api(`/worker/v1/marketplace/jobs/next?deviceId=${encodeURIComponent(DEVICE)}`);
        if (next && next.job) await handleJob(browser, next.job);
        else await sleep(POLL * 1000);
      } catch (e) {
        console.error('[FB] ciclo:', e.message);
        await sleep(POLL * 1000);
      }
      if (ARGS.has('--once')) break;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(e => { console.error('[FB] fatal:', e.message); process.exit(1); });
