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

  const pendingWithoutSymbol = scraper.parseWaterBillPage('Factura pendiente. Valor total de la factura: 98.765 COP. Periodo agosto 2026');
  assert.equal(pendingWithoutSymbol.status, 'pending');
  assert.equal(pendingWithoutSymbol.deudaCOP, 98765);

  const pendingWithDecimals = scraper.parseWaterBillPage('Factura pendiente. Total a pagar $ 45.600,00');
  assert.equal(pendingWithDecimals.status, 'pending');
  assert.equal(pendingWithDecimals.deudaCOP, 45600);

  const pendingFromApi = scraper.parseWaterBillPage('{"status":"pending","amountDue":"$ 77.777","invoiceTotal":"COP 77.777"}');
  assert.equal(pendingFromApi.status, 'pending');
  assert.equal(pendingFromApi.deudaCOP, 77777);

  assert.equal(scraper.parseWaterBillPage('Verificación CAPTCHA requerida').status, 'captcha');
  assert.equal(scraper.parseWaterBillPage('El portal requiere usuario y contraseña').status, 'error');
  const portalShell = 'Pagos. Aqui podras realizar el pago de tus documentos. Consultar tus deudas. Numero de Cupon 3489242196.';
  assert.equal(scraper.parseWaterBillPage(portalShell).status, 'unknown');
  assert.equal(scraper.parseWaterBillPage(portalShell).deudaCOP, null);
  assert.equal(scraper.waterNavigationError({ apartmentId: 1, apartment: '101', waterPaymentUrl: 'https://example.test' }, new Error('Navigation timeout exceeded')).status, 'timeout');
}

async function testBrowserAndPersistence() {
  const pages = [];
  let navigationOptions = null;
  let evaluateCalls = 0;
  const fakeBrowser = {
    async newPage() {
      const page = {
        url: '',
        setDefaultNavigationTimeout() {},
        async goto(url, options) { this.url = url; navigationOptions = options; return { status: () => 200 }; },
        async evaluate() {
          evaluateCalls += 1;
          return evaluateCalls === 1
            ? 'Cargando factura...'
            : 'Factura pagada. Saldo: $0. Periodo 2026-08';
        },
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
  assert.equal(navigationOptions.timeout, 30000);
  assert.ok(evaluateCalls >= 2, 'the scraper should wait for delayed invoice content');
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

async function testReloadAfterTimeout() {
  let pagesCreated = 0;
  const fakeBrowser = {
    async newPage() {
      const pageNumber = ++pagesCreated;
      return {
        setDefaultNavigationTimeout() {},
        async goto() {
          if (pageNumber === 1) throw new Error('Navigation timeout exceeded');
          return { status: () => 200 };
        },
        async evaluate() { return 'Factura pagada. Saldo: $0. Periodo 2026-08'; },
        async close() {},
      };
    },
    async close() {},
  };

  const results = await scraper.scrapeWaterBills(
    [{ id: 1, name: '101', waterPaymentUrl: 'https://example.test/101' }],
    async () => fakeBrowser,
  );
  assert.equal(pagesCreated, 2, 'the scraper should reopen a page after a timeout');
  assert.equal(results[0].status, 'paid');
}

testParserStates();
testBrowserAndPersistence()
  .then(testReloadAfterTimeout)
  .then(() => console.log('Water scraper checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1; });
