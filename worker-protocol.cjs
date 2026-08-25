'use strict';

const crypto = require('crypto');

const WORKER_PROTOCOL_VERSION = 1;
const PROVIDERS = new Map([
  ['air-e', { provider: 'Air-e', service: 'electricity' }],
  ['air-e electricity', { provider: 'Air-e', service: 'electricity' }],
  ['air-e electric', { provider: 'Air-e', service: 'electricity' }],
  ['electricity', { provider: 'Air-e', service: 'electricity' }],
  ['water', { provider: 'Triple A', service: 'water' }],
  ['triple a', { provider: 'Triple A', service: 'water' }],
  ['triple-a', { provider: 'Triple A', service: 'water' }],
  ['gas', { provider: 'Gases del Caribe', service: 'gas' }],
  ['gases del caribe', { provider: 'Gases del Caribe', service: 'gas' }],
  ['gascaribe', { provider: 'Gases del Caribe', service: 'gas' }],
]);

const ALLOWED_STATUSES = new Set(['pending', 'paid', 'error', 'captcha', 'timeout', 'unknown']);

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function gasContractPaymentUrl(contract) {
  const code = text(contract, 120);
  return code ? `https://portal.gascaribe.com/payments/contract/${encodeURIComponent(code)}` : null;
}

function normalizeWorkerId(value) {
  const id = text(value, 128);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(id) ? id : null;
}

function normalizeProvider(value, service) {
  const providerKey = text(value, 80).toLowerCase().replace(/\s+/g, ' ');
  const serviceKey = text(service, 40).toLowerCase();
  return PROVIDERS.get(providerKey) || PROVIDERS.get(serviceKey) || null;
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
  const raw = text(value, 80).replace(/[^0-9-]/g, '');
  if (!raw || raw === '-') return null;
  const amount = Number(raw);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

// Optional monetary fields are intentionally kept separate from the legacy
// deudaTotalCOP field.  The local scraper already returns these values, but
// the portable-worker normalizer used to discard them before persistence.
function optionalAmount(raw, keys) {
  if (!raw || typeof raw !== 'object') return undefined;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (raw[key] === null || raw[key] === undefined || raw[key] === '') continue;
    return normalizeAmount(raw[key]);
  }
  return undefined;
}

function isoOrNow(value, now = new Date().toISOString()) {
  const candidate = new Date(value || '');
  return Number.isNaN(candidate.getTime()) ? now : candidate.toISOString();
}

function normalizeStatus(value, amount) {
  const status = text(value, 30).toLowerCase();
  if (ALLOWED_STATUSES.has(status)) return status;
  if (amount !== null && amount > 0) return 'pending';
  if (amount === 0) return 'paid';
  return 'unknown';
}

function sanitizeWorkerResult(raw, { deviceId = null, now = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const providerInfo = normalizeProvider(raw.provider, raw.service);
  if (!providerInfo) return null;

  const apartmentId = normalizeInteger(raw.apartmentId);
  const apartment = text(raw.apartment || raw.apartmentName, 80) || null;
  if (apartmentId === null && !apartment) return null;

  const amount = normalizeAmount(raw.deudaTotalCOP ?? raw.deudaCOP ?? raw.totalDebt ?? raw.debt);
  const monthAmount = optionalAmount(raw, [
    'deudaMesCOP', 'valorMesCOP', 'monthValueCOP', 'facturaValorCOP',
    'invoiceValueCOP', 'valorFacturaCOP', 'amt_TotalMes', 'totalMes',
    'totalMesSinTasa', 'deudaMes', 'valorMes', 'monthValue', 'facturaValor',
  ]);
  const financedAmount = optionalAmount(raw, [
    'deudaConveniosCOP', 'financiadaCOP', 'deudaFinanciada', 'saldoFinanciado',
    'financedDebt', 'valorFinanciado', 'financingValue', 'financedAmount',
    'saldoDeudaFinanciada', 'saldoPorFacturar',
  ]);
  const quotaAmount = optionalAmount(raw, [
    'cuotaFinanciadaCOP', 'cuotaFinanciada', 'quotaValue', 'valorCuota',
    'valorCuotaFinanciada', 'monthlyQuota', 'cuotaMensual',
  ]);
  const invoiceAmount = optionalAmount(raw, [
    'facturaValorCOP', 'invoiceValueCOP', 'valorFacturaCOP', 'invoiceValue',
    'valorFactura', 'monthValueCOP', 'deudaMesCOP',
  ]);
  const checkedAt = isoOrNow(raw.checkedAt || raw.scrapedAt, now);
  const result = {
    provider: providerInfo.provider,
    service: providerInfo.service,
    apartmentId,
    apartment,
    status: normalizeStatus(raw.status, amount),
    deudaCOP: amount,
    deudaTotalCOP: amount,
    deudaLabel: 'Deuda Total',
    numFacturas: normalizeInteger(raw.numFacturas),
    factura: text(raw.factura || raw.invoiceNumber, 120) || null,
    periodo: text(raw.periodo || raw.billingPeriod, 80) || null,
    error: text(raw.error, 500) || null,
    checkedAt,
    scrapedAt: checkedAt,
    source: 'portable-worker',
    workerDeviceId: normalizeWorkerId(deviceId),
  };

  // Do not write null optional fields when the worker did not send them. This
  // lets mergeUtilityRecord retain the last confirmed split during a partial
  // or legacy run, while still persisting valid zero values for paid records.
  if (monthAmount !== undefined) result.deudaMesCOP = monthAmount;
  if (financedAmount !== undefined) {
    result.deudaConveniosCOP = financedAmount;
    result.financiadaCOP = financedAmount;
  }
  if (quotaAmount !== undefined) result.cuotaFinanciadaCOP = quotaAmount;
  if (invoiceAmount !== undefined) result.facturaValorCOP = invoiceAmount;

  if (providerInfo.provider === 'Air-e') {
    result.nic = text(raw.nic || raw.electricityPaymentCode, 80) || null;
    result.deudaText = text(raw.deudaText, 240) || null;
  } else if (providerInfo.provider === 'Triple A') {
    result.waterPaymentCode = text(raw.waterPaymentCode || raw.paymentCode || raw.contract, 120) || null;
    result.waterPaymentUrl = text(raw.waterPaymentUrl, 300) || 'https://portal.aaa.com.co/polizas';
  } else {
    result.gasPaymentCode = text(raw.gasPaymentCode || raw.paymentCode || raw.policy, 120) || null;
    // Never persist a receipt/coupon QR from the worker. The public tenant
    // link is always derived from the contract number.
    result.gasPaymentUrl = gasContractPaymentUrl(result.gasPaymentCode);
  }

  return result;
}

function normalizeWorkerResults(body, options = {}) {
  return inspectWorkerResults(body, options).records;
}

function providerCount(records) {
  return records.reduce((counts, record) => {
    const key = text(record?.provider || record?.service, 80) || '<sin proveedor>';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

// Keep the normalizer strict, but expose enough non-sensitive diagnostics to
// explain why a phone/PC says it sent N records while the server accepts fewer.
// Do not include credentials, tokens, raw portal payloads, or debt values here.
function inspectWorkerResults(body, options = {}) {
  const rawRecords = Array.isArray(body) ? body : body?.results || body?.records;
  if (!Array.isArray(rawRecords)) {
    return {
      records: [],
      received: 0,
      accepted: 0,
      rejected: [{ index: null, reason: 'results_no_es_un_arreglo' }],
      acceptedByProvider: {},
      rejectedByProvider: {},
      truncated: 0,
    };
  }

  const accepted = [];
  const rejected = [];
  const limited = rawRecords.slice(0, 200);
  limited.forEach((item, index) => {
    const sanitized = sanitizeWorkerResult(item, options);
    if (sanitized) {
      accepted.push(sanitized);
      return;
    }

    let reason = 'registro_invalido';
    let provider = null;
    let service = null;
    let apartment = null;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      reason = 'registro_no_es_un_objeto';
    } else {
      provider = text(item.provider, 80) || null;
      service = text(item.service, 40) || null;
      apartment = text(item.apartment || item.apartmentName, 80) || null;
      if (!normalizeProvider(item.provider, item.service)) reason = 'proveedor_o_servicio_no_reconocido';
      else if (normalizeInteger(item.apartmentId) === null && !apartment) reason = 'apartamento_sin_id_ni_nombre';
    }
    rejected.push({ index, provider, service, apartment, reason });
  });

  return {
    records: accepted,
    received: rawRecords.length,
    accepted: accepted.length,
    confirmed: accepted.filter(record =>
      ['pending', 'paid'].includes(record.status) && record.deudaTotalCOP !== null
    ).length,
    issueCount: accepted.filter(record =>
      !['pending', 'paid'].includes(record.status) || record.deudaTotalCOP === null
    ).length,
    rejected,
    acceptedByProvider: providerCount(accepted),
    confirmedByProvider: providerCount(accepted.filter(record =>
      ['pending', 'paid'].includes(record.status) && record.deudaTotalCOP !== null
    )),
    issueByProvider: providerCount(accepted.filter(record =>
      !['pending', 'paid'].includes(record.status) || record.deudaTotalCOP === null
    )),
    rejectedByProvider: providerCount(rejected),
    truncated: Math.max(0, rawRecords.length - limited.length),
  };
}

function safeTokenEquals(provided, expected) {
  const left = Buffer.from(String(provided || '').trim());
  const right = Buffer.from(String(expected || '').trim());
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = {
  WORKER_PROTOCOL_VERSION,
  normalizeWorkerId,
  normalizeProvider,
  normalizeAmount,
  sanitizeWorkerResult,
  normalizeWorkerResults,
  inspectWorkerResults,
  safeTokenEquals,
};
