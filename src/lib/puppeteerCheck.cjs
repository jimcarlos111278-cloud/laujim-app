const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const POLICE_BASE = 'https://antecedentes.policia.gov.co:7005/WebJudicial';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

let browser = null;
let browserWSEndpoint = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await puppeteer.launch({
    headless: 'shell',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-web-security',
    ],
    executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
  });
  return browser;
}

async function closeBrowser() {
  if (browser) { try { await browser.close(); } catch {} browser = null; }
}

async function autoCheck(documentId, timeoutMs = 60000) {
  const page = await (await getBrowser()).newPage();
  const logs = [];

  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CO,es;q=0.9' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'es-CO' });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-CO', 'es'] });
    });

    const result = await Promise.race([
      runCheck(page, documentId, logs),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
    ]);

    return result;
  } catch (e) {
    logs.push('Error: ' + e.message);
    let screenshot = null;
    try { screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 }); } catch {}
    return { status: 'error', message: e.message, logs, screenshot };
  } finally {
    try { await page.close(); } catch {}
  }
}

async function runCheck(page, documentId, logs) {
  logs.push('Navigating to police site...');
  await page.goto(POLICE_BASE + '/antecedentes.xhtml', { waitUntil: 'networkidle', timeout: 30000 });

  // Accept terms if present
  const hasTerms = await page.$('#aceptaOption, #continuarBtn, [value="Acepto"], [value="aceptaOption"]');
  if (hasTerms) {
    logs.push('Terms page detected, accepting...');
    await page.evaluate(() => {
      const opt = document.getElementById('aceptaOption');
      if (opt) opt.checked = true;
    });
    await page.click('#continuarBtn');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    logs.push('Terms accepted');
  }

  // Wait for the search form
  logs.push('Waiting for search form...');
  await page.waitForSelector('#cedulaInput', { timeout: 15000 }).catch(() => {});

  // Fill the cedula
  const cedulaInput = await page.$('#cedulaInput');
  if (!cedulaInput) {
    logs.push('Could not find cedula input');
    const html = await page.content();
    return { status: 'error', message: 'No se encontró el campo de cédula en la página', logs, html: html.slice(0, 2000) };
  }

  await cedulaInput.click({ clickCount: 3 });
  await cedulaInput.type(documentId, { delay: 30 });
  logs.push('Filled cedula: ' + documentId);

  // Look for the consultar button
  const consultarBtn = await page.$('input[value="Consultar"], #consultarBtn, input[src*="consultar"]');
  if (!consultarBtn) {
    logs.push('Consultar button not found by selector, trying by text content...');
    const allButtons = await page.$$('input, button, a');
    let found = null;
    for (const btn of allButtons) {
      const text = await page.evaluate(el => el.value || el.textContent || '', btn);
      if (text.toLowerCase().includes('consultar')) { found = btn; break; }
    }
    if (!found) {
      return { status: 'error', message: 'No se encontró el botón Consultar', logs };
    }
    logs.push('Clicking Consultar (found by text)...');
    await found.click();
  } else {
    logs.push('Clicking Consultar...');
    await consultarBtn.click();
  }

  // Wait for navigation/result
  await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // Check the result
  const text = await page.evaluate(() => document.body.innerText);
  logs.push('Response text preview: ' + text.slice(0, 500));

  if (text.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES')) {
    logs.push('Result: CLEAN');
    return { status: 'clean', clean: true, detail: '', logs };
  }

  if (/REGISTRA ANTECEDENTES|TIENE ANTECEDENTES|CON ANTECEDENTES|SÍ REGISTRA/i.test(text)) {
    logs.push('Result: FLAGGED');
    return { status: 'flagged', clean: false, detail: 'Tiene antecedentes judiciales', logs };
  }

  const hasRecaptcha = await page.$('.g-recaptcha, iframe[src*="recaptcha"], #g-recaptcha-response');
  const html = await page.content();

  if (hasRecaptcha || /recaptcha|g-recaptcha|No soy un robot|I'm not a robot/i.test(html)) {
    logs.push('Captcha detected, trying to interact...');

    try {
      const frames = await page.frames();
      const recaptchaFrame = frames.find(f => f.url().includes('recaptcha'));
      if (recaptchaFrame) {
        logs.push('Found reCAPTCHA frame, attempting checkbox click...');
        const cb = await recaptchaFrame.$('.recaptcha-checkbox-border');
        if (cb) {
          await cb.click();
          await new Promise(r => setTimeout(r, 3000));
          logs.push('Clicked reCAPTCHA checkbox');
        }
      }
    } catch (ce) {
      logs.push('reCAPTCHA interaction error: ' + ce.message);
    }

    await new Promise(r => setTimeout(r, 2000));

    // Check if there's an audio challenge button
    try {
      const audioBtn = await page.$('#recaptcha-audio-button, .rc-button-audio');
      if (audioBtn) {
        logs.push('Audio challenge available, clicking...');
        await audioBtn.click();
        await new Promise(r => setTimeout(r, 3000));
        // Try to play audio and get text - this is complex, skip for now
        logs.push('Audio challenge mode entered (requires STT to solve)');
      }
    } catch (ae) {
      logs.push('Audio button error: ' + ae.message);
    }

    let screenshot = null;
    try { screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 50 }); } catch {}

    return {
      status: 'captcha',
      message: 'El captcha no pudo resolverse automáticamente. Usa el flujo manual.',
      logs,
      screenshot,
      html: html.slice(0, 1000),
    };
  }

  logs.push('Could not determine result, unexpected response');
  return { status: 'error', message: 'Respuesta inesperada de la Policía', logs, html: html.slice(0, 2000) };
}

module.exports = { autoCheck, closeBrowser };
