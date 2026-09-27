// Verificación local de la imagen reconstruida (solo valores reales del scraper)
// Uso: node scripts/verify-report.cjs [png|html]
const s = require('../server.cjs');
const fs = require('fs');
const path = require('path');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'database.json'), 'utf-8'));

function latest(provider, apt) {
  const list = (db.utilityRecords || []).filter(r => r.provider === provider &&
    (String(r.apartment) === String(apt.name) || String(r.apartmentId) === String(apt.id)));
  list.sort((a, b) => new Date(b.checkedAt || b.scrapedAt || 0) - new Date(a.checkedAt || a.scrapedAt || 0));
  return list[0] || null;
}

const rows = db.apartments.map(apartment => {
  const records = {
    electricity: latest('Air-e', apartment),
    water: latest('Triple A', apartment),
    gas: latest('Gases del Caribe', apartment),
  };
  const services = ['electricity', 'water', 'gas'].map(key => {
    const amounts = s.cloudServiceAmounts(records[key]);
    const amount = Number(amounts.total);
    return {
      known: amounts.totalKnown && Number.isFinite(amount),
      amount: Number.isFinite(amount) ? amount : null,
      month: amounts.month,
      monthKnown: amounts.monthKnown,
      invoiceCount: amounts.invoiceCount,
      invoiceTotalCount: amounts.invoiceTotalCount,
      invoicePendingCount: amounts.invoicePendingCount,
      invoiceOverdueCount: amounts.invoiceOverdueCount,
      financed: amounts.financed,
      quota: amounts.quota,
      installmentCurrent: amounts.installmentCurrent,
      installmentTotal: amounts.installmentTotal,
      financingKnown: amounts.financingKnown,
      changeStatus: null,
      changeDelta: null,
    };
  });
  const complete = services.every(sv => sv.known);
  return {
    apartment: String(apartment.name || apartment.id || '—'),
    services,
    complete,
    total: complete ? services.reduce((sum, sv) => sum + sv.amount, 0) : null,
  };
});

const serviceKeys = ['electricity', 'water', 'gas'];
const serviceTotals = serviceKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.services[i].known ? r.services[i].amount : 0), 0));
const serviceMonthTotals = serviceKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.services[i].monthKnown ? r.services[i].month : 0), 0));
const serviceFinancedTotals = serviceKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.services[i].financingKnown ? r.services[i].financed : 0), 0));
const serviceConfirmedCounts = serviceKeys.map((_, i) => rows.reduce((c, r) => c + (r.services[i].known ? 1 : 0), 0));
const serviceMonthConfirmedCounts = serviceKeys.map((_, i) => rows.reduce((c, r) => c + (r.services[i].monthKnown ? 1 : 0), 0));
const serviceFinancingCounts = serviceKeys.map((_, i) => rows.reduce((c, r) => c + (r.services[i].financingKnown ? 1 : 0), 0));
const serviceInvoiceTotals = serviceKeys.map((_, i) => rows.reduce((sum, r) => sum + (r.services[i].invoiceTotalCount ?? 0), 0));
const serviceInvoiceKnownCounts = serviceKeys.map((_, i) => rows.reduce((c, r) => c + (r.services[i].invoiceTotalCount !== null ? 1 : 0), 0));
const allComplete = rows.length > 0 && rows.every(r => r.complete);

const report = {
  dateLabel: 'VERIFICACIÓN LOCAL',
  rows,
  serviceTotals,
  serviceMonthTotals,
  serviceFinancedTotals,
  serviceConfirmedCounts,
  serviceMonthConfirmedCounts,
  serviceFinancingCounts,
  serviceInvoiceTotals,
  serviceInvoiceKnownCounts,
  serviceSync: { electricity: '—', water: '—', gas: '—' },
  allComplete,
  total: allComplete ? rows.reduce((sum, r) => sum + r.total, 0) : null,
};

const html = s.cloudServicesReportImageHtml(report);
const outDir = path.join(__dirname, '..', '.tmp-report');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.html'), html);

const checks = {
  'sin "vencidas/venc." en el HTML': !/vencidas|venc\./i.test(html),
  'contiene "Facturas sin pagar"': html.includes('Facturas sin pagar'),
  'contiene "Convenio"': html.includes('Convenio'),
  'no contiene "X total · Y venc."': !/total · .*venc/i.test(html),
};
console.log('Checks:', JSON.stringify(checks, null, 2));
console.log('Filas:', rows.length, '| allComplete:', allComplete);
console.log('Totales por servicio:', serviceTotals.map(v => '$' + v.toLocaleString('es-CO')).join(', '));
console.log('Facturas sin pagar (suma):', serviceInvoiceTotals.join(', '));

const mode = process.argv[2] || 'html';
if (mode === 'png') {
  s.renderCloudServicesReportImage(report)
    .then(buffer => {
      fs.writeFileSync(path.join(outDir, 'report.png'), buffer);
      console.log('PNG escrito en .tmp-report/report.png (' + buffer.length + ' bytes)');
    })
    .catch(error => {
      console.error('Error renderizando PNG:', error.message);
      process.exitCode = 1;
    });
} else {
  console.log('HTML escrito en .tmp-report/report.html (' + html.length + ' bytes)');
}