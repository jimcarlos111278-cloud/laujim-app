// Smoke test: valida que Chrome headful arranca contra Xvfb (:99).
// Uso en la VM: docker cp /tmp/xvfb-smoke.cjs laujim-app:/tmp/xvfb-smoke.cjs
//   docker exec laujim-app node /tmp/xvfb-smoke.cjs
const fs = require('fs');
const puppeteer = require('/app/node_modules/puppeteer-core');
(async () => {
  const exe = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
    .find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!exe) throw new Error('No Chrome/Chromium binary found');
  console.log('SMOKE binary:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768'],
    protocolTimeout: 30000,
  });
  console.log('SMOKE OK:', await browser.version());
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
