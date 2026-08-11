const assert = require('node:assert/strict');
const scraper = require('../services-scraper.cjs');

// The public scraper surface must not expose either removed per-link fallback.
assert.equal(scraper.scrapeWaterBills, undefined);
assert.equal(scraper.scrapeGasBills, undefined);

assert.equal(scraper.parseCopAmount('$ 123.456'), 123456);
assert.equal(scraper.parseWaterBillPage('Saldo pendiente: $ 123.456').status, 'pending');
assert.equal(scraper.parseWaterBillPage('Factura pagada. Saldo: $0').status, 'paid');

const db = { utilityRecords: [] };
let saves = 0;
scraper.init(db, () => { saves += 1; });
scraper.persistWaterResults([{
  provider: 'Triple A',
  service: 'water',
  apartmentId: 1,
  apartment: '101',
  waterPaymentCode: '11156',
  status: 'error',
  deudaCOP: null,
  deudaTotalCOP: null,
  deudaLabel: 'Deuda Total',
  error: 'Portal global sin datos',
  checkedAt: new Date().toISOString(),
}]);
assert.equal(db.utilityRecords.length, 1);
assert.equal(db.utilityRecords[0].deudaCOP, null);

scraper.persistWaterResults([{
  provider: 'Triple A',
  service: 'water',
  apartmentId: 1,
  apartment: '101',
  status: 'pending',
  deudaCOP: 50000,
  deudaTotalCOP: 50000,
  deudaLabel: 'Deuda Total',
  checkedAt: new Date().toISOString(),
}]);
assert.equal(db.utilityRecords.length, 1);
assert.equal(db.utilityRecords[0].deudaTotalCOP, 50000);
assert.equal(saves, 2);

console.log('Portal-only service scraper checks passed.');
