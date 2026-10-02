'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function writeField(page, handle, value) {
  const ok = await page.evaluate((el, val) => {
    try {
      el.focus();
      const isTextarea = el.tagName.toLowerCase() === 'textarea';
      const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch { return false; }
  }, handle, String(value)).catch(() => false);
  if (ok) return true;
  try {
    await handle.click({ clickCount: 3 }).catch(() => {});
    await handle.type(String(value), { delay: 5 });
    return true;
  } catch { return false; }
}

async function pickOption(page, rowLabel, wantedText) {
  const want = norm(wantedText);
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(800);
  const clicked = await page.evaluate(label => {
    const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const els = [...document.querySelectorAll('div, span, label')];
    const hits = els.filter(el => {
      const t = (el.innerText || '').trim();
      if (t.length === 0 || t.length > 60) return false;
      const f = fold(t);
      return f === label || f.startsWith(label);
    });
    if (!hits.length) return null;
    hits.sort((a, b) => a.innerText.length - b.innerText.length);
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
  }, rowLabel.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()).catch(() => null);
  if (!clicked || !clicked.w) return null;
  await page.mouse.click(clicked.x, clicked.y);
  await sleep(2000);
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
  return null;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    userDataDir: '/tmp/laujim-fb-profile',
    headless: 'shell',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=es-ES'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
    await page.goto('https://www.facebook.com/marketplace/create/rental', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);

    const db = JSON.parse(fs.readFileSync('/app/data/database.json', 'utf8'));
    const job = db.marketplaceJobs.find(j => j.id == 39) || db.marketplaceJobs[0];
    const ad = job.listing;

    console.log('1. Subiendo fotos...');
    const adDir = path.join('/tmp', `fb-ad-${job.id}`);
    const photos = fs.existsSync(adDir) ? fs.readdirSync(adDir).filter(f => f.endsWith('.jpg')).map(f => path.join(adDir, f)) : [];
    if (photos.length > 0) {
      const inputs = await page.$$('input[type="file"]');
      if (inputs.length) {
        await inputs[0].uploadFile(...photos);
        await sleep(6000);
      }
    }

    console.log('2. Tipo de propiedad...');
    await pickOption(page, 'tipo de propiedad en alquiler', 'apartamento o piso');

    console.log('3. Habitaciones, baños, precio...');
    const numHab = await page.$('input[aria-label*="habitaciones" i], input[placeholder*="habitaciones" i]') ||
      await page.evaluateHandle(() => {
        const labels = [...document.querySelectorAll('label')].filter(l => (l.innerText||'').toLowerCase().includes('habitaciones'));
        return labels[0] ? labels[0].querySelector('input') : null;
      });
    if (numHab && numHab.asElement()) await writeField(page, numHab.asElement(), ad.bedrooms || '1');

    const numBan = await page.$('input[aria-label*="baños" i], input[placeholder*="baños" i]') ||
      await page.evaluateHandle(() => {
        const labels = [...document.querySelectorAll('label')].filter(l => (l.innerText||'').toLowerCase().includes('baños') || (l.innerText||'').toLowerCase().includes('banos'));
        return labels[0] ? labels[0].querySelector('input') : null;
      });
    if (numBan && numBan.asElement()) await writeField(page, numBan.asElement(), ad.bathrooms || '2');

    const precio = await page.$('input[aria-label*="precio" i], input[placeholder*="precio" i]') ||
      await page.evaluateHandle(() => {
        const labels = [...document.querySelectorAll('label')].filter(l => (l.innerText||'').toLowerCase().includes('precio al mes'));
        return labels[0] ? labels[0].querySelector('input') : null;
      });
    if (precio && precio.asElement()) await writeField(page, precio.asElement(), ad.price || '2500000');

    console.log('4. Ubicación...');
    const addrInput = await page.$('input[role="combobox"][aria-autocomplete="list"][type="text"]') ||
      await page.evaluateHandle(() => {
        const inputs = [...document.querySelectorAll('input[type="text"]')];
        return inputs.find(i => i.getAttribute('role') === 'combobox');
      });
    
    const addrHandle = addrInput && addrInput.asElement ? addrInput.asElement() : null;
    if (!addrHandle) throw new Error('Campo de ubicación no encontrado');

    await addrHandle.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await sleep(500);
    await addrHandle.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await sleep(300);

    const searchTerm = 'Barranquilla';
    await addrHandle.type(searchTerm, { delay: 60 });
    await sleep(3000);

    const suggestionInfo = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="option"], [role="listbox"] li, div[role="listbox"] div[role="button"], ul[role="listbox"] > li')];
      const valid = items.filter(el => {
        const t = (el.innerText || '').trim();
        const r = el.getBoundingClientRect();
        return r.width > 100 && t.length > 3 && !t.toLowerCase().includes('actual');
      });
      return valid.map(el => {
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return {
          text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
          tag: el.tagName,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2
        };
      });
    });

    if (suggestionInfo.length > 0) {
      const best = suggestionInfo[0];
      console.log(`Click en sugerencia: ${best.text}`);
      await page.mouse.click(best.x, best.y);
    }
    await sleep(2500);

    console.log('5. Descripción...');
    const descArea = await page.$('textarea');
    if (descArea) {
      await descArea.evaluate(el => el.scrollIntoView({ block: 'center' }));
      await writeField(page, descArea, ad.description);
    }
    await sleep(2000);

    console.log('6. Haciendo CLICK en Siguiente...');
    const nextBtnBox = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('div[role="button"], button')].find(b => (b.innerText || '').trim().toLowerCase() === 'siguiente');
      if (!btn || btn.getAttribute('aria-disabled') === 'true') return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (!nextBtnBox) throw new Error('Botón Siguiente no está habilitado');
    await page.mouse.click(nextBtnBox.x, nextBtnBox.y);
    console.log('Click en Siguiente realizado, esperando pantalla 2...');
    await sleep(6000);

    console.log('7. Inspeccionando Pantalla 2 (Paso final)...');
    const pubBtnBox = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('div[role="button"], button')].find(b => (b.innerText || '').trim().toLowerCase() === 'publicar');
      if (!btn || btn.getAttribute('aria-disabled') === 'true') return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (!pubBtnBox) throw new Error('Botón Publicar no encontrado o deshabilitado');
    console.log(`Haciendo CLICK en Publicar en (${pubBtnBox.x}, ${pubBtnBox.y})...`);
    await page.mouse.click(pubBtnBox.x, pubBtnBox.y);
    console.log('Click en Publicar enviado, esperando 10s...');
    await sleep(10000);

    console.log('URL actual tras publicar:', page.url());
    await page.screenshot({ path: '/tmp/fb-published.png', fullPage: true });

    let finalUrl = null;
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const cur = page.url();
      console.log('Chequeando URL:', cur);
      const m = cur.match(/facebook\.com\/marketplace\/item\/(\d+)/i);
      if (m) {
        finalUrl = `https://www.facebook.com/marketplace/item/${m[1]}/`;
        break;
      }
      const itemLink = await page.evaluate(() => {
        const a = document.querySelector('a[href*="/marketplace/item/"]');
        return a ? a.href : null;
      }).catch(() => null);
      if (itemLink) {
        const m2 = itemLink.match(/facebook\.com\/marketplace\/item\/(\d+)/i);
        if (m2) { finalUrl = `https://www.facebook.com/marketplace/item/${m2[1]}/`; break; }
      }
      if (!cur.includes('/create/')) {
        console.log('Ya no está en /create/, navegando a /marketplace/you/selling para extraer URL...');
        await page.goto('https://www.facebook.com/marketplace/you/selling', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(6000);
        const sellingItem = await page.evaluate(() => {
          const a = document.querySelector('a[href*="/marketplace/item/"]');
          return a ? a.href : null;
        }).catch(() => null);
        if (sellingItem) {
          const m3 = sellingItem.match(/facebook\.com\/marketplace\/item\/(\d+)/i);
          if (m3) { finalUrl = `https://www.facebook.com/marketplace/item/${m3[1]}/`; break; }
        }
      }
      await sleep(3000);
    }

    console.log('RESULTADO_FINAL_PUBLICACION:', finalUrl);
    if (finalUrl) {
      console.log('🎉🎉🎉 PUBLICACION CONFIRMADA:', finalUrl);
    } else {
      console.log('Aun esperando confirmacion de URL.');
    }

  } finally {
    await browser.close().catch(() => {});
  }
})().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
