// Diagnostic harness: run scrapeAirE locally to find where the sync fails.
const fs = require('fs');
const path = require('path');
const scraper = require('../services-scraper.cjs');

const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'database.json'), 'utf-8'));
scraper.init(db, () => {});
console.log('portalCredentials:', (db.portalCredentials || []).map(c => c.provider + ':' + (c.username ? 'set' : 'MISSING') + '/' + (c.password ? 'set' : 'MISSING')).join(', '));

(async () => {
  const t0 = Date.now();
  const results = await scraper.scrapeAirE();
  console.log('ELAPSED_MS:', Date.now() - t0);
  console.log('RESULTS_COUNT:', results.length);
  console.log('RESULTS:', JSON.stringify(results, null, 2));
})().catch((e) => { console.error('HARNESS_ERROR:', e.message, e.stack); process.exit(1); });
