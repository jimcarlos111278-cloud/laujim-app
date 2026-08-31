'use strict';

// OCR for payment proofs received through WhatsApp Cloud.
//
// This module deliberately produces evidence, not an accounting decision. OCR
// can misread a digit or a forged screenshot; the payment therefore remains in
// pending_validation until an administrator approves it in Laujim.

const MAX_OCR_BYTES = Math.max(256 * 1024, Number(process.env.PAYMENT_OCR_MAX_BYTES || 16 * 1024 * 1024));
const MAX_PDF_PAGES = Math.max(1, Math.min(5, Number(process.env.PAYMENT_OCR_MAX_PDF_PAGES || 3)));
const OCR_TIMEOUT_MS = Math.max(10_000, Number(process.env.PAYMENT_OCR_TIMEOUT_MS || 90_000));

let tesseractWorkerPromise = null;
let ocrQueue = Promise.resolve();

function ocrEnabled() {
  return String(process.env.PAYMENT_OCR_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

function normaliseText(value) {
  return String(value || '')
    .replaceAll('\u0000', ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fold(value) {
  return normaliseText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function toSafeString(value, max = 120) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function parseMoney(value) {
  let text = String(value || '').replace(/[^0-9,.-]/g, '').trim();
  if (!text) return null;
  // Colombian receipts normally use a dot as the thousands separator. Keep
  // the last two decimal digits only when both separators are present.
  if (text.includes('.') && text.includes(',')) {
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastComma > lastDot && text.length - lastComma - 1 <= 2) text = text.replaceAll('.', '').replace(',', '.');
    else text = text.replace(/[,.]/g, '');
  } else if (text.includes('.')) {
    const parts = text.split('.');
    text = parts.length > 1 && parts.slice(1).every(part => part.length === 3)
      ? parts.join('')
      : text;
  } else if (text.includes(',')) {
    const parts = text.split(',');
    text = parts.length > 1 && parts.slice(1).every(part => part.length === 3)
      ? parts.join('')
      : text.replace(',', '.');
  }
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 && amount < 1_000_000_000 ? Math.round(amount) : null;
}

function moneyFromLabel(text, labels) {
  const source = String(text || '');
  const labelPattern = labels.join('|');
  const labelled = new RegExp(`(?:${labelPattern})[^\\d$]{0,45}(?:\\$\\s*)?([\\d][\\d., ]{0,18})`, 'gi');
  const values = [...source.matchAll(labelled)]
    .map(match => parseMoney(match[1]))
    .filter(amount => amount && amount >= 100);
  return values.length ? Math.max(...values) : null;
}

function amountCandidates(text) {
  const source = String(text || '');
  const values = [];
  const pattern = /(?:\$\s*)?\b\d{1,3}(?:[., ]\d{3})+(?:[.,]\d{1,2})?\b/g;
  for (const match of source.matchAll(pattern)) {
    const amount = parseMoney(match[0]);
    if (amount && !values.includes(amount)) values.push(amount);
  }
  for (const match of source.matchAll(/\$\s*([\d]{3,9})\b/g)) {
    const amount = parseMoney(match[1]);
    if (amount && !values.includes(amount)) values.push(amount);
  }
  return values;
}

function extractReference(text) {
  const source = String(text || '');
  const match = source.match(/(?:referencia|referencia de pago|transacci[oó]n|operaci[oó]n|comprobante|n[uú]mero de pago|id de pago|c[oó]digo)\s*(?:n[°ºo.]?\s*)?[:#-]?\s*([a-z0-9][a-z0-9-]{4,})/i);
  return match ? toSafeString(match[1], 80) : null;
}

function extractDate(text) {
  const source = String(text || '');
  const numeric = source.match(new RegExp('\\b(\\d{1,2})[/-](\\d{1,2})[/-](20\\d{2})\\b'));
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  const months = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
  const named = source.match(new RegExp(`\\b(\\d{1,2})\\s+de?\\s+(${months})\\s+(20\\d{2})\\b`, 'i'));
  if (!named) return null;
  const index = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre'].indexOf(fold(named[2]));
  if (index < 0) return null;
  return `${named[3]}-${String(index + 1).padStart(2, '0')}-${String(named[1]).padStart(2, '0')}`;
}

function detectProvider(text) {
  const source = fold(text);
  const providers = [
    ['nequi', 'Nequi'], ['bancolombia', 'Bancolombia'], ['daviplata', 'DaviPlata'],
    ['davivienda', 'Davivienda'], ['bbva', 'BBVA'], ['banco de bogota', 'Banco de Bogotá'],
    ['banco de occidente', 'Banco de Occidente'], ['scotiabank', 'Scotiabank'],
    ['movii', 'Movii'], ['nu bank|nubank', 'Nu'], ['uala', 'Ualá'],
  ];
  return providers.find(([needle]) => new RegExp(needle).test(source))?.[1] || null;
}

function looksLikePaymentProof(text) {
  const source = fold(text);
  const strongPaymentWords = /(transferencia|transaccion|comprobante|recibido|exitoso|aprobado|enviado|destinatario|beneficiario|referencia|banco|nequi|bancolombia|daviplata)/.test(source);
  const weakPaymentWords = /(pago|valor|monto)/.test(source);
  const amount = moneyFromLabel(text, ['valor', 'monto', 'total', 'importe', 'recibido', 'enviado', 'pago']) || amountCandidates(text)[0];
  return Boolean(amount && (strongPaymentWords || (weakPaymentWords && /\$/.test(text))));
}

function analyseText(text, meta = {}) {
  const source = normaliseText(text);
  const folded = fold(source);
  const hasStrongPaymentLanguage = /(transferencia|transaccion|comprobante|recibido|exitoso|aprobado|enviado|destinatario|beneficiario|referencia|banco|nequi|bancolombia|daviplata)/.test(folded);
  const amount = moneyFromLabel(source, [
    'valor recibido', 'valor transferido', 'valor enviado', 'monto', 'importe',
    'total pagado', 'total pago', 'valor del pago', 'valor', 'total', 'pago',
  ]) || amountCandidates(source)[0] || null;
  const reference = extractReference(source);
  const date = extractDate(source);
  const provider = detectProvider(source);
  const paymentLike = Boolean(looksLikePaymentProof(source));
  const indicators = [
    amount ? 35 : 0,
    paymentLike ? 25 : 0,
    reference ? 15 : 0,
    date ? 10 : 0,
    provider ? 10 : 0,
    /(?:exitoso|aprobado|completado|recibido)/i.test(folded) ? 5 : 0,
  ];
  const confidence = Math.min(100, indicators.reduce((sum, item) => sum + item, 0));
  const status = !source
    ? 'unreadable'
    : !paymentLike && !amount
      ? 'not_payment_proof'
      : confidence >= 70
        ? 'readable'
        : 'partial';
  return {
    engine: meta.engine || 'text', source: meta.source || 'unknown', pageCount: meta.pageCount || 1,
    amount, reference, date, provider, confidence, status,
    hasPaymentLanguage: paymentLike,
    hasStrongPaymentLanguage,
    processedAt: new Date().toISOString(),
    // Keep only a tiny diagnostic excerpt; never persist the full OCR text.
    excerpt: toSafeString(source.slice(0, 180), 180),
  };
}

async function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const language = String(process.env.PAYMENT_OCR_LANGUAGE || 'spa+eng').trim() || 'spa+eng';
      const worker = await createWorker(language, 1, { logger: () => {} });
      return worker;
    })().catch(error => {
      tesseractWorkerPromise = null;
      throw error;
    });
  }
  return tesseractWorkerPromise;
}

function runWithTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} superó el tiempo máximo`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function recogniseImage(buffer) {
  const run = async () => {
    const worker = await getTesseractWorker();
    const result = await worker.recognize(buffer);
    return String(result?.data?.text || '');
  };
  // Tesseract's worker is intentionally serialized: one Render instance may
  // receive several WhatsApp messages at once, but the worker is not safe to
  // run concurrently and parallel OCR would spike memory.
  const next = ocrQueue.catch(() => {}).then(() => runWithTimeout(run(), OCR_TIMEOUT_MS, 'OCR'));
  ocrQueue = next.catch(() => {});
  return next;
}

async function extractPdfText(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await runWithTimeout(parser.getText({}), OCR_TIMEOUT_MS, 'Lectura de PDF');
    return { text: String(result?.text || ''), pageCount: Number(result?.total || result?.pages?.length || 1) };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractPdfScreenshots(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await runWithTimeout(parser.getScreenshot({
      first: 1, last: MAX_PDF_PAGES, scale: 1.35, imageBuffer: true, imageDataUrl: false,
    }), OCR_TIMEOUT_MS, 'Render de PDF');
    return (result?.pages || []).map(page => Buffer.from(page.data || [])).filter(item => item.length > 0);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function analysePaymentProofMedia({ buffer, mimeType, fileName } = {}) {
  const startedAt = Date.now();
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();
  const base = { source: mime.includes('pdf') || name.endsWith('.pdf') ? 'pdf' : 'image' };
  if (!ocrEnabled()) return { ...base, engine: 'disabled', status: 'disabled', confidence: 0, processedAt: new Date().toISOString() };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ...base, engine: 'none', status: 'unreadable', confidence: 0, error: 'Archivo vacío' };
  if (buffer.length > MAX_OCR_BYTES) return { ...base, engine: 'none', status: 'too_large', confidence: 0, error: `Archivo mayor a ${MAX_OCR_BYTES} bytes` };

  try {
    if (base.source === 'pdf') {
      const extracted = await extractPdfText(buffer);
      const textResult = analyseText(extracted.text, { engine: 'pdf-text', source: 'pdf', pageCount: extracted.pageCount });
      if (textResult.status !== 'unreadable' && textResult.status !== 'not_payment_proof') {
        return { ...textResult, elapsedMs: Date.now() - startedAt };
      }
      // Many bank PDFs are scans with no selectable text. Render a small
      // number of pages and send those images through the same OCR engine.
      const screenshots = await extractPdfScreenshots(buffer);
      const pageTexts = [];
      for (const screenshot of screenshots) pageTexts.push(await recogniseImage(screenshot));
      const combined = pageTexts.join('\n');
      return { ...analyseText(combined, { engine: 'tesseract-pdf', source: 'pdf', pageCount: screenshots.length || extracted.pageCount }), elapsedMs: Date.now() - startedAt };
    }
    const text = await recogniseImage(buffer);
    return { ...analyseText(text, { engine: 'tesseract', source: 'image' }), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ...base, engine: error.message?.startsWith('OCR') ? 'tesseract' : 'ocr', status: 'unavailable', confidence: 0, error: toSafeString(error.message, 180), processedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
  }
}

function ocrSummary(ocr) {
  if (!ocr || typeof ocr !== 'object') return 'OCR no ejecutado';
  if (ocr.status === 'readable') return `OCR legible (${ocr.confidence}% de confianza)${ocr.amount ? ` · ${ocr.amount}` : ''}`;
  if (ocr.status === 'partial') return `OCR parcial (${ocr.confidence}% de confianza)`;
  if (ocr.status === 'not_payment_proof') return 'La imagen no parece un comprobante de pago';
  if (ocr.status === 'unavailable') return 'OCR no disponible en este momento';
  if (ocr.status === 'too_large') return 'Archivo demasiado grande para OCR';
  if (ocr.status === 'disabled') return 'OCR desactivado';
  return 'OCR sin datos suficientes';
}

module.exports = {
  analysePaymentProofMedia,
  analyseText,
  ocrEnabled,
  ocrSummary,
  parseMoney,
};
