// Standalone script to run the Triple A (water) scrape and print results.
// Loads data/database.json, inits the scraper, runs scrapeTripleAAccount().
// Usage: node scripts/run-triplea-scrape.cjs
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'database.json');
const scraper = require(path.join(ROOT, 'services-scraper.cjs'));

async function main() {
  const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // No-op save: we only want to extract values, not persist.
  const saveData = async () => {};
  scraper.init(db, saveData);

  console.log('=== Iniciando scrape de Triple A ===');
  const started = Date.now();
  const results = await scraper.scrapeTripleAAccount();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n=== Resultados (${results.length} apartamentos, ${elapsed}s) ===`);
  for (const r of results) {
    console.log(JSON.stringify({
      apartment: r.apartment,
      status: r.status,
      deudaMesCOP: r.deudaMesCOP,
      deudaCOP: r.deudaCOP,
      financiadaCOP: r.financiadaCOP,
      debtEndpointStatus: r.debtEndpointStatus,
      error: r.error || null,
    }, null, 2));
  }

  const lastErr = scraper.getLastWaterScrapeError();
  if (lastErr) console.log(`\n[lastWaterScrapeError] ${lastErr}`);
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
