const assert = require('node:assert/strict');
const scraper = require('../services-scraper.cjs');

// The public scraper surface must not expose either removed per-link fallback.
assert.equal(scraper.scrapeWaterBills, undefined);
assert.equal(scraper.scrapeGasBills, undefined);

assert.equal(scraper.parseCopAmount('$ 123.456'), 123456);
assert.equal(scraper.parseWaterBillPage('Saldo pendiente: $ 123.456').status, 'pending');
assert.equal(scraper.parseWaterBillPage('Factura pagada. Saldo: $0').status, 'paid');

const airSummary = scraper.aggregateAirEInvoices([
  { cd_Poliza: '123', cd_EstadosPagoDocumento: 'PENDIENTE', amt_DeudaTotal: 95000, amt_ValorMes: 42000, fechaFactura: '2026-08-01' },
  { cd_Poliza: '123', cd_EstadosPagoDocumento: 'PENDIENTE', amt_DeudaTotal: 95000, amt_ValorMes: 53000, fechaFactura: '2026-07-01' },
]);
assert.equal(airSummary['123'].deudaTotalCOP, 190000);
assert.equal(airSummary['123'].deudaMesCOP, 42000);

const gasSummary = scraper.gasInvoiceSummary([
  { id: 'current', status: 'PENDIENTE', amountDue: 42000, invoiceDate: '2026-08-01' },
  { id: 'old', status: 'PENDIENTE', amountDue: 53000, invoiceDate: '2026-07-01' },
]);
assert.equal(gasSummary.deudaCOP, 95000);
assert.equal(gasSummary.deudaMesCOP, 42000);

const tripleSummary = scraper.tripleAInvoiceSummary([
  { invoiceNumber: 'AAA-08', status: 'PENDING', monthValue: 45000, totalValue: 45000, invoiceDate: '2026-08-01' },
  { invoiceNumber: 'AAA-07', status: 'PENDING', monthValue: 50000, totalValue: 50000, invoiceDate: '2026-07-01' },
]);
assert.equal(tripleSummary.deudaMesCOP, 45000);
assert.equal(tripleSummary.deudaTotalCOP, 95000);
assert.equal(tripleSummary.numFacturas, 2);

// The portal can expose a smaller coupon/component as monthValue while the
// current debt card is totalValue. The card total must be used for Deuda del
// mes; otherwise the report repeats the component and loses the real balance.
const splitTripleSummary = scraper.tripleAInvoiceSummary([
  { invoiceNumber: 'AAA-SPLIT', status: 'PENDING', monthValue: 12257, totalValue: 151224, invoiceDate: '2026-08-01' },
]);
assert.equal(splitTripleSummary.deudaMesCOP, 151224);
assert.equal(splitTripleSummary.deudaTotalCOP, 151224);

const financing = scraper.portalFinancingSummary({
  debts: [{ conceptDescription: 'Acuerdo de financiación', pendingBalance: 120000, quotaValue: 20000 }],
});
assert.equal(financing.financiadaCOP, 120000);
assert.equal(financing.cuotaFinanciadaCOP, 20000);

const gasWithAgreement = scraper.portalFinancingSummary({
  currentDebt: 16846,
  saldoPorFacturar: 149890,
  quotaValue: 5047,
});
assert.equal(gasWithAgreement.financiadaCOP, 149890);
assert.equal(gasWithAgreement.cuotaFinanciadaCOP, 5047);

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
  deudaConveniosCOP: 120000,
  deudaTotalCOP: 50000,
  deudaLabel: 'Deuda Total',
  checkedAt: new Date().toISOString(),
}]);
assert.equal(db.utilityRecords.length, 1);
assert.equal(db.utilityRecords[0].deudaTotalCOP, 50000);
assert.equal(db.utilityRecords[0].deudaConveniosCOP, 120000);
assert.equal(saves, 2);

console.log('Portal-only service scraper checks passed.');
