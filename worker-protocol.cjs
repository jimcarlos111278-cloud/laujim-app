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

  if (providerInfo.provider === 'Air-e') {
    result.nic = text(raw.nic || raw.electricityPaymentCode, 80) || null;
    result.deudaText = text(raw.deudaText, 240) || null;
  } else if (providerInfo.provider === 'Triple A') {
    result.waterPaymentCode = text(raw.waterPaymentCode || raw.paymentCode || raw.contract, 120) || null;
    result.waterPaymentUrl = text(raw.waterPaymentUrl, 300) || 'https://portal.aaa.com.co/polizas';
  } else {
    result.gasPaymentCode = text(raw.gasPaymentCode || raw.paymentCode || raw.policy, 120) || null;
    result.gasPaymentUrl = text(raw.gasPaymentUrl, 300) || 'https://www.gascaribe.com/';
  }

  return result;
}

function normalizeWorkerResults(body, options = {}) {
  const records = Array.isArray(body) ? body : body?.results || body?.records;
  if (!Array.isArray(records)) return [];
  return records.map(item => sanitizeWorkerResult(item, options)).filter(Boolean).slice(0, 200);
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
  safeTokenEquals,
};
