const assert = require('node:assert/strict');
const scraper = require('../services-scraper.cjs');

function testParserStates() {
  const paid = scraper.parseWaterBillPage('Factura pagada. Saldo pendiente: $0. Factura No. AAA-12345. Periodo 2026-08');
  assert.equal(paid.status, 'paid');
  assert.equal(paid.deudaCOP, 0);
  assert.equal(paid.factura, 'AAA-12345');
  assert.equal(paid.periodo, '2026-08');

  const pending = scraper.parseWaterBillPage('Saldo pendiente: $ 123.456. Factura No. AAA-12345. Periodo 2026-08');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.deudaCOP, 123456);
  assert.equal(pending.factura, 'AAA-12345');

  assert.equal(scraper.parseWaterBillPage('Verificación CAPTCHA requerida').status, 'captcha');
  assert.equal(scraper.parseWaterBillPage('El portal requiere usuario y contraseña').status, 'error');
  assert.equal(scraper.waterNavigationError({ apartmentId: 1, apartment: '101', waterPaymentUrl: 'https://example.test' }, new Error('Navigation timeout exceeded')).status, 'timeout');
}

async function testBrowserAndPersistence() {
  const pages = [];
  let navigationOptions = null;
  const fakeBrowser = {
    async newPage() {
      const page = {
        url: '',
        setDefaultNavigationTimeout() {},
        async goto(url, options) { this.url = url; navigationOptions = options; return { status: () => 200 }; },
        async evaluate() { return 'Factura pagada. Saldo: $0. Periodo 2026-08'; },
        async close() { pages.push(this.url); },
      };
      return page;
    },
    async close() { this.closed = true; },
  };

  const apartments = [{ id: 1, name: '101', waterPaymentUrl: 'https://example.test/101', waterPaymentCode: '123' }];
  const results = await scraper.scrapeWaterBills(apartments, async () => fakeBrowser);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'paid');
  assert.equal(results[0].apartmentId, 1);
  assert.equal(navigationOptions.waitUntil, 'domcontentloaded');
  assert.equal(pages.length, 1);
  assert.equal(fakeBrowser.closed, true);

  const db = { utilityRecords: [] };
  let saves = 0;
  scraper.init(db, () => { saves++; });
  scraper.persistWaterResults(results);
  assert.equal(db.utilityRecords.length, 1);
  assert.equal(db.utilityRecords[0].provider, 'Triple A');
  assert.equal(db.utilityRecords[0].service, 'water');
  assert.equal(saves, 1);

  scraper.persistWaterResults([{ ...results[0], status: 'pending', deudaCOP: 50000 }]);
  assert.equal(db.utilityRecords.length, 1);
  assert.equal(db.utilityRecords[0].deudaCOP, 50000);
  assert.equal(saves, 2);
}

testParserStates();
testBrowserAndPersistence()
  .then(() => console.log('Water scraper checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
