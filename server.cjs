const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const { exec } = require('child_process');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const { Pool } = require('pg');
const servicesScraper = require('./services-scraper.cjs');
const workerProtocol = require('./worker-protocol.cjs');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const ffmpegPath = require('ffmpeg-static');
const { analysePaymentProofMedia, ocrSummary } = require('./payment-receipt-ocr.cjs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 1011;
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;
let requestCount = 0;
let responseCount = 0;
let responseBytes = 0;
const trafficStartedAt = new Date().toISOString();
// Private API requests must not run against the INITIAL_DATA object while the
// durable store is still loading. Otherwise a deploy can briefly create a
// valid-looking session backed by an empty database and the UI ends up showing
// "0 apartments" until the next reload.
let databaseReady = false;
let databaseState = 'starting';
let databaseError = null;
let databaseLoadedAt = null;

process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err.message, err.stack); });
process.on('unhandledRejection', (reason) => { console.error('UNHANDLED:', reason); });

app.get('/health', (req, res) => res.send('ok'));

app.use(cors({
  exposedHeaders: ['x-auth-token'],
  allowedHeaders: ['Content-Type', 'x-auth-token', 'x-worker-token', 'x-worker-id'],
}));
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.use((req, res, next) => {
  res.once('finish', () => {
    responseCount += 1;
    const contentLength = Number(res.getHeader('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 0) responseBytes += contentLength;
  });
  if (req.path.startsWith('/api/')) requestCount++;
  const isPublicApi = req.path === '/api/login' || req.path === '/api/version' ||
    req.path === '/api/ready' || req.path === '/api/admin/recovery-status' || req.path === '/api/admin/recover-password' ||
    req.path.startsWith('/api/public/') || req.path === '/api/whatsapp/webhook';
  if (req.path.startsWith('/api/') && !isPublicApi) {
    if (!databaseReady) {
      return res.status(503).json({
        error: databaseState === 'error'
          ? 'La base de datos no está disponible en este momento.'
          : 'La base de datos todavía está iniciando. Intenta de nuevo en unos segundos.',
        databaseState,
      });
    }
    const session = getAuthSession(req.headers['x-auth-token']);
    if (!session) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    req.auth = session;
    const tenantPath = req.path === '/api/logout' || req.path.startsWith('/api/tenant/');
    if (session.role === 'tenant' && !tenantPath) {
      return res.status(403).json({ error: 'Acceso restringido al apartamento autenticado' });
    }
  }
  next();
});

const PERSISTENT_DIR = process.env.PERSISTENT_DIR || __dirname;
const DATA_DIR = path.join(PERSISTENT_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
const BACKUP_DIR = path.join(PERSISTENT_DIR, 'backups');
const BACKUP_FILE = path.join(BACKUP_DIR, 'auto-latest.json');
const UPLOADS_DIR = path.join(PERSISTENT_DIR, 'uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
const CONTRACTS_DIR = path.join(UPLOADS_DIR, 'contracts');

try { [DATA_DIR, BACKUP_DIR, PHOTOS_DIR, CONTRACTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }); } catch (e) { console.error('DIR SETUP FAILED:', e.message); }

let upload;
try {
  // Apartment documents are immediately copied to R2; keeping them in
  // memory avoids treating Render's ephemeral filesystem as an archive.
  upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
} catch (e) { console.error('MULTER SETUP FAILED:', e.message); upload = null; }

// Attachments sent from the Cloud inbox are relayed directly to Meta. They are
// kept in memory only for the duration of the request; this prevents the
// Render filesystem from becoming an accidental, non-durable media archive.
let cloudUpload;
try {
  cloudUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
} catch (e) { console.error('CLOUD MULTER SETUP FAILED:', e.message); cloudUpload = null; }

const { INITIAL_DATA } = require('./db.cjs');

let db = { ...INITIAL_DATA };
let nextId = {};

// R2 remains private. Files are served only through application routes, so an
// object URL or storage credential never reaches a browser.
const R2_DEFAULT_LIMIT_BYTES = 9 * 1024 * 1024 * 1024;
let r2Client = null;

function r2Config() {
  // Render's environment export can preserve a pair of outer quotes. That is
  // harmless for plain text values but makes the AWS SDK reject the endpoint
  // as an invalid URL. Normalize only the R2 settings so both Render nodes
  // can read the same permanent apartment photos.
  const clean = value => {
    const raw = String(value ?? '').trim();
    if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  };
  const accountId = clean(process.env.R2_ACCOUNT_ID)
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split('.')[0];
  const bucket = clean(process.env.R2_BUCKET);
  const accessKeyId = clean(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(process.env.R2_SECRET_ACCESS_KEY);
  const configuredEndpoint = clean(process.env.R2_ENDPOINT).replace(/\/+$/, '');
  // Prefer the canonical Cloudflare endpoint derived from the account ID.
  // This avoids a copied/custom endpoint causing TLS failures on the backup.
  let endpoint = accountId ? `https://${accountId}.r2.cloudflarestorage.com` : configuredEndpoint;
  try { new URL(endpoint); } catch { endpoint = accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''; }
  const limitBytes = Math.max(1, Number(process.env.R2_MAX_BYTES || R2_DEFAULT_LIMIT_BYTES));
  return { accountId, bucket, accessKeyId, secretAccessKey, endpoint, limitBytes };
}

function r2Ready() {
  const c = r2Config();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey && c.endpoint);
}

function getR2Client() {
  if (!r2Ready()) throw new Error('El almacenamiento permanente R2 no est\u00e1 configurado');
  if (!r2Client) {
    const c = r2Config();
    r2Client = new S3Client({
      region: 'auto', endpoint: c.endpoint, forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
  }
  return r2Client;
}

function ensureR2Usage() {
  if (!db.r2Storage || typeof db.r2Storage !== 'object' || Array.isArray(db.r2Storage)) {
    db.r2Storage = { bytes: 0, updatedAt: null };
  }
  db.r2Storage.bytes = Math.max(0, Number(db.r2Storage.bytes) || 0);
  return db.r2Storage;
}

function r2SafeFileName(name) {
  return String(name || 'archivo').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'archivo';
}

function r2Key(section, fileName) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return `${section}/${stamp}/${crypto.randomUUID()}-${r2SafeFileName(fileName)}`;
}

async function putR2Buffer({ section, fileName, buffer, mimeType, contentDisposition = null }) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Archivo inv\u00e1lido para almacenamiento permanente');
  const c = r2Config();
  const usage = ensureR2Usage();
  if (usage.bytes + buffer.length > c.limitBytes) {
    throw new Error('El almacenamiento permanente alcanz\u00f3 el l\u00edmite seguro de 9 GB. Elimina archivos antes de agregar otro.');
  }
  const key = r2Key(section, fileName);
  await getR2Client().send(new PutObjectCommand({
    Bucket: c.bucket, Key: key, Body: buffer,
    ContentType: mimeType || 'application/octet-stream',
    ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
  }));
  usage.bytes += buffer.length;
  usage.updatedAt = new Date().toISOString();
  return { storageKey: key, size: buffer.length, mimeType: mimeType || 'application/octet-stream', storedAt: usage.updatedAt };
}

async function deleteR2Object(storageKey, knownSize = 0) {
  if (!storageKey || !r2Ready()) return;
  await getR2Client().send(new DeleteObjectCommand({ Bucket: r2Config().bucket, Key: storageKey }));
  const usage = ensureR2Usage();
  usage.bytes = Math.max(0, usage.bytes - Math.max(0, Number(knownSize) || 0));
  usage.updatedAt = new Date().toISOString();
}

async function streamR2Object(storageKey, res, fallback = {}) {
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: r2Config().bucket, Key: storageKey }));
  const safeName = r2SafeFileName(fallback.fileName || path.basename(storageKey));
  res.setHeader('Content-Type', object.ContentType || fallback.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  if (object.ContentLength !== undefined) res.setHeader('Content-Length', String(object.ContentLength));
  object.Body.pipe(res);
}

async function getR2Buffer(storageKey) {
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: r2Config().bucket, Key: storageKey }));
  if (!object.Body) throw new Error('El archivo permanente no devolvió contenido');
  if (typeof object.Body.transformToByteArray === 'function') {
    return Buffer.from(await object.Body.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function storedAdminPasswordHash() {
  return String((db.settings || []).find(item => item.key === 'admin_password_hash')?.value || '');
}

function hashAdminPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const digest = crypto.scryptSync(String(password || ''), salt, 32).toString('base64url');
  return `scrypt$${salt}$${digest}`;
}

function verifyAdminPasswordHash(password, packed) {
  const parts = String(packed || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  try {
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(String(password || ''), parts[1], expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function adminPasswordMatches(password) {
  const stored = storedAdminPasswordHash();
  if (stored) return verifyAdminPasswordHash(password, stored);
  const configured = process.env.ADMIN_PASSWORD || '';
  return Boolean(configured && constantTimeEqual(password, configured));
}

function saveAdminPassword(password) {
  if (!Array.isArray(db.settings)) db.settings = [];
  const value = hashAdminPassword(password);
  const existing = db.settings.find(item => item.key === 'admin_password_hash');
  if (existing) existing.value = value;
  else {
    const record = { id: nextId.settings || 1, key: 'admin_password_hash', value };
    db.settings.push(record);
    nextId.settings = record.id + 1;
  }
  // Remove the unreachable legacy plaintext override if an old build created it.
  db.settings = db.settings.filter(item => item.key !== 'admin_password');
  saveData();
}

// ─── Utility credentials (stored in plain text) ───────────────────────────
// The portal-credentials endpoints are protected by requireCloudAdmin, so
// values are stored/returned verbatim. Encryption was removed because the
// runtime filesystem is ephemeral and generated keys caused unrecoverable
// ciphertext across restarts. Only the ADMIN_PASSWORD secret protects access.
function encryptSecret(plaintext) {
  return plaintext;
}

function decryptSecret(value) {
  return value;
}

function ensureAuthSessions() {
  if (!Array.isArray(db.authSessions)) db.authSessions = [];
}

function pruneAuthSessions() {
  ensureAuthSessions();
  const now = Date.now();
  const before = db.authSessions.length;
  db.authSessions = db.authSessions.filter(session => new Date(session.expiresAt).getTime() > now);
  return before !== db.authSessions.length;
}

function createAuthSession({ role, name, apartmentId = null, tenantId = null }) {
  pruneAuthSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const session = {
    id: crypto.randomUUID(),
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    role,
    name,
    apartmentId,
    tenantId,
    createdAt: now.toISOString(),
    expiresAt,
  };
  db.authSessions.push(session);
  saveData();
  return { token, expiresAt };
}

function getAuthSession(token) {
  if (!token || typeof token !== 'string') return null;
  const changed = pruneAuthSessions();
  if (changed) saveData();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const session = (db.authSessions || []).find(item => constantTimeEqual(item.tokenHash, hash));
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return session;
}

function removeAuthSession(token) {
  if (!token || typeof token !== 'string') return;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  ensureAuthSessions();
  const before = db.authSessions.length;
  db.authSessions = db.authSessions.filter(item => !constantTimeEqual(item.tokenHash, hash));
  if (before !== db.authSessions.length) saveData();
}

// ─── WhatsApp Business Platform (Cloud API) ─────────────────────────────────
// This is intentionally independent from the legacy Baileys relay. It stays
// disabled until Meta credentials are configured in the deployment environment.
const CLOUD_AUTH_TTL = 5 * 60 * 1000;
const CLOUD_AUTH_MAX_ATTEMPTS = 3;
const CLOUD_PROCESSED_MESSAGE_TTL = 7 * 24 * 60 * 60 * 1000;

function cloudConfig() {
  return {
    enabled: process.env.WHATSAPP_CLOUD_ENABLED === 'true',
    token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    // An explicit production override lets the service switch numbers without
    // rewriting a Blueprint-managed setup variable.
    phoneNumberId: process.env.WHATSAPP_ACTIVE_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION || '',
  };
}

function cloudReady() {
  const c = cloudConfig();
  return c.enabled && c.token && c.phoneNumberId && c.verifyToken && c.appSecret && c.graphVersion;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// Tenant records are often entered locally as 10-digit Colombian mobile
// numbers, while Meta sends webhook numbers and expects outbound recipients
// with the country code. Keep matching permissive, but always send a valid
// international recipient to the Cloud API.
function whatsappRecipientPhone(phone) {
  const normalized = normalizePhone(phone);
  const countryCode = normalizePhone(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '57');
  if (/^3\d{9}$/.test(normalized) && countryCode) return `${countryCode}${normalized}`;
  return normalized;
}

function samePhone(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return left && right && (left === right || left.slice(-10) === right.slice(-10));
}

function apartmentIdFromReference(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    return apartmentIdFromReference(value.apartmentId ?? value.id ?? value.name ?? value.number);
  }
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isInteger(numeric) && (db.apartments || []).some(apartment => Number(apartment.id) === numeric)) return numeric;
  const normalized = text.toLocaleLowerCase();
  const exact = (db.apartments || []).find(apartment => String(apartment.name || '').trim().toLocaleLowerCase() === normalized);
  if (exact) return Number(exact.id);
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  const byDigits = (db.apartments || []).find(apartment => String(apartment.name || '').replace(/\D/g, '') === digits);
  return byDigits ? Number(byDigits.id) : null;
}

function contractDateMs(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = endOfDay ? 'T23:59:59.999-05:00' : 'T00:00:00.000-05:00';
    return new Date(`${raw}${suffix}`).getTime();
  }
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrentContract(contract, now = Date.now()) {
  if (!contract || contract.status === 'terminated' || contract.status === 'cancelled') return false;
  const startsAt = contractDateMs(contract.startDate);
  const endsAt = contractDateMs(contract.endDate, true);
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
}

function tenantBelongsToApartment(tenant, apartmentId) {
  const directApartmentId = apartmentIdFromReference(tenant?.apartmentId ?? tenant?.linkedAptId ?? tenant?.apartment);
  if (directApartmentId !== null && Number(directApartmentId) === Number(apartmentId)) return true;
  return (db.contracts || []).some(c =>
    Number(c.tenantId) === Number(tenant?.id) &&
    Number(c.apartmentId) === Number(apartmentId) &&
    isCurrentContract(c)
  );
}

function ensureCloudCollections() {
  for (const name of ['whatsappContacts', 'whatsappConversations', 'whatsappMessages', 'whatsappAuthStates', 'whatsappAdminSessions', 'whatsappBlockedUsers', 'whatsappProcessedMessages', 'paymentReminderLogs']) {
    if (!Array.isArray(db[name])) db[name] = [];
    if (!nextId[name]) nextId[name] = db[name].reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }
}

function pruneCloudCollections() {
  ensureCloudCollections();
  const now = Date.now();
  db.whatsappAuthStates = db.whatsappAuthStates.filter(state => new Date(state.expiresAt).getTime() > now);
  db.whatsappProcessedMessages = db.whatsappProcessedMessages.filter(item =>
    now - new Date(item.createdAt).getTime() < CLOUD_PROCESSED_MESSAGE_TTL
  );
}

function getCloudAuthState(phone) {
  pruneCloudCollections();
  return db.whatsappAuthStates.find(state => samePhone(state.phone, phone)) || null;
}

function setCloudAuthState(phone, state) {
  ensureCloudCollections();
  const now = new Date().toISOString();
  const index = db.whatsappAuthStates.findIndex(item => samePhone(item.phone, phone));
  const record = {
    id: index >= 0 ? db.whatsappAuthStates[index].id : nextId.whatsappAuthStates++,
    phone: normalizePhone(phone),
    step: state.step,
    apartmentId: state.apartmentId || null,
    attempts: Number(state.attempts) || 0,
    expiresAt: state.expiresAt || new Date(Date.now() + CLOUD_AUTH_TTL).toISOString(),
    createdAt: index >= 0 ? db.whatsappAuthStates[index].createdAt : now,
    updatedAt: now,
  };
  if (index >= 0) db.whatsappAuthStates[index] = record;
  else db.whatsappAuthStates.push(record);
  return record;
}

function clearCloudAuthState(phone) {
  ensureCloudCollections();
  db.whatsappAuthStates = db.whatsappAuthStates.filter(state => !samePhone(state.phone, phone));
}

function getCloudBlockedUser(phone) {
  ensureCloudCollections();
  return db.whatsappBlockedUsers.find(item => samePhone(item.phone, phone)) || null;
}

function isCloudMessageProcessed(messageId) {
  if (!messageId) return false;
  pruneCloudCollections();
  return db.whatsappProcessedMessages.some(item => item.messageId === messageId);
}

function markCloudMessageProcessed(messageId) {
  if (!messageId) return;
  ensureCloudCollections();
  db.whatsappProcessedMessages.push({
    id: nextId.whatsappProcessedMessages++,
    messageId,
    createdAt: new Date().toISOString(),
  });
}

function authorizedCloudContact(phone) {
  ensureCloudCollections();
  const now = Date.now();
  const explicit = db.whatsappContacts.find(c => c.enabled !== false && samePhone(c.phone, phone) &&
    (!c.expiresAt || new Date(c.expiresAt).getTime() > now));
  if (explicit) {
    const tenant = (db.tenants || []).find(item => Number(item.id) === Number(explicit.tenantId));
    const currentApartmentId = tenant ? tenantApartmentId(tenant) : null;
    const storedApartmentId = apartmentIdFromReference(explicit.apartmentId);
    const storedApartmentExists = storedApartmentId !== null &&
      (db.apartments || []).some(apartment => Number(apartment.id) === Number(storedApartmentId));
    const phoneStillBelongsToTenant = Boolean(tenant?.phone) && samePhone(tenant.phone, explicit.phone);
    // A number authenticated with apartment + document is intentionally
    // allowed to be different from the phone stored on the tenant record.
    // Requiring phoneStillBelongsToTenant here made the very next message
    // restart authentication for new but successfully verified numbers.
    const verifiedByIdentity = explicit.source === 'authenticated' && Boolean(explicit.verifiedAt);
    const tenantStillOwnsStoredApartment = Boolean(tenant) && storedApartmentExists &&
      tenantBelongsToApartment(tenant, storedApartmentId);
    const identityStillValid = verifiedByIdentity
      ? tenantStillOwnsStoredApartment
      : phoneStillBelongsToTenant && (tenantStillOwnsStoredApartment ||
        (currentApartmentId !== null && Number(currentApartmentId) === Number(storedApartmentId)));
    const trustedApartmentId = verifiedByIdentity
      ? (storedApartmentExists ? storedApartmentId : null)
      : (currentApartmentId ?? (storedApartmentExists ? storedApartmentId : null));
    if (!identityStillValid || trustedApartmentId === null || trustedApartmentId === undefined) {
      // Do not let a previous authentication keep impersonating a tenant after
      // the phone or its apartment association changes in the administration DB.
      explicit.enabled = false;
      explicit.revokedAt = new Date().toISOString();
      explicit.revocationReason = !tenant ? 'tenant_removed' : 'phone_or_apartment_mismatch';
      const staleConversation = db.whatsappConversations.find(c => samePhone(c.phone, phone));
      if (staleConversation) {
        staleConversation.tenantId = null;
        staleConversation.apartmentId = null;
        staleConversation.status = 'revoked';
        staleConversation.lastInboundAt = null;
        staleConversation.customerServiceWindowUntil = null;
      }
      console.warn(`[WHATSAPP CLOUD] Revoked stale identity for ${normalizePhone(phone)}: contact tenant ${explicit.tenantId} no longer matches the tenant phone.`);
      return null;
    }
    if (Number(explicit.tenantId) !== Number(tenant.id) || Number(explicit.apartmentId) !== Number(trustedApartmentId)) {
      // The phone is still the current tenant's phone, so repair a changed
      // apartment association instead of forcing a needless re-authentication.
      explicit.tenantId = tenant.id;
      explicit.apartmentId = trustedApartmentId;
      explicit.enabled = true;
      explicit.updatedAt = new Date().toISOString();
      saveData();
    }
    return { ...explicit, phone: normalizePhone(phone), apartmentId: trustedApartmentId };
  }

  const tenant = (db.tenants || []).find(t => samePhone(t.phone, phone));
  const apartmentId = tenantApartmentId(tenant);
  // A phone registered on a tenant with a current apartment association is
  // trusted directly. A tenant row without an apartment is not enough to
  // expose messages to the administrator, so it follows authentication.
  if (!tenant || apartmentId === null || apartmentId === undefined) return null;
  return {
    phone: normalizePhone(phone),
    tenantId: tenant.id,
    // Inquilinos created from the tenants screen keep the association in
    // tenant.apartmentId. Older records may use linkedAptId, while a formal
    // active contract should remain the strongest source of truth.
    apartmentId,
    source: 'database',
  };
}

function isCloudRevokedContact(phone) {
  ensureCloudCollections();
  const stored = db.whatsappContacts.find(contact => samePhone(contact.phone, phone));
  if (!stored || stored.enabled !== false || stored.revocationReason !== 'tenant_removed') return false;
  return !(db.tenants || []).some(tenant => Number(tenant.id) === Number(stored.tenantId) && samePhone(tenant.phone, phone));
}

function getCloudConversation(contact) {
  ensureCloudCollections();
  let conversation = db.whatsappConversations.find(c => samePhone(c.phone, contact.phone));
  if (!conversation) {
    conversation = { id: nextId.whatsappConversations++, phone: whatsappRecipientPhone(contact.phone), tenantId: contact.tenantId,
      apartmentId: contact.apartmentId, status: 'active', createdAt: new Date().toISOString(), lastInboundAt: null,
      customerServiceWindowUntil: null };
    db.whatsappConversations.push(conversation);
  } else {
    // A successful re-authentication repairs a conversation that was previously
    // detached because its phone was linked to the wrong tenant.
    if (contact.tenantId != null) conversation.tenantId = contact.tenantId;
    if (contact.apartmentId != null) conversation.apartmentId = contact.apartmentId;
    const recipientPhone = whatsappRecipientPhone(contact.phone);
    if (recipientPhone && conversation.phone !== recipientPhone) conversation.phone = recipientPhone;
    conversation.status = 'active';
  }
  return conversation;
}

function addCloudMessage(conversation, direction, message) {
  ensureCloudCollections();
  const record = { id: nextId.whatsappMessages++, conversationId: conversation.id, direction,
    type: message.type || 'text', text: message.text || '', mediaId: message.mediaId || null,
    media: message.media || null,
    whatsappMessageId: message.whatsappMessageId || null,
    interaction: message.interaction || null,
    template: message.template || null,
    templatePreviewText: message.templatePreviewText || null,
    templateVariables: Array.isArray(message.templateVariables) ? message.templateVariables : null,
    createdAt: new Date().toISOString() };
  db.whatsappMessages.push(record);
  if (direction === 'in') {
    conversation.lastInboundAt = record.createdAt;
    conversation.customerServiceWindowUntil = new Date(Date.parse(record.createdAt) + 24 * 60 * 60 * 1000).toISOString();
  } else if (direction === 'out') {
    conversation.lastOutboundAt = record.createdAt;
  }
  return record;
}

// Keep the inbox usable when a webhook delivered the tenant reply before the
// conversation metadata was persisted (or when an older record has no window
// timestamp). The inbound message itself is the source of truth for Meta's
// 24-hour customer-service window.
function cloudServiceWindowOpen(conversation) {
  const now = Date.now();
  const configuredUntil = conversation?.customerServiceWindowUntil ? new Date(conversation.customerServiceWindowUntil).getTime() : 0;
  if (configuredUntil > now) return true;
  const latestInbound = (db.whatsappMessages || [])
    .filter(message => Number(message.conversationId) === Number(conversation?.id) && message.direction === 'in')
    .map(message => new Date(message.createdAt).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!latestInbound || latestInbound + 24 * 60 * 60 * 1000 <= now) return false;
  conversation.customerServiceWindowUntil = new Date(latestInbound + 24 * 60 * 60 * 1000).toISOString();
  return true;
}

function cloudApiRequest(pathname, method, payload) {
  const c = cloudConfig();
  if (!cloudReady()) return Promise.reject(new Error('WhatsApp Cloud API no está configurada'));
  const body = payload ? JSON.stringify(payload) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com', path: `/${c.graphVersion}/${c.phoneNumberId}${pathname}`, method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error?.message || 'Cloud API error'));
        } catch {
          reject(new Error('Respuesta inválida de Cloud API'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Cloud API timeout')));
    if (body) req.write(body);
    req.end();
  });
}

// Some Cloud API resources, such as media, are addressed directly under the
// Graph version and not under a phone-number ID.
function cloudGraphRequest(pathname, method = 'GET', payload = null) {
  const c = cloudConfig();
  if (!cloudReady()) return Promise.reject(new Error('WhatsApp Cloud API no está configurada'));
  const body = payload ? JSON.stringify(payload) : null;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com', path: `/${c.graphVersion}${pathname}`, method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(parsed.error?.message || 'Cloud API error'));
        } catch { reject(new Error('Respuesta inválida de Cloud API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Cloud API timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function cloudMediaKind(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function cloudInboundMedia(message, type) {
  const source = message?.[type];
  if (!source?.id) return null;
  return {
    id: source.id,
    mimeType: source.mime_type || null,
    fileName: source.filename || null,
    caption: source.caption || '',
    voice: !!source.voice,
  };
}

function downloadCloudMedia(mediaId, maxBytes = 20 * 1024 * 1024) {
  return cloudGraphRequest(`/${encodeURIComponent(mediaId)}`).then(info => new Promise((resolve, reject) => {
    if (!info.url) return reject(new Error('WhatsApp no entreg\u00f3 una URL para este archivo'));
    const remoteUrl = new URL(info.url);
    const c = cloudConfig();
    const request = https.request({
      hostname: remoteUrl.hostname, port: remoteUrl.port || 443,
      path: remoteUrl.pathname + remoteUrl.search, method: 'GET', headers: { Authorization: `Bearer ${c.token}` },
    }, remote => {
      if (remote.statusCode < 200 || remote.statusCode >= 300) {
        remote.resume();
        return reject(new Error('WhatsApp no pudo entregar el archivo'));
      }
      const declaredSize = Number(remote.headers['content-length'] || 0);
      if (declaredSize > maxBytes) {
        remote.resume();
        return reject(new Error('El archivo supera el l\u00edmite de 20 MB del archivo permanente'));
      }
      let size = 0;
      const chunks = [];
      remote.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) remote.destroy(new Error('El archivo supera el l\u00edmite de 20 MB del archivo permanente'));
        else chunks.push(chunk);
      });
      remote.on('error', reject);
      remote.on('end', () => resolve({ buffer: Buffer.concat(chunks), mimeType: remote.headers['content-type'] || info.mime_type || 'application/octet-stream' }));
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('La descarga del archivo tard\u00f3 demasiado')));
    request.end();
  }));
}

async function archiveCloudInboundMedia(media, { runOcr = false } = {}) {
  if (!media?.id) return media;
  try {
    const file = await downloadCloudMedia(media.id);
    const ocr = runOcr
      ? await analysePaymentProofMedia({ buffer: file.buffer, mimeType: media.mimeType || file.mimeType, fileName: media.fileName })
      : null;
    const stored = await putR2Buffer({
      section: 'whatsapp/inbound', fileName: media.fileName || `whatsapp-${media.id}`,
      buffer: file.buffer, mimeType: media.mimeType || file.mimeType,
    });
    return { ...media, ...stored, archiveStatus: 'stored', ...(ocr ? { ocr } : {}) };
  } catch (error) {
    console.error('[R2] inbound WhatsApp media archive error:', error.message);
    return { ...media, archiveStatus: 'pending_or_failed', archiveError: error.message };
  }
}

function uploadCloudMedia(file) {
  const c = cloudConfig();
  if (!cloudReady()) return Promise.reject(new Error('WhatsApp Cloud API no está configurada'));
  const boundary = `----LaujimMedia${crypto.randomBytes(12).toString('hex')}`;
  const safeName = String(file.originalname || 'archivo').replace(/[\r\n"]/g, '_');
  const mime = file.mimetype || 'application/octet-stream';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="messaging_product"\r\n\r\nwhatsapp\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\n${mime}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`),
    file.buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com', path: `/${c.graphVersion}/${c.phoneNumberId}/media`, method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.id) resolve(parsed);
          else reject(new Error(parsed.error?.message || 'No fue posible cargar el archivo a WhatsApp'));
        } catch { reject(new Error('Respuesta inválida al cargar el archivo')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('La carga del archivo tardó demasiado')));
    req.write(body);
    req.end();
  });
}

function sendCloudMedia(to, media, caption = '') {
  const type = media.kind;
  const content = { id: media.id };
  if ((type === 'image' || type === 'video' || type === 'document') && caption) content.caption = caption;
  if (type === 'document' && media.fileName) content.filename = media.fileName;
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type, [type]: content,
  });
}

function sendCloudText(to, body) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'text', text: { body },
  });
}

function sendCloudInteractiveList(to, body, buttonTitle, sections) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonTitle,
        sections: sections.map(section => ({
          title: section.title,
          rows: section.rows.map(row => ({
            id: row.id,
            title: row.title,
            ...(row.description ? { description: row.description } : {}),
          })),
        })),
      },
    },
  });
}

const PUBLIC_APP_URL = String(process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || 'https://laujim-app.onrender.com').trim().replace(/\/+$/, '');
const CLOUD_ADMIN_WHATSAPP_URL = `${PUBLIC_APP_URL}/whatsapp`;

function sendCloudAdminAccessButton(to, body) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Abrir Laujim',
          url: CLOUD_ADMIN_WHATSAPP_URL,
        },
      },
    },
  });
}

function sendCloudUtilitiesDetailButton(to) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: 'Consulta el reporte financiero detallado de Air-e, Triple A y Gases del Caribe en Laujim.' },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: 'Ver detalle seguro',
          url: `${PUBLIC_APP_URL}/utilities`,
        },
      },
    },
  });
}

function firstName(name) {
  return String(name || 'hola').trim().split(/\s+/)[0] || 'hola';
}

function sendCloudGreetingTemplate(to, name) {
  const templateName = String(process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino').trim();
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: firstName(name) }] }],
    },
  });
}

function cloudPeriodLabel(period = colombiaDate().slice(0, 7)) {
  const match = String(period).match(/^(\d{4})-(\d{2})$/);
  if (!match) return String(period);
  return new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

// This template must be created and approved in WhatsApp Manager. It has the
// tenant's first name and the payment period as body variables, plus two
// reply buttons: "Ya pagué" (id: payment_confirmed) and "No he pagado"
// (id: payment_pending). The buttons are defined in the template itself.
function cloudTemplateDebtValue(state, referenceLabel = '', referenceValue = '') {
  const suffix = referenceValue ? ` · ${referenceLabel}: ${referenceValue}` : '';
  if (state?.debt !== null && state?.debt !== undefined && Number.isFinite(Number(state.debt))) {
    return '$' + Number(state.debt).toLocaleString('es-CO') + suffix;
  }
  if (state?.known) return '$0 · Al día' + suffix;
  return 'Sin dato confirmado' + suffix;
}

function cloudPaymentTemplateData(apartment, period) {
  if (!apartment?.id) {
    const periodKey = String(period || colombiaDate().slice(0, 7)).slice(0, 7);
    const dueDay = 5;
    const dueDate = cloudCalendarDate(periodKey, dueDay);
    return {
      apartment: apartment || {},
      contract: null,
      contextWarning: 'La conversación no está asociada a un apartamento con contrato activo.',
      parameters: [
        { type: 'text', text: 'inquilino' },
        { type: 'text', text: String(apartment?.name || '—') },
        { type: 'text', text: cloudPeriodLabel(periodKey) },
        { type: 'text', text: '$0' },
        { type: 'text', text: cloudFormatFullDate(colombiaDate(dueDate)) },
        { type: 'text', text: 'Sin apartamento asociado' },
        { type: 'text', text: 'Sin dato confirmado' },
        { type: 'text', text: 'Sin dato confirmado' },
        { type: 'text', text: 'Sin dato confirmado' },
        { type: 'text', text: 'No configurado' },
        { type: 'text', text: 'No configurado' },
        { type: 'text', text: 'No configurado' },
      ],
    };
  }
  const summary = cloudApartmentServices(apartment);
  const { contract, amount } = cloudRentAmount(apartment);
  const references = {
    electricity: apartment.electricityPaymentCode || apartment.nic || summary.records.electricity?.nic || '',
    water: apartment.waterPaymentCode || summary.records.water?.waterPaymentCode || '',
    gas: apartment.gasPaymentCode || summary.records.gas?.gasPaymentCode || '',
  };
  const periodKey = String(period || colombiaDate().slice(0, 7)).slice(0, 7);
  const dueDay = Math.min(31, Math.max(1, Number(apartment?.paymentDueDay) || 5));
  const dueDate = cloudCalendarDate(periodKey, dueDay);
  const alreadyPaid = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment?.id) &&
    payment.type === 'rent' && paymentPeriod(payment) === periodKey && paymentCountsAsCollected(payment));
  const awaitingReview = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment?.id) &&
    payment.type === 'rent' && paymentPeriod(payment) === periodKey && payment.status === 'pending_validation');
  const today = colombiaDate();
  const dueDateKey = colombiaDate(dueDate);
  const rentStatus = alreadyPaid
    ? 'Pagado'
    : awaitingReview
      ? 'Comprobante pendiente de validación'
      : dueDateKey < today ? 'Vencido' : 'Pendiente';

  return {
    apartment,
    contract,
    contextWarning: null,
    parameters: [
      { type: 'text', text: firstName(apartment?.tenantName || '') },
      { type: 'text', text: String(apartment?.name || '—') },
      { type: 'text', text: cloudPeriodLabel(periodKey) },
      { type: 'text', text: '$' + Number(amount || 0).toLocaleString('es-CO') },
      { type: 'text', text: cloudFormatFullDate(colombiaDate(dueDate)) },
      { type: 'text', text: rentStatus },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.electricity, 'NIC', references.electricity) },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.water, 'Póliza', references.water) },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.gas, 'Contrato', references.gas) },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.electricity, 'electricity') },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.water, 'water') },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.gas, 'gas') },
    ],
  };
}

function cloudAdminPaymentReminderTemplateName() {
  const configured = (db.settings || []).find(item => item.key === 'whatsapp_admin_reminder_template')?.value;
  return String(process.env.WHATSAPP_ADMIN_PAYMENT_REMINDER_TEMPLATE || configured || 'recordatorio_admin_cobros').trim();
}

function cloudAdminPaymentConfirmedTemplateName() {
  const configured = (db.settings || []).find(item => item.key === 'whatsapp_admin_confirmed_payment_template')?.value;
  return String(process.env.WHATSAPP_ADMIN_PAYMENT_CONFIRMED_TEMPLATE || configured || 'pago_confirmado_admin').trim();
}

function cloudAdminPaymentReminderTemplateData(apartment, period) {
  const data = cloudPaymentTemplateData(apartment, period);
  const summary = cloudApartmentServices(apartment);
  const amounts = Object.fromEntries(Object.entries(summary.records).map(([key, record]) => [key, cloudServiceAmounts(record)]));
  const latest = Object.values(summary.records)
    .map(record => utilityRecordValueTimestamp(record))
    .filter(Boolean)
    .map(value => new Date(value))
    .filter(value => !Number.isNaN(value.getTime()))
    .sort((left, right) => right - left)[0];
  const money = value => cloudUtilityMoney(value);
  const financing = value => value.financingKnown ? money(value.financed) : value.totalKnown ? '$0' : 'sin confirmar';
  const air = amounts.electricity;
  const water = amounts.water;
  const gas = amounts.gas;
  return {
    templateName: cloudAdminPaymentReminderTemplateName(),
    parameters: [
      { type: 'text', text: 'administrador' },
      { type: 'text', text: String(apartment?.name || '—') },
      { type: 'text', text: data.parameters[3]?.text || '$0' },
      { type: 'text', text: data.parameters[4]?.text || 'fecha no confirmada' },
      { type: 'text', text: data.parameters[5]?.text || 'Pendiente' },
      { type: 'text', text: money(air.month) },
      { type: 'text', text: air.invoiceOverdueCount === null ? 'sin confirmar' : String(air.invoiceOverdueCount) },
      { type: 'text', text: money(air.total) },
      { type: 'text', text: money(water.month) },
      { type: 'text', text: financing(water) },
      { type: 'text', text: money(water.total) },
      { type: 'text', text: money(gas.month) },
      { type: 'text', text: financing(gas) },
      { type: 'text', text: money(gas.total) },
      { type: 'text', text: latest ? formatColombiaDateTime(latest) : 'sin sincronización' },
    ],
  };
}

function sendCloudAdminPaymentReminderTemplate(to, period, apartment) {
  const data = cloudAdminPaymentReminderTemplateData(apartment, period);
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: data.templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: data.parameters }],
    },
  });
}

function automaticPaymentTenantName(apartment) {
  if (!apartment) return 'No identificado';
  const contract = activeContractForApartment(apartment.id);
  const tenant = contract ? (db.tenants || []).find(item => Number(item.id) === Number(contract.tenantId)) : null;
  return String(tenant?.name || apartment.tenantName || 'No identificado').trim() || 'No identificado';
}

function cloudAdminPaymentConfirmedTemplateData(event, payment, apartment, manuallyConfirmed = false) {
  return {
    templateName: cloudAdminPaymentConfirmedTemplateName(),
    parameters: [
      { type: 'text', text: String(apartment?.name || event?.apartmentName || 'Sin apartamento') },
      { type: 'text', text: automaticPaymentTenantName(apartment) },
      { type: 'text', text: `$${Number(payment?.amount ?? event?.amount ?? 0).toLocaleString('es-CO')}` },
      { type: 'text', text: String(event?.sourceApp || event?.provider || 'Desconocido') },
      { type: 'text', text: String(event?.payerIdentifierMasked || event?.payerName || 'No visible') },
      { type: 'text', text: String(event?.transactionId || event?.reference || 'Sin referencia') },
      { type: 'text', text: formatColombiaDateTime(event?.receivedAt) || 'Fecha no disponible' },
      { type: 'text', text: manuallyConfirmed ? 'Confirmado por administrador' : 'Confirmado automáticamente' },
    ],
  };
}

function sendCloudAdminPaymentConfirmedTemplate(to, event, payment, apartment, manuallyConfirmed = false) {
  const data = cloudAdminPaymentConfirmedTemplateData(event, payment, apartment, manuallyConfirmed);
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: data.templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: data.parameters }],
    },
  });
}

async function notifyPaymentConfirmed(event, payment, apartment, manuallyConfirmed = false) {
  ensurePaymentAutomationCollections();
  if (!event || event.adminNotificationStatus === 'sent' || event.adminNotificationStatus === 'sending') return;
  const phones = cloudAdminPhones();
  if (!phones.length || !cloudReady()) {
    event.adminNotificationStatus = 'pending_configuration';
    event.adminNotificationUpdatedAt = new Date().toISOString();
    saveData();
    console.warn('[PAYMENTS] Pago confirmado sin aviso: WhatsApp Cloud o administradores no están configurados.');
    return;
  }

  event.adminNotificationStatus = 'sending';
  event.adminNotificationUpdatedAt = new Date().toISOString();
  saveData();
  let sent = 0;
  let lastError = '';
  for (const phone of phones) {
    try {
      await sendCloudAdminPaymentConfirmedTemplate(phone, event, payment, apartment, manuallyConfirmed);
      sent += 1;
    } catch (error) {
      lastError = error.message || 'Error desconocido';
      console.error(`[PAYMENTS] No se pudo avisar el pago confirmado al administrador ${phone}:`, lastError);
    }
  }
  event.adminNotificationStatus = sent === phones.length ? 'sent' : 'failed';
  event.adminNotificationSentAt = sent === phones.length ? new Date().toISOString() : null;
  event.adminNotificationUpdatedAt = new Date().toISOString();
  if (lastError) event.adminNotificationError = lastError.slice(0, 300);
  saveData();
  console.log(`[PAYMENTS] Confirmación de pago: ${sent}/${phones.length} administrador(es) notificado(s).`);
}

// Create and approve this body in WhatsApp Manager as `cobro_canon_servicios`.
// Variable order: name, apartment, period, rent, due date, rent status,
// Air-e debt, Triple A debt, gas debt, and the three payment URLs. The body
// should end by asking the tenant to attach the rent payment proof.
function sendCloudPaymentReminderTemplate(to, name, period, apartment = null) {
  const templateName = String(process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios').trim();
  const resolvedApartment = apartment || {};
  const data = cloudPaymentTemplateData(resolvedApartment, period);
  console.log(`[WHATSAPP CLOUD] Payment template context: apartment=${resolvedApartment.name || resolvedApartment.id}, period=${period || colombiaDate().slice(0, 7)}, rent=${data.parameters[3].text}.`);
  if (name) data.parameters[0].text = firstName(name);
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: data.parameters }],
    },
  });
}

function cloudTemplatePreview(conversation, template, period = colombiaDate().slice(0, 7)) {
  const context = resolveCloudConversationContext(conversation);
  const tenant = context.tenant;
  const apartment = context.apartment;
  const templateKey = String(template || '').trim();
  const templateName = templateKey === 'greeting'
    ? String(process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino').trim()
    : String(process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios').trim();

  if (templateKey === 'greeting') {
    const name = firstName(tenant?.name);
    const previewText = `Hola, ${name}, ¿cómo estás? ¿Podemos hablar un momento?`;
    const fingerprint = crypto.createHash('sha256')
      .update([templateName, 'greeting', previewText].join('\n'))
      .digest('hex');
    return {
      template: templateKey,
      templateName,
      apartmentName: apartment?.name || null,
      canSend: true,
      warning: null,
      generatedAt: new Date().toISOString(),
      variables: [{ label: 'Nombre', value: name }],
      fingerprint,
      previewText,
    };
  }

  if (templateKey !== 'payment_reminder') throw new Error('Plantilla no soportada');
  const data = cloudPaymentTemplateData(apartment, period);
  const values = data.parameters.map(parameter => parameter.text);
  const [name, apartmentName, periodLabel, rent, dueDate, rentStatus, airDebt, waterDebt, gasDebt, airLink, waterLink, gasLink] = values;
  const summary = cloudApartmentServices(apartment);
  const syncValue = record => record?.valueCheckedAt || record?.checkedAt || record?.scrapedAt || record?.updatedAt || null;
  const sync = {
    air: syncValue(summary.records.electricity),
    water: syncValue(summary.records.water),
    gas: syncValue(summary.records.gas),
  };
  const previewText = [
    `Hola ${name} 👋`,
    '',
    'Te saluda la administración de apartamentos Laujim.',
    '',
    `🏠 Apartamento: ${apartmentName}`,
    `📊 Canon de ${periodLabel}: ${rent}`,
    `📅 Vencimiento: ${dueDate}`,
    `📌 Estado: ${rentStatus}`,
    '',
    `⚡ Air-e — Deuda Total: ${airDebt}`,
    `💧 Triple A — Deuda Total: ${waterDebt}`,
    `🔥 Gases del Caribe — Deuda Total: ${gasDebt}`,
    '',
    '💳 Enlaces de pago:',
    `⚡ Air-e: ${airLink}`,
    `💧 Triple A: ${waterLink}`,
    `🔥 Gases del Caribe: ${gasLink}`,
    '',
    'Cuando realices el pago del canon, responde adjuntando el comprobante para validarlo. ¡Gracias!',
  ].join('\n');
  // A stable fingerprint ties the confirmation click to exactly the values
  // shown in the preview. If the scraper updates a value in between, the
  // server rejects the stale confirmation and asks the UI to refresh it.
  const fingerprint = crypto.createHash('sha256')
    .update([templateName, String(period).slice(0, 7), previewText].join('\n'))
    .digest('hex');
  return {
    template: templateKey,
    templateName,
    period: String(period).slice(0, 7),
    apartmentName,
    canSend: !data.contextWarning,
    warning: data.contextWarning || null,
    generatedAt: new Date().toISOString(),
    dataSync: sync,
    fingerprint,
    variables: [
      { label: 'Nombre', value: name }, { label: 'Apartamento', value: apartmentName },
      { label: 'Periodo', value: periodLabel }, { label: 'Canon', value: rent },
      { label: 'Vencimiento', value: dueDate }, { label: 'Estado del canon', value: rentStatus },
      { label: 'Air-e · Deuda Total', value: airDebt, syncedAt: sync.air },
      { label: 'Triple A · Deuda Total', value: waterDebt, syncedAt: sync.water },
      { label: 'Gases · Deuda Total', value: gasDebt, syncedAt: sync.gas },
      { label: 'Enlace Air-e', value: airLink }, { label: 'Enlace Triple A', value: waterLink },
      { label: 'Enlace Gases', value: gasLink },
    ],
    previewText,
  };
}

function colombiaDate(date = new Date()) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${values.year}-${values.month}-${values.day}`;
}

// Render runs in UTC, while the administrator and the tenants use Colombia's
// fixed UTC-5 clock. Keep the WhatsApp timestamp independent of the server's
// local timezone. The UI label uses the user's requested "CDT" wording.
function formatColombiaDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
  return `${formatted} (CDT)`;
}

function nextColombiaEightAm(date = new Date()) {
  const [year, month, day] = colombiaDate(date).split('-').map(Number);
  // Colombia remains UTC-5 year round, so 08:00 Colombia is 13:00 UTC.
  const target = new Date(Date.UTC(year, month - 1, day, 13, 0, 0));
  if (target <= date) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

function paymentPeriod(payment) {
  return String(payment?.period || payment?.date || '').slice(0, 7);
}

function paymentCountsAsCollected(payment) {
  return payment?.status !== 'pending_validation' && payment?.status !== 'rejected';
}

function existingCollectedRent(apartmentId, period) {
  return (db.payments || []).find(payment =>
    Number(payment.apartmentId) === Number(apartmentId) &&
    payment.type === 'rent' &&
    paymentPeriod(payment) === String(period || '').slice(0, 7) &&
    paymentCountsAsCollected(payment)
  ) || null;
}

// ─── Automatic payment reconciliation ─────────────────────────────────────
// Notifications are evidence, not bank webhooks. A payment is auto-confirmed
// only when a configured sender identity and the current rent uniquely match.
// Amount alone never confirms a payment.
function ensurePaymentAutomationCollections() {
  for (const name of ['paymentRules', 'paymentEvents', 'paymentAlerts']) {
    if (!Array.isArray(db[name])) db[name] = [];
    if (!nextId[name]) nextId[name] = db[name].reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }
}

function paymentProviderKey(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalisePaymentIdentifier(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function paymentIdentifiersMatch(left, right) {
  const a = normalisePaymentIdentifier(left);
  const b = normalisePaymentIdentifier(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aDigits = a.replace(/\D/g, '');
  const bDigits = b.replace(/\D/g, '');
  if (aDigits && bDigits) return aDigits.endsWith(bDigits) || bDigits.endsWith(aDigits);
  return false;
}

function parseAutomaticPaymentAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  const text = String(value || '').replace(/\s/g, '').replace(/\$/g, '').replace(/COP/ig, '');
  const match = text.match(/\d[\d.,]*/);
  if (!match) return null;
  const raw = match[0];
  const numeric = raw.includes('.') || raw.includes(',')
    ? Number(raw.replace(/[.,]/g, ''))
    : Number(raw);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
}

function maskedPaymentIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 4) return `••••${digits.slice(-4)}`;
  return raw.slice(0, 42);
}

function automaticPaymentPeriod(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? colombiaDate().slice(0, 7) : colombiaDate(parsed).slice(0, 7);
}

function rentForPaymentApartment(apartment) {
  const contract = apartment ? activeContractForApartment(apartment.id) : null;
  return Number(contract?.monthlyRent || apartment?.monthlyRent || 0);
}

function extractPaymentReference(text) {
  const value = String(text || '');
  const match = value.match(/(?:referencia|transacci[oó]n|comprobante|operaci[oó]n|id)\s*[:#-]?\s*([a-z0-9-]{4,})/i);
  return match ? match[1].slice(0, 80) : null;
}

function normaliseAutomaticPaymentEvent(input = {}) {
  const text = String(input.text || input.body || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
  const amount = parseAutomaticPaymentAmount(input.amount ?? text);
  const receivedAt = input.receivedAt && !Number.isNaN(new Date(input.receivedAt).getTime())
    ? new Date(input.receivedAt).toISOString() : new Date().toISOString();
  const provider = String(input.provider || input.sourceApp || 'desconocido').trim().slice(0, 80);
  const identifier = String(input.payerIdentifier || input.sender || input.sourceIdentifier || '').trim().slice(0, 120);
  const transactionId = String(input.transactionId || input.reference || extractPaymentReference(text) || '').trim().slice(0, 100) || null;
  const direction = String(input.direction || '').toLowerCase();
  const likelyOutgoing = /\b(enviaste|envio|envias|transferiste|debito|retiro|salida|pagaste)\b/i.test(text);
  const incoming = direction ? ['in', 'incoming', 'received', 'recibido'].includes(direction) : !likelyOutgoing;
  const fingerprint = String(input.eventId || '').trim().slice(0, 160) || crypto.createHash('sha256')
    .update([provider, identifier, amount || '', transactionId || '', text, receivedAt.slice(0, 16)].join('|'))
    .digest('hex');
  return {
    externalId: String(input.eventId || transactionId || '').trim().slice(0, 160) || null,
    fingerprint,
    provider,
    providerKey: paymentProviderKey(provider),
    sourceApp: String(input.sourceApp || '').trim().slice(0, 120) || null,
    sourceType: String(input.sourceType || 'notification').trim().slice(0, 40),
    transferChannel: String(input.transferChannel || '').trim().slice(0, 40) || null,
    title: String(input.title || '').trim().slice(0, 180) || null,
    amount,
    currency: String(input.currency || 'COP').toUpperCase().slice(0, 8),
    payerName: String(input.payerName || '').trim().slice(0, 120) || null,
    payerIdentifier: identifier || null,
    payerIdentifierMasked: maskedPaymentIdentifier(identifier),
    transactionId,
    reference: transactionId,
    textPreview: text ? text.slice(0, 280) : null,
    incoming,
    // Android notification reconciliation is intentionally rent-only. Utility
    // bills are read by the utility worker and never become payment records
    // from an SMS/Gmail notification.
    paymentPurpose: 'rent',
    paymentConcept: 'canon',
    receivedAt,
    period: automaticPaymentPeriod(receivedAt),
  };
}

function automaticPaymentIsRentOnly(input = {}) {
  const declared = String(input.paymentPurpose || input.paymentType || input.category || input.type || '').trim().toLowerCase();
  if (!declared) return true;
  return !/(?:servicio|utility|agua|gas|luz|energ[ií]a|triple\s*a|air[-\s]?e|gascaribe)/i.test(declared);
}

function automaticPaymentCandidates(event) {
  ensurePaymentAutomationCollections();
  if (event.paymentPurpose !== 'rent' || !event.incoming || !event.amount) return [];
  const candidates = [];
  for (const rule of db.paymentRules.filter(item => item.active !== false)) {
    if (rule.providerKey && event.providerKey && rule.providerKey !== event.providerKey) continue;
    if (!paymentIdentifiersMatch(rule.identifier, event.payerIdentifier)) continue;
    const apartment = (db.apartments || []).find(item => Number(item.id) === Number(rule.apartmentId));
    if (!apartment) continue;
    const expected = rule.amountMode === 'fixed' ? Number(rule.amount) : rentForPaymentApartment(apartment);
    const tolerance = Math.max(0, Number(rule.tolerance) || 0);
    const amountMatch = expected > 0 && Math.abs(Number(event.amount) - expected) <= tolerance;
    candidates.push({
      apartmentId: apartment.id,
      apartmentName: apartment.name,
      ruleId: rule.id,
      rule,
      expectedAmount: expected,
      amountMatch,
      confidence: amountMatch ? 100 : 82,
    });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence || Number(a.apartmentId) - Number(b.apartmentId));
}

function paymentEventAlreadySeen(event) {
  ensurePaymentAutomationCollections();
  return db.paymentEvents.find(item =>
    (event.externalId && item.externalId === event.externalId) || item.fingerprint === event.fingerprint
  ) || null;
}

function makeAutomaticPaymentRecord(event, apartment, status, details = {}) {
  const period = event.period || automaticPaymentPeriod(event.receivedAt);
  const contract = activeContractForApartment(apartment.id);
  const record = {
    id: nextId.payments++, apartmentId: Number(apartment.id), contractId: contract?.id || null,
    tenantId: contract?.tenantId || null, amount: Number(event.amount), date: event.receivedAt.slice(0, 10), period,
    type: 'rent', paymentMode: 'full', status, origin: 'automatic_notification', paymentPurpose: 'rent', paymentConcept: 'canon',
    sourceProvider: event.provider, sourceApp: event.sourceApp, sourceIdentifier: event.payerIdentifierMasked,
    transactionId: event.transactionId, paymentEventId: details.eventId || null, automationConfidence: details.confidence || 0,
    approvedAt: status === 'approved' ? new Date().toISOString() : null,
    approvedBy: status === 'approved' ? 'Regla automática' : null,
    description: `Transferencia recibida · ${event.provider} · ${apartment.name}`,
    createdAt: new Date().toISOString(),
  };
  db.payments.push(record);
  return record;
}

async function notifyPaymentAssociationRequired(event) {
  ensurePaymentAutomationCollections();
  const existingAlert = db.paymentAlerts.find(item => Number(item.eventId) === Number(event.id) && item.status === 'open');
  if (existingAlert) return;
  const alert = {
    id: nextId.paymentAlerts++, eventId: event.id, kind: 'payment_needs_association', status: 'open',
    createdAt: new Date().toISOString(), message: `Pago recibido por $${Number(event.amount || 0).toLocaleString('es-CO')} sin apartamento identificado.`,
  };
  db.paymentAlerts.unshift(alert);
  saveData();

  const phones = cloudAdminPhones();
  if (!phones.length || !cloudReady()) return;
  const body = `💳 *Pago recibido sin asociar*\n\nValor: $${Number(event.amount || 0).toLocaleString('es-CO')}\nOrigen: ${event.provider}\nRemitente: ${event.payerIdentifierMasked || event.payerName || 'No visible'}\nFecha: ${formatColombiaDateTime(event.receivedAt)}\n\n¿Es un pago de los apartamentos? Responde *Sí* o *No*.`;
  for (const phone of phones) {
    try {
      const conversation = db.whatsappConversations.find(item => samePhone(item.phone, phone));
      if (conversation && cloudServiceWindowOpen(conversation)) {
        await sendCloudText(phone, body);
      } else {
        await sendCloudPaymentReviewTemplate(phone, event);
      }
      // Keep only this payment-association flow alive for one day. The normal
      // admin authentication window remains unchanged.
      setCloudAuthState(phone, { step: 'payment_unknown_confirm', paymentEventId: event.id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
    } catch (error) {
      console.error('[PAYMENTS] No se pudo notificar al administrador por WhatsApp:', error.message);
    }
  }
  saveData();
}

function evaluateAutomaticPayment(input = {}) {
  ensurePaymentAutomationCollections();
  const event = normaliseAutomaticPaymentEvent(input);
  const seen = paymentEventAlreadySeen(event);
  if (seen) return { event: seen, duplicate: true, status: seen.status, payment: null, candidates: seen.candidates || [] };
  const candidates = automaticPaymentCandidates(event);
  const exact = candidates.filter(candidate => candidate.confidence === 100 && candidate.amountMatch);
  const availableExact = exact.filter(candidate => !existingCollectedRent(candidate.apartmentId, event.period));
  const unique = availableExact.length === 1 ? availableExact[0] : null;
  const eventRecord = {
    id: nextId.paymentEvents++, ...event, status: unique ? 'auto_confirmed' : 'pending_association',
    confidence: unique ? 100 : candidates.length ? Math.max(...candidates.map(item => item.confidence)) : 0,
    candidates: candidates.map(item => ({ apartmentId: item.apartmentId, apartmentName: item.apartmentName, ruleId: item.ruleId, expectedAmount: item.expectedAmount, amountMatch: item.amountMatch, confidence: item.confidence })),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), paymentId: null,
  };
  db.paymentEvents.unshift(eventRecord);
  let payment = null;
  if (unique) {
    payment = makeAutomaticPaymentRecord(eventRecord, (db.apartments || []).find(item => Number(item.id) === Number(unique.apartmentId)), 'approved', { eventId: eventRecord.id, confidence: 100 });
    eventRecord.paymentId = payment.id;
    eventRecord.apartmentId = unique.apartmentId;
    eventRecord.apartmentName = unique.apartmentName;
    eventRecord.matchedRuleId = unique.ruleId;
  }
  saveData();
  if (unique) {
    const apartment = (db.apartments || []).find(item => Number(item.id) === Number(unique.apartmentId));
    notifyPaymentConfirmed(eventRecord, payment, apartment).catch(error => console.error('[PAYMENTS] confirmation alert error:', error.message));
  } else notifyPaymentAssociationRequired(eventRecord).catch(error => console.error('[PAYMENTS] alert error:', error.message));
  return { event: eventRecord, duplicate: false, status: eventRecord.status, payment, candidates: eventRecord.candidates };
}

function associateAutomaticPaymentEvent(eventId, apartmentId, remember = true, by = 'Administrador') {
  ensurePaymentAutomationCollections();
  const event = db.paymentEvents.find(item => Number(item.id) === Number(eventId));
  const apartment = (db.apartments || []).find(item => Number(item.id) === Number(apartmentId));
  if (!event) throw new Error('Evento de pago no encontrado.');
  if (!apartment) throw new Error('Apartamento no encontrado.');
  if (event.status === 'false_alarm') throw new Error('Este evento fue marcado como falsa alarma.');
  let payment = event.paymentId ? db.payments.find(item => Number(item.id) === Number(event.paymentId)) : null;
  if (!payment) payment = makeAutomaticPaymentRecord(event, apartment, 'approved', { eventId: event.id, confidence: 100 });
  else Object.assign(payment, { apartmentId: apartment.id, status: 'approved', approvedAt: new Date().toISOString(), approvedBy: by });
  event.status = 'manually_confirmed'; event.confidence = 100; event.apartmentId = apartment.id; event.apartmentName = apartment.name; event.paymentId = payment.id; event.updatedAt = new Date().toISOString();
  if (remember && event.payerIdentifier) {
    const providerKey = event.providerKey;
    const existing = db.paymentRules.find(rule => rule.active !== false && rule.providerKey === providerKey && paymentIdentifiersMatch(rule.identifier, event.payerIdentifier) && Number(rule.apartmentId) === Number(apartment.id));
    if (existing) existing.updatedAt = new Date().toISOString();
    else db.paymentRules.push({ id: nextId.paymentRules++, provider: event.provider, providerKey, identifier: event.payerIdentifier, identifierMasked: event.payerIdentifierMasked, apartmentId: apartment.id, amountMode: 'current_rent', tolerance: 0, active: true, source: 'learned_manual_association', createdAt: new Date().toISOString() });
  }
  db.paymentAlerts.filter(item => Number(item.eventId) === Number(event.id) && item.status === 'open').forEach(item => { item.status = 'resolved'; item.resolvedAt = new Date().toISOString(); });
  saveData();
  notifyPaymentConfirmed(event, payment, apartment, true).catch(error => console.error('[PAYMENTS] confirmation alert error:', error.message));
  return { event, payment, apartment };
}

function dismissAutomaticPaymentEvent(eventId, reason = 'Falsa alarma') {
  ensurePaymentAutomationCollections();
  const event = db.paymentEvents.find(item => Number(item.id) === Number(eventId));
  if (!event) throw new Error('Evento de pago no encontrado.');
  event.status = 'false_alarm'; event.updatedAt = new Date().toISOString(); event.dismissReason = String(reason).slice(0, 180);
  db.paymentAlerts.filter(item => Number(item.eventId) === Number(event.id) && item.status === 'open').forEach(item => { item.status = 'resolved'; item.resolvedAt = new Date().toISOString(); });
  saveData();
  return event;
}

function sendCloudPaymentReviewTemplate(to, event) {
  const configured = (db.settings || []).find(item => item.key === 'whatsapp_payment_review_template')?.value;
  const templateName = String(process.env.WHATSAPP_PAYMENT_REVIEW_TEMPLATE || configured || 'pago_por_asociar').trim();
  const components = [{ type: 'body', parameters: [
    { type: 'text', text: `$${Number(event.amount || 0).toLocaleString('es-CO')}` },
    { type: 'text', text: event.provider || 'desconocido' },
    { type: 'text', text: event.payerIdentifierMasked || event.payerName || 'No visible' },
    { type: 'text', text: formatColombiaDateTime(event.receivedAt) },
  ] }];
  // The review template is designed with two quick replies. Keep a switch for
  // installations that still use the old four-variable template while Meta
  // reviews the new interactive version.
  if (String(process.env.WHATSAPP_PAYMENT_REVIEW_BUTTONS || 'true').toLowerCase() !== 'false') {
    components.push(
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'payment_unknown_yes' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'payment_unknown_no' }] },
    );
  }
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: templateName, language: { code: 'es_CO' },
      components,
    },
  });
}

function activeContractForApartment(apartmentId) {
  const now = Date.now();
  return (db.contracts || [])
    .filter(contract => Number(contract.apartmentId) === Number(apartmentId) && isCurrentContract(contract, now))
    .sort((left, right) => (contractDateMs(right.startDate) || contractDateMs(right.createdAt) || 0) - (contractDateMs(left.startDate) || contractDateMs(left.createdAt) || 0))[0] || null;
}

function activeContractForTenant(tenantId) {
  const now = Date.now();
  return (db.contracts || [])
    .filter(contract => Number(contract.tenantId) === Number(tenantId) && isCurrentContract(contract, now))
    .sort((left, right) => (contractDateMs(right.startDate) || contractDateMs(right.createdAt) || 0) - (contractDateMs(left.startDate) || contractDateMs(left.createdAt) || 0))[0] || null;
}

function tenantApartmentId(tenant) {
  if (!tenant) return null;
  const direct = [
    tenant.apartmentId,
    tenant.linkedAptId,
    tenant.apartment,
    tenant.apartmentName,
    tenant.apartmentNumber,
  ].map(apartmentIdFromReference).find(value => value !== null);
  if (direct !== undefined) return direct;
  const contract = activeContractForTenant(tenant.id);
  return apartmentIdFromReference(contract?.apartmentId ?? contract?.apartment ?? contract?.apartmentName);
}

function resolveCloudConversationContext(conversation = {}) {
  // The phone is the stable WhatsApp identity. Prefer it over stale tenantId
  // metadata so an old conversation cannot keep displaying another resident.
  let tenant = conversation.phone
    ? (db.tenants || []).find(item => samePhone(item.phone, conversation.phone)) || null
    : null;
  tenant ||= (db.tenants || []).find(item => Number(item.id) === Number(conversation.tenantId)) || null;
  const contact = conversation.phone
    ? (db.whatsappContacts || []).find(item => samePhone(item.phone, conversation.phone)) || null
    : null;
  let apartment = null;
  if (!apartment && tenant) {
    apartment = (db.apartments || []).find(item => Number(item.id) === Number(tenantApartmentId(tenant))) || null;
  }
  // An authenticated Cloud contact stores the apartment selected during the
  // identity check. Use that association when the tenant row is older or was
  // imported without apartmentId. This fixes template previews and keeps the
  // same apartment shown by the inbox after a worker/webhook restart.
  if (!apartment && contact?.apartmentId != null) {
    apartment = (db.apartments || []).find(item => Number(item.id) === Number(contact.apartmentId)) || null;
  }
  if (!apartment && tenant && Number(conversation.tenantId) === Number(tenant.id) && conversation.apartmentId != null) {
    apartment = (db.apartments || []).find(item => Number(item.id) === Number(conversation.apartmentId)) || null;
  }
  // Unknown conversations still may carry the apartment selected during a
  // verified session, but never infer an apartment for an unknown phone.
  if (!apartment && !tenant) apartment = (db.apartments || []).find(item => Number(item.id) === Number(conversation.apartmentId)) || null;
  if (!tenant && apartment) tenant = activeTenantForApartment(apartment).tenant || null;
  return { tenant, apartment };
}

function repairCloudConversationContext(conversation) {
  const context = resolveCloudConversationContext(conversation);
  let changed = false;
  const tenantId = context.tenant?.id ?? null;
  const apartmentId = context.tenant ? tenantApartmentId(context.tenant) : context.apartment?.id ?? null;
  if (tenantId !== null && Number(conversation.tenantId) !== Number(tenantId)) {
    conversation.tenantId = tenantId;
    changed = true;
  }
  if (apartmentId !== null && Number(conversation.apartmentId) !== Number(apartmentId)) {
    conversation.apartmentId = apartmentId;
    changed = true;
  } else if (context.tenant && apartmentId === null && conversation.apartmentId != null) {
    conversation.apartmentId = null;
    changed = true;
  }
  return { ...context, changed };
}

function paymentReminderOffsets(apartment) {
  const offsets = Array.isArray(apartment?.paymentReminderDays) ? apartment.paymentReminderDays : [-3, 0, 3];
  return [...new Set(offsets.map(Number).filter(day => Number.isInteger(day) && day >= -15 && day <= 31))];
}

function cloudAdminPaymentReminderText(apartment, tenant, period) {
  const data = cloudPaymentTemplateData(apartment, period);
  const dueDate = data.parameters[4]?.text || 'fecha no confirmada';
  const rentStatus = data.parameters[5]?.text || 'Pendiente';
  const summary = cloudApartmentServices(apartment);
  const serviceLines = CLOUD_SERVICE_PRESENTATIONS.map(service => {
    const record = summary.records[service.key];
    const amounts = cloudServiceAmounts(record);
    const month = cloudUtilityMoney(amounts.month);
    const total = cloudUtilityMoney(amounts.total);
    const extra = service.key === 'electricity'
      ? `Facturas sin pagar: ${amounts.invoiceCount === null ? 'sin confirmar' : amounts.invoiceCount}`
      : `Convenio: ${amounts.financingKnown ? cloudUtilityMoney(amounts.financed) : amounts.totalKnown ? '$0' : 'sin confirmar'}`;
    return `${service.icon} ${service.label}: Mes ${month} · ${extra} · Total ${total}`;
  });
  return [
    `🔔 *Copia administrativa — cobro ${cloudPeriodLabel(period)}*`,
    '',
    `🏠 *Apartamento ${apartment?.name || '—'}*`,
    tenant?.name ? `👤 Inquilino: ${tenant.name}` : '',
    `💰 Canon: ${data.parameters[3]?.text || '$0'}`,
    `📅 Vencimiento: ${dueDate}`,
    `📌 Estado del canon: ${rentStatus}`,
    '',
    '*Estado de recibos:*',
    ...serviceLines,
    '',
    'La información corresponde a la última sincronización disponible.'
  ].filter(Boolean).join('\n');
}

async function sendCloudAdminPaymentReminder(phone, apartment, tenant, period) {
  const conversation = getCloudConversation({ phone });
  const body = cloudAdminPaymentReminderText(apartment, tenant, period);
  let sent;
  let channel = 'template';
  if (cloudServiceWindowOpen(conversation)) {
    sent = await sendCloudText(phone, body);
    channel = 'text';
  } else {
    // Outside Meta's customer-service window only an approved template can be
    // delivered. Use the administrator-specific template approved in Meta.
    sent = await sendCloudAdminPaymentReminderTemplate(phone, period, apartment);
  }
  addCloudMessage(conversation, 'out', {
    type: channel === 'text' ? 'text' : 'template',
    text: channel === 'text' ? body : `Copia administrativa de cobro (${period})`,
    template: channel === 'template' ? cloudAdminPaymentReminderTemplateName() : null,
    whatsappMessageId: sent.messages?.[0]?.id || null,
  });
  return { channel, messageId: sent.messages?.[0]?.id || null };
}

async function runPaymentReminders({ force = false } = {}) {
  ensureCloudCollections();
  const today = colombiaDate();
  const period = today.slice(0, 7);
  const [year, month] = period.split('-').map(Number);
  const result = { checked: 0, sent: 0, skipped: 0, failed: 0, adminSent: 0, adminFailed: 0, period };
  if (!cloudReady()) return { ...result, error: 'WhatsApp Cloud API no está configurada' };

  for (const apartment of db.apartments || []) {
    if (apartment.status !== 'occupied' || apartment.paymentRemindersEnabled === false) continue;
    const contract = activeContractForApartment(apartment.id);
    const tenant = contract && (db.tenants || []).find(item => Number(item.id) === Number(contract.tenantId));
    if (!tenant?.phone) continue;
    const dueDay = Math.min(31, Math.max(1, Number(apartment.paymentDueDay) || 5));
    // A configured day 31 should mean the last day in shorter months, not a
    // reminder accidentally moving to the following month.
    const dueAt = new Date(Date.UTC(year, month, 0));
    dueAt.setUTCDate(Math.min(dueDay, dueAt.getUTCDate()));
    for (const offset of paymentReminderOffsets(apartment)) {
      const target = new Date(dueAt);
      target.setUTCDate(target.getUTCDate() + offset);
      if (colombiaDate(target) !== today) continue;
      result.checked++;
      const key = `${apartment.id}:${period}:${offset}`;
      if (!force && db.paymentReminderLogs.some(log => log.key === key && log.status === 'sent')) { result.skipped++; continue; }
      const alreadyPaid = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment.id) &&
        payment.type === 'rent' && paymentPeriod(payment) === period && paymentCountsAsCollected(payment));
      const awaitingReview = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment.id) &&
        payment.type === 'rent' && paymentPeriod(payment) === period && payment.status === 'pending_validation');
      if (alreadyPaid || awaitingReview) { result.skipped++; continue; }
      const log = { id: nextId.paymentReminderLogs++, key, apartmentId: apartment.id, tenantId: tenant.id, period, offset,
        createdAt: new Date().toISOString(), status: 'sent' };
      try {
        const sent = await sendCloudPaymentReminderTemplate(tenant.phone, tenant.name, period, apartment);
        const conversation = getCloudConversation({ phone: tenant.phone, tenantId: tenant.id, apartmentId: apartment.id });
        addCloudMessage(conversation, 'out', { type: 'template', text: `Recordatorio de pago (${period})`,
          template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios', whatsappMessageId: sent.messages?.[0]?.id || null });
        db.paymentReminderLogs.push(log);
        result.sent++;

        // Administrators receive one copy per apartment/reminder offset. A
        // separate idempotency key prevents the admin copy from being sent
        // repeatedly on every hourly scheduler tick.
        // The due-date copy is scheduled separately for 08:00 CDT. Keep the
        // optional early/late copies, but do not send the offset 0 copy here.
        const adminPhones = offset === 0 ? [] : cloudAdminPhones().filter(phone => !samePhone(phone, tenant.phone));
        for (const adminPhone of adminPhones) {
          const adminKey = `admin:${adminPhone}:${apartment.id}:${period}:${offset}`;
          if (!force && db.paymentReminderLogs.some(item => item.key === adminKey && item.status === 'sent')) continue;
          const adminLog = {
            id: nextId.paymentReminderLogs++, key: adminKey, audience: 'admin', adminPhone,
            apartmentId: apartment.id, tenantId: tenant.id, period, offset,
            createdAt: new Date().toISOString(), status: 'sent',
          };
          try {
            const adminResult = await sendCloudAdminPaymentReminder(adminPhone, apartment, tenant, period);
            db.paymentReminderLogs.push({ ...adminLog, channel: adminResult.channel, whatsappMessageId: adminResult.messageId });
            result.adminSent++;
          } catch (adminError) {
            db.paymentReminderLogs.push({ ...adminLog, status: 'failed', error: adminError.message });
            result.adminFailed++;
            console.error('[WHATSAPP CLOUD] admin payment reminder error:', adminError.message);
          }
        }
      } catch (error) {
        db.paymentReminderLogs.push({ ...log, status: 'failed', error: error.message });
        result.failed++;
        console.error('[WHATSAPP CLOUD] payment reminder error:', error.message);
      }
    }
  }
  saveData();
  console.log(`[WHATSAPP CLOUD] Payment reminders ${period}: tenantSent=${result.sent}, adminSent=${result.adminSent}, tenantFailed=${result.failed}, adminFailed=${result.adminFailed}, skipped=${result.skipped}.`);
  return result;
}

async function runAdministrativeDueReminders({ force = false } = {}) {
  ensureCloudCollections();
  const today = colombiaDate();
  const period = today.slice(0, 7);
  const result = { checked: 0, sent: 0, skipped: 0, failed: 0, period, scheduledFor: '08:00 CDT' };
  if (!cloudReady()) return { ...result, error: 'WhatsApp Cloud API no está configurada' };
  const adminPhones = cloudAdminPhones();
  if (!adminPhones.length) return { ...result, error: 'No hay administradores WhatsApp configurados' };

  for (const apartment of db.apartments || []) {
    if (apartment.status !== 'occupied' || apartment.paymentRemindersEnabled === false) continue;
    const contract = activeContractForApartment(apartment.id);
    const tenant = contract && (db.tenants || []).find(item => Number(item.id) === Number(contract.tenantId));
    const dueDay = Math.min(31, Math.max(1, Number(apartment.paymentDueDay) || 5));
    const dueDate = cloudCalendarDate(period, dueDay);
    if (colombiaDate(dueDate) !== today) continue;
    result.checked++;
    const alreadyPaid = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment.id) &&
      payment.type === 'rent' && paymentPeriod(payment) === period && paymentCountsAsCollected(payment));
    if (alreadyPaid) { result.skipped++; continue; }

    for (const adminPhone of adminPhones) {
      const key = `admin-due:${adminPhone}:${apartment.id}:${period}`;
      if (!force && db.paymentReminderLogs.some(log => log.key === key && log.status === 'sent')) { result.skipped++; continue; }
      const log = {
        id: nextId.paymentReminderLogs++, key, audience: 'admin', adminPhone,
        apartmentId: apartment.id, tenantId: tenant?.id || null, period,
        offset: 0, scheduledFor: '08:00 CDT', createdAt: new Date().toISOString(), status: 'sent',
      };
      try {
        const sent = await sendCloudAdminPaymentReminder(adminPhone, apartment, tenant, period);
        db.paymentReminderLogs.push({ ...log, channel: sent.channel, whatsappMessageId: sent.messageId });
        result.sent++;
      } catch (error) {
        db.paymentReminderLogs.push({ ...log, status: 'failed', error: error.message });
        result.failed++;
        console.error('[WHATSAPP CLOUD] administrative due reminder error:', error.message);
      }
    }
  }
  saveData();
  console.log(`[WHATSAPP CLOUD] Administrative due reminders ${period}: sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}.`);
  return result;
}

function scheduleAdministrativeDueReminders() {
  const delay = Math.max(1000, nextColombiaEightAm() - Date.now());
  const nextRun = new Date(Date.now() + delay);
  console.log(`[WHATSAPP CLOUD] Administrative reminder scheduler: next run ${formatColombiaDateTime(nextRun)}.`);
  setTimeout(async () => {
    try { await runAdministrativeDueReminders(); }
    catch (error) { console.error('[WHATSAPP CLOUD] administrative scheduler error:', error.message); }
    scheduleAdministrativeDueReminders();
  }, delay).unref();
}

function cloudInteractiveReply(message) {
  // Meta normally sends interactive.button_reply/list_reply. Keep the
  // legacy shapes as fallbacks because old Cloud API payloads and test
  // webhooks may expose the reply one level higher.
  const buttonReply = message?.interactive?.button_reply || message?.button_reply || message?.button || null;
  const listReply = message?.interactive?.list_reply || message?.list_reply || null;
  const reply = buttonReply || listReply;
  if (!reply) return null;
  const id = String(reply.id || reply.button_id || reply.buttonId || reply.value || '').trim();
  const title = String(reply.title || reply.text || reply.label || '').trim();
  const payload = String(reply.payload || reply.button_payload || '').trim();
  return {
    id,
    title,
    payload,
    type: buttonReply ? 'button_reply' : 'list_reply',
  };
}

function cloudInteractiveAction(interactive) {
  const id = cloudNormaliseText(interactive?.id || '').replace(/\s+/g, '_');
  const title = cloudNormaliseText(interactive?.title || '');
  const payload = cloudNormaliseText(interactive?.payload || '').replace(/\s+/g, '_');
  const search = cloudNormaliseText([interactive?.id, interactive?.payload, interactive?.title].filter(Boolean).join(' '));
  const actions = {
    payment_confirmed: 'Solicitar comprobante de pago',
    payment_pending: 'Enviar recordatorio y solicitar comprobante',
  };
  if (actions[id] || actions[payload]) return actions[id] || actions[payload];
  if (/(?:payment[_-]?(?:confirmed|paid)|confirm(?:ar)?[_-]?pago|pago[_-]?(?:confirmado|realizado)|ya[_-]?(?:lo[_-]?)?pague|pago[_-]?si)/i.test(`${id} ${payload}`) ||
      /(?:^|\b)(?:si|sí)\b.*\bya\s+(?:lo\s+)?pague\b|\b(?:ya|he)\s+(?:lo\s+)?pague\b|\bconfirm(?:ar)?\s+(?:el|mi)?\s*pago\b|\bpago\s+(?:realizado|confirmado)\b/i.test(search)) {
    return actions.payment_confirmed;
  }
  if (/(?:payment[_-]?pending|not[_-]?paid|no[_-]?he[_-]?pag|pendiente[_-]?pago|pago[_-]?no)/i.test(`${id} ${payload}`) ||
      /\bno\s+he\s+pagado\b|\baun\s+no\s+he\s+pagado\b|\btodavia\s+no\s+he\s+pagado\b/i.test(search)) {
    return actions.payment_pending;
  }
  if (/^services_/.test(id)) return 'Actualizar menú de servicios';
  if (/^payments_/.test(id)) return 'Abrir flujo de confirmación de pagos';
  if (/^incident_/.test(id)) return 'Abrir flujo de registro de imprevistos';
  if (/^reminders_/.test(id)) return 'Abrir flujo de envío de cobros';
  if (/^menu_/.test(id)) return 'Abrir opción del menú de administración';
  return 'Botón recibido; no hay una acción automática asociada';
}

function cloudInteractiveIsPaymentConfirmed(interactive) {
  const id = cloudNormaliseText(interactive?.id || '').replace(/\s+/g, '_');
  const title = cloudNormaliseText(interactive?.title || '');
  const payload = cloudNormaliseText(interactive?.payload || '').replace(/\s+/g, '_');
  const search = cloudNormaliseText([interactive?.id, interactive?.payload, interactive?.title].filter(Boolean).join(' '));
  return /(?:payment[_-]?(?:confirmed|paid)|confirm(?:ar)?[_-]?pago|pago[_-]?(?:confirmado|realizado)|ya[_-]?(?:lo[_-]?)?pague|pago[_-]?si)/i.test(`${id} ${payload}`) ||
    /(?:^|\b)(?:si)\b.*\bya\s+(?:lo\s+)?pague\b|\b(?:ya|he)\s+(?:lo\s+)?pague\b|\bconfirm(?:ar)?\s+(?:el|mi)?\s*pago\b|\bpago\s+(?:realizado|confirmado)\b/i.test(search);
}

function cloudInteractiveIsPaymentPending(interactive) {
  const id = cloudNormaliseText(interactive?.id || '').replace(/\s+/g, '_');
  const title = cloudNormaliseText(interactive?.title || '');
  const payload = cloudNormaliseText(interactive?.payload || '').replace(/\s+/g, '_');
  const search = cloudNormaliseText([interactive?.id, interactive?.payload, interactive?.title].filter(Boolean).join(' '));
  return /(?:payment[_-]?pending|not[_-]?paid|no[_-]?he[_-]?pag|pendiente[_-]?pago|pago[_-]?no)/i.test(`${id} ${payload}`) ||
    /\bno\s+he\s+pagado\b|\baun\s+no\s+he\s+pagado\b|\btodavia\s+no\s+he\s+pagado\b/i.test(search);
}

function markCloudInteraction(message, status, detail = '') {
  if (!message?.interaction) return;
  message.interaction = {
    ...message.interaction,
    status,
    detail: detail || message.interaction.detail || '',
    processedAt: new Date().toISOString(),
  };
}

function requestedPaymentProof(conversation, period = colombiaDate().slice(0, 7)) {
  conversation.paymentProofRequestedAt = new Date().toISOString();
  conversation.paymentProofPeriod = period;
}

function paymentProofIsActive(conversation) {
  return !!conversation?.paymentProofRequestedAt &&
    Date.now() - new Date(conversation.paymentProofRequestedAt).getTime() < 72 * 60 * 60 * 1000;
}

function createPendingPaymentFromProof(conversation, media, messageId) {
  if (!media?.storageKey || media.archiveStatus !== 'stored') return null;
  const apartment = (db.apartments || []).find(item => Number(item.id) === Number(conversation.apartmentId));
  const contract = activeContractForApartment(conversation.apartmentId);
  const period = conversation.paymentProofPeriod || colombiaDate().slice(0, 7);
  const submittedAt = new Date().toISOString();
  const existing = (db.payments || []).find(payment => Number(payment.apartmentId) === Number(conversation.apartmentId) &&
    payment.type === 'rent' && paymentPeriod(payment) === period && payment.status === 'pending_validation');
  const expectedAmount = Number(contract?.monthlyRent || apartment?.monthlyRent || 0);
  const detectedAmount = Number(media.ocr?.amount) > 0 ? Number(media.ocr.amount) : null;
  const details = {
    apartmentId: Number(conversation.apartmentId), contractId: contract?.id || null, tenantId: conversation.tenantId || null,
    amount: expectedAmount || detectedAmount || 0, detectedAmount, date: colombiaDate(), period, type: 'rent',
    paymentMode: 'full', status: 'pending_validation', origin: 'whatsapp', submittedAt,
    receiptMedia: media, receiptMessageId: messageId,
    receiptOcr: media.ocr || null,
    description: `Comprobante de pago por WhatsApp - ${apartment?.name || 'apartamento'} (${period})`,
  };
  if (existing) {
    Object.assign(existing, details, { updatedAt: submittedAt });
    return existing;
  }
  const payment = { id: nextId.payments++, ...details, createdAt: submittedAt };
  db.payments.push(payment);
  return payment;
}

function paymentProofOcrLooksUseful(media) {
  const ocr = media?.ocr;
  const paymentSignal = ocr?.hasStrongPaymentLanguage || ocr?.reference || ocr?.provider;
  return !!ocr && ['readable', 'partial'].includes(ocr.status) && paymentSignal && (ocr.amount || ocr.reference);
}

async function acknowledgePaymentProof(conversation, payment, media) {
  const ocr = media?.ocr;
  const amount = ocr?.amount ? ` Valor detectado: $${Number(ocr.amount).toLocaleString('es-CO')}.` : '';
  const message = payment
    ? `🧾 Comprobante recibido y enviado a revisión.${amount}\n\nEl pago no se marcará como confirmado hasta que la administración lo valide.`
    : `🧾 Recibí el archivo, pero no pude asociarlo todavía a un comprobante de pago. La administración puede revisarlo manualmente.`;
  try {
    const sent = await sendCloudText(conversation.phone, message);
    addCloudMessage(conversation, 'out', { type: 'text', text: message, whatsappMessageId: sent.messages?.[0]?.id || null });
  } catch (error) {
    console.error('[WHATSAPP CLOUD] payment proof acknowledgement error:', error.message);
  }
}

function transcodeVoiceNote(file) {
  const isBrowserRecording = /^audio\/webm/i.test(String(file?.mimetype || ''));
  if (!isBrowserRecording || !ffmpegPath) return Promise.resolve(file);
  const id = crypto.randomUUID();
  const input = path.join(os.tmpdir(), `laujim-voice-${id}.webm`);
  const output = path.join(os.tmpdir(), `laujim-voice-${id}.ogg`);
  return new Promise((resolve, reject) => {
    try { fs.writeFileSync(input, file.buffer); } catch (error) { return reject(error); }
    const ffmpegProcess = spawn(ffmpegPath, ['-y', '-i', input, '-vn', '-c:a', 'libopus', '-b:a', '32k', output], { windowsHide: true });
    let stderr = '';
    ffmpegProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
    ffmpegProcess.on('error', error => { try { fs.unlinkSync(input); } catch {} reject(error); });
    ffmpegProcess.on('close', code => {
      try {
        if (code !== 0 || !fs.existsSync(output)) throw new Error(stderr || 'No fue posible convertir la nota de voz');
        const buffer = fs.readFileSync(output);
        resolve({ ...file, buffer, size: buffer.length, mimetype: 'audio/ogg', originalname: 'nota-de-voz.ogg', voice: true });
      } catch (error) { reject(error); }
      finally { [input, output].forEach(temp => { try { fs.unlinkSync(temp); } catch {} }); }
    });
  });
}

async function blockCloudUser(phone, reason) {
  ensureCloudCollections();
  const normalized = normalizePhone(phone);
  const index = db.whatsappBlockedUsers.findIndex(item => samePhone(item.phone, normalized));
  const record = {
    id: index >= 0 ? db.whatsappBlockedUsers[index].id : nextId.whatsappBlockedUsers++,
    phone: normalized,
    reason: reason || 'authentication_failed',
    blockedAt: index >= 0 ? db.whatsappBlockedUsers[index].blockedAt : new Date().toISOString(),
    remoteBlocked: false,
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) db.whatsappBlockedUsers[index] = record;
  else db.whatsappBlockedUsers.push(record);

  try {
    await cloudApiRequest('/block_users', 'POST', {
      messaging_product: 'whatsapp', block_users: [{ user: whatsappRecipientPhone(normalized) }],
    });
    record.remoteBlocked = true;
  } catch (error) {
    console.error('[WHATSAPP CLOUD] block user error:', error.message);
  }
  saveData();
  return record;
}

async function unblockCloudUser(phone) {
  ensureCloudCollections();
  const normalized = normalizePhone(phone);
  const index = db.whatsappBlockedUsers.findIndex(item => samePhone(item.phone, normalized));
  if (index < 0) return false;
  const blocked = db.whatsappBlockedUsers[index];

  // The old authentication flow also called Meta's block_users endpoint. A
  // local delete alone would make the inbox look fixed while Meta could still
  // reject outgoing replies, so remove the remote block when possible.
  try {
    if (blocked.remoteBlocked) {
      await cloudApiRequest('/block_users', 'DELETE', {
        messaging_product: 'whatsapp', block_users: [{ user: whatsappRecipientPhone(normalized) }],
      });
    }
    db.whatsappBlockedUsers.splice(index, 1);
    console.info(`[WHATSAPP CLOUD] recovered blocked contact ending ${normalized.slice(-4)} · reason=${blocked.reason || 'unknown'}`);
  } catch (error) {
    // Keep the local record so the remote unblock is retried on the next valid
    // message. The current message is still processed by the caller.
    console.error('[WHATSAPP CLOUD] remote unblock failed:', error.message);
  }
  saveData();
  return true;
}

async function failCloudAuthentication(phone, state, response) {
  const attempts = (Number(state?.attempts) || 0) + 1;
  if (attempts < CLOUD_AUTH_MAX_ATTEMPTS) {
    setCloudAuthState(phone, { ...state, attempts, expiresAt: new Date(Date.now() + CLOUD_AUTH_TTL).toISOString() });
    saveData();
    await sendCloudText(phone, response);
    return false;
  }

  clearCloudAuthState(phone);
  saveData();
  try {
    await sendCloudText(phone, 'No fue posible validar tu identidad. Este canal solo acepta mensajes de residentes autorizados.');
  } catch (error) {
    console.error('[WHATSAPP CLOUD] final authentication message error:', error.message);
  }
  await blockCloudUser(phone, 'authentication_failed');
  return true;
}

function validCloudSignature(req) {
  const c = cloudConfig();
  const signature = req.get('x-hub-signature-256') || '';
  if (!c.appSecret || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', c.appSecret).update(req.rawBody || '').digest('hex');
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireCloudAdmin(req, res) {
  if (req.auth?.role === 'admin') return true;
  res.status(403).json({ error: 'Acceso de administración requerido' });
  return false;
}

function parseJsonEnv(name, fallback = []) {
  try {
    const parsed = JSON.parse(String(process.env[name] || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeEdgeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80);
}

function cameraDefinitions() {
  const configured = parseJsonEnv('CAMERA_STREAMS_JSON', []);
  return (Array.isArray(configured) ? configured : []).map((item, index) => ({
    id: safeEdgeId(item?.id) || `camera-${index + 1}`,
    gatewayId: safeEdgeId(item?.gatewayId || item?.id) || `camera-${index + 1}`,
    name: String(item?.name || `Cámara ${index + 1}`).trim().slice(0, 100),
    location: String(item?.location || '').trim().slice(0, 140) || null,
    tenantVisible: item?.tenantVisible === true,
    enabled: item?.enabled !== false,
  })).filter(item => item.enabled);
}

function doorDefinitions() {
  const configured = parseJsonEnv('ACCESS_DOORS_JSON', []);
  return (Array.isArray(configured) ? configured : []).map((item, index) => ({
    id: safeEdgeId(item?.id) || `door-${index + 1}`,
    gatewayId: safeEdgeId(item?.gatewayId || item?.id) || `door-${index + 1}`,
    name: String(item?.name || `Acceso ${index + 1}`).trim().slice(0, 100),
    location: String(item?.location || '').trim().slice(0, 140) || null,
    tenantVisible: item?.tenantVisible === true,
    enabled: item?.enabled !== false,
  })).filter(item => item.enabled);
}

function publicEdgeView(item) {
  return { id: item.id, name: item.name, location: item.location, tenantVisible: item.tenantVisible, enabled: item.enabled };
}

function edgeGatewayConfig() {
  return {
    url: String(process.env.EDGE_GATEWAY_URL || '').trim().replace(/\/+$/, ''),
    token: String(process.env.EDGE_GATEWAY_TOKEN || '').trim(),
  };
}

function edgeGatewayReady() {
  const config = edgeGatewayConfig();
  return Boolean(config.url && config.token && /^https:\/\//i.test(config.url));
}

async function edgeGatewayRequest(route, body) {
  const config = edgeGatewayConfig();
  if (!edgeGatewayReady()) throw new Error('La pasarela local de cámaras y accesos todavía no está conectada.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(config.url + route, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(payload.error || payload.message || `Pasarela HTTP ${response.status}`).slice(0, 300));
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

const accessRateLimits = new Map();

function accessRateAllowed(actorKey) {
  const key = String(actorKey || 'unknown');
  const now = Date.now();
  const recent = (accessRateLimits.get(key) || []).filter(stamp => now - stamp < 60_000);
  if (recent.length >= 4 || (recent.length && now - recent[recent.length - 1] < 10_000)) return false;
  recent.push(now);
  accessRateLimits.set(key, recent);
  return true;
}

function appendAccessEvent(input = {}) {
  if (!Array.isArray(db.accessEvents)) db.accessEvents = [];
  const event = {
    id: nextId.accessEvents || 1,
    requestId: String(input.requestId || crypto.randomUUID()).slice(0, 80),
    actorRole: input.actorRole === 'tenant' ? 'tenant' : 'admin',
    actorId: String(input.actorId || '').slice(0, 100) || null,
    apartmentId: Number(input.apartmentId) || null,
    doorId: safeEdgeId(input.doorId) || null,
    status: ['requested', 'opened', 'failed', 'rejected'].includes(input.status) ? input.status : 'failed',
    message: String(input.message || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    createdAt: new Date().toISOString(),
  };
  nextId.accessEvents = event.id + 1;
  db.accessEvents.unshift(event);
  if (db.accessEvents.length > 1000) db.accessEvents.splice(1000);
  saveData();
  return event;
}

function tenantUtilityOverview(apartment) {
  const electricity = latestUtilityRecord('Air-e', apartment);
  const water = latestUtilityRecord('Triple A', apartment);
  const gas = latestUtilityRecord('Gases del Caribe', apartment);
  const view = (record, provider, referenceLabel, reference, paymentUrl, paymentMode) => ({
    provider,
    status: record?.status || 'unknown',
    // Residents receive the current month's amount only. Keep a temporary
    // fallback to the legacy field until every worker persists deudaMesCOP.
    debt: utilityMonthDebtAmount(normalizeUtilityRecord(record)) ?? utilityDebtAmount(normalizeUtilityRecord(record)),
    checkedAt: utilityRecordValueTimestamp(record),
    error: record?.error ? String(record.error).slice(0, 240) : null,
    referenceLabel,
    reference: String(reference || '').trim() || null,
    paymentUrl: /^https:\/\//i.test(String(paymentUrl || '')) ? String(paymentUrl) : null,
    paymentMode,
  });
  return {
    electricity: view(electricity, 'Air-e', 'NIC', apartment?.electricityPaymentCode || apartment?.nic || electricity?.nic, publicServicePaymentUrl(apartment, electricity, 'electricity'), 'nic'),
    water: view(water, 'Triple A', 'Póliza', apartment?.waterPaymentCode || water?.waterPaymentCode, publicServicePaymentUrl(apartment, water, 'water'), 'qr'),
    gas: view(gas, 'Gases del Caribe', 'Contrato', apartment?.gasPaymentCode || gas?.gasPaymentCode, publicServicePaymentUrl(apartment, gas, 'gas'), 'qr'),
  };
}

// ── Debt query intent (servicios públicos) ────────────────────────────────
const DEBT_QUERY_RE =
  /(?:cu[aá]nto\s+(?:debo|debe|vale|es|hay\s+que\s+pagar)|deuda|deudas|factura|facturas|servicios|energ[ií]a|aire|recibo|recibos)/i;

function isDebtQuery(text) {
  return DEBT_QUERY_RE.test(String(text || '').trim());
}

// Shared service-record helpers must live outside startServer(). The WhatsApp
// admin handlers are declared before startServer and use the same records as
// the HTTP utility endpoints.
function utilityProviderKey(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (normalized === 'aire' || normalized === 'air' || normalized.includes('aire')) return 'air-e';
  if (normalized.includes('triplea') || normalized === 'agua') return 'water';
  if (normalized.includes('gases') || normalized.includes('gascaribe')) return 'gas';
  return normalized;
}

function utilityRecordTimestamp(record) {
  const value = record?.checkedAt || record?.scrapedAt || record?.updatedAt || record?.createdAt || 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function utilityRecordValueTimestamp(record) {
  return record?.valueCheckedAt || record?.checkedAt || record?.scrapedAt || record?.updatedAt || null;
}

function utilityRecordMatchesApartment(record, apartment) {
  if (!record || !apartment) return false;
  const recordId = Number(record.apartmentId);
  const apartmentId = Number(apartment.id);
  if (Number.isFinite(recordId) && Number.isFinite(apartmentId) && recordId === apartmentId) return true;
  const recordName = String(record.apartment || '').trim().toLowerCase();
  const apartmentName = String(apartment.name || '').trim().toLowerCase();
  return Boolean(recordName && apartmentName && recordName === apartmentName);
}

function utilityRecordAirENic(record) {
  return String(record?.nic || record?.electricityPaymentCode || record?.electricityCode || '').replace(/\D/g, '');
}

function latestUtilityRecord(provider, apartment) {
  const requestedProvider = utilityProviderKey(provider);
  const records = (db.utilityRecords || []).filter(record => utilityProviderKey(record.provider) === requestedProvider);
  const direct = records.filter(record => utilityRecordMatchesApartment(record, apartment));

  // Air-e returns one Deuda Total per NIC and the worker may legitimately
  // persist that record without an apartment id/name (or with an older
  // portal label). A NIC is the canonical identity for Air-e, so include
  // that record when the direct apartment mapping is missing or stale.
  const expectedNic = requestedProvider === 'air-e'
    ? String(apartment?.electricityPaymentCode || apartment?.nic || '').replace(/\D/g, '')
    : '';
  const byNic = expectedNic
    ? records.filter(record => utilityRecordAirENic(record) === expectedNic)
    : [];
  const candidates = [...new Map([...direct, ...byNic].map(record => [
    `${record.id ?? ''}|${record.apartmentId ?? ''}|${record.apartment ?? ''}|${utilityRecordAirENic(record)}`,
    record,
  ])).values()];

  return candidates.sort((a, b) => utilityRecordTimestamp(b) - utilityRecordTimestamp(a))[0] || null;
}

function utilityDebtAmount(record) {
  if (!record) return null;
  // Prefer explicit total-debt fields. numFacturas is metadata and must never
  // be interpreted as a currency value.
  const fields = [
    'deudaTotalCOP', 'totalDeudaCOP', 'saldoTotalCOP', 'deudaCOP',
    'totalCOP', 'saldoCOP', 'amountCOP', 'valorCOP', 'deudaTotal',
    'deuda', 'total', 'amount', 'valor', 'deudaText',
  ];
  for (const field of fields) {
    if (record[field] === null || record[field] === undefined || record[field] === '') continue;
    const amount = typeof servicesScraper.parseCopAmount === 'function'
      ? servicesScraper.parseCopAmount(record[field])
      : Number(record[field]);
    if (amount !== null && Number.isFinite(amount)) return amount;
  }
  return null;
}

function utilityAmountFromFields(record, fields) {
  if (!record) return null;
  for (const field of fields) {
    if (record[field] === null || record[field] === undefined || record[field] === '') continue;
    const amount = typeof servicesScraper.parseCopAmount === 'function'
      ? servicesScraper.parseCopAmount(record[field])
      : Number(record[field]);
    if (amount !== null && Number.isFinite(amount)) return amount;
  }
  return null;
}

function utilityMonthDebtAmount(record) {
  return utilityAmountFromFields(record, [
    'deudaMesCOP', 'valorMesCOP', 'monthValueCOP', 'facturaValorCOP',
    'invoiceValueCOP', 'valorFacturaCOP', 'amt_ValorMes', 'amt_Valor',
    'amt_TotalMes', 'totalMes', 'TotalMes', 'amt_TotalMesSinTasa',
    'totalMesSinTasa', 'amt_EnergiaMes', 'energiaMes',
    'deudaMes', 'valorMes', 'monthValue', 'facturaValor', 'invoiceValue',
  ]);
}

function utilityFinancedAmount(record) {
  return utilityAmountFromFields(record, [
    'deudaConveniosCOP', 'financiadaCOP', 'deudaFinanciada', 'saldoFinanciado', 'financedDebt',
    'valorFinanciado', 'financingValue', 'financedAmount', 'saldoDeudaFinanciada',
  ]);
}

// Prefer the provider-specific financing field when both it and the
// standardized convention field exist. This prevents an old zero convention
// value from hiding a confirmed financing card.
function utilityCanonicalFinancingAmount(record) {
  return utilityAmountFromFields(record, [
    'financiadaCOP', 'deudaConveniosCOP', 'deudaFinanciada', 'saldoFinanciado',
    'financedDebt', 'valorFinanciado', 'financingValue', 'financedAmount',
    'saldoDeudaFinanciada',
  ]);
}

function utilityFinancingEvidence(record) {
  const provider = utilityProviderKey(record?.provider);
  if (provider === 'air-e') return false;
  const validation = String(record?.financeValidation || '').trim().toLowerCase();
  if (validation === 'confirmed' || record?.financingConfirmed === true) return true;
  if (validation === 'absent' || validation === 'not_applicable') return false;
  if (Array.isArray(record?.financiacion) && record.financiacion.length > 0) return true;
  const gasBalance = utilityAmountFromFields(record, ['saldoPorFacturarGasCOP', 'pendingGasBalanceCOP', 'pendingGasBalance']);
  const financialBalance = utilityAmountFromFields(record, ['saldoPorFacturarFinancieroCOP', 'pendingFinancialBalanceCOP', 'pendingFinancialBalance']);
  if ([gasBalance, financialBalance].some(value => value !== null && value > 0)) return true;
  const amount = utilityCanonicalFinancingAmount(record);
  return amount !== null && amount > 0 && Boolean(String(record?.financingSource || '').trim());
}

function clearUtilityFinancing(record, validation = 'absent') {
  record.deudaConveniosCOP = 0;
  record.financiadaCOP = 0;
  record.cuotaFinanciadaCOP = null;
  record.cuotaActual = null;
  record.cuotasTotales = null;
  record.proximoPagoCOP = null;
  record.saldoPorFacturarGasCOP = null;
  record.saldoPorFacturarFinancieroCOP = null;
  record.financingConfirmed = false;
  record.financeValidation = validation;
  record.financingSource = null;
  record.financiacion = [];
}

// Normalize records at the server boundary as well as in the worker. It is
// intentionally idempotent so old Aiven rows, Android payloads and the legacy
// scraper share the same provider-specific meaning.
function normalizeUtilityRecord(input) {
  const record = { ...(input || {}) };
  const provider = utilityProviderKey(record.provider);
  if (record.deudaTotalCOP === null || record.deudaTotalCOP === undefined) {
    const fallbackTotal = utilityAmountFromFields(record, ['deudaCOP', 'totalDeudaCOP', 'saldoTotalCOP', 'totalCOP', 'saldoCOP']);
    if (fallbackTotal !== null) record.deudaTotalCOP = fallbackTotal;
  }
  if (record.deudaCOP === null || record.deudaCOP === undefined) {
    if (record.deudaTotalCOP !== null && record.deudaTotalCOP !== undefined) record.deudaCOP = record.deudaTotalCOP;
  }

  if (provider === 'air-e') {
    // Air-e's Estado de Cuenta is accumulated debt, not a financing plan.
    clearUtilityFinancing(record, 'not_applicable');
    return record;
  }

  const total = utilityDebtAmount(record);
  if (utilityFinancingEvidence(record)) {
    const financing = utilityCanonicalFinancingAmount(record);
    record.deudaConveniosCOP = financing ?? 0;
    record.financiadaCOP = financing ?? 0;
    record.financingConfirmed = true;
    record.financeValidation = 'confirmed';
    if (!Array.isArray(record.financiacion)) record.financiacion = [];
    return record;
  }

  // A confirmed account total without a financing card is an explicit zero;
  // never retain yesterday's agreement or copy another apartment's balance.
  if (total !== null) clearUtilityFinancing(record, 'absent');
  return record;
}

function utilityQuotaAmount(record) {
  return utilityAmountFromFields(record, [
    'cuotaFinanciadaCOP', 'cuotaFinanciada', 'quotaValue', 'valorCuota',
    'valorCuotaFinanciada', 'monthlyQuota', 'cuotaMensual',
  ]);
}

function utilityIntegerFromFields(record, fields) {
  if (!record) return null;
  for (const field of fields) {
    if (record[field] === null || record[field] === undefined || record[field] === '') continue;
    const value = Number(String(record[field]).replace(/[^0-9-]/g, ''));
    if (Number.isFinite(value)) return Math.max(0, Math.round(value));
  }
  return null;
}

function cloudServiceAmounts(record) {
  const canonical = normalizeUtilityRecord(record);
  const provider = utilityProviderKey(canonical?.provider);
  const month = utilityMonthDebtAmount(canonical);
  const total = utilityDebtAmount(canonical);
  const financingKnown = provider !== 'air-e' && utilityFinancingEvidence(canonical);
  const explicitFinanced = financingKnown ? utilityCanonicalFinancingAmount(canonical) ?? 0 : null;
  const invoiceTotalCount = utilityIntegerFromFields(record, ['facturasTotales', 'invoiceTotalCount', 'totalInvoices', 'numFacturas']);
  const invoicePendingCount = utilityIntegerFromFields(record, ['facturasPendientes', 'pendingInvoices', 'numFacturas']);
  const explicitInvoiceOverdueCount = utilityIntegerFromFields(record, ['facturasVencidas', 'overdueInvoices', 'pastDueInvoices']);
  // Older Air-e worker payloads only carried `numFacturas`. Preserve that
  // useful value until the next rich scrape replaces it with the explicit
  // overdue count. Never apply this fallback to Triple A or Gases.
  const invoiceOverdueCount = explicitInvoiceOverdueCount !== null
    ? explicitInvoiceOverdueCount
    : provider === 'air-e'
      ? utilityIntegerFromFields(canonical, ['numFacturas'])
      : null;
  const invoiceCount = invoicePendingCount;
  // Air-e's accumulated Estado de Cuenta must never become a fake convenio.
  // It remains visible through Total a Pagar and the overdue-invoice count.
  const financed = provider === 'air-e' ? 0 : explicitFinanced;
  const quota = financingKnown ? utilityQuotaAmount(canonical) : null;
  const installmentCurrent = financingKnown ? utilityIntegerFromFields(canonical, ['cuotaActual', 'currentQuota', 'currentInstallment', 'installmentNumber']) : null;
  const installmentTotal = financingKnown ? utilityIntegerFromFields(canonical, ['cuotasTotales', 'totalQuotas', 'totalInstallments', 'installmentCount']) : null;
  return {
    month,
    total,
    financed,
    quota,
    invoiceCount,
    invoiceTotalCount,
    invoicePendingCount,
    invoiceOverdueCount,
    installmentCurrent,
    installmentTotal,
    monthKnown: month !== null,
    totalKnown: total !== null,
    financingKnown,
  };
}

function cloudUtilityMoney(value) {
  return value === null || value === undefined
    ? 'sin confirmar'
    : `$${Math.round(Number(value)).toLocaleString('es-CO')}`;
}

function utilityResultHasConfirmedValue(record) {
  const status = String(record?.status || '').trim().toLowerCase();
  return ['pending', 'paid'].includes(status) && utilityDebtAmount(record) !== null;
}

const UTILITY_CHANGE_DETECTOR_VERSION = 4;
const UTILITY_CHANGE_CONFIRMATIONS_REQUIRED = 2;
const UTILITY_CHANGE_CONFIRMATION_MAX_MS = 2 * 60 * 60 * 1000;

function utilitySnapshotForChange(record) {
  const amounts = cloudServiceAmounts(record);
  return {
    provider: utilityProviderKey(record?.provider),
    total: amounts.total,
    month: amounts.month,
    // Financing is compared only when it is a confirmed provider field. A
    // missing card during a SPA route change must not look like a payment.
    financed: amounts.financingKnown ? amounts.financed : null,
    invoiceCount: amounts.invoiceCount,
    invoiceOverdueCount: amounts.invoiceOverdueCount,
    period: String(record?.periodo || record?.billingPeriod || '').trim(),
    source: String(record?.debtSource || '').trim().toLowerCase(),
    status: String(record?.status || '').trim().toLowerCase(),
  };
}

function utilityCandidateMatches(candidate, snapshot) {
  if (!candidate || snapshot.total === null) return false;
  const sameKnown = (left, right) => left === null || left === undefined || right === null || right === undefined
    ? (left === null || left === undefined) && (right === null || right === undefined)
    : Number(left) === Number(right);
  const periodCompatible = !candidate.period || !snapshot.period || String(candidate.period) === String(snapshot.period);
  return Number(candidate.currentTotal) === Number(snapshot.total)
    && sameKnown(candidate.currentMonth, snapshot.month)
    && sameKnown(candidate.currentInvoiceCount, snapshot.invoiceCount)
    && sameKnown(candidate.currentInvoiceOverdueCount, snapshot.invoiceOverdueCount)
    && periodCompatible;
}

// A portal parser can temporarily lose a financing card or change how a total
// is split. That must not look like a payment. A reduction is therefore only
// promoted after two consecutive, structurally identical confirmed readings.
// A detector-version change establishes a fresh baseline and clears alerts
// produced by the previous one-reading implementation.
function utilityPaymentDecision(existing, incoming) {
  if (!utilityResultHasConfirmedValue(incoming)) {
    return { change: existing?.paymentChange || null, candidate: existing?.paymentChangeCandidate || null };
  }
  if (!utilityResultHasConfirmedValue(existing)
      || Number(existing?.paymentChangeDetectorVersion || 0) !== UTILITY_CHANGE_DETECTOR_VERSION) {
    return { change: null, candidate: null };
  }

  const previous = utilitySnapshotForChange(existing);
  const current = utilitySnapshotForChange(incoming);
  const candidate = existing?.paymentChangeCandidate || null;
  const candidateAt = candidate?.firstSeenAt ? new Date(candidate.firstSeenAt).getTime() : 0;
  const candidateFresh = candidateAt > 0 && Date.now() - candidateAt <= UTILITY_CHANGE_CONFIRMATION_MAX_MS;

  if (candidateFresh && utilityCandidateMatches(candidate, current)) {
    const confirmations = Number(candidate.confirmations || 1) + 1;
    if (confirmations >= UTILITY_CHANGE_CONFIRMATIONS_REQUIRED) {
      const detectedAt = incoming.checkedAt || incoming.scrapedAt || new Date().toISOString();
      const base = {
        previousTotal: Number(candidate.previousTotal),
        currentTotal: Number(current.total),
        delta: Number(candidate.previousTotal) - Number(current.total),
        detectedAt,
        confidence: 'probable-confirmed-twice',
        detectorVersion: UTILITY_CHANGE_DETECTOR_VERSION,
      };
      if (base.previousTotal > 0 && base.currentTotal === 0) {
        return { change: { ...base, status: 'full_payment' }, candidate: null };
      }
      if (base.currentTotal > 0 && base.delta > 0) {
        return { change: { ...base, status: 'partial_payment' }, candidate: null };
      }
    }
    return { change: null, candidate: { ...candidate, confirmations } };
  }

  const periodChanged = previous.period && current.period && previous.period !== current.period;
  const invoiceCountIncreased = previous.invoiceCount !== null && current.invoiceCount !== null
    && current.invoiceCount > previous.invoiceCount;
  if (previous.total === null || current.total === null || current.total >= previous.total
      || periodChanged || invoiceCountIncreased) {
    return { change: null, candidate: null };
  }

  // A financing card can disappear temporarily while the SPA changes route.
  // Do not infer a payment from that field alone. Require an observable
  // reduction in the billed month/invoice count, or a fully confirmed $0
  // account. This specifically prevents false positives like 302/303.
  const monthReduced = previous.month !== null && current.month !== null && current.month < previous.month;
  const pendingInvoicesReduced = previous.invoiceCount !== null && current.invoiceCount !== null
    && current.invoiceCount < previous.invoiceCount;
  const overdueInvoicesReduced = previous.invoiceOverdueCount !== null && current.invoiceOverdueCount !== null
    && current.invoiceOverdueCount < previous.invoiceOverdueCount;
  const fullZeroConfirmed = current.total === 0
    && current.status === 'paid'
    && current.month === 0
    && current.financed === 0
    && (current.invoiceCount === null || current.invoiceCount === 0);
  if (!monthReduced && !pendingInvoicesReduced && !overdueInvoicesReduced && !fullZeroConfirmed) {
    return { change: null, candidate: null };
  }

  return {
    change: null,
    candidate: {
      previousTotal: previous.total,
      currentTotal: current.total,
      currentMonth: current.month,
      currentFinanced: current.financed,
      currentInvoiceCount: current.invoiceCount,
      currentInvoiceOverdueCount: current.invoiceOverdueCount,
      period: current.period,
      source: current.source,
      status: current.status,
      confirmations: 1,
      firstSeenAt: incoming.checkedAt || incoming.scrapedAt || new Date().toISOString(),
    },
  };
}

function gasRecordHasNoVisibleInvoice(record) {
  return utilityProviderKey(record?.provider) === 'gas'
    && /no tiene este contrato asociado/i.test(String(record?.error || ''));
}

function mergeUtilityRecord(existing, incoming) {
  const existingRecord = existing ? normalizeUtilityRecord(existing) : null;
  const incomingRecord = normalizeUtilityRecord(incoming);
  const incomingConfirmed = utilityResultHasConfirmedValue(incomingRecord);
  const existingConfirmed = utilityResultHasConfirmedValue(existingRecord);
  const existingValueAt = existingRecord ? new Date(utilityRecordValueTimestamp(existingRecord) || '').getTime() : 0;
  const incomingValueAt = new Date(utilityRecordValueTimestamp(incomingRecord) || '').getTime();

  // A delayed worker response must not overwrite a newer confirmed portal
  // value. Keep the attempt diagnostics so the operator can still see that a
  // late run happened, but preserve the financial snapshot and its detector.
  if (existingRecord && existingConfirmed && incomingConfirmed
      && existingValueAt > 0 && incomingValueAt > 0 && incomingValueAt < existingValueAt) {
    return normalizeUtilityRecord({
      ...existingRecord,
      lastAttemptAt: incomingRecord.checkedAt || incomingRecord.scrapedAt || new Date().toISOString(),
      lastAttemptStatus: incomingRecord.status || 'unknown',
      lastAttemptError: incomingRecord.error || null,
      staleAttemptIgnored: true,
    });
  }

  const merged = { ...(existingRecord || {}), ...incomingRecord };
  if (incomingConfirmed) {
    const decision = utilityPaymentDecision(existingRecord, incomingRecord);
    merged.paymentChange = decision.change;
    merged.paymentChangeCandidate = decision.candidate;
    merged.paymentChangeDetectorVersion = UTILITY_CHANGE_DETECTOR_VERSION;
  }
  if (!existingRecord || !existingConfirmed || incomingConfirmed) {
    if (incomingConfirmed) {
      merged.valueCheckedAt = incomingRecord.checkedAt || incomingRecord.scrapedAt || new Date().toISOString();
    }
    return normalizeUtilityRecord(merged);
  }

  // A failed/captcha/timeout run is still a useful health signal, but it is
  // not a new bill value. Keep the last confirmed amount so WhatsApp and the
  // tenant portal do not replace a real Air-e debt with a blank response.
  for (const field of [
    'deudaCOP', 'deudaTotalCOP', 'deudaMesCOP', 'valorMesCOP', 'monthValueCOP',
    'facturaValorCOP', 'invoiceValueCOP', 'deudaLabel', 'deudaText', 'status',
    'numFacturas', 'facturasTotales', 'facturasPendientes', 'facturasVencidas', 'factura', 'periodo',
    'deudaConveniosCOP', 'financiadaCOP', 'cuotaFinanciadaCOP', 'cuotaActual', 'cuotasTotales',
    'proximoPagoCOP', 'saldoPorFacturarGasCOP', 'saldoPorFacturarFinancieroCOP',
    'financingConfirmed', 'financeValidation', 'financingSource', 'financiacion', 'facturas', 'debtSource',
    'debtEndpointStatus', 'invoiceEndpointStatus',
  ]) {
    if (existingRecord[field] !== undefined) merged[field] = existingRecord[field];
  }
  merged.valueCheckedAt = existingRecord.valueCheckedAt || existingRecord.checkedAt || existingRecord.scrapedAt || null;
  merged.lastAttemptAt = incomingRecord?.checkedAt || incomingRecord?.scrapedAt || new Date().toISOString();
  merged.lastAttemptStatus = incomingRecord?.status || 'unknown';
  merged.lastAttemptError = incomingRecord?.error || null;
  return normalizeUtilityRecord(merged);
}

function utilityPaymentView(record) {
  if (!record) return null;
  const canonical = normalizeUtilityRecord(record);
  const checkedAt = utilityRecordValueTimestamp(canonical);
  if (gasRecordHasNoVisibleInvoice(canonical) || canonical.portalNoInvoice === true) {
    return {
      status: 'paid',
      deudaCOP: 0,
      deudaMesCOP: 0,
      deudaConveniosCOP: 0,
      deudaTotalCOP: 0,
      numFacturas: 0,
      factura: null,
      periodo: null,
      actualizado: checkedAt,
      checkedAt,
      error: null,
      portalNoInvoice: true,
      paymentChange: canonical.paymentChange || null,
    };
  }
  const financingConfirmed = utilityFinancingEvidence(canonical);
  return {
    status: canonical.status || 'unknown',
    deudaMesCOP: utilityMonthDebtAmount(canonical),
    deudaConveniosCOP: financingConfirmed ? utilityCanonicalFinancingAmount(canonical) ?? 0 : 0,
    deudaTotalCOP: utilityDebtAmount(canonical),
    deudaCOP: utilityDebtAmount(canonical),
    facturaValorCOP: utilityAmountFromFields(canonical, ['facturaValorCOP', 'invoiceValueCOP', 'valorFacturaCOP']),
    financiadaCOP: financingConfirmed ? utilityCanonicalFinancingAmount(canonical) ?? 0 : 0,
    cuotaFinanciadaCOP: financingConfirmed ? utilityQuotaAmount(canonical) : null,
    cuotaActual: financingConfirmed ? utilityIntegerFromFields(canonical, ['cuotaActual', 'currentQuota', 'currentInstallment', 'installmentNumber']) : null,
    cuotasTotales: financingConfirmed ? utilityIntegerFromFields(canonical, ['cuotasTotales', 'totalQuotas', 'totalInstallments', 'installmentCount']) : null,
    proximoPagoCOP: financingConfirmed ? utilityAmountFromFields(canonical, ['proximoPagoCOP', 'nextPaymentCOP', 'nextPayment']) : null,
    saldoPorFacturarGasCOP: financingConfirmed ? utilityAmountFromFields(canonical, ['saldoPorFacturarGasCOP', 'pendingGasBalanceCOP']) : null,
    saldoPorFacturarFinancieroCOP: financingConfirmed ? utilityAmountFromFields(canonical, ['saldoPorFacturarFinancieroCOP', 'pendingFinancialBalanceCOP']) : null,
    financiacion: financingConfirmed && Array.isArray(canonical.financiacion) ? canonical.financiacion : [],
    facturas: Array.isArray(canonical.facturas) ? canonical.facturas : [],
    facturasTotales: utilityIntegerFromFields(canonical, ['facturasTotales', 'invoiceTotalCount', 'totalInvoices', 'numFacturas']),
    facturasPendientes: utilityIntegerFromFields(canonical, ['facturasPendientes', 'pendingInvoices', 'numFacturas']),
    facturasVencidas: utilityIntegerFromFields(canonical, ['facturasVencidas', 'overdueInvoices', 'pastDueInvoices']),
    financingConfirmed,
    financeValidation: canonical.financeValidation || (financingConfirmed ? 'confirmed' : 'absent'),
    financingSource: canonical.financingSource || null,
    debtSource: canonical.debtSource || null,
    debtEndpointStatus: canonical.debtEndpointStatus ?? null,
    paymentChange: canonical.paymentChange || null,
    numFacturas: Number(canonical.numFacturas) || (canonical.status === 'pending' ? 1 : 0),
    factura: canonical.factura || canonical.invoiceNumber || null,
    periodo: canonical.periodo || canonical.period || null,
    actualizado: checkedAt,
    checkedAt,
    error: canonical.error || null,
  };
}

function utilityTenantPaymentView(record) {
  const view = utilityPaymentView(record);
  if (!view) return null;
  const monthDebt = view.deudaMesCOP ?? view.deudaCOP;
  return {
    status: view.status,
    deudaCOP: monthDebt,
    numFacturas: view.numFacturas,
    factura: view.factura,
    periodo: view.periodo,
    actualizado: view.actualizado,
    checkedAt: view.checkedAt,
    error: view.error,
    portalNoInvoice: view.portalNoInvoice || false,
  };
}

function buildDebtReply(contact) {
  const aptId = Number(contact.apartmentId);
  const apt = (db.apartments || []).find(a => Number(a.id) === aptId);
  const electricity = latestUtilityRecord('Air-e', apt);
  const water = latestUtilityRecord('Triple A', apt);
  const gas = latestUtilityRecord('Gases del Caribe', apt);
  if (!electricity && !water && !gas) {
    return 'No tengo datos de tu deuda de servicios en este momento. Si acabas de sincronizar, espera unos minutos y vuelve a preguntar.';
  }

  const utilityLine = (label, record, paidText) => {
    if (!record) return `${label}: sin datos de consulta.`;
    // The tenant-facing bot exposes only the current month's amount. The
    // accumulated/provider debt remains available to the administrator view.
    const debt = utilityMonthDebtAmount(record) ?? utilityDebtAmount(record);
    const facturas = Number(record.numFacturas) || (record.status === 'pending' ? 1 : 0);
    const checkedAt = utilityRecordValueTimestamp(record);
    const when = checkedAt && !Number.isNaN(new Date(checkedAt).getTime())
      ? ` Datos del ${formatColombiaDateTime(checkedAt)}.`
      : '';
    if (gasRecordHasNoVisibleInvoice(record)) {
      return `${label}: Deuda Total de $0; sin factura pendiente visible.${when}`;
    }
    if (debt !== null && debt > 0) {
      return `${label}: Deuda del mes de $${debt.toLocaleString('es-CO')}, correspondiente a ${facturas} factura${facturas === 1 ? '' : 's'} pendiente${facturas === 1 ? '' : 's'}.${when}`;
    }
    if (record.status === 'pending') {
      return `${label}: Deuda del mes pendiente; el portal no informó el valor.${when}`;
    }
    if (record.status === 'paid' || debt === 0) return `${label}: ${paidText}${when}`;
    return `${label}: no fue posible confirmar el valor en la última consulta.${when}`;
  };

  return [
    '📋 Estado de servicios:',
    utilityLine('⚡ Energía (Air-e)', electricity, 'está al día 🎉 (0 facturas pendientes).'),
    utilityLine('💧 Agua (Triple A)', water, 'está al día 🎉 (0 facturas pendientes).'),
    utilityLine('🔥 Gas (Gases del Caribe)', gas, 'está al día 🎉 (0 facturas pendientes).'),
  ].join('\n');
}

// ── WhatsApp admins (configured in Settings, stored in db.settings) ────────
function cloudAdminPhones() {
  const setting = (db.settings || []).find(s => s.key === 'whatsapp_admin_phones');
  try {
    const parsed = JSON.parse(setting?.value || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizePhone).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isCloudAdminPhone(phone) {
  return cloudAdminPhones().some(admin => samePhone(admin, phone));
}

function getCloudAdminSession(phone) {
  ensureCloudCollections();
  const normalized = normalizePhone(phone);
  let session = db.whatsappAdminSessions.find(item => samePhone(item.phone, normalized));
  if (!session) {
    session = {
      id: nextId.whatsappAdminSessions++,
      phone: normalized,
      greetedAt: null,
      updatedAt: new Date().toISOString(),
    };
    db.whatsappAdminSessions.push(session);
  }
  return session;
}

function cloudAdminGreeting(date = new Date()) {
  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).find(part => part.type === 'hour');
  const hour = Number(hourPart?.value || 0);
  const greeting = hour >= 5 && hour < 12
    ? 'Buenos días'
    : hour >= 12 && hour < 19
      ? 'Buenas tardes'
      : 'Buenas noches';
  return `${greeting}, administrador. Bienvenido al sistema de administración de apartamentos Laujim. ¿Cómo te puedo ayudar?`;
}

async function greetCloudAdminOnce(phone) {
  const session = getCloudAdminSession(phone);
  if (session.greetedAt) return;
  try {
    await sendCloudAdminAccessButton(phone, `${cloudAdminGreeting()}\n\nAcceso directo para revisar y enviar mensajes desde WhatsApp Cloud:`);
  } catch (error) {
    console.error('[WHATSAPP CLOUD] admin access button error:', error.message);
    await sendCloudText(phone, `${cloudAdminGreeting()}\n\n🔗 ${CLOUD_ADMIN_WHATSAPP_URL}`);
  }
  session.greetedAt = new Date().toISOString();
  session.updatedAt = session.greetedAt;
  saveData();
}

function isCloudExitCommand(text) {
  return /^(?:salir|salida|cancelar|cancel|terminar|fin|cerrar|menu\s+principal|inicio)$/i.test(String(text || '').trim());
}

// Interactive list messages are used here because the administrator needs
// more than three options (WhatsApp's limit for reply buttons).
async function sendCloudAdminMenu(phone) {
  clearCloudAuthState(phone);
  saveData();
  try {
    await sendCloudInteractiveList(phone, '🤖 Menú de administración — elige una opción. Escribe SALIR para cerrar:', 'Abrir menú', [{
      title: 'Administración',
      rows: [
        { id: 'menu_morosos', title: '📋 Morosos', description: 'Reporte de cobros y vencimientos' },
        { id: 'menu_enviar_cobros', title: '📨 Enviar cobros', description: 'Plantilla con canon y servicios' },
        { id: 'menu_confirmar', title: '✅ Confirmar pagos', description: 'Registrar el canon con fecha de hoy' },
        { id: 'menu_servicios', title: '💧 Servicios', description: 'Consultar deudas por apartamento' },
        { id: 'menu_imprevistos', title: '⚠️ Imprevistos', description: 'Registrar un gasto del apartamento' },
      ],
    }]);
  } catch (error) {
    console.error('[WHATSAPP CLOUD] admin menu error:', error.message);
    await sendCloudText(phone, '🤖 Comandos admin:\n• "cobros" / "deuda" / "morosos" → reporte de pagos\n• "enviar cobros" → plantilla con canon y servicios\n• "confirmar pagos" → registrar el canon de hoy\n• "servicios" → consulta de servicios\n• "registrar imprevistos" → registrar un gasto\n• "APROBAR <apto>" / "RECHAZAR <apto>" → revisar un comprobante\n• "SALIR" → cerrar');
  }
}

function cloudNormaliseText(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function cloudFindApartment(ref) {
  const value = String(ref || '').trim();
  const digits = value.replace(/\D/g, '');
  return (db.apartments || []).find(apartment =>
    String(apartment.name || '').toLowerCase() === value.toLowerCase() ||
    String(apartment.id) === value ||
    (digits && String(apartment.name || '').replace(/\D/g, '') === digits)
  ) || null;
}

function cloudApartmentFloor(apartment) {
  const explicitFloor = Number(apartment?.floor);
  if (Number.isInteger(explicitFloor) && explicitFloor > 0) return explicitFloor;
  const firstDigit = String(apartment?.name || '').match(/\d/);
  return firstDigit ? Number(firstDigit[0]) : 0;
}

function occupiedCloudApartments() {
  const apartments = (db.apartments || []).filter(apartment => apartment.status === 'occupied');
  const source = apartments.length ? apartments : (db.apartments || []);
  return source.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es', { numeric: true }));
}

function configuredCloudApartments() {
  return (db.apartments || [])
    .slice()
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es', { numeric: true }));
}

function cloudApartmentsForFloor(floor) {
  return occupiedCloudApartments().filter(apartment => cloudApartmentFloor(apartment) === Number(floor));
}

function cloudServiceApartmentsForFloor(floor) {
  return configuredCloudApartments().filter(apartment => cloudApartmentFloor(apartment) === Number(floor));
}

function cloudListSections(title, rows) {
  return [{ title, rows }];
}

function isReceiptPaymentUrl(value, service) {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (service === 'water' && host.endsWith('portal.aaa.com.co')) {
      return path === '/pagos' && url.searchParams.get('tipoPago') === 'coupon' && Boolean(url.searchParams.get('numeroPago'));
    }
    if (service === 'gas' && host.endsWith('gascaribe.com')) {
      if (/^\/(?:login|contracts)(?:\/|$)/i.test(path)) return false;
      if (path === '/payments' && [...url.searchParams.keys()].length === 0) return false;
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

function gasContractPaymentUrl(contract) {
  const code = String(contract || '').trim();
  return code ? `https://portal.gascaribe.com/payments/contract/${encodeURIComponent(code)}` : null;
}

function normalizeApartmentServiceLinks(apartment) {
  if (!apartment || typeof apartment !== 'object') return apartment;
  apartment.gasPaymentUrl = gasContractPaymentUrl(apartment.gasPaymentCode);
  return apartment;
}

function defaultGasAccountId(apartment, apartments = []) {
  if (!String(apartment?.gasPaymentCode || '').trim()) return null;
  const explicit = String(apartment?.gasAccountId || '').trim();
  if (/^gas-\d+$/.test(explicit)) return explicit;

  const identity = item => item?.id != null
    ? `id:${item.id}`
    : `name:${String(item?.name || '').trim().toLowerCase()}|gas:${String(item?.gasPaymentCode || '').trim()}`;
  const targetIdentity = identity(apartment);
  const candidates = [...(apartments || [])];
  if (!candidates.some(item => identity(item) === targetIdentity)) candidates.push(apartment);

  const counts = new Map();
  for (const item of candidates) {
    if (!String(item?.gasPaymentCode || '').trim()) continue;
    const account = String(item.gasAccountId || '').trim();
    if (/^gas-\d+$/.test(account)) counts.set(account, (counts.get(account) || 0) + 1);
  }

  const unassigned = candidates
    .filter(item => String(item?.gasPaymentCode || '').trim() && !/^gas-\d+$/.test(String(item?.gasAccountId || '').trim()))
    .sort((left, right) => {
      const created = String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''));
      if (created) return created;
      const leftId = Number(left?.id);
      const rightId = Number(right?.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) return leftId - rightId;
      return String(left?.name || '').localeCompare(String(right?.name || ''), 'es', { numeric: true });
    });
  const assignments = new Map();
  for (const item of unassigned) {
    let number = 1;
    while ((counts.get(`gas-${number}`) || 0) >= 10) number += 1;
    const account = `gas-${number}`;
    counts.set(account, (counts.get(account) || 0) + 1);
    assignments.set(identity(item), account);
  }
  return assignments.get(targetIdentity) || 'gas-1';
}

function publicServicePaymentUrl(apartment, record, service) {
  if (service === 'electricity') {
    // Air-e payment entry point. Tenants can enter the NIC on the public
    // payment page; never expose the authenticated invoice portal.
    return 'https://portal.air-e.com/Pagar#/List';
  }
  if (service === 'gas') {
    return gasContractPaymentUrl(apartment?.gasPaymentCode || record?.gasPaymentCode);
  }
  const field = 'waterPaymentUrl';
  return [apartment?.[field], record?.[field]].find(value => isReceiptPaymentUrl(value, service)) || null;
}

function cloudServicePaymentLink(apartment, record, service) {
  return publicServicePaymentUrl(apartment, record, service) || 'No configurado';
}

function cloudServiceReference(apartment, record, service) {
  const valueByService = {
    electricity: ['NIC', apartment?.electricityPaymentCode || apartment?.nic || record?.nic],
    water: ['Póliza', apartment?.waterPaymentCode || record?.waterPaymentCode],
    gas: ['Contrato', apartment?.gasPaymentCode || record?.gasPaymentCode],
  };
  const [label, value] = valueByService[service] || ['Referencia', ''];
  return `${label}: ${value || 'No configurado'}`;
}

function cloudServiceState(record, _provider) {
  if (!record) return { label: 'Deuda Total: sin datos de consulta', debt: null, known: false, hasDebt: false };
  if (gasRecordHasNoVisibleInvoice(record)) {
    return { label: 'Deuda Total: $0 · Al día · sin factura pendiente visible', debt: 0, known: true, hasDebt: false };
  }
  const debt = utilityDebtAmount(record);
  if (debt !== null && debt > 0) {
    return {
      label: `Deuda Total: $${debt.toLocaleString('es-CO')}`,
      debt,
      known: true,
      hasDebt: true,
    };
  }
  if (record.status === 'paid' || debt === 0) {
    return { label: 'Deuda Total: $0 · Al día', debt: debt ?? 0, known: true, hasDebt: false };
  }
  if (record.status === 'pending') {
    return { label: 'Deuda Total pendiente · valor no informado', debt, known: false, hasDebt: false };
  }
  if (record.status === 'captcha') return { label: 'Deuda Total: requiere verificación manual', debt, known: false, hasDebt: false };
  if (record.status === 'timeout') return { label: 'Deuda Total: consulta agotó el tiempo', debt, known: false, hasDebt: false };
  return { label: 'Deuda Total: sin valor confirmado', debt, known: false, hasDebt: false };
}

function cloudApartmentServices(apartment) {
  const electricity = latestUtilityRecord('Air-e', apartment);
  const water = latestUtilityRecord('Triple A', apartment);
  const gas = latestUtilityRecord('Gases del Caribe', apartment);
  return {
    apartment,
    records: { electricity, water, gas },
    states: {
      electricity: cloudServiceState(electricity, 'Air-e'),
      water: cloudServiceState(water, 'Triple A'),
      gas: cloudServiceState(gas, 'Gases del Caribe'),
    },
  };
}

function setCloudServicesStep(phone, step) {
  setCloudAuthState(phone, {
    step,
    expiresAt: new Date(Date.now() + CLOUD_AUTH_TTL).toISOString(),
    attempts: 0,
  });
  saveData();
}

async function sendCloudServicesMenu(phone, body = '💧 Servicios — elige una opción. Escribe SALIR para volver al menú principal:') {
  setCloudServicesStep(phone, 'admin_services_menu');
  try {
    await sendCloudInteractiveList(phone, body, 'Abrir servicios', cloudListSections('Servicios', [
      { id: 'services_all', title: '📊 Todos los aptos', description: 'Reporte de agua, energía y gas' },
      { id: 'services_by_apartment', title: '🏠 Por apartamento', description: 'Elige piso y apartamento' },
      { id: 'services_exit', title: '↩️ Menú principal', description: 'Volver al menú de administración' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] services menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "todos" → información de todos los apartamentos\n• "por apartamento" → consulta manual\n• "SALIR" → menú principal`);
  }
}

async function sendCloudServiceFloorsMenu(phone, body = '🏢 Servicios — elige el piso o escribe directamente el número del apartamento (ej: 403):') {
  setCloudServicesStep(phone, 'admin_service_floor');
  try {
    await sendCloudInteractiveList(phone, body, 'Elegir piso', cloudListSections('Pisos', [
      ...[1, 2, 3, 4, 5].map(floor => ({
        id: `services_floor_${floor}`,
        title: `Piso ${floor}`,
        description: `${cloudServiceApartmentsForFloor(floor).length} apartamento(s) configurado(s)`,
      })),
      { id: 'services_back', title: '↩️ Servicios', description: 'Volver a opciones de servicios' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] services floors menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "piso 1" ... "piso 5" → seleccionar piso\n• Escribe 403 → consulta directa\n• "SALIR" → menú principal`);
  }
}

async function sendCloudServiceApartmentsMenu(phone, floor) {
  const apartments = cloudServiceApartmentsForFloor(floor);
  if (!apartments.length) {
    await sendCloudText(phone, `No hay apartamentos configurados en el piso ${floor}.`);
    await sendCloudServiceFloorsMenu(phone);
    return;
  }
  setCloudServicesStep(phone, 'admin_service_apt');
  try {
    await sendCloudInteractiveList(phone, `🏢 Piso ${floor} — elige el apartamento para consultar sus servicios y cuánto debe:`, 'Elegir apartamento', cloudListSections(`Piso ${floor}`, [
      ...apartments.map(apartment => ({
        id: `services_apartment_${apartment.id}`,
        title: `Apartamento ${apartment.name}`,
        description: 'Consultar Air-e, agua y gas',
      })),
      { id: 'services_back_floors', title: '↩️ Cambiar piso', description: 'Volver a la selección de pisos' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] services apartments menu error:', error.message);
    await sendCloudText(phone, `🏢 Piso ${floor} — escribe el número del apartamento (ej: 403).\nEscribe SALIR para volver.`);
  }
}

function splitCloudText(body, maxLength = 3600) {
  const paragraphs = String(body || '').split(/\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && candidate.length > maxLength) {
      chunks.push(current);
      current = paragraph;
    } else if (paragraph.length > maxLength) {
      if (current) chunks.push(current);
      for (let index = 0; index < paragraph.length; index += maxLength) {
        chunks.push(paragraph.slice(index, index + maxLength));
      }
      current = '';
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

async function sendCloudTextChunks(phone, body) {
  for (const chunk of splitCloudText(body)) await sendCloudText(phone, chunk);
}

const CLOUD_SERVICE_PRESENTATIONS = [
  { key: 'electricity', icon: '⚡', label: 'Air-e', paymentLabel: 'Pago Air-e' },
  { key: 'water', icon: '💧', label: 'Triple A', paymentLabel: 'Pago Triple A' },
  { key: 'gas', icon: '🔥', label: 'Gases del Caribe', paymentLabel: 'Pago Gases' },
];

function cloudServiceDisplayBlock(summary) {
  const { apartment, records, states } = summary;
  const lines = [`🏠 *${apartment.name}*`];
  for (const service of CLOUD_SERVICE_PRESENTATIONS) {
    const record = records[service.key];
    const state = states[service.key];
    const amounts = cloudServiceAmounts(record);
    const updatedAt = utilityRecordValueTimestamp(record);
    lines.push('', `${service.icon} *${service.label}:*`);
    lines.push(`   Deuda del mes: *${cloudUtilityMoney(amounts.month)}*`);
    if (service.key === 'electricity') {
      lines.push(`   Facturas sin pagar: *${amounts.invoiceTotalCount === null ? 'sin confirmar' : amounts.invoiceTotalCount}*`);
    } else {
      const convenio = amounts.financingKnown
        ? cloudUtilityMoney(amounts.financed)
        : amounts.totalKnown ? '$0' : 'sin confirmar';
      lines.push(`   Deuda de convenios: *${convenio}*`);
      if (amounts.quota !== null || amounts.installmentTotal !== null) {
        const progress = amounts.installmentCurrent !== null || amounts.installmentTotal !== null
          ? `${amounts.installmentCurrent ?? '—'} de ${amounts.installmentTotal ?? '—'}`
          : 'sin confirmar';
        lines.push(`   Cuota: *${cloudUtilityMoney(amounts.quota)}* · avance *${progress}*`);
      }
      if (amounts.invoiceTotalCount !== null) {
        lines.push(`   Facturas sin pagar: *${amounts.invoiceTotalCount}*`);
      }
    }
    lines.push(`   Deuda Total: *${cloudUtilityMoney(amounts.total)}*`);
    if (!amounts.monthKnown && !amounts.totalKnown && !amounts.financingKnown) lines.push(`   ${state.label}`);
    lines.push(cloudServiceReference(apartment, record, service.key));
    if (updatedAt) lines.push(`Actualizado: ${formatColombiaDateTime(updatedAt)}`);
    lines.push(`💳 *${service.paymentLabel}:* ${cloudServicePaymentLink(apartment, record, service.key)}`);
  }
  return lines.join('\n');
}

function buildCloudDetailedGlobalServicesReport() {
  const summaries = configuredCloudApartments().map(cloudApartmentServices);
  const debt = summaries.filter(summary => Object.values(summary.states).some(state => state.hasDebt));
  const pending = summaries.filter(summary => !debt.includes(summary) && Object.values(summary.states).some(state => !state.known));
  const paid = summaries.filter(summary => !debt.includes(summary) && !pending.includes(summary));
  const period = cloudPeriodLabel(colombiaDate().slice(0, 7));
  const section = (title, entries) => entries.length
    ? [`${title} (${entries.length})*`, ...entries.map(cloudServiceDisplayBlock)].join('\n\n')
    : '';
  return [
    `📊 *Reporte global de servicios — ${period}*`,
    section('🔴 *DEUDAS CONFIRMADAS', debt),
    section('🟡 *PENDIENTES / SIN DATOS', pending),
    section('🟢 *AL DÍA', paid),
    '━━━━━━━━━━━━━━━━━━━━',
    'ℹ️ Air-e muestra *Deuda del mes*, *Facturas sin pagar* y *Deuda Total*. Triple A y Gases muestran *Deuda del mes*, *Deuda de convenios* y *Deuda Total*.',
  ].filter(Boolean).join('\n\n');
}

function buildCloudDetailedApartmentServicesInfo(apartment) {
  const summary = cloudApartmentServices(apartment);
  return [
    `📊 *Servicios — Apartamento ${apartment.name}*`,
    '',
    cloudServiceDisplayBlock(summary),
    '',
    'ℹ️ La deuda del mes corresponde al periodo actual; Air-e muestra la cantidad de facturas sin pagar; Triple A y Gases muestran saldos financiados o diferidos; la deuda total es el saldo global confirmado por el portal.',
  ].join('\n');
}

function cloudApartmentServicesLine(summary) {
  const { apartment, states } = summary;
  const references = [
    apartment.nic || apartment.electricityPaymentCode ? `NIC ${apartment.nic || apartment.electricityPaymentCode}` : '',
    apartment.waterPaymentCode ? `Póliza ${apartment.waterPaymentCode}` : '',
    apartment.gasPaymentCode ? `Contrato ${apartment.gasPaymentCode}` : '',
  ].filter(Boolean).join(' · ');
  return [
    `🏠 *${apartment.name}*`,
    `⚡ ${states.electricity.label} · 💧 ${states.water.label} · 🔥 ${states.gas.label}`,
    references ? `   ${references}` : '',
  ].filter(Boolean).join('\n');
}

function buildCloudGlobalServicesReport() {
  return buildCloudDetailedGlobalServicesReport();
}

function buildCloudApartmentServicesInfo(apartment) {
  return buildCloudDetailedApartmentServicesInfo(apartment);
}

function cloudReportDateLabel(date = new Date()) {
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  const month = part('month').replace(/\./g, '').toUpperCase();
  const period = part('dayPeriod').replace(/\s+/g, ' ').trim();
  return `${part('day')} ${month} ${part('year')} \u00b7 ${part('hour')}:${part('minute')} ${period}`.trim();
}

function cloudImageMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${Math.round(amount).toLocaleString('es-CO')}` : '\u2014';
}

function escapeCloudImageHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function buildCloudServicesImageData() {
  const summaries = configuredCloudApartments().map(cloudApartmentServices);
  const serviceKeys = ['electricity', 'water', 'gas'];
  const rows = summaries.map(summary => {
    const { apartment } = summary;
    const services = serviceKeys.map(key => {
      const amounts = cloudServiceAmounts(summary.records[key]);
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
        changeStatus: Number(summary.records[key]?.paymentChangeDetectorVersion || 0) === UTILITY_CHANGE_DETECTOR_VERSION
          ? summary.records[key]?.paymentChange?.status || null
          : null,
        changeDelta: Number(summary.records[key]?.paymentChangeDetectorVersion || 0) === UTILITY_CHANGE_DETECTOR_VERSION
          ? Number(summary.records[key]?.paymentChange?.delta) || null
          : null,
      };
    });
    const complete = services.every(service => service.known);
    return {
      apartment: String(apartment.name || apartment.id || '\u2014'),
      services,
      complete,
      total: complete ? services.reduce((sum, service) => sum + service.amount, 0) : null,
    };
  });
  const serviceTotals = serviceKeys.map((_, index) => rows.reduce((sum, row) => (
    sum + (row.services[index].known ? row.services[index].amount : 0)
  ), 0));
  const serviceMonthTotals = serviceKeys.map((_, index) => rows.reduce((sum, row) => (
    sum + (row.services[index].monthKnown ? row.services[index].month : 0)
  ), 0));
  const serviceFinancedTotals = serviceKeys.map((_, index) => rows.reduce((sum, row) => (
    sum + (row.services[index].financingKnown ? row.services[index].financed : 0)
  ), 0));
  const serviceConfirmedCounts = serviceKeys.map((_, index) => rows.reduce((count, row) => (
    count + (row.services[index].known ? 1 : 0)
  ), 0));
  const serviceMonthConfirmedCounts = serviceKeys.map((_, index) => rows.reduce((count, row) => (
    count + (row.services[index].monthKnown ? 1 : 0)
  ), 0));
  const serviceFinancingCounts = serviceKeys.map((_, index) => rows.reduce((count, row) => (
    count + (row.services[index].financingKnown ? 1 : 0)
  ), 0));
  const serviceInvoiceTotals = serviceKeys.map((_, index) => rows.reduce((sum, row) => (
    sum + (row.services[index].invoiceTotalCount ?? 0)
  ), 0));
  const serviceInvoiceKnownCounts = serviceKeys.map((_, index) => rows.reduce((count, row) => (
    count + (row.services[index].invoiceTotalCount !== null ? 1 : 0)
  ), 0));
  const serviceSync = Object.fromEntries(serviceKeys.map(key => {
    const latest = summaries
      .map(summary => utilityRecordValueTimestamp(summary.records[key]))
      .filter(value => value && !Number.isNaN(new Date(value).getTime()))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
    return [key, latest ? cloudReportDateLabel(new Date(latest)) : '\u2014'];
  }));
  const allComplete = rows.length > 0 && rows.every(row => row.complete);
  return {
    dateLabel: cloudReportDateLabel(),
    rows,
    serviceTotals,
    serviceMonthTotals,
    serviceFinancedTotals,
    serviceConfirmedCounts,
    serviceMonthConfirmedCounts,
    serviceFinancingCounts,
    serviceInvoiceTotals,
    serviceInvoiceKnownCounts,
    serviceSync,
    allComplete,
    total: allComplete ? rows.reduce((sum, row) => sum + row.total, 0) : null,
  };
}

function cloudServicesReportImageHtml(report) {
  const serviceMeta = [
    { key: 'electricity', icon: '\u26a1', name: 'AIR-E', secondary: 'Facturas sin pagar', className: 'air-head' },
    { key: 'water', icon: '\ud83d\udca7', name: 'TRIPLE A', secondary: 'Convenio', className: 'water-head' },
    { key: 'gas', icon: '\ud83d\udd25', name: 'GASES', secondary: 'Convenio', className: 'gas-head' },
  ];
  const headerCells = [
    '<div class="cell header ap-head"><div class="header-main"># APARTAMENTO</div></div>',
    ...serviceMeta.map(service => `<div class="cell header ${service.className}"><div class="header-main">${service.icon} ${service.name}</div><div class="header-sub">Mes · ${service.secondary} · Total</div></div>`),
    '<div class="cell header total-head"><div class="header-main">TOTAL</div><div class="header-sub">Deuda total</div></div>',
  ].join('');
  const serviceRows = report.rows.length
    ? report.rows.map((row, index) => {
      const stripe = index % 2 ? ' stripe' : '';
      const serviceCells = row.services.map((service, serviceIndex) => {
        const month = service.monthKnown ? cloudImageMoney(service.month) : '\u2014';
        const total = service.known ? cloudImageMoney(service.amount) : '\u2014';
        const isAirE = serviceIndex === 0;
        const secondaryLabel = isAirE ? 'Facturas sin pagar' : 'Convenio';
        const secondary = isAirE
          ? service.invoiceTotalCount !== null ? String(service.invoiceTotalCount) : '\u2014'
          : service.financingKnown ? cloudImageMoney(service.financed) : service.known ? '$0' : '\u2014';
        // The portals only expose how many invoices remain unpaid; none of them
        // reports which ones are overdue, so a "vencidas" label would be fake.
        const invoices = !isAirE && service.invoiceTotalCount !== null
          ? `<div class="service-line detail-line"><span>Facturas</span><b>${service.invoiceTotalCount} sin pagar</b></div>`
          : '';
        const quota = isAirE ? '' : `<div class="service-line detail-line"><span>Cuota</span><b>${service.quota !== null ? cloudImageMoney(service.quota) : '\u2014'}</b></div>`;
        const progress = isAirE ? '' : `<div class="service-line detail-line"><span>Avance</span><b>${service.installmentCurrent ?? '\u2014'} de ${service.installmentTotal ?? '\u2014'}</b></div>`;
        const changeClass = service.changeStatus === 'full_payment'
          ? ' change-full'
          : service.changeStatus === 'partial_payment' ? ' change-partial' : '';
        const changeLabel = service.changeStatus === 'full_payment'
          ? '✓ Pago total detectado'
          : service.changeStatus === 'partial_payment' ? '↓ Pago parcial detectado' : '';
        const changeAmount = service.changeDelta ? ` · ${cloudImageMoney(service.changeDelta)}` : '';
        return `<div class="cell service-value${stripe}${changeClass}">${changeLabel ? `<div class="change-badge">${changeLabel}${changeAmount}</div>` : ''}<div class="service-line"><span>Mes</span><b>${month}</b></div><div class="service-line financing-line"><span>${secondaryLabel}</span><b>${secondary}</b></div>${quota}${progress}${invoices}<div class="service-line total-line"><span>Total</span><b>${total}</b></div></div>`;
      }).join('');
      const total = row.complete ? cloudImageMoney(row.total) : '\u2014';
      return [
        `<div class="cell apartment${stripe}">${escapeCloudImageHtml(row.apartment)}</div>`,
        serviceCells,
        `<div class="cell money row-total${stripe}"><div>${total}</div><div class="small-money">Suma de servicios</div></div>`,
      ].join('');
    }).join('')
    : '<div class="empty">No hay apartamentos configurados para mostrar.</div>';
  const totals = report.serviceTotals || [null, null, null];
  const confirmedCounts = report.serviceConfirmedCounts || [0, 0, 0];
  const monthTotals = report.serviceMonthTotals || [null, null, null];
  const monthCounts = report.serviceMonthConfirmedCounts || [0, 0, 0];
  const financingTotals = report.serviceFinancedTotals || [null, null, null];
  const financingCounts = report.serviceFinancingCounts || [0, 0, 0];
  const invoiceTotals = report.serviceInvoiceTotals || [null, null, null];
  const invoiceKnownCounts = report.serviceInvoiceKnownCounts || [0, 0, 0];
  const totalGeneralCells = serviceMeta.map((service, index) => {
    const hasValues = confirmedCounts[index] > 0;
    const hasMonth = monthCounts[index] > 0;
    const hasFinancing = financingCounts[index] > 0;
    const secondary = index === 0
      ? (invoiceKnownCounts[index] > 0 ? String(invoiceTotals[index]) : '\u2014')
      : (hasFinancing ? cloudImageMoney(financingTotals[index]) : hasValues ? '$0' : '\u2014');
    return `<div class="cell money total-row-value"><div>Total ${hasValues ? cloudImageMoney(totals[index]) : '\u2014'}</div><div class="small-money">Mes ${hasMonth ? cloudImageMoney(monthTotals[index]) : '\u2014'}</div><div class="small-money">${service.secondary} ${secondary}</div></div>`;
  }).join('');
  const grandTotal = report.allComplete ? cloudImageMoney(report.total) : '\u2014';
  const syncSummary = serviceMeta.map(service => `
    <div class="sync-item ${service.className.replace('-head', '')}">
      <div class="sync-name">${service.icon} <span>${service.name}</span></div>
      <div class="sync-label">Sincronizado:</div>
      <div class="sync-value">${escapeCloudImageHtml(report.serviceSync?.[service.key] || '\u2014')}</div>
    </div>`).join('');
  const hasPaymentChange = report.rows.some(row => row.services.some(service => ['partial_payment', 'full_payment'].includes(service.changeStatus)));
  const changeLegend = hasPaymentChange
    ? '<div class="change-legend"><span class="legend-partial">↓ Pago parcial detectado</span><span class="legend-full">✓ Pago total detectado</span><span class="legend-note">Comparación contra la última deuda confirmada; requiere validar el comprobante.</span></div>'
    : '';
  const incompleteNote = report.allComplete
    ? '<div class="note"><span class="info-icon">i</span> Cada celda separa deuda del mes, facturas sin pagar de Air-e o convenios de los otros servicios, y deuda total acumulada.</div>'
    : '<div class="note"><span class="info-icon">i</span> \u2014 indica que el portal todavía no confirmó ese valor. Air-e muestra facturas sin pagar; Triple A y Gases conservan sus convenios separados del total.</div>';
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { width: 1160px; padding: 24px; color: #253b53; font-family: Arial, "DejaVu Sans", sans-serif; }
  .card { border: 2px solid #d7e3ec; border-radius: 24px; overflow: hidden; box-shadow: 0 8px 22px rgba(25, 64, 96, .09); }
  .title { padding: 28px 30px 24px; background: linear-gradient(135deg, #0d6fae, #1594c5); color: #fff; }
  .title-line { display: flex; align-items: center; gap: 18px; }
  .report-logo { width: 46px; height: 48px; padding: 5px 6px 4px; display: flex; align-items: flex-end; gap: 4px; background: #fff; border-radius: 2px; }
  .report-logo span { display: block; width: 8px; border-radius: 1px 1px 0 0; }
  .report-logo .bar-one { height: 25px; background: #2c8bc5; }
  .report-logo .bar-two { height: 35px; background: #83c64c; }
  .report-logo .bar-three { height: 18px; background: #edb843; }
  h1 { margin: 0 0 8px; font-size: 38px; letter-spacing: .3px; }
  .date { font-size: 23px; opacity: .96; }
  .table { margin: 28px 16px 0; display: grid; grid-template-columns: 200px repeat(3, minmax(0, 1fr)) 172px; border: 2px solid #cbdce8; border-radius: 16px; overflow: hidden; }
  .cell { min-width: 0; min-height: 82px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 12px 14px; border-right: 1px solid #d8e4ec; border-bottom: 1px solid #d8e4ec; font-size: 26px; background: #fff; overflow: hidden; }
  .cell:nth-child(5n) { border-right: 0; }
  .header { min-height: 94px; justify-content: center; color: #fff; border-bottom: 0; white-space: nowrap; }
  .header-main { font-size: 23px; font-weight: 800; line-height: 1.25; }
  .header-sub { margin-top: 6px; font-size: 16px; font-weight: 400; line-height: 1.15; }
  .ap-head { background: #2e4a62; }
  .air-head { background: #f28a0b; }
  .water-head { background: #118fc8; }
  .gas-head { background: #e9533f; }
  .total-head { background: #1c507b; }
  .apartment { font-weight: 800; font-size: 29px; }
  .service-value { min-height: 184px; gap: 6px; align-items: stretch; padding-top: 14px; padding-bottom: 14px; }
  .service-line { display: flex; justify-content: space-between; gap: 8px; font-size: 18px; line-height: 1.22; white-space: nowrap; }
  .service-line span { color: #637991; }
  .service-line b { font-size: 22px; font-variant-numeric: tabular-nums; }
  .financing-line { border-top: 1px solid #e3ebf1; padding-top: 5px; }
  .detail-line b { font-size: 18px; }
  .total-line { margin-top: 2px; padding-top: 5px; border-top: 1px solid #d3e0e9; }
  .total-line b { font-weight: 900; }
  .money { justify-content: center; font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
  .row-total { color: #1c507b; gap: 5px; }
  .row-total > div:first-child { font-size: 24px; font-weight: 900; }
  .small-money { font-size: 16px; color: #637991; font-weight: 600; white-space: nowrap; }
  .stripe { background: #f3f7fa; }
  .total-row-label { background: #1c507b; color: #fff; font-size: 21px; font-weight: 800; white-space: nowrap; }
  .total-row-value { color: #1c507b; font-size: 20px; gap: 5px; }
  .total-row-value > div:first-child { font-size: 23px; font-weight: 800; }
  .sync-grid { margin: 28px 16px 0; display: grid; grid-template-columns: repeat(3, 1fr); }
  .sync-item { min-height: 108px; padding: 4px 28px 4px 20px; border-right: 1px solid #cbdce8; }
  .sync-item:last-child { border-right: 0; }
  .sync-name { font-size: 22px; font-weight: 800; }
  .sync-name span { margin-left: 8px; }
  .sync-label { margin: 13px 0 2px 37px; font-size: 18px; color: #637991; }
    .sync-value { margin-left: 37px; font-size: 19px; color: #253b53; white-space: nowrap; }
  .air .sync-name { color: #e88909; }
  .water .sync-name { color: #148fc5; }
    .gas .sync-name { color: #e84e3a; }
  .change-full { background: #eaf8ef !important; box-shadow: inset 6px 0 0 #22a05a; }
  .change-partial { background: #fff8dd !important; box-shadow: inset 6px 0 0 #e1a400; }
  .change-badge { align-self: center; margin: -3px 0 3px; padding: 3px 7px; border-radius: 10px; font-size: 12px; font-weight: 800; white-space: nowrap; }
  .change-full .change-badge { color: #13733e; background: #ccefd9; }
  .change-partial .change-badge { color: #8a6200; background: #ffedaa; }
  .change-legend { margin: 18px 16px 0; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 16px; font-weight: 700; }
  .legend-partial { color: #8a6200; }
  .legend-full { color: #13733e; }
  .legend-note { color: #637991; font-size: 14px; font-weight: 400; }
  .note { margin: 28px 16px 0; padding: 16px 18px; border: 2px solid #1674bc; border-radius: 10px; color: #637991; font-size: 18px; line-height: 1.35; }
  .info-icon { display: inline-flex; justify-content: center; align-items: center; width: 22px; height: 22px; margin-right: 8px; border: 2px solid #1674bc; border-radius: 50%; color: #1674bc; font-size: 14px; font-weight: 800; }
  .empty { grid-column: 1 / -1; padding: 28px; font-size: 22px; color: #637991; text-align: center; }
  .footer { margin-top: 26px; padding: 20px 24px 26px; border-top: 1px solid #d8e4ec; color: #637991; font-size: 18px; line-height: 1.45; }
  .footer-main { font-size: 18px; }
  .refresh-icon { display: inline-block; margin-right: 10px; color: #168bc5; font-size: 30px; line-height: .7; vertical-align: -3px; }
  .footer-date { margin-top: 8px; color: #8397ad; }
</style></head><body>
  <div class="card">
    <div class="title"><div class="title-line"><div class="report-logo"><span class="bar-one"></span><span class="bar-two"></span><span class="bar-three"></span></div><div><h1>REPORTE DE SERVICIOS</h1><div class="date">${escapeCloudImageHtml(report.dateLabel)}</div></div></div></div>
    <div class="table">${headerCells}${serviceRows}<div class="cell total-row-label">TOTAL GENERAL</div>${totalGeneralCells}<div class="cell money total-row-value">${grandTotal}</div></div>
    <div class="sync-grid">${syncSummary}</div>
    ${changeLegend}
    ${incompleteNote}
    <div class="footer"><div class="footer-main"><span class="refresh-icon">↻</span> Deuda del mes, facturas sin pagar de Air-e, convenios y deuda total se muestran con la última sincronización disponible.</div><div class="footer-date">Reporte generado: ${escapeCloudImageHtml(report.dateLabel)}</div></div>
  </div>
</body></html>`;
}

async function renderCloudServicesReportImage(report = buildCloudServicesImageData()) {
  if (typeof servicesScraper.launchLocalBrowser !== 'function') {
    throw new Error('El renderizador local de imágenes no está disponible');
  }
  const browser = await servicesScraper.launchLocalBrowser('whatsapp-report');
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1160, height: 900, deviceScaleFactor: 1 });
    await page.setContent(cloudServicesReportImageHtml(report), { waitUntil: 'load' });
    const height = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    ));
    await page.setViewport({ width: 1160, height: Math.max(900, Math.ceil(height)), deviceScaleFactor: 1 });
    return Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
  } finally {
    await browser.close().catch(() => {});
  }
}

// Payment references, current service debts and payment links for one apartment.
async function sendCloudServicesInfo(phone, aptRef) {
  const ref = String(aptRef || '').trim();
  const apartment = cloudFindApartment(ref);
  if (!apartment) {
    await sendCloudServiceFloorsMenu(phone, `💧 No encontré el apartamento "${ref}". Elige un piso o escribe el número nuevamente:`);
    return false;
  }
  await sendCloudText(phone, buildCloudApartmentServicesInfo(apartment));
  await sendCloudServicesMenu(phone);
  return true;
}

async function createCloudServicesReportMedia(report = buildCloudServicesImageData()) {
  const buffer = await renderCloudServicesReportImage(report);
  const file = {
    originalname: `reporte-servicios-${colombiaDate()}.png`,
    mimetype: 'image/png',
    buffer,
    size: buffer.length,
  };
  const uploaded = await uploadCloudMedia(file);
  const media = {
    kind: 'image',
    mimeType: file.mimetype,
    fileName: file.originalname,
    size: file.size,
    id: uploaded.id,
  };
  if (r2Ready()) {
    try {
      Object.assign(media, await putR2Buffer({
        section: 'whatsapp/outbound', fileName: file.originalname,
        buffer, mimeType: file.mimetype,
      }));
      media.archiveStatus = 'stored';
    } catch (archiveError) {
      media.archiveStatus = 'not_archived';
      media.archiveError = archiveError.message;
      console.warn('[R2] generated services report archive skipped:', archiveError.message);
    }
  } else {
    media.archiveStatus = 'not_configured';
  }
  return { report, buffer, media, caption: `📊 REPORTE DE SERVICIOS\n${report.dateLabel}` };
}

async function sendCloudServicesReportImageOnly(phone, report, mediaPackage = null) {
  const packageData = mediaPackage || await createCloudServicesReportMedia(report);
  const result = await sendCloudMedia(phone, packageData.media, packageData.caption);
  const conversation = getCloudConversation({ phone });
  addCloudMessage(conversation, 'out', {
    type: 'image', text: packageData.caption, mediaId: packageData.media.id, media: packageData.media,
    whatsappMessageId: result.messages?.[0]?.id || null,
  });
  saveData();
  console.log(`[WHATSAPP CLOUD] Global services report image sent (${packageData.report.rows.length} apartment(s), ${packageData.buffer.length} bytes).`);
  return { ...packageData, messageId: result.messages?.[0]?.id || null };
}

async function sendCloudGlobalServices(phone) {
  const report = buildCloudServicesImageData();
  try {
    await sendCloudServicesReportImageOnly(phone, report);
    await sendCloudUtilitiesDetailButton(phone);
  } catch (error) {
    console.error('[WHATSAPP CLOUD] services report image error; using text fallback:', error.message);
    await sendCloudTextChunks(phone, buildCloudGlobalServicesReport());
  }
  await sendCloudServicesMenu(phone);
}

// ── Automatic utility-payment change alerts ───────────────────────────────
// A lower utility balance is evidence of a possible payment, not independent
// bank confirmation. Keep the alert separate from rent-payment events so the
// existing SMS/Gmail canon automation cannot accidentally classify a utility
// change as rent.
function ensureUtilityChangeAlertCollection() {
  if (!Array.isArray(db.utilityChangeAlerts)) db.utilityChangeAlerts = [];
  if (!nextId.utilityChangeAlerts) {
    nextId.utilityChangeAlerts = db.utilityChangeAlerts.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }
  return db.utilityChangeAlerts;
}

function utilityChangeAlertFingerprint(change) {
  return crypto.createHash('sha256').update([
    utilityProviderKey(change.provider),
    String(change.apartmentId ?? change.apartmentName ?? change.apartment ?? ''),
    Number(change.previousTotal), Number(change.currentTotal), String(change.status || ''),
  ].join('|')).digest('hex');
}

function utilityChangeStatusLabel(status) {
  return status === 'full_payment' ? 'Pago total detectado' : 'Posible pago parcial';
}

function utilityChangeIcon(provider) {
  const key = utilityProviderKey(provider);
  if (key === 'air-e') return '⚡ Air-e';
  if (key === 'water') return '💧 Triple A';
  if (key === 'gas') return '🔥 Gases del Caribe';
  return String(provider || 'Servicio');
}

function buildUtilityChangeSummary(changes) {
  const grouped = new Map();
  for (const change of changes || []) {
    const apartmentKey = String(change.apartmentId ?? change.apartmentName ?? change.apartment ?? '—');
    if (!grouped.has(apartmentKey)) grouped.set(apartmentKey, {
      apartment: String(change.apartmentName || change.apartment || change.apartmentId || '—'),
      changes: [],
    });
    grouped.get(apartmentKey).changes.push(change);
  }
  return [...grouped.values()]
    .sort((left, right) => left.apartment.localeCompare(right.apartment, 'es', { numeric: true }))
    .map(group => [
      `🏠 Apartamento ${group.apartment}`,
      ...group.changes
        .sort((left, right) => utilityChangeIcon(left.provider).localeCompare(utilityChangeIcon(right.provider), 'es'))
        .map(change => `${utilityChangeIcon(change.provider)}: ${cloudUtilityMoney(change.previousTotal)} → ${cloudUtilityMoney(change.currentTotal)} · ${utilityChangeStatusLabel(change.status)}`),
    ].join('\n'))
    .join('\n\n');
}

function cloudAdminUtilityChangeTemplateName() {
  const configured = (db.settings || []).find(item => item.key === 'whatsapp_admin_utility_change_template')?.value;
  return String(process.env.WHATSAPP_ADMIN_UTILITY_CHANGE_TEMPLATE || configured || 'cambios_servicios_admin').trim();
}

function utilityChangeTemplateData(changes) {
  const apartments = new Set((changes || []).map(change => String(change.apartmentId ?? change.apartmentName ?? change.apartment ?? ''))).size;
  const detectedAt = (changes || [])
    .map(change => new Date(change.detectedAt || 0))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((left, right) => right - left)[0] || new Date();
  const summary = buildUtilityChangeSummary(changes);
  return {
    templateName: cloudAdminUtilityChangeTemplateName(),
    summary,
    parameters: [
      { type: 'text', text: String(apartments) },
      { type: 'text', text: String(changes.length) },
      { type: 'text', text: summary },
      { type: 'text', text: formatColombiaDateTime(detectedAt) },
    ],
    previewText: [
      '🔔 Cambios detectados en servicios',
      '',
      `Apartamentos afectados: ${apartments}`,
      `Servicios con disminución: ${changes.length}`,
      '',
      summary,
      '',
      `Hora de sincronización: ${formatColombiaDateTime(detectedAt)}`,
      '',
      'La disminución es una alerta automática; verifica el pago en el portal del servicio.',
    ].join('\n'),
  };
}

function sendCloudAdminUtilityChangeTemplate(to, changes) {
  const data = utilityChangeTemplateData(changes);
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: whatsappRecipientPhone(to), type: 'template',
    template: {
      name: data.templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: data.parameters }],
    },
  }).then(result => ({ result, data }));
}

async function notifyUtilityPaymentChanges(changes, { runId = null, deviceId = null } = {}) {
  const incoming = (changes || [])
    .filter(change => ['partial_payment', 'full_payment'].includes(change.status))
    .map(change => ({
      ...change,
      fingerprint: change.fingerprint || utilityChangeAlertFingerprint(change),
    }));
  if (!incoming.length || !cloudReady()) return { skipped: true, reason: incoming.length ? 'cloud_not_ready' : 'no_changes' };

  const uniqueChanges = [...new Map(incoming.map(change => [change.fingerprint, change])).values()];
  const batchFingerprint = crypto.createHash('sha256')
    .update(uniqueChanges.map(change => change.fingerprint).sort().join('|'))
    .digest('hex');
  const alerts = ensureUtilityChangeAlertCollection();
  let alert = alerts.find(item => item.fingerprint === batchFingerprint);
  if (alert?.status === 'sent') return { skipped: true, reason: 'already_sent', alert };
  if (!alert) {
    alert = {
      id: nextId.utilityChangeAlerts++, fingerprint: batchFingerprint,
      kind: 'utility_payment_change', status: 'sending', runId, deviceId,
      changes: uniqueChanges, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), imageSentTo: [], templateSentTo: [],
      failedTo: [], imageSkippedTo: [],
    };
    alerts.unshift(alert);
  } else {
    alert.status = 'sending';
    alert.updatedAt = new Date().toISOString();
  }
  saveData();

  const phones = cloudAdminPhones();
  if (!phones.length) {
    alert.status = 'pending_configuration';
    alert.error = 'No hay administradores WhatsApp configurados.';
    alert.updatedAt = new Date().toISOString();
    saveData();
    return { skipped: true, reason: 'no_admin_phones', alert };
  }

  const report = buildCloudServicesImageData();
  let mediaPackage = null;
  let imageBuildError = null;
  let sentTemplates = 0;
  for (const phone of phones) {
    const conversation = getCloudConversation({ phone });
    const phoneKey = normalizePhone(phone);
    try {
      // A standalone media message is allowed only while the admin's
      // customer-service window is open. Outside that window, Meta requires
      // an approved template, so we send the template and keep the reason in
      // the durable alert instead of falsely claiming that the image arrived.
      if (!alert.imageSentTo.includes(phoneKey) && !alert.imageSkippedTo.includes(phoneKey)) {
        if (cloudServiceWindowOpen(conversation)) {
          try {
            mediaPackage ||= await createCloudServicesReportMedia(report);
            const image = await sendCloudServicesReportImageOnly(phone, report, mediaPackage);
            alert.imageSentTo.push(phoneKey);
            alert.imageMessageIds ||= {};
            alert.imageMessageIds[phoneKey] = image.messageId;
          } catch (error) {
            imageBuildError = error.message;
            // Continue with the administrative template so the event is not
            // lost when only the image upload/rendering has failed.
            console.error('[WHATSAPP CLOUD] utility change report image error:', error.message);
          }
        } else {
          alert.imageSkippedTo.push(phoneKey);
          alert.imageSkipReason = 'La ventana de servicio del administrador está cerrada; Meta exige una plantilla para enviar contenido fuera de la ventana.';
        }
      }

      if (!alert.templateSentTo.includes(phoneKey)) {
        const sent = await sendCloudAdminUtilityChangeTemplate(phone, uniqueChanges);
        const message = addCloudMessage(conversation, 'out', {
          type: 'template', text: sent.data.previewText, templatePreviewText: sent.data.previewText,
          templateVariables: sent.data.parameters, template: sent.data.templateName,
          whatsappMessageId: sent.result.messages?.[0]?.id || null,
        });
        alert.templateSentTo.push(phoneKey);
        alert.templateMessageIds ||= {};
        alert.templateMessageIds[phoneKey] = message.whatsappMessageId;
        sentTemplates += 1;
      }
    } catch (error) {
      alert.failedTo = [...new Set([...(alert.failedTo || []), phoneKey])];
      alert.error = error.message;
      console.error(`[WHATSAPP CLOUD] utility change alert error for ${phoneKey}:`, error.message);
    }
  }
  alert.status = alert.templateSentTo.length === phones.length ? 'sent' : 'partial';
  alert.updatedAt = new Date().toISOString();
  alert.sentAt = alert.status === 'sent' ? new Date().toISOString() : null;
  if (imageBuildError) alert.imageError = imageBuildError.slice(0, 300);
  saveData();
  console.log(`[WHATSAPP CLOUD] Utility change alert: ${uniqueChanges.length} service change(s), templates=${sentTemplates}/${phones.length}, images=${alert.imageSentTo.length}/${phones.length}.`);
  return { skipped: false, alert };
}

function cloudRentAmount(apartment, fallbackAmount = 0) {
  const contract = activeContractForApartment(apartment?.id);
  const amount = Number(contract?.monthlyRent || apartment?.monthlyRent || fallbackAmount || 0);
  return { contract, amount: Number.isFinite(amount) ? amount : 0 };
}

function activeTenantForApartment(apartment) {
  const contract = activeContractForApartment(apartment?.id);
  const tenant = (contract && (db.tenants || []).find(item => Number(item.id) === Number(contract.tenantId))) ||
    (db.tenants || []).find(item => Number(item.apartmentId ?? item.linkedAptId) === Number(apartment?.id));
  return { contract, tenant };
}

async function sendCloudReminderSelectionMenu(phone, body = '📨 Enviar cobros — elige todos los apartamentos o un piso. La plantilla incluye canon, vencimiento y Deuda Total de servicios:') {
  setCloudAuthState(phone, { step: 'admin_reminder_scope' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, body, 'Elegir alcance', cloudListSections('Enviar cobros', [
      { id: 'reminders_all', title: 'Todos los apartamentos', description: 'Enviar plantilla a los inquilinos' },
      ...[1, 2, 3, 4, 5].map(floor => ({
        id: `reminders_floor_${floor}`,
        title: `Piso ${floor}`,
        description: `${cloudApartmentsForFloor(floor).length} apartamento(s)`,
      })),
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] reminder selection menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "todos" → enviar a todos\n• "piso 1" ... "piso 5" → elegir piso\n• Escribe el apartamento para enviar uno\n• "SALIR" → cancelar`);
  }
}

async function sendCloudReminderApartmentsMenu(phone, floor) {
  const apartments = cloudApartmentsForFloor(floor);
  if (!apartments.length) {
    await sendCloudText(phone, `No hay apartamentos configurados en el piso ${floor}.`);
    await sendCloudReminderSelectionMenu(phone);
    return;
  }
  setCloudAuthState(phone, { step: 'admin_reminder_apartment' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, `📨 Piso ${floor} — elige el apartamento al que enviarás la plantilla de cobro:`, 'Elegir apartamento', cloudListSections(`Piso ${floor}`, [
      ...apartments.map(apartment => ({
        id: `reminders_apartment_${apartment.id}`,
        title: `Apartamento ${apartment.name}`,
        description: activeTenantForApartment(apartment).tenant?.phone ? 'Enviar canon y servicios' : 'Sin teléfono registrado',
      })),
      { id: 'reminders_back', title: '↩️ Cambiar alcance', description: 'Volver a todos o pisos' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] reminder apartments menu error:', error.message);
    await sendCloudText(phone, `📨 Piso ${floor} — escribe el número del apartamento (ej: 403).\nEscribe SALIR para cancelar.`);
  }
}

function cloudReminderResultLine(result) {
  if (result.status === 'sent') return `✅ *${result.apartment.name}* — plantilla enviada a ${result.tenant.name || 'inquilino'}`;
  if (result.status === 'missing_phone') return `⚠️ *${result.apartment.name}* — no tiene teléfono de un contrato activo`;
  return `❌ *${result.apartment.name}* — no se pudo enviar: ${result.error}`;
}

async function sendCloudCollectionTemplates(phone, apartments, period = colombiaDate().slice(0, 7)) {
  const results = [];
  for (const apartment of apartments || []) {
    const { tenant } = activeTenantForApartment(apartment);
    if (!tenant?.phone) {
      results.push({ apartment, status: 'missing_phone' });
      continue;
    }
    try {
      const sent = await sendCloudPaymentReminderTemplate(tenant.phone, tenant.name, period, apartment);
      const conversation = getCloudConversation({ phone: tenant.phone, tenantId: tenant.id, apartmentId: apartment.id });
      addCloudMessage(conversation, 'out', {
        type: 'template',
        text: `Cobro de canon y servicios — ${cloudPeriodLabel(period)}`,
        template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios',
        whatsappMessageId: sent.messages?.[0]?.id || null,
      });
      results.push({ apartment, tenant, status: 'sent' });
    } catch (error) {
      results.push({ apartment, tenant, status: 'failed', error: error.message });
    }
  }
  saveData();
  const sent = results.filter(result => result.status === 'sent').length;
  await sendCloudTextChunks(phone, `📨 *Resultado de envío — ${cloudPeriodLabel(period)}*\nEnviadas: ${sent} · Seleccionadas: ${results.length}\n\n${results.map(cloudReminderResultLine).join('\n')}`);
  await sendCloudAdminMenu(phone);
}

function nextCloudCollectionId(collection) {
  if (!nextId[collection]) {
    nextId[collection] = (db[collection] || []).reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }
  const id = nextId[collection];
  nextId[collection]++;
  return id;
}

function registerCloudRentPayment(apartment, { persist = true } = {}) {
  if (!Array.isArray(db.payments)) db.payments = [];
  const today = colombiaDate();
  const period = today.slice(0, 7);
  const payments = (db.payments || []).filter(payment => Number(payment.apartmentId) === Number(apartment.id) &&
    payment.type === 'rent' && paymentPeriod(payment) === period);
  const collected = payments.find(payment => paymentCountsAsCollected(payment));
  if (collected) {
    return { status: 'already_paid', apartment, payment: collected, amount: Number(collected.amount || 0), date: today, changed: false };
  }

  const pending = payments.find(payment => payment.status === 'pending_validation');
  const { contract, amount } = cloudRentAmount(apartment, pending?.amount);
  if (amount <= 0) return { status: 'missing_amount', apartment, amount: 0, date: today, changed: false };

  const now = new Date().toISOString();
  let payment = pending;
  if (payment) {
    Object.assign(payment, {
      apartmentId: Number(apartment.id),
      contractId: payment.contractId || contract?.id || null,
      tenantId: payment.tenantId || contract?.tenantId || null,
      amount,
      period,
      date: today,
      type: 'rent',
      status: 'approved',
      origin: payment.origin || 'whatsapp_admin',
      approvedAt: now,
      approvedBy: 'Admin WhatsApp',
      updatedAt: now,
    });
  } else {
    payment = {
      id: nextCloudCollectionId('payments'),
      apartmentId: Number(apartment.id),
      contractId: contract?.id || null,
      tenantId: contract?.tenantId || null,
      amount,
      period,
      date: today,
      type: 'rent',
      paymentMode: 'full',
      status: 'approved',
      origin: 'whatsapp_admin',
      description: `Pago de canon confirmado por WhatsApp - Apartamento ${apartment.name}`,
      approvedAt: now,
      approvedBy: 'Admin WhatsApp',
      createdAt: now,
      updatedAt: now,
    };
    db.payments.push(payment);
  }
  if (persist) saveData();
  return { status: 'confirmed', apartment, payment, amount, date: today, changed: true };
}

function confirmCloudRentPayments(apartments) {
  const results = (apartments || []).map(apartment => registerCloudRentPayment(apartment, { persist: false }));
  if (results.some(result => result.changed)) saveData();
  return results;
}

function cloudFormatFullDate(dateKey) {
  const [year, month, day] = String(dateKey).slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 17)));
}

async function sendCloudPaymentSelectionMenu(phone, body = '✅ Confirmar pagos — elige todos los apartamentos o un piso. El registro quedará con fecha de hoy:') {
  setCloudAuthState(phone, { step: 'admin_payment_scope' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, body, 'Elegir alcance', cloudListSections('Confirmar pagos', [
      { id: 'payments_all', title: 'Todos los apartamentos', description: 'Registrar el canon de hoy' },
      ...[1, 2, 3, 4, 5].map(floor => ({
        id: `payments_floor_${floor}`,
        title: `Piso ${floor}`,
        description: `${cloudApartmentsForFloor(floor).length} apartamento(s)`,
      })),
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] payment selection menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "todos" → confirmar todos\n• "piso 1" ... "piso 5" → elegir piso\n• Escribe el número del apartamento para confirmar uno\n• "SALIR" → cancelar`);
  }
}

async function sendCloudPaymentApartmentsMenu(phone, floor) {
  const apartments = cloudApartmentsForFloor(floor);
  if (!apartments.length) {
    await sendCloudText(phone, `No hay apartamentos configurados en el piso ${floor}.`);
    await sendCloudPaymentSelectionMenu(phone);
    return;
  }
  setCloudAuthState(phone, { step: 'admin_payment_apartment' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, `✅ Piso ${floor} — elige el apartamento cuyo canon quieres confirmar con fecha de hoy:`, 'Elegir apartamento', cloudListSections(`Piso ${floor}`, [
      ...apartments.map(apartment => ({
        id: `payments_apartment_${apartment.id}`,
        title: `Apartamento ${apartment.name}`,
        description: `Confirmar $${Number(cloudRentAmount(apartment).amount || 0).toLocaleString('es-CO')}`,
      })),
      { id: 'payments_back', title: '↩️ Cambiar alcance', description: 'Volver a todos o pisos' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] payment apartments menu error:', error.message);
    await sendCloudText(phone, `✅ Piso ${floor} — escribe el número del apartamento (ej: 403).\nEscribe SALIR para cancelar.`);
  }
}

function cloudPaymentResultLine(result) {
  const apartmentName = result.apartment?.name || '—';
  if (result.status === 'confirmed') {
    return `✅ *${apartmentName}* — $${Number(result.amount).toLocaleString('es-CO')} — confirmado el ${cloudFormatFullDate(result.date)}`;
  }
  if (result.status === 'already_paid') {
    return `ℹ️ *${apartmentName}* — ya tenía el pago confirmado para ${cloudPeriodLabel(result.date.slice(0, 7))}`;
  }
  return `⚠️ *${apartmentName}* — no tiene un canon configurado; no se creó el pago.`;
}

async function confirmCloudPaymentsAndReply(phone, apartments) {
  const results = confirmCloudRentPayments(apartments);
  const confirmed = results.filter(result => result.status === 'confirmed').length;
  const alreadyPaid = results.filter(result => result.status === 'already_paid').length;
  const heading = `✅ Confirmar pagos — ${cloudFormatFullDate(colombiaDate())}\nRegistrados: ${confirmed} · Ya confirmados: ${alreadyPaid}`;
  await sendCloudTextChunks(phone, `${heading}\n\n${results.map(cloudPaymentResultLine).join('\n')}`);
  await sendCloudAdminMenu(phone);
}

function parseCloudMoney(value) {
  let normalized = String(value || '').trim().replace(/[$\s]/g, '').replace(/[^\d,.-]/g, '');
  if (!normalized || !/\d/.test(normalized) || normalized.includes('-')) return null;
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    const parts = normalized.split(',');
    normalized = parts[parts.length - 1].length === 3 ? normalized.replace(/,/g, '') : normalized.replace(',', '.');
  } else if (normalized.includes('.')) {
    const parts = normalized.split('.');
    normalized = parts[parts.length - 1].length === 3 ? normalized.replace(/\./g, '') : normalized;
  }
  const amount = Math.round(Number(normalized));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function registerCloudUnexpectedExpense(apartment, amount, { persist = true } = {}) {
  if (!Array.isArray(db.expenses)) db.expenses = [];
  const date = colombiaDate();
  const createdAt = new Date().toISOString();
  const expense = {
    id: nextCloudCollectionId('expenses'),
    apartmentId: Number(apartment.id),
    amount: Number(amount),
    date,
    category: 'Imprevisto',
    description: `Gasto imprevisto - Apartamento ${apartment.name}`,
    isUnexpected: true,
    origin: 'whatsapp_admin',
    createdAt,
  };
  db.expenses.push(expense);
  if (persist) saveData();
  return expense;
}

async function sendCloudIncidentSelectionMenu(phone, body = '⚠️ Registrar imprevistos — elige el piso para seleccionar el apartamento:') {
  setCloudAuthState(phone, { step: 'admin_incident_floor' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, body, 'Elegir piso', cloudListSections('Imprevistos', [
      ...[1, 2, 3, 4, 5].map(floor => ({
        id: `incident_floor_${floor}`,
        title: `Piso ${floor}`,
        description: `${cloudApartmentsForFloor(floor).length} apartamento(s)`,
      })),
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] incident selection menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "piso 1" ... "piso 5" → elegir piso\n• "SALIR" → cancelar`);
  }
}

async function sendCloudIncidentApartmentsMenu(phone, floor) {
  const apartments = cloudApartmentsForFloor(floor);
  if (!apartments.length) {
    await sendCloudText(phone, `No hay apartamentos configurados en el piso ${floor}.`);
    await sendCloudIncidentSelectionMenu(phone);
    return;
  }
  setCloudAuthState(phone, { step: 'admin_incident_apartment' });
  saveData();
  try {
    await sendCloudInteractiveList(phone, `⚠️ Piso ${floor} — elige el apartamento al que corresponde el imprevisto:`, 'Elegir apartamento', cloudListSections(`Piso ${floor}`, [
      ...apartments.map(apartment => ({
        id: `incident_apartment_${apartment.id}`,
        title: `Apartamento ${apartment.name}`,
        description: 'Registrar valor del gasto',
      })),
      { id: 'incident_back', title: '↩️ Cambiar piso', description: 'Volver a los pisos' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] incident apartments menu error:', error.message);
    await sendCloudText(phone, `⚠️ Piso ${floor} — escribe el número del apartamento (ej: 403).\nEscribe SALIR para cancelar.`);
  }
}

async function sendCloudIncidentAmountPrompt(phone, apartment) {
  setCloudAuthState(phone, { step: 'admin_incident_amount', apartmentId: apartment.id });
  saveData();
  await sendCloudText(phone, `🧾 *Apartamento ${apartment.name}*\n\nIndique el valor del imprevisto/gasto usando este formato, ejemplo:\n\n155.000\n\nEscribe SALIR para cancelar.`);
}

async function handleCloudAdminMessage(phone, message) {
  await greetCloudAdminOnce(phone);
  const type = message.type || 'unknown';
  const interactive = cloudInteractiveReply(message);
  const rawText = type === 'text' ? String(message.text?.body || '').trim() : '';
  const buttonId = String(interactive?.id || '');
  const text = rawText || String(interactive?.title || '').trim();
  const normalizedText = cloudNormaliseText(text);
  if (!text && !buttonId) {
    await sendCloudAdminMenu(phone);
    return;
  }

  const state = getCloudAuthState(phone);
  if (isCloudExitCommand(text) || buttonId === 'services_exit') {
    clearCloudAuthState(phone);
    saveData();
    await sendCloudText(phone, '👋 Saliste de la sección actual.');
    await sendCloudAdminMenu(phone);
    return;
  }

  // A notification without a unique association is resolved conversationally
  // with the administrator. A confirmed apartment also teaches the rule engine
  // for the next payment from the same sender.
  if (state?.step === 'payment_unknown_confirm') {
    const event = (db.paymentEvents || []).find(item => Number(item.id) === Number(state.paymentEventId));
    if (!event) {
      clearCloudAuthState(phone); saveData();
      await sendCloudText(phone, 'Ese pago ya no está pendiente de asociación.');
      await sendCloudAdminMenu(phone); return;
    }
    if (buttonId === 'payment_unknown_no' || /^(?:no|falsa(?:\s+alarma)?|no\s+es)$/i.test(text)) {
      dismissAutomaticPaymentEvent(event.id, 'Falsa alarma confirmada por administrador');
      clearCloudAuthState(phone); saveData();
      await sendCloudText(phone, 'Ok, fue una falsa alarma. No se registró como pago.');
      await sendCloudAdminMenu(phone); return;
    }
    if (buttonId === 'payment_unknown_yes' || /^(?:s[ií]|si\s+es|es\s+un\s+pago)$/i.test(text)) {
      setCloudAuthState(phone, { ...state, step: 'payment_unknown_apartment', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      saveData();
      await sendCloudText(phone, 'Sí, digite el número del apartamento al que desea asociar el pago. Ejemplo: 202.');
      return;
    }
    await sendCloudText(phone, 'Responde *Sí* si es un pago de los apartamentos o *No* si fue una falsa alarma.');
    return;
  }

  if (state?.step === 'payment_unknown_apartment') {
    const event = (db.paymentEvents || []).find(item => Number(item.id) === Number(state.paymentEventId));
    const apartment = /^\d{3,}$/.test(text) ? cloudFindApartment(text) : null;
    if (!event) {
      clearCloudAuthState(phone); saveData();
      await sendCloudText(phone, 'Ese pago ya no está pendiente de asociación.');
      await sendCloudAdminMenu(phone); return;
    }
    if (!apartment) {
      await sendCloudText(phone, 'No encontré ese apartamento. Escribe únicamente su número, por ejemplo 202.');
      return;
    }
    const result = associateAutomaticPaymentEvent(event.id, apartment.id, true, 'Administrador WhatsApp');
    clearCloudAuthState(phone); saveData();
    await sendCloudText(phone, `Gracias por confirmar. El pago de $${Number(event.amount || 0).toLocaleString('es-CO')} quedó asociado al apartamento ${result.apartment.name}. Guardé esta asociación para futuros pagos del mismo remitente.`);
    await sendCloudAdminMenu(phone);
    return;
  }

  if (buttonId === 'menu_enviar_cobros' || /^(?:enviar\s+(?:cobros|recordatorios)|plantillas?\s+de\s+cobro)$/i.test(text)) {
    await sendCloudReminderSelectionMenu(phone);
    return;
  }

  if (buttonId === 'reminders_all' ||
      (state?.step === 'admin_reminder_scope' && /^(?:todos|todos\s+los\s+apartamento(?:s)?|todos\s+los\s+aptos|global)$/i.test(text))) {
    await sendCloudCollectionTemplates(phone, occupiedCloudApartments());
    return;
  }

  const reminderFloorMatch = buttonId.match(/^reminders_floor_(\d+)$/);
  if (reminderFloorMatch || (state?.step === 'admin_reminder_scope' || state?.step === 'admin_reminder_apartment') && /^piso\s*[1-5]$/i.test(text)) {
    const floor = Number(reminderFloorMatch?.[1] || text.match(/[1-5]/)?.[0]);
    await sendCloudReminderApartmentsMenu(phone, floor);
    return;
  }

  if (buttonId === 'reminders_back') {
    await sendCloudReminderSelectionMenu(phone);
    return;
  }

  const reminderApartmentMatch = buttonId.match(/^reminders_apartment_(\d+)$/);
  if (reminderApartmentMatch) {
    const apartment = cloudFindApartment(reminderApartmentMatch[1]);
    if (!apartment) {
      await sendCloudText(phone, 'No encontré ese apartamento.');
      await sendCloudReminderSelectionMenu(phone);
      return;
    }
    await sendCloudCollectionTemplates(phone, [apartment]);
    return;
  }

  if (state?.step === 'admin_reminder_scope' || state?.step === 'admin_reminder_apartment') {
    const apartment = /^\d{3,}$/.test(text) ? cloudFindApartment(text) : null;
    if (apartment) {
      await sendCloudCollectionTemplates(phone, [apartment]);
      return;
    }
  }

  const approveMatch = text.match(/^aprob(?:ar)?\s+(.+)$/i);
  const rejectMatch = text.match(/^rechaz(?:ar)?\s+(.+)$/i);
  if (approveMatch || rejectMatch) {
    const ref = (approveMatch || rejectMatch)[1].trim();
    const apartment = cloudFindApartment(ref);
    if (!apartment) {
      await sendCloudText(phone, `No encontré el apartamento "${ref}".`);
      await sendCloudAdminMenu(phone);
      return;
    }
    const payment = (db.payments || []).find(p => Number(p.apartmentId) === Number(apartment.id) && p.status === 'pending_validation');
    if (!payment) {
      await sendCloudText(phone, `El apartamento ${apartment.name} no tiene comprobantes pendientes de validación.`);
      await sendCloudAdminMenu(phone);
      return;
    }
    const tenant = (db.tenants || []).find(item => Number(item.id) === Number(payment.tenantId));
    const periodLabel = cloudPeriodLabel(paymentPeriod(payment));
    if (approveMatch) {
      approveCloudPayment(payment, payment.amount, 'Admin WhatsApp');
      if (tenant?.phone) {
        try { await sendCloudText(tenant.phone, `✅ Tu pago de ${periodLabel} fue confirmado. ¡Gracias!`); }
        catch (error) { console.error('[WHATSAPP CLOUD] admin approve tenant notice error:', error.message); }
      }
      await sendCloudText(phone, `✅ Pago de ${apartment.name} (${periodLabel}) aprobado.`);
    } else {
      rejectCloudPayment(payment, 'Rechazado desde WhatsApp', 'Admin WhatsApp');
      if (tenant?.phone) {
        try { await sendCloudText(tenant.phone, `❌ Tu comprobante de ${periodLabel} fue rechazado. Envía uno nuevo por favor.`); }
        catch (error) { console.error('[WHATSAPP CLOUD] tenant reject notice error:', error.message); }
      }
      await sendCloudText(phone, `❌ Pago de ${apartment.name} (${periodLabel}) rechazado.`);
    }
    await sendCloudAdminMenu(phone);
    return;
  }

  if (state?.step === 'admin_incident_amount') {
    const apartment = (db.apartments || []).find(item => Number(item.id) === Number(state.apartmentId));
    const amount = parseCloudMoney(text);
    if (!apartment) {
      clearCloudAuthState(phone);
      saveData();
      await sendCloudText(phone, 'No encontré el apartamento asociado a este registro.');
      await sendCloudAdminMenu(phone);
      return;
    }
    if (!amount) {
      await sendCloudText(phone, `⚠️ No pude leer ese valor.\n\nIndique el valor usando este formato, ejemplo:\n\n155.000\n\nEscribe SALIR para cancelar.`);
      return;
    }
    const expense = registerCloudUnexpectedExpense(apartment, amount);
    clearCloudAuthState(phone);
    saveData();
    await sendCloudText(phone, `✅ *Imprevisto registrado*\n\n🏠 Apartamento ${apartment.name}\n💸 Valor: $${Number(expense.amount).toLocaleString('es-CO')}\n📅 Fecha: ${cloudFormatFullDate(expense.date)}`);
    await sendCloudAdminMenu(phone);
    return;
  }

  if (buttonId === 'menu_confirmar' || buttonId === 'menu_validar' ||
      /^(?:confirmar(?:\s+pagos)?|validar(?:\s+pagos)?|validaciones)$/i.test(text)) {
    await sendCloudPaymentSelectionMenu(phone);
    return;
  }

  if (buttonId === 'payments_all' ||
      (state?.step === 'admin_payment_scope' && /^(?:todos|todos\s+los\s+apartamento(?:s)?|todos\s+los\s+aptos|global)$/i.test(text))) {
    await confirmCloudPaymentsAndReply(phone, occupiedCloudApartments());
    return;
  }

  const paymentFloorMatch = buttonId.match(/^payments_floor_(\d+)$/);
  if (paymentFloorMatch || (state?.step === 'admin_payment_scope' || state?.step === 'admin_payment_apartment') && /^piso\s*[1-5]$/i.test(text)) {
    const floor = Number(paymentFloorMatch?.[1] || text.match(/[1-5]/)?.[0]);
    await sendCloudPaymentApartmentsMenu(phone, floor);
    return;
  }

  if (buttonId === 'payments_back') {
    await sendCloudPaymentSelectionMenu(phone);
    return;
  }

  const paymentApartmentMatch = buttonId.match(/^payments_apartment_(\d+)$/);
  if (paymentApartmentMatch) {
    const apartment = cloudFindApartment(paymentApartmentMatch[1]);
    if (!apartment) {
      await sendCloudText(phone, 'No encontré ese apartamento.');
      await sendCloudPaymentSelectionMenu(phone);
      return;
    }
    await confirmCloudPaymentsAndReply(phone, [apartment]);
    return;
  }

  if (state?.step === 'admin_payment_scope' || state?.step === 'admin_payment_apartment') {
    const apartment = /^\d{3,}$/.test(text) ? cloudFindApartment(text) : null;
    if (apartment) {
      await confirmCloudPaymentsAndReply(phone, [apartment]);
      return;
    }
    if (/^(?:todos|global|todos\s+los\s+apartamento(?:s)?|todos\s+los\s+aptos)$/i.test(text)) {
      await confirmCloudPaymentsAndReply(phone, occupiedCloudApartments());
      return;
    }
  }

  if (buttonId === 'menu_imprevistos' || /^(?:registrar\s+imprevistos|imprevistos|registrar\s+gasto|gasto)$/i.test(text)) {
    await sendCloudIncidentSelectionMenu(phone);
    return;
  }

  const incidentFloorMatch = buttonId.match(/^incident_floor_(\d+)$/);
  if (incidentFloorMatch || (state?.step === 'admin_incident_floor' || state?.step === 'admin_incident_apartment') && /^piso\s*[1-5]$/i.test(text)) {
    const floor = Number(incidentFloorMatch?.[1] || text.match(/[1-5]/)?.[0]);
    await sendCloudIncidentApartmentsMenu(phone, floor);
    return;
  }

  if (buttonId === 'incident_back') {
    await sendCloudIncidentSelectionMenu(phone);
    return;
  }

  const incidentApartmentMatch = buttonId.match(/^incident_apartment_(\d+)$/);
  if (incidentApartmentMatch) {
    const apartment = cloudFindApartment(incidentApartmentMatch[1]);
    if (!apartment) {
      await sendCloudText(phone, 'No encontré ese apartamento.');
      await sendCloudIncidentSelectionMenu(phone);
      return;
    }
    await sendCloudIncidentAmountPrompt(phone, apartment);
    return;
  }

  if (state?.step === 'admin_incident_apartment' && /^\d{3,}$/.test(text)) {
    const apartment = cloudFindApartment(text);
    if (apartment) {
      await sendCloudIncidentAmountPrompt(phone, apartment);
      return;
    }
  }

  if (buttonId === 'menu_servicios' || normalizedText === 'servicios') {
    await sendCloudServicesMenu(phone);
    return;
  }

  if (buttonId === 'services_all' || /^(todos|global|general|todos\s+los\s+apartamentos)$/i.test(text)) {
    await sendCloudGlobalServices(phone);
    return;
  }

  if (buttonId === 'services_by_apartment' || /^(por\s+apartamento|manual|individual)$/i.test(text)) {
    await sendCloudServiceFloorsMenu(phone);
    return;
  }

  const serviceFloorMatch = buttonId.match(/^services_floor_(\d+)$/);
  if (serviceFloorMatch) {
    await sendCloudServiceApartmentsMenu(phone, Number(serviceFloorMatch[1]));
    return;
  }

  if (buttonId === 'services_back') {
    await sendCloudServicesMenu(phone);
    return;
  }

  if (buttonId === 'services_back_floors') {
    await sendCloudServiceFloorsMenu(phone);
    return;
  }

  const serviceApartmentMatch = buttonId.match(/^services_apartment_(\d+)$/);
  if (serviceApartmentMatch) {
    await sendCloudServicesInfo(phone, serviceApartmentMatch[1]);
    return;
  }

  if (state?.step === 'admin_service_apt' || state?.step === 'admin_apt' ||
      (state?.step === 'admin_services_menu' && /^\d+$/.test(text))) {
    await sendCloudServicesInfo(phone, text);
    return;
  }

  if (state?.step === 'admin_service_floor') {
    const directApartment = /^\d{3,}$/.test(text) ? cloudFindApartment(text) : null;
    if (directApartment) {
      await sendCloudServicesInfo(phone, directApartment.name);
      return;
    }
    const floorMatch = normalizedText.match(/^piso\s*([1-5])$/) || normalizedText.match(/^([1-5])$/);
    if (floorMatch) {
      await sendCloudServiceApartmentsMenu(phone, Number(floorMatch[1]));
      return;
    }
  }

  if (buttonId === 'menu_morosos' || /^(cobros|deuda|canon|morosos|reporte)$/i.test(text)) {
    await sendCloudText(phone, buildAdminDebtReport());
    await sendCloudAdminMenu(phone);
    return;
  }

  await sendCloudAdminMenu(phone);
}

function cloudCalendarDate(period, day) {
  const [year, month] = String(period).slice(0, 7).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(Math.max(1, Number(day) || 1), lastDay), 17));
}

function cloudDateKey(date) {
  return colombiaDate(date);
}

function cloudFormatDayMonth(date) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'long',
  }).format(date);
}

function cloudCapitalise(text) {
  const value = String(text || '');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function cloudPaymentDate(payment, fallbackDate) {
  const raw = payment?.date || payment?.paidAt || payment?.approvedAt || payment?.updatedAt || payment?.createdAt;
  if (!raw) return fallbackDate;
  const rawText = String(raw);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) && !/^\d{4}-\d{2}-\d{2}$/.test(rawText)) return fallbackDate;
  const key = /^\d{4}-\d{2}-\d{2}$/.test(rawText) ? rawText : cloudDateKey(parsed);
  return cloudCalendarDate(key, Number(key.slice(8, 10)));
}

// Reporte de cobros con fechas completas y tres estados visibles para el
// administrador: vencidos, próximos vencimientos y pagos realizados.
function buildAdminDebtReport() {
  const today = colombiaDate();
  const currentPeriod = today.slice(0, 7);
  const todayDate = cloudCalendarDate(today, Number(today.slice(8, 10)));
  const overdue = [];
  const upcoming = [];
  const paid = [];
  let pendingCount = 0;

  for (const apartment of db.apartments || []) {
    if (apartment.status !== 'occupied') continue;
    const contract = activeContractForApartment(apartment.id);
    const rent = Number(contract?.monthlyRent || apartment?.monthlyRent || 0);
    const dueDay = Math.min(31, Math.max(1, Number(apartment.paymentDueDay) || 5));
    const payments = (db.payments || []).filter(payment => Number(payment.apartmentId) === Number(apartment.id) &&
      payment.type === 'rent' && paymentPeriod(payment) === currentPeriod);
    const pendingPayment = payments.find(payment => payment.status === 'pending_validation');
    const collectedPayment = payments.find(payment => paymentCountsAsCollected(payment));
    const dueAt = cloudCalendarDate(currentPeriod, dueDay);
    const daysLeft = Math.round((dueAt - todayDate) / (1000 * 60 * 60 * 24));
    const amount = rent ? `$${rent.toLocaleString('es-CO')}` : '$—';
    if (pendingPayment) pendingCount++;

    if (collectedPayment) {
      paid.push({ apartment, amount, paidAt: cloudPaymentDate(collectedPayment, todayDate) });
    } else if (daysLeft < 0) {
      overdue.push({ apartment, amount, dueAt, daysLate: Math.abs(daysLeft), pending: !!pendingPayment });
    } else {
      upcoming.push({ apartment, amount, dueAt, daysLeft, pending: !!pendingPayment });
    }
  }

  const byCalendarDate = (left, right) => left.dueAt.getTime() - right.dueAt.getTime() ||
    String(left.apartment?.name || '').localeCompare(String(right.apartment?.name || ''), 'es', { numeric: true });
  overdue.sort(byCalendarDate);
  upcoming.sort(byCalendarDate);
  paid.sort((left, right) => left.paidAt.getTime() - right.paidAt.getTime() ||
    String(left.apartment?.name || '').localeCompare(String(right.apartment?.name || ''), 'es', { numeric: true }));

  const overdueLines = overdue.map(item => {
    const pending = item.pending ? ' · ⏳ comprobante en validación' : '';
    return `🏠 *${item.apartment.name}* — ${item.amount} — *Venció el ${cloudFormatDayMonth(item.dueAt)} · hace ${item.daysLate} días*${pending}`;
  });
  const upcomingLines = upcoming.map(item => {
    const dateLabel = cloudFormatDayMonth(item.dueAt);
    const when = item.daysLeft === 0
      ? `Vence hoy, ${dateLabel}`
      : item.daysLeft === 1
        ? `Vence mañana, ${dateLabel}`
        : `Vencerá en ${item.daysLeft} días, el ${dateLabel}`;
    const pending = item.pending ? ' · ⏳ comprobante en validación' : '';
    return `🏠 *${item.apartment.name}* — ${item.amount} — *${when}*${pending}`;
  });
  const paidLines = paid.map(item =>
    `🏠 *${item.apartment.name}* — ${item.amount} — *Pagó el ${cloudFormatDayMonth(item.paidAt)} · al día*`
  );
  const sections = [
    overdueLines.length ? `🔴 *PAGOS VENCIDOS (${overdueLines.length}):*\n\n${overdueLines.join('\n')}` : '',
    upcomingLines.length ? `🟡 *PRÓXIMOS VENCIMIENTOS (${upcomingLines.length}):*\n\n${upcomingLines.join('\n')}` : '',
    paidLines.length ? `🟢 *PAGOS REALIZADOS (${paidLines.length}):*\n\n${paidLines.join('\n')}` : '',
  ].filter(Boolean);
  if (!sections.length) sections.push('✅ Todos los apartamentos están al día.');
  if (pendingCount) sections.push(`💡 ${pendingCount} comprobante(s) están en validación.`);
  return [`📊 *Reporte de cobros — ${cloudCapitalise(cloudPeriodLabel(currentPeriod))}*`, sections.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n')].join('\n\n');
}

async function handleCloudInbound(message) {
  const phone = normalizePhone(message.from);
  if (!phone || isCloudMessageProcessed(message.id)) return;
  markCloudMessageProcessed(message.id);
  pruneCloudCollections();

  if (isCloudAdminPhone(phone)) {
    await handleCloudAdminMessage(phone, message);
    return;
  }

  // A tenant deleted from Laujim must not be able to re-enter through the old
  // authenticated contact. Keep this separate from unknown numbers, which may
  // still start the normal apartment + document verification flow.
  if (isCloudRevokedContact(phone)) {
    console.warn(`[WHATSAPP CLOUD] ignored message from revoked tenant phone ending ${phone.slice(-4)}`);
    await blockCloudUser(phone, 'tenant_removed');
    saveData();
    return;
  }

  const known = authorizedCloudContact(phone);
  const blocked = getCloudBlockedUser(phone);
  if (blocked) {
    const recoverableReason = ['authentication_failed', 'tenant_removed'].includes(String(blocked.reason || ''));
    if (!known || !recoverableReason) {
      console.warn(`[WHATSAPP CLOUD] ignored blocked contact ending ${phone.slice(-4)} · reason=${blocked.reason || 'unknown'}`);
      saveData();
      return;
    }
    // A number that is now present in the tenant database must not remain
    // trapped by a historical failed-authentication block. This is also what
    // lets a re-added tenant contact recover without a manual database edit.
    await unblockCloudUser(phone);
  }
  if (known) {
    console.info(`[WHATSAPP CLOUD] accepted known contact ending ${phone.slice(-4)} · source=${known.source || 'contact'} · apartment=${known.apartmentId || '—'}`);
    const conversation = getCloudConversation(known);
    const type = message.type || 'unknown';
    const interactive = cloudInteractiveReply(message);
    // Content and media identifiers are persisted only after authorization.
    const inboundMedia = cloudInboundMedia(message, type);
    // Payment proofs are the only inbound files that go through OCR. Other
    // photos, videos and voice notes remain ordinary inbox attachments.
    const media = await archiveCloudInboundMedia(inboundMedia, {
      runOcr: !!inboundMedia && ['image', 'document'].includes(type),
    });
    const interactionText = interactive
      ? (interactive.title ||
        (cloudInteractiveIsPaymentConfirmed(interactive) ? 'Ya pagué' :
          cloudInteractiveIsPaymentPending(interactive) ? 'No he pagado' :
            interactive.id || interactive.payload ? `Botón seleccionado: ${interactive.id || interactive.payload}` : 'Botón seleccionado'))
      : '';
    const incoming = addCloudMessage(conversation, 'in', {
      type: interactive ? 'interactive' : type,
      text: type === 'text' ? (message.text?.body || '') : (interactive ? '' : (media?.caption || '')),
      mediaId: media?.id || null, media, whatsappMessageId: message.id,
      interaction: interactive ? {
        type: interactive.type,
        id: interactive.id || null,
        title: interactive.title || null,
        payload: interactive.payload || null,
        displayText: interactionText,
        status: 'received',
        action: cloudInteractiveAction(interactive),
      } : null,
    });
    const writtenConfirmation = type === 'text' && /^(?:ya\s+)?(?:lo\s+)?pag(?:u[eé]|ue)(?:\.|\s|$)/i.test(message.text?.body || '');
    const confirmedWithButton = Boolean(interactive) && cloudInteractiveIsPaymentConfirmed(interactive);
    // "¿Cuánto debo?" intent: reply with the maximum outstanding Air-e debt.
    if (type === 'text' && isDebtQuery(message.text?.body || '')) {
      const reply = buildDebtReply(known);
      let whatsappMessageId = null;
      try {
        const sent = await sendCloudText(phone, reply);
        whatsappMessageId = sent.messages?.[0]?.id || null;
      } catch (error) { console.error('[WHATSAPP CLOUD] debt reply error:', error.message); }
      addCloudMessage(conversation, 'out', { type: 'text', text: reply, whatsappMessageId });
      saveData();
      return;
    }
    const pendingWithButton = Boolean(interactive) && cloudInteractiveIsPaymentPending(interactive);
    if (pendingWithButton) {
      markCloudInteraction(incoming, 'handled', 'Se envió el recordatorio y se solicitó el comprobante.');
      const reply = 'Entendido. Te pedimos realizar el pago lo antes posible. Cuando lo hagas, envía aquí el comprobante (foto o PDF) para validarlo.';
      requestedPaymentProof(conversation);
      saveData();
      try {
        const sent = await sendCloudText(phone, reply);
        addCloudMessage(conversation, 'out', { type: 'text', text: reply, whatsappMessageId: sent.messages?.[0]?.id || null });
        saveData();
      } catch (error) { console.error('[WHATSAPP CLOUD] pending payment reply error:', error.message); }
      return;
    }
    if (confirmedWithButton || writtenConfirmation) {
      if (interactive) markCloudInteraction(incoming, 'handled', 'Se solicitó el comprobante de pago para validación.');
      requestedPaymentProof(conversation);
      saveData();
      try {
        const sent = await sendCloudText(phone, 'Perfecto. Envía por aquí una foto o PDF del comprobante para revisarlo.');
        addCloudMessage(conversation, 'out', {
          type: 'text', text: 'Perfecto. Envía por aquí una foto o PDF del comprobante para revisarlo.',
          whatsappMessageId: sent.messages?.[0]?.id || null,
        });
        saveData();
      } catch (error) { console.error('[WHATSAPP CLOUD] proof request error:', error.message); }
      return;
    }
    if (media && (paymentProofIsActive(conversation) || paymentProofOcrLooksUseful(media))) {
      const payment = createPendingPaymentFromProof(conversation, media, incoming.id);
      if (payment) {
        conversation.paymentProofRequestedAt = null;
        conversation.paymentProofPeriod = null;
        console.log(`[WHATSAPP CLOUD] payment proof pending validation: ${payment.id} · ${ocrSummary(media.ocr)}.`);
        await acknowledgePaymentProof(conversation, payment, media);
      } else if (paymentProofOcrLooksUseful(media)) {
        await acknowledgePaymentProof(conversation, null, media);
      }
    }
    if (interactive && incoming.interaction?.status === 'received') {
      markCloudInteraction(incoming, 'recorded', 'La pulsación quedó registrada, pero no tenía una acción automática configurada.');
    }
    saveData();
    return;
  }

  const state = getCloudAuthState(phone);
  const text = message.type === 'text' ? String(message.text?.body || '').trim() : '';
  if (!state || new Date(state.expiresAt).getTime() < Date.now()) {
    console.info(`[WHATSAPP CLOUD] authentication requested for phone ending ${phone.slice(-4)}`);
    setCloudAuthState(phone, { step: 'apartment', expiresAt: new Date(Date.now() + CLOUD_AUTH_TTL).toISOString(), attempts: 0 });
    saveData();
    await sendCloudText(phone, '🤖 Laujim Bot: este canal requiere autenticación. Tus mensajes y archivos no se entregan ni se guardan hasta verificar tu identidad. Escribe tu número de apartamento.');
    return;
  }
  if (!text) {
    await failCloudAuthentication(phone, state, 'Para validar tu identidad, responde solo con texto. Escribe tu número de apartamento.');
    return;
  }
  if (state.step === 'apartment') {
    const apartment = (db.apartments || []).find(a => String(a.name) === text || String(a.id) === text);
    if (!apartment) {
      await failCloudAuthentication(phone, state, 'No encontré ese apartamento. Intenta nuevamente.');
      return;
    }
    setCloudAuthState(phone, { ...state, step: 'document', apartmentId: apartment.id, expiresAt: new Date(Date.now() + CLOUD_AUTH_TTL).toISOString() });
    saveData();
    await sendCloudText(phone, 'Ahora escribe tu número de cédula para verificar la residencia.');
    return;
  }
  const tenant = (db.tenants || []).find(t => String(t.documentId || '') === text && tenantBelongsToApartment(t, state.apartmentId));
  if (!tenant) {
    await failCloudAuthentication(phone, state, 'Los datos no coinciden. Intenta de nuevo.');
    return;
  }
  ensureCloudCollections();
  const now = new Date().toISOString();
  const existingIndex = db.whatsappContacts.findIndex(item => samePhone(item.phone, phone));
  const contact = { id: existingIndex >= 0 ? db.whatsappContacts[existingIndex].id : nextId.whatsappContacts++, phone, tenantId: tenant.id, apartmentId: state.apartmentId, enabled: true,
    source: 'authenticated', verifiedAt: now, createdAt: existingIndex >= 0 ? db.whatsappContacts[existingIndex].createdAt : now };
  if (existingIndex >= 0) db.whatsappContacts[existingIndex] = contact;
  else db.whatsappContacts.push(contact);
  clearCloudAuthState(phone);
  const conversation = getCloudConversation(contact);
  conversation.lastInboundAt = new Date().toISOString();
  conversation.customerServiceWindowUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  conversation.authenticatedAt = now;
  conversation.authenticationSource = 'apartment_document';
  // Wait for Aiven before acknowledging success. Otherwise a fast follow-up
  // message can arrive after the reply but before the new contact exists in
  // the durable store after a worker restart.
  await saveData();
  console.info(`[WHATSAPP CLOUD] authentication completed for phone ending ${phone.slice(-4)} · apartment=${state.apartmentId} · contact=${contact.id}`);
  const confirmation = '✅ Identidad verificada. Desde ahora tus mensajes llegarán al administrador por este canal.';
  try {
    const sent = await sendCloudText(phone, confirmation);
    addCloudMessage(conversation, 'out', {
      type: 'text', text: confirmation, whatsappMessageId: sent.messages?.[0]?.id || null,
    });
    await saveData();
  } catch (error) {
    console.error('[WHATSAPP CLOUD] authentication confirmation error:', error.message);
  }
}

// ─── PostgreSQL persistence ───
let pgPool = null;
let pgSaveChain = Promise.resolve();

async function initPostgres() {
  // Blueprint-managed DATABASE_URL can still point at a deleted Render
  // datastore. An explicitly configured Aiven URL always takes precedence.
  const databaseUrl = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  const pgUrl = databaseUrl.replace(/sslmode=[^&]+&?/, '');
  // Do not leave a half-initialized pool behind. Before this guard, a failed
  // DNS/credential check was reported as "connected" and the app continued
  // writing to Render's ephemeral filesystem.
  const candidatePool = new Pool({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } });
  try {
    await candidatePool.query(`
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL
      )
    `);
    pgPool = candidatePool;
    console.log('PostgreSQL connected');
    return true;
  } catch (error) {
    await candidatePool.end().catch(() => {});
    pgPool = null;
    throw error;
  }
}

async function loadFromPostgres() {
  if (!pgPool) return null;
  const result = await pgPool.query('SELECT key, value FROM store WHERE key IN ($1, $2)', ['database', 'database_meta']);
  const rows = result.rows || [];
  const dataRow = rows.find(row => row.key === 'database');
  if (!dataRow) return null;
  let updatedAt = null;
  try { updatedAt = rows.find(row => row.key === 'database_meta')?.value?.updatedAt || null; } catch {}
  return { data: dataRow.value, updatedAt };
}

async function saveToPostgres() {
  if (!pgPool) return;
  const now = new Date().toISOString();
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['database', JSON.stringify(db)]
    );
    // Keep the data and its timestamp in one transaction. A deploy must never
    // observe a database row from one save and metadata from another.
    await client.query(
      'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['database_meta', JSON.stringify({ updatedAt: now })]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function queuePostgresSave() {
  // Serialize writes so a burst of page edits cannot finish out of order and
  // leave Aiven with an older snapshot than the last change in memory.
  const write = pgSaveChain
    .catch(() => {})
    .then(() => saveToPostgres());
  pgSaveChain = write.catch(error => {
    console.error('PG save error:', error.message);
  });
  return write;
}

function repairApartmentFloors() {
  let repaired = false;
  for (const apartment of db.apartments || []) {
    const match = String(apartment.name || '').trim().match(/^(\d)(\d{2})$/);
    if (!match) continue;
    const canonicalFloor = Number(match[1]);
    if (Number(apartment.floor) !== canonicalFloor) {
      apartment.floor = canonicalFloor;
      repaired = true;
    }
  }
  if (repaired) console.log('[DATA] Se corrigieron pisos a partir del número del apartamento.');
  return repaired;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      db = JSON.parse(raw);
    } else if (fs.existsSync(BACKUP_FILE)) {
      const raw = fs.readFileSync(BACKUP_FILE, 'utf-8');
      db = JSON.parse(raw);
      console.log('Restored from backup: ' + BACKUP_FILE);
    } else {
      db = JSON.parse(JSON.stringify(INITIAL_DATA));
    }
  } catch { db = JSON.parse(JSON.stringify(INITIAL_DATA)); }
  ['messages', 'payments', 'expenses', 'leads', 'settings', 'authSessions', 'presence', 'paymentReminderLogs', 'utilityRecords', 'utilityChangeAlerts', 'scraperWorkers', 'scraperLogs', 'marketplaceJobs', 'accessEvents', 'contractTemplates', 'paymentRules', 'paymentEvents', 'paymentAlerts'].forEach(k => { if (!db[k]) db[k] = []; });
  repairApartmentFloors();
  if (pruneAuthSessions()) console.log('Expired authentication sessions removed');
  recalcNextId();
}

function recalcNextId() {
  Object.keys(db).forEach(key => {
    const arr = db[key];
    if (Array.isArray(arr) && arr.length > 0) {
      nextId[key] = Math.max(...arr.map(i => i.id || 0)) + 1;
    } else {
      nextId[key] = 1;
    }
  });
}

let dataVersion = Date.now();

function saveData() {
  dataVersion = Date.now();
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(DATA_FILE, json, 'utf-8');
  fs.writeFileSync(BACKUP_FILE, json, 'utf-8');
  return pgPool ? queuePostgresSave() : Promise.resolve();
}

let r2UsageCache = { checkedAt: 0, bytes: 0, objects: 0, source: 'tracked', error: null };

function readMemoryLimit(fileName) {
  try {
    const raw = fs.readFileSync(fileName, 'utf8').trim();
    if (!raw || raw === 'max') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 && value < Number.MAX_SAFE_INTEGER ? value : null;
  } catch { return null; }
}

function runtimeMemory() {
  const rss = process.memoryUsage().rss;
  // Render runs inside a Linux container. cgroup is the actual limit assigned
  // to this service, unlike os.totalmem() which can describe the host.
  const limit = readMemoryLimit('/sys/fs/cgroup/memory.max') ||
    readMemoryLimit('/sys/fs/cgroup/memory/memory.limit_in_bytes') || os.totalmem();
  return {
    usedBytes: rss,
    limitBytes: limit,
    percent: limit ? Math.min(100, Number(((rss / limit) * 100).toFixed(1))) : null,
    heapUsedBytes: process.memoryUsage().heapUsed,
    heapTotalBytes: process.memoryUsage().heapTotal,
  };
}

async function getR2Usage() {
  const tracked = ensureR2Usage().bytes;
  if (!r2Ready()) return { configured: false, bytes: tracked, limitBytes: r2Config().limitBytes, percent: null, source: 'not_configured' };
  if (Date.now() - r2UsageCache.checkedAt > 60 * 1000) {
    try {
      let bytes = 0;
      let objects = 0;
      let token;
      do {
        const page = await getR2Client().send(new ListObjectsV2Command({ Bucket: r2Config().bucket, ContinuationToken: token }));
        for (const object of page.Contents || []) { bytes += Number(object.Size) || 0; objects++; }
        token = page.IsTruncated ? page.NextContinuationToken : null;
      } while (token);
      r2UsageCache = { checkedAt: Date.now(), bytes, objects, source: 'live', error: null };
    } catch (error) {
      r2UsageCache = { checkedAt: Date.now(), bytes: tracked, objects: null, source: 'tracked', error: error.message };
    }
  }
  const limitBytes = r2Config().limitBytes;
  return {
    configured: true, bytes: r2UsageCache.bytes, objects: r2UsageCache.objects, limitBytes,
    percent: Math.min(100, Number(((r2UsageCache.bytes / limitBytes) * 100).toFixed(1))),
    source: r2UsageCache.source, error: r2UsageCache.error, checkedAt: new Date(r2UsageCache.checkedAt).toISOString(),
  };
}

async function getDatabaseUsage() {
  let bytes = 0;
  let connected = false;
  let error = null;
  if (pgPool) {
    try {
      const result = await pgPool.query('SELECT pg_database_size(current_database()) AS bytes');
      bytes = Number(result.rows?.[0]?.bytes || 0);
      connected = true;
    } catch (queryError) { error = queryError.message; }
  }
  if (!connected) {
    try { bytes = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).size : 0; } catch {}
  }
  const limitBytes = Number(process.env.AIVEN_DATABASE_LIMIT_BYTES || 0) || null;
  return {
    provider: connected ? 'Aiven PostgreSQL' : 'Archivo local de respaldo', connected, bytes, limitBytes,
    percent: limitBytes ? Math.min(100, Number(((bytes / limitBytes) * 100).toFixed(1))) : null,
    error,
  };
}

function syncPasswordFromTenant(tenantId, apartmentId) {
  const tenant = (db.tenants || []).find(t => t.id === tenantId);
  if (!tenant || !tenant.documentId) return;
  const existing = (db.passwords || []).find(p => p.apartmentId === apartmentId);
  if (existing) {
    existing.password = tenant.documentId;
  } else {
    if (!db.passwords) db.passwords = [];
    db.passwords.push({ id: nextId.passwords || 1, apartmentId, password: tenant.documentId });
    nextId.passwords = (nextId.passwords || 1) + 1;
  }
  saveData();
}

function startServer() {
  // ─── RUTAS ESPECÍFICAS ───

app.get('/api/data-version', (req, res) => {
  res.json({ version: dataVersion });
});

app.get('/api/system/stats', async (req, res) => {
  let dbSize = 0;
  try { if (fs.existsSync(DATA_FILE)) dbSize = fs.statSync(DATA_FILE).size; } catch {}
  const collections = {};
  Object.keys(db).forEach(key => { if (Array.isArray(db[key])) collections[key] = db[key].length; });
  const [database, storage] = await Promise.all([getDatabaseUsage(), getR2Usage()]);
  const memory = runtimeMemory();
  res.json({
    app: { provider: 'Render', status: 'online', uptime: process.uptime(), memory },
    database,
    storage,
    // Fields retained for compatibility with older versions of the settings UI.
    hostname: os.hostname(), platform: os.platform(), uptime: process.uptime(),
    totalmem: memory.limitBytes, freemem: Math.max(0, memory.limitBytes - memory.usedBytes),
    heapUsed: memory.heapUsedBytes, heapTotal: memory.heapTotalBytes, rss: memory.usedBytes,
    pid: process.pid, nodeVersion: process.version,
    dbSize,
    collections,
    requests: requestCount,
    traffic: {
      scope: 'process',
      startedAt: trafficStartedAt,
      responses: responseCount,
      responseBytes,
      approxOutboundGb: Number((responseBytes / (1024 ** 3)).toFixed(4)),
      note: 'Estimación de respuestas servidas por esta instancia; el valor facturable exacto se confirma en Render Billing/Metrics.',
    },
  });
});

app.get('/api/version', (req, res) => {
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'version.json'), 'utf-8'));
    res.json(ver);
  } catch {
    res.json({ build: '0', date: '', time: '' });
  }
});

// Readiness is intentionally public so the login screen and deployment checks
// can distinguish a real database outage from an expired admin session.
app.get('/api/ready', (req, res) => {
  const payload = {
    ok: databaseReady,
    state: databaseState,
    postgres: Boolean(pgPool),
    loadedAt: databaseLoadedAt,
    apartments: databaseReady ? (Array.isArray(db.apartments) ? db.apartments.length : 0) : null,
  };
  if (!databaseReady && databaseState === 'error') payload.error = 'La base de datos no está disponible en este momento.';
  res.status(databaseReady ? 200 : 503).json(payload);
});

app.get('/api/data/all', (req, res) => {
  res.json(JSON.parse(JSON.stringify(db)));
});

app.post('/api/login', (req, res) => {
  if (!databaseReady) {
    return res.status(503).json({
      error: databaseState === 'error'
        ? 'La base de datos no está disponible en este momento.'
        : 'La base de datos todavía está iniciando. Intenta de nuevo en unos segundos.',
    });
  }
  const { username, password } = req.body || {};
  const adminUsername = process.env.ADMIN_USERNAME || '';
  if (adminUsername && constantTimeEqual(username, adminUsername) && adminPasswordMatches(password)) {
    const session = createAuthSession({ role: 'admin', name: 'Administrador' });
    return res.json({ authenticated: true, role: 'admin', name: 'Administrador', ...session });
  }
  if (false) {
    if (false) {
      return res.json({ authenticated: true, role: 'admin', name: 'Administrador' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
  const apartmentLogin = String(username || '').trim();
  const documentId = String(password || '').trim();
  const apt = (db.apartments || []).find(a => a.name === apartmentLogin);
  if (apt) {
    const tenant = (db.tenants || []).find(t => {
      if (!t.documentId || !constantTimeEqual(t.documentId, documentId)) return false;
      if (Number(t.apartmentId) === Number(apt.id)) return true;
      return (db.contracts || []).some(c =>
        Number(c.tenantId) === Number(t.id) &&
        Number(c.apartmentId) === Number(apt.id) &&
        c.status !== 'terminated' && c.status !== 'cancelled'
      );
    });
    if (tenant) {
      const session = createAuthSession({ role: 'tenant', apartmentId: apt.id, tenantId: tenant.id, name: tenant.name });
      return res.json({ authenticated: true, role: 'tenant', apartmentId: apt.id, name: tenant.name, ...session });
    }
  }
  res.status(401).json({ error: 'Credenciales inválidas' });
});

app.post('/api/logout', (req, res) => {
  removeAuthSession(req.headers['x-auth-token']);
  res.json({ ok: true });
});

app.get('/api/tenant/overview', (req, res) => {
  const apartmentId = Number(req.auth.apartmentId);
  const tenantId = Number(req.auth.tenantId);
  const apartment = (db.apartments || []).find(item => Number(item.id) === apartmentId);
  const tenant = (db.tenants || []).find(item => Number(item.id) === tenantId && tenantBelongsToApartment(item, apartmentId));
  if (!apartment || !tenant) return res.status(403).json({ error: 'Sesion de inquilino invalida' });
  const contract = (db.contracts || []).find(item =>
    Number(item.apartmentId) === apartmentId && Number(item.tenantId) === tenantId &&
    item.status !== 'terminated' && item.status !== 'cancelled' &&
    (!item.endDate || new Date(item.endDate).getTime() >= Date.now())
  ) || null;
  const payments = (db.payments || []).filter(item => Number(item.apartmentId) === apartmentId && item.type === 'rent');
  const apartmentView = {
    id: apartment.id, name: apartment.name, status: apartment.status,
    floor: apartment.floor || null, area: apartment.area || null,
    rooms: apartment.rooms || null, bathrooms: apartment.bathrooms || null,
    monthlyRent: apartment.monthlyRent || 0, paymentDueDay: apartment.paymentDueDay || 1,
    waterReadingDay: apartment.waterReadingDay || null,
    gasReadingDay: apartment.gasReadingDay || null,
    electricityReadingDay: apartment.electricityReadingDay || null,
  };
  const tenantView = {
    id: tenant.id,
    name: tenant.name,
    phone: tenant.phone || null,
    email: tenant.email || null,
  };
  const contractView = contract ? {
    id: contract.id,
    status: contract.status || null,
    startDate: contract.startDate || null,
    endDate: contract.endDate || null,
    monthlyRent: Number(contract.monthlyRent) || 0,
    contractFile: contract.contractFile || null,
  } : null;
  const paymentView = payments.map(payment => ({
    id: payment.id,
    date: payment.date || null,
    period: payment.period || null,
    amount: Number(payment.amount) || 0,
    type: payment.type,
    status: payment.status || null,
  }));
  res.json({
    apartment: apartmentView, tenant: tenantView, contract: contractView, payments: paymentView,
    services: tenantUtilityOverview(apartment),
    cameras: cameraDefinitions().filter(camera => camera.tenantVisible).map(publicEdgeView),
    doors: doorDefinitions().filter(door => door.tenantVisible).map(publicEdgeView),
    edgeGatewayConnected: edgeGatewayReady(),
  });
});

app.post('/api/tenant/cameras/:id/ticket', async (req, res) => {
  const camera = cameraDefinitions().find(item => item.id === safeEdgeId(req.params.id) && item.tenantVisible);
  if (!camera) return res.status(404).json({ error: 'Cámara no disponible para este portal.' });
  try {
    const payload = await edgeGatewayRequest(`/v1/cameras/${encodeURIComponent(camera.gatewayId)}/ticket`, {
      requestId: crypto.randomUUID(), role: 'tenant', apartmentId: Number(req.auth.apartmentId), ttlSeconds: 120,
    });
    const playbackUrl = String(payload.playbackUrl || payload.url || '');
    if (!/^https:\/\//i.test(playbackUrl)) throw new Error('La pasarela no devolvió una transmisión HTTPS válida.');
    res.json({ ok: true, camera: publicEdgeView(camera), playbackUrl, expiresAt: payload.expiresAt || null, mode: payload.mode || 'embed' });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post('/api/tenant/access/doors/:id/unlock', async (req, res) => {
  const door = doorDefinitions().find(item => item.id === safeEdgeId(req.params.id) && item.tenantVisible);
  if (!door) return res.status(404).json({ error: 'Acceso no disponible para este portal.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma explícitamente la apertura.' });
  const actorKey = `tenant:${req.auth.tenantId}:${door.id}`;
  if (!accessRateAllowed(actorKey)) {
    appendAccessEvent({ actorRole: 'tenant', actorId: req.auth.tenantId, apartmentId: req.auth.apartmentId, doorId: door.id, status: 'rejected', message: 'Límite de frecuencia.' });
    return res.status(429).json({ error: 'Espera unos segundos antes de volver a solicitar la apertura.' });
  }
  const requestId = crypto.randomUUID();
  try {
    const payload = await edgeGatewayRequest(`/v1/doors/${encodeURIComponent(door.gatewayId)}/unlock`, {
      requestId, role: 'tenant', tenantId: Number(req.auth.tenantId), apartmentId: Number(req.auth.apartmentId), pulseMs: 1200,
    });
    const event = appendAccessEvent({ requestId, actorRole: 'tenant', actorId: req.auth.tenantId, apartmentId: req.auth.apartmentId, doorId: door.id, status: 'opened', message: payload.message || 'Apertura confirmada por la pasarela.' });
    res.json({ ok: true, requestId: event.requestId, door: publicEdgeView(door), message: event.message });
  } catch (error) {
    appendAccessEvent({ requestId, actorRole: 'tenant', actorId: req.auth.tenantId, apartmentId: req.auth.apartmentId, doorId: door.id, status: 'failed', message: error.message });
    res.status(503).json({ error: error.message, requestId });
  }
});

app.get('/api/security/overview', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  res.json({
    ok: true,
    gatewayConnected: edgeGatewayReady(),
    cameras: cameraDefinitions().map(publicEdgeView),
    doors: doorDefinitions().map(publicEdgeView),
    accessEvents: (db.accessEvents || []).slice(0, 100),
  });
});

app.post('/api/security/cameras/:id/ticket', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const camera = cameraDefinitions().find(item => item.id === safeEdgeId(req.params.id));
  if (!camera) return res.status(404).json({ error: 'Cámara no configurada.' });
  try {
    const payload = await edgeGatewayRequest(`/v1/cameras/${encodeURIComponent(camera.gatewayId)}/ticket`, {
      requestId: crypto.randomUUID(), role: 'admin', ttlSeconds: 180,
    });
    const playbackUrl = String(payload.playbackUrl || payload.url || '');
    if (!/^https:\/\//i.test(playbackUrl)) throw new Error('La pasarela no devolvió una transmisión HTTPS válida.');
    res.json({ ok: true, camera: publicEdgeView(camera), playbackUrl, expiresAt: payload.expiresAt || null, mode: payload.mode || 'embed' });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post('/api/security/doors/:id/unlock', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const door = doorDefinitions().find(item => item.id === safeEdgeId(req.params.id));
  if (!door) return res.status(404).json({ error: 'Acceso no configurado.' });
  if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirma explícitamente la apertura.' });
  const actorKey = `admin:${req.auth.id || req.auth.name || 'admin'}:${door.id}`;
  if (!accessRateAllowed(actorKey)) return res.status(429).json({ error: 'Espera unos segundos antes de volver a abrir.' });
  const requestId = crypto.randomUUID();
  try {
    const payload = await edgeGatewayRequest(`/v1/doors/${encodeURIComponent(door.gatewayId)}/unlock`, {
      requestId, role: 'admin', actor: req.auth.name || 'Administrador', pulseMs: 1200,
    });
    const event = appendAccessEvent({ requestId, actorRole: 'admin', actorId: req.auth.name, doorId: door.id, status: 'opened', message: payload.message || 'Apertura confirmada por la pasarela.' });
    res.json({ ok: true, requestId: event.requestId, door: publicEdgeView(door), message: event.message });
  } catch (error) {
    appendAccessEvent({ requestId, actorRole: 'admin', actorId: req.auth.name, doorId: door.id, status: 'failed', message: error.message });
    res.status(503).json({ error: error.message, requestId });
  }
});

app.get('/api/public/vacants', (req, res) => {
  const vacants = (db.apartments || []).filter(a => a.status === 'vacant').map(a => ({
    id: a.id, name: a.name, description: a.description || '', monthlyRent: a.monthlyRent,
    rooms: a.rooms, bathrooms: a.bathrooms, area: a.area, floor: a.floor, paymentDueDay: a.paymentDueDay, notes: a.notes || '',
  }));
  const photos = (db.photos || []).filter(p => vacants.some(a => a.id === Number(p.apartmentId)));
  res.json({ apartments: vacants, photos });
});

app.get('/api/public/apartments/:id', (req, res) => {
  const apartment = (db.apartments || []).find(item => item.id === Number(req.params.id));
  if (!apartment || apartment.publicPageEnabled === false) {
    return res.status(404).json({ error: 'Página de apartamento no disponible' });
  }
  const publicApartment = {
    id: apartment.id,
    name: apartment.name,
    description: apartment.description || '',
    monthlyRent: apartment.monthlyRent || 0,
    rooms: apartment.rooms || null,
    bathrooms: apartment.bathrooms || null,
    area: apartment.area || null,
    floor: apartment.floor || null,
    status: apartment.status || 'unknown',
  };
  const photos = (db.photos || []).filter(photo => Number(photo.apartmentId) === Number(apartment.id)).map(photo => ({
    id: photo.id,
    data: photo.data || null,
    url: photo.url || null,
    uploadedAt: photo.uploadedAt || null,
  }));
  res.json({
    apartment: publicApartment,
    photos,
    services: [
      { id: 'water', name: 'Agua', provider: 'Triple A', url: 'https://portal.aaa.com.co/polizas' },
      { id: 'gas', name: 'Gas', provider: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
      { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
    ],
  });
});

// Get all utility records for an apartment (admin)
app.get('/api/services/utility-records/:apartmentId', (req, res) => {
  const aptId = Number(req.params.apartmentId);
  if (!db.utilityRecords) db.utilityRecords = [];
  const apt = db.apartments.find(a => a.id === aptId);
  if (!apt) return res.json([]);
  // Match by apartment identity first. Shared Air-e NICs must not make the
  // record for one apartment appear as a second record in another apartment.
  const directRecords = db.utilityRecords.filter(r =>
    Number(r.apartmentId) === aptId || r.apartment === apt.name
  );
  const hasDirectAirE = directRecords.some(r => r.provider === 'Air-e');
  const legacyAirERecords = hasDirectAirE ? [] : db.utilityRecords.filter(r =>
    r.provider === 'Air-e' && !r.apartmentId && !r.apartment &&
    r.nic === (apt.electricityPaymentCode || apt.nic)
  );
  const records = [...directRecords, ...legacyAirERecords];
  // Sort by scrapedAt DESC, then by periodo DESC
  records.sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || '') || (b.periodo || '').localeCompare(a.periodo || ''));
  res.json(records);
});

// Get latest utility status for all apartments (admin)
app.get('/api/utility-status', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  if (!db.utilityRecords) db.utilityRecords = [];
  const apts = db.apartments || [];
  const status = apts.map(apt => {
    const electricityRecord = latestUtilityRecord('Air-e', apt);
    const electricity = electricityRecord ? utilityPaymentView(electricityRecord) : null;
    const water = utilityPaymentView(latestUtilityRecord('Triple A', apt));
    const gas = utilityPaymentView(latestUtilityRecord('Gases del Caribe', apt));
    return {
      id: apt.id,
      name: apt.name,
       electricity: electricityRecord
         ? { ...electricity, nic: electricityRecord.nic, scrapedAt: electricityRecord.scrapedAt }
         : null,
       water,
       gas,
    };
  });
  res.json(status);
});

// ── Portable scraper workers ────────────────────────────────────────────────
// A phone, PC, or another browser host can collect portal data without
// exposing an inbound port. The worker authenticates with one shared token,
// pulls a non-secret configuration, and pushes sanitized utility records back
// to this process. Portal passwords and browser sessions stay on the worker.
function portableWorkerEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.SCRAPER_WORKER_ENABLED || ''));
}

function portableWorkerTokenValid(req) {
  const expected = String(process.env.SCRAPER_WORKER_TOKEN || '').trim();
  const provided = String(req.headers['x-worker-token'] || '').trim();
  return Boolean(expected && workerProtocol.safeTokenEquals(provided, expected));
}

function requirePortableWorker(req, res, next) {
  if (!portableWorkerEnabled()) return res.status(503).json({ error: 'Worker portátil no habilitado' });
  if (!portableWorkerTokenValid(req)) return res.status(401).json({ error: 'Worker no autorizado' });
  next();
}

function ensurePortableWorkerCollection() {
  if (!Array.isArray(db.scraperWorkers)) db.scraperWorkers = [];
  return db.scraperWorkers;
}

// A worker run has two different failure surfaces: the local WebView can
// reach a portal but fail inside its authenticated fetch, and Render can
// receive fewer records than the phone produced. Keep both views in one
// durable, redacted stream so the administrator can tell those cases apart.
const SCRAPER_LOG_LIMIT = 600;

function ensureScraperLogCollection() {
  if (!Array.isArray(db.scraperLogs)) db.scraperLogs = [];
  return db.scraperLogs;
}

function safeScraperLogIso(value, fallback = new Date().toISOString()) {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function sanitizeScraperLogDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const result = {};
  const blocked = /token|password|secret|cookie|authorization|credential|session|jwt|body|payload|raw.?invoice|invoice(data|payload|body|token)/i;
  Object.entries(details).slice(0, 16).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim().slice(0, 60);
    if (!key || blocked.test(key)) return;
    if (rawValue === null || typeof rawValue === 'boolean' || typeof rawValue === 'number') {
      result[key] = rawValue;
      return;
    }
    if (typeof rawValue === 'string') result[key] = rawValue.replace(/\s+/g, ' ').trim().slice(0, 240);
    else if (Array.isArray(rawValue)) result[key] = rawValue.slice(0, 12).map(value => String(value).slice(0, 120));
  });
  return Object.keys(result).length ? result : null;
}

function appendScraperLog(input = {}, { persist = true } = {}) {
  const logs = ensureScraperLogCollection();
  const now = new Date().toISOString();
  const level = ['debug', 'info', 'success', 'warn', 'error'].includes(String(input.level || '').toLowerCase())
    ? String(input.level).toLowerCase()
    : 'info';
  const numberOrNull = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  };
  const log = {
    id: nextId.scraperLogs || 1,
    source: input.source === 'app' ? 'app' : 'render',
    deviceId: workerProtocol.normalizeWorkerId(input.deviceId) || null,
    runId: String(input.runId || '').trim().slice(0, 120) || null,
    provider: String(input.provider || '').trim().slice(0, 80) || null,
    stage: String(input.stage || 'general').trim().slice(0, 80),
    level,
    message: String(input.message || '').replace(/\s+/g, ' ').trim().slice(0, 500) || 'Evento sin mensaje.',
    httpStatus: numberOrNull(input.httpStatus),
    durationMs: numberOrNull(input.durationMs),
    records: numberOrNull(input.records),
    received: numberOrNull(input.received),
    accepted: numberOrNull(input.accepted),
    persisted: numberOrNull(input.persisted),
    rejected: numberOrNull(input.rejected),
    eventAt: safeScraperLogIso(input.eventAt || input.createdAt, now),
    createdAt: now,
    details: sanitizeScraperLogDetails(input.details),
  };
  nextId.scraperLogs = log.id + 1;
  logs.unshift(log);
  if (logs.length > SCRAPER_LOG_LIMIT) logs.splice(SCRAPER_LOG_LIMIT);
  if (persist) saveData();
  return log;
}

function scraperLogSummary() {
  const logs = ensureScraperLogCollection();
  return {
    total: logs.length,
    render: logs.filter(log => log.source === 'render').length,
    app: logs.filter(log => log.source === 'app').length,
    latestRenderAt: logs.find(log => log.source === 'render')?.createdAt || null,
    latestAppAt: logs.find(log => log.source === 'app')?.createdAt || null,
  };
}

function savedPortableWorkerSchedule() {
  const setting = (db.settings || []).find(item => item.key === 'portable_worker_schedule');
  if (!setting) return null;
  try {
    const parsed = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function workerScheduleConfig() {
  const saved = savedPortableWorkerSchedule();
  const requestedInterval = Number(
    saved?.intervalHours ?? process.env.PORTABLE_WORKER_INTERVAL_HOURS ?? process.env.SERVICES_SCRAPE_INTERVAL_HOURS ?? 1,
  );
  const intervalHours = Number.isFinite(requestedInterval)
    ? Math.min(168, Math.max(1, Math.floor(requestedInterval)))
    : 12;
  const configuredStart = String(saved?.startAt || process.env.PORTABLE_WORKER_START_AT || '07:00');
  const startAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(configuredStart) ? configuredStart : '07:00';
  const timezone = String(saved?.timezone || process.env.PORTABLE_WORKER_TIMEZONE || process.env.SERVICES_TIMEZONE || 'America/Bogota').slice(0, 80);
  const configuredProviders = Array.isArray(saved?.providers) ? saved.providers.join(',') : saved?.providers;
  const providers = String(configuredProviders || process.env.PORTABLE_WORKER_PROVIDERS || 'air-e,water,gas')
    .split(',').map(value => value.trim().toLowerCase()).filter(value => ['air-e', 'water', 'gas'].includes(value));
  const requestedMode = String(
    saved?.executionMode || process.env.SERVICES_EXECUTION_MODE || process.env.PORTABLE_WORKER_EXECUTION_MODE || 'portable',
  ).trim().toLowerCase();
  const executionMode = ['portable', 'render'].includes(requestedMode) ? requestedMode : 'portable';
  return { intervalHours, startAt, timezone, providers: [...new Set(providers)], executionMode, source: saved ? 'app' : 'env' };
}

// Browserless/Render is deliberately not the default anymore. The local
// Android WebView or the local PC/VPS worker owns the authenticated browser.
// Keep the Render scheduler available only when the administrator explicitly
// selects executionMode=render from the app.
function applyServiceExecutionMode() {
  const mode = workerScheduleConfig().executionMode;
  if (mode === 'render') {
    servicesScraper.startScheduler();
    console.log('[SERVICES] Execution mode: Render (requires a local/full browser runtime).');
  } else {
    servicesScraper.stopScheduler();
    console.log('[SERVICES] Execution mode: portable/local device. Render scheduler disabled; no Browserless calls will be made.');
  }
  return mode;
}

function requireRenderScraperMode(res) {
  const mode = workerScheduleConfig().executionMode;
  if (mode === 'render') return false;
  res.status(409).json({
    error: 'El scraper de Render está desactivado. Ejecuta los portales desde el worker local del celular o PC/VPS.',
    executionMode: mode,
  });
  return true;
}

function portableWorkerApartments() {
  return (db.apartments || []).map(apt => ({
    id: apt.id,
    name: apt.name,
    floor: apt.floor || String(apt.name || '').slice(0, 1) || null,
    waterPaymentCode: apt.waterPaymentCode || null,
    gasPaymentCode: apt.gasPaymentCode || null,
    gasAccountId: defaultGasAccountId(apt, db.apartments || []),
    gasPaymentUrl: gasContractPaymentUrl(apt.gasPaymentCode),
    electricityPaymentCode: apt.electricityPaymentCode || apt.nic || null,
  }));
}

// Portal credentials are delivered only to an authenticated portable worker,
// over HTTPS, and are consumed in memory by the local WebView. They are never
// written to scraper diagnostics or returned by the public utility APIs.
function portableWorkerPortalCredentials() {
  // Default credentials that are used when no provider-specific credential
  // is stored in the database.  These match the portal accounts configured
  // by the admin and allow the worker to auto-login without manual setup.
  const DEFAULT_USERNAME = 'arriendo.apartamentos.la.victoria@gmail.com';
  const DEFAULT_PASSWORD = 'Laujim1011.';
  const GAS_PORTAL2_USERNAME = 'arriendo.apartamento.la.victoria@gmail.com';

  const credentials = {};
  for (const record of db.portalCredentials || []) {
    const storedProvider = String(record?.provider || '').trim().toLowerCase();
    const username = String(decryptSecret(record?.username) || '').trim();
    const password = String(decryptSecret(record?.password) || '');
    if (!storedProvider || !username || !password) continue;

    let workerProvider = storedProvider;
    if (storedProvider === 'triple-a') workerProvider = 'water';
    else if (storedProvider === 'gascaribe') workerProvider = 'gas-1';
    else if (/^gascaribe-\d+$/.test(storedProvider)) workerProvider = storedProvider.replace('gascaribe-', 'gas-');
    else if (storedProvider === 'gascaribe-portal2') workerProvider = 'gas-2';
    else if (storedProvider === 'gas') workerProvider = 'gas-1';

    credentials[workerProvider] = { username, password };
  }

  // Ensure every standard provider has at least the default credentials.
  // This prevents autologin from failing when the admin has not yet
  // configured provider-specific credentials in the portal settings.
  if (!credentials['air-e']) {
    credentials['air-e'] = { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
  }
  if (!credentials['water']) {
    credentials['water'] = { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
  }
  if (!credentials['gas-1']) {
    credentials['gas-1'] = { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD };
  }
  if (!credentials['gas-2']) {
    credentials['gas-2'] = { username: GAS_PORTAL2_USERNAME, password: DEFAULT_PASSWORD };
  }

  return credentials;
}

function ensureMarketplaceJobs() {
  if (!Array.isArray(db.marketplaceJobs)) db.marketplaceJobs = [];
  return db.marketplaceJobs;
}

function nextMarketplaceJobId() {
  const jobs = ensureMarketplaceJobs();
  const current = Number(nextId.marketplaceJobs) || (jobs.reduce((max, job) => Math.max(max, Number(job.id) || 0), 0) + 1);
  nextId.marketplaceJobs = current + 1;
  return current;
}

function marketplacePublicBase(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const forwarded = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'https';
  return `${protocol}://${req.get('host')}`;
}

function normalizeMarketplaceText(value) {
  return String(value ?? '').replace(/\+/g, ' ').trim();
}

function marketplaceListingSnapshot(apartment, req) {
  const photos = (db.photos || [])
    .filter(photo => Number(photo.apartmentId) === Number(apartment.id))
    .slice(0, 10);
  const base = marketplacePublicBase(req);
  const areaSquareMeters = Number(apartment.area || 0);
  const propertySquareFeet = Number(apartment.marketplaceSquareFeet || apartment.propertySquareFeet || 0) ||
    (areaSquareMeters > 0 ? Math.round(areaSquareMeters * 10.7639) : 0);
  const specs = [
    apartment.rooms ? `${apartment.rooms} habitaciones` : '',
    apartment.bathrooms ? `${apartment.bathrooms} baños` : '',
    apartment.area ? `${apartment.area} m²` : '',
  ].filter(Boolean).join(', ');
  const description = normalizeMarketplaceText(apartment.marketplaceDescription || apartment.description || '');
  return {
    apartmentId: Number(apartment.id),
    apartmentName: normalizeMarketplaceText(apartment.name || apartment.id),
    address: normalizeMarketplaceText(apartment.marketplaceAddress || apartment.address || ''),
    rentalType: normalizeMarketplaceText(apartment.marketplaceRentalType || 'Apartamento o piso'),
    city: normalizeMarketplaceText(apartment.marketplaceCity || apartment.city || 'Barranquilla'),
    bedrooms: String(apartment.marketplaceBedrooms ?? apartment.rooms ?? ''),
    bathrooms: String(apartment.marketplaceBathrooms ?? apartment.bathrooms ?? ''),
    title: normalizeMarketplaceText(apartment.marketplaceTitle || `Arriendo Apartamento ${apartment.name || apartment.id}`),
    price: String(Math.max(0, Math.round(Number(apartment.monthlyRent) || 0))),
    description: [
      `Apartamento ${apartment.name || apartment.id} en arriendo${specs ? `: ${specs}` : ''}.`,
      `Canon mensual: $${Math.max(0, Math.round(Number(apartment.monthlyRent) || 0)).toLocaleString('es-CO')}.`,
      description,
      'Para más información, contáctame.',
    ].filter(Boolean).join('\n'),
    area: String(apartment.area || ''),
    propertySquareFeet: String(propertySquareFeet || ''),
    availability: String(apartment.marketplaceAvailability || apartment.availableDate || apartment.availability || ''),
    laundryType: String(apartment.marketplaceLaundryType || 'Ninguno'),
    parkingType: String(apartment.marketplaceParkingType || 'Ninguno'),
    airConditioningType: String(apartment.marketplaceAirConditioningType || 'Ninguno'),
    heatingType: String(apartment.marketplaceHeatingType || 'Ninguno'),
    catFriendly: apartment.marketplaceCatFriendly === true,
    dogFriendly: apartment.marketplaceDogFriendly === true,
    photoUrls: photos.map(photo => `${base}/api/public/photos/${photo.id}`),
    photoCount: photos.length,
  };
}

function marketplaceJobView(job) {
  return {
    id: job.id,
    apartmentId: job.apartmentId,
    apartmentName: job.apartmentName,
    status: job.status,
    publish: job.publish === true,
    createdAt: job.createdAt,
    claimedAt: job.claimedAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    updatedAt: job.updatedAt || job.createdAt,
    claimedBy: job.claimedBy || null,
    attempts: Number(job.attempts) || 0,
    error: job.error || null,
    message: job.message || null,
    listingUrl: job.listingUrl || null,
    photoCount: Number(job.listing?.photoCount) || 0,
  };
}

function upsertPortableWorker(body = {}) {
  const workers = ensurePortableWorkerCollection();
  const deviceId = workerProtocol.normalizeWorkerId(body.deviceId);
  if (!deviceId) return null;
  const now = new Date().toISOString();
  if (body.replaceExisting === true) {
    workers.forEach(worker => {
      if (worker.deviceId !== deviceId) worker.active = false;
    });
  }
  const existing = workers.find(worker => worker.deviceId === deviceId);
  const record = {
    deviceId,
    platform: String(body.platform || existing?.platform || 'unknown').slice(0, 40),
    runtime: String(body.runtime || existing?.runtime || 'unknown').slice(0, 80),
    appVersion: String(body.appVersion || existing?.appVersion || '').slice(0, 80) || null,
    providers: Array.isArray(body.providers) ? body.providers.map(String).slice(0, 10) : (existing?.providers || []),
    active: body.active !== false,
    registeredAt: existing?.registeredAt || now,
    lastSeenAt: now,
    lastRunAt: existing?.lastRunAt || null,
    lastRunId: existing?.lastRunId || null,
    lastResultCount: Number(existing?.lastResultCount) || 0,
    lastError: existing?.lastError || null,
  };
  if (existing) Object.assign(existing, record);
  else workers.push(record);
  saveData();
  return record;
}

function mergePortableWorkerRecords(records, { runId = null, deviceId = null } = {}) {
  if (!Array.isArray(db.utilityRecords)) db.utilityRecords = [];
  let persisted = 0;
  const changes = [];
  for (const result of records) {
    const sameApartment = record => (
      (result.apartmentId !== null && result.apartmentId !== undefined && Number(record.apartmentId) === Number(result.apartmentId)) ||
      (result.apartment && String(record.apartment || '').trim() === String(result.apartment).trim())
    );
    const index = db.utilityRecords.findIndex(record => {
      if (record.provider !== result.provider) return false;
      if (sameApartment(record)) return true;
      // A shared Air-e NIC is duplicated for every configured apartment. Only
      // use the NIC as a fallback for legacy records that have no apartment
      // identity at all; otherwise 101 and 501 overwrite each other.
      if (result.provider === 'Air-e' && result.nic && record.nic
        && !result.apartmentId && !result.apartment && !record.apartmentId && !record.apartment) {
        return String(record.nic) === String(result.nic);
      }
      return false;
    });
    const existing = index >= 0 ? db.utilityRecords[index] : null;
    const merged = mergeUtilityRecord(existing, result);
    if (merged.paymentChange && ['partial_payment', 'full_payment'].includes(merged.paymentChange.status)) {
      changes.push({
        provider: result.provider,
        service: result.service || null,
        apartmentId: result.apartmentId ?? existing?.apartmentId ?? null,
        apartmentName: result.apartment || existing?.apartment || null,
        previousTotal: merged.paymentChange.previousTotal,
        currentTotal: merged.paymentChange.currentTotal,
        delta: merged.paymentChange.delta,
        status: merged.paymentChange.status,
        detectedAt: merged.paymentChange.detectedAt,
        fingerprint: utilityChangeAlertFingerprint({
          provider: result.provider,
          apartmentId: result.apartmentId ?? existing?.apartmentId ?? null,
          apartmentName: result.apartment || existing?.apartment || null,
          previousTotal: merged.paymentChange.previousTotal,
          currentTotal: merged.paymentChange.currentTotal,
          status: merged.paymentChange.status,
        }),
      });
    }
    if (index >= 0) db.utilityRecords[index] = merged;
    else db.utilityRecords.push(merged);

    // The authenticated portal name/address is authoritative.  Once a UI
    // scrape returns a confirmed value, keep the real portal identifier on the
    // apartment so the next run does not depend on the old QR/manual code.
    const mappedApartment = (db.apartments || []).find(apartment =>
      (result.apartmentId !== null && result.apartmentId !== undefined && Number(apartment.id) === Number(result.apartmentId)) ||
      (result.apartment && String(apartment.name || '').trim() === String(result.apartment).trim())
    );
    if (mappedApartment && ['paid', 'pending'].includes(String(result.status || '').toLowerCase())) {
      if (result.provider === 'Triple A' && result.waterPaymentCode) {
        mappedApartment.waterPaymentCode = String(result.waterPaymentCode);
        if (result.waterPaymentUrl && isReceiptPaymentUrl(result.waterPaymentUrl, 'water')) {
          mappedApartment.waterPaymentUrl = String(result.waterPaymentUrl);
        }
      }
      if (result.provider === 'Gases del Caribe' && result.gasPaymentCode) {
        mappedApartment.gasPaymentCode = String(result.gasPaymentCode);
        mappedApartment.gasPaymentUrl = gasContractPaymentUrl(result.gasPaymentCode);
      }
    }
    persisted += 1;
  }
  if (persisted) saveData();
  return { persisted, changes };
}

let portableWorkerRunPromise = null;
let portableWorkerRunState = {
  runId: null,
  status: 'idle',
  startedAt: null,
  finishedAt: null,
  providers: [],
  results: {},
  error: null,
};

app.post('/worker/v1/register', requirePortableWorker, (req, res) => {
  const registerStartedAt = Date.now();
  const record = upsertPortableWorker(req.body || {});
  appendScraperLog({
    source: 'render', deviceId: record?.deviceId || req.body?.deviceId, stage: 'register',
    level: record ? 'success' : 'error',
    message: record ? `Worker ${record.deviceId} registrado en Render.` : 'Render rechazó el registro del worker.',
    durationMs: Date.now() - registerStartedAt,
    details: record ? { platform: record.platform, runtime: record.runtime, appVersion: record.appVersion, providers: record.providers } : null,
  });
  if (!record) return res.status(400).json({ error: 'deviceId inválido' });
  res.json({ ok: true, protocolVersion: workerProtocol.WORKER_PROTOCOL_VERSION, deviceId: record.deviceId, replacedExisting: req.body?.replaceExisting === true });
});

app.post('/worker/v1/heartbeat', requirePortableWorker, (req, res) => {
  const body = { ...(req.body || {}), active: true };
  const record = upsertPortableWorker(body);
  appendScraperLog({
    source: 'render', deviceId: record?.deviceId || body.deviceId, stage: 'heartbeat', level: 'info',
    message: record ? `Heartbeat recibido de ${record.deviceId}.` : 'Render rechazó el heartbeat del worker.',
  });
  if (!record) return res.status(400).json({ error: 'deviceId inválido' });
  res.json({ ok: true, deviceId: record.deviceId, serverTime: new Date().toISOString() });
});

app.get('/worker/v1/config', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.headers['x-worker-id'] || req.query.deviceId);
  const schedule = workerScheduleConfig();
  appendScraperLog({
    source: 'render', deviceId, stage: 'config', level: 'success',
    message: `Configuración entregada a ${deviceId || 'worker sin identificar'}.`,
    details: { apartments: portableWorkerApartments().length, providers: schedule.providers, executionMode: schedule.executionMode },
  });
  res.json({
    ok: true,
    protocolVersion: workerProtocol.WORKER_PROTOCOL_VERSION,
    enabled: true,
    deviceId,
    schedule,
    executionMode: schedule.executionMode,
    portals: {
      water: 'https://portal.aaa.com.co/polizas',
      electricity: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List',
      gas: 'https://www.gascaribe.com/',
    },
    apartments: portableWorkerApartments(),
    serverTime: new Date().toISOString(),
  });
});

app.get('/worker/v1/portal-credentials', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.headers['x-worker-id'] || req.query.deviceId);
  const credentials = portableWorkerPortalCredentials();
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  appendScraperLog({
    source: 'render', deviceId, stage: 'credentials', level: 'success',
    message: `Credenciales de portales entregadas de forma privada a ${deviceId || 'worker sin identificar'}.`,
    details: { configuredProviders: Object.keys(credentials) },
  });
  res.json({ ok: true, credentials, serverTime: new Date().toISOString() });
});

// The phone/PC sends only stage metadata here. Portal tokens, cookies, raw
// responses and invoice payloads are intentionally excluded from persistence
// by sanitizeScraperLogDetails().
app.post('/worker/v1/events', requirePortableWorker, (req, res) => {
  const body = req.body || {};
  const deviceId = workerProtocol.normalizeWorkerId(body.deviceId || req.headers['x-worker-id']);
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  const rawEvents = Array.isArray(body.events) ? body.events.slice(0, 60) : [];
  if (!rawEvents.length) return res.status(400).json({ error: 'No se recibieron eventos de diagnóstico.' });
  let persisted = 0;
  rawEvents.forEach(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    appendScraperLog({
      source: 'app',
      deviceId,
      runId: body.runId || event.runId,
      provider: event.provider,
      stage: event.stage,
      level: event.level,
      message: event.message,
      httpStatus: event.httpStatus,
      durationMs: event.durationMs,
      records: event.records,
      received: event.received,
      accepted: event.accepted,
      persisted: event.persisted,
      rejected: event.rejected,
      eventAt: event.eventAt || event.createdAt,
      details: event.details,
    }, { persist: false });
    persisted += 1;
  });
  appendScraperLog({
    source: 'render', deviceId, runId: body.runId, stage: 'events_received', level: 'info',
    message: `Render recibió ${persisted} evento(s) de diagnóstico desde la app.`,
    details: { eventCount: persisted },
  }, { persist: false });
  saveData();
  res.json({ ok: true, deviceId, runId: String(body.runId || '').slice(0, 120) || null, received: rawEvents.length, persisted, serverTime: new Date().toISOString() });
});

// Android foreground workers use this endpoint as a lightweight trigger. The
// actual portal browser stays on Render, where the existing Browserless
// session, credentials and portal-specific scrapers are already configured.
// The worker never receives portal passwords and a second trigger cannot open
// overlapping browser sessions.
app.post('/worker/v1/run', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.body?.deviceId || req.headers['x-worker-id']);
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  if (portableWorkerRunPromise) {
    return res.status(202).json({
      ok: true,
      alreadyRunning: true,
      runId: portableWorkerRunState.runId,
      status: portableWorkerRunState.status,
    });
  }

  const configured = workerScheduleConfig();
  if (configured.executionMode !== 'render') {
    return res.status(409).json({
      error: 'El servidor está en modo portable/local. La APK o el worker de PC debe ejecutar los portales y enviar /worker/v1/results.',
      executionMode: configured.executionMode,
    });
  }
  const requestedProviders = Array.isArray(req.body?.providers)
    ? req.body.providers.map(value => String(value).trim().toLowerCase())
    : configured.providers;
  const providers = [...new Set(requestedProviders.filter(value => ['air-e', 'water', 'gas'].includes(value)))];
  if (!providers.length) return res.status(400).json({ error: 'No hay servicios habilitados para ejecutar.' });

  const runId = String(req.body?.runId || `android-${Date.now()}`).slice(0, 120);
  const startedAt = new Date().toISOString();
  portableWorkerRunState = {
    runId,
    status: 'running',
    startedAt,
    finishedAt: null,
    providers,
    results: {},
    error: null,
    deviceId,
  };
  upsertPortableWorker({
    deviceId,
    platform: req.body?.platform || 'android',
    runtime: req.body?.runtime || 'laujim-apk',
    appVersion: req.body?.appVersion,
    providers,
    active: true,
  });

  portableWorkerRunPromise = (async () => {
    for (const provider of providers) {
      try {
        let results = [];
        if (provider === 'air-e') results = await servicesScraper.runScrapeOnce(`worker:${deviceId}`);
        if (provider === 'water') results = await servicesScraper.runWaterScrapeOnce(`worker:${deviceId}`);
        if (provider === 'gas') results = await servicesScraper.runGasScrapeOnce(`worker:${deviceId}`);
        portableWorkerRunState.results[provider] = Array.isArray(results) ? results.length : 0;
      } catch (error) {
        portableWorkerRunState.results[provider] = 0;
        portableWorkerRunState.error = error.message;
        console.error(`[PORTABLE WORKER] ${provider} trigger error:`, error.message);
      }
    }
    portableWorkerRunState.status = 'completed';
    portableWorkerRunState.finishedAt = new Date().toISOString();
    const worker = ensurePortableWorkerCollection().find(item => item.deviceId === deviceId);
    if (worker) {
      worker.lastSeenAt = portableWorkerRunState.finishedAt;
      worker.lastRunAt = portableWorkerRunState.finishedAt;
      worker.lastRunId = runId;
      worker.lastResultCount = Object.values(portableWorkerRunState.results).reduce((sum, value) => sum + Number(value || 0), 0);
      worker.lastError = portableWorkerRunState.error || null;
      saveData();
    }
    return portableWorkerRunState;
  })().finally(() => {
    portableWorkerRunPromise = null;
  });

  res.status(202).json({ ok: true, runId, status: 'running', providers, serverTime: startedAt });
});

app.get('/worker/v1/run-status', requirePortableWorker, (req, res) => {
  res.json({ ok: true, run: portableWorkerRunState });
});

// Marketplace does not expose a general consumer-listing API through the
// existing WhatsApp Cloud integration. Render therefore stores only a safe
// publication queue; the authenticated Android WebView performs the action.
app.get('/api/marketplace/jobs', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const apartmentId = Number(req.query.apartmentId || 0);
  const jobs = ensureMarketplaceJobs()
    .filter(job => !apartmentId || Number(job.apartmentId) === apartmentId)
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 100)
    .map(marketplaceJobView);
  res.json({ ok: true, jobs });
});

app.get('/api/marketplace/logs', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const jobId = Number(req.query.jobId || 0);
  const logs = ensureScraperLogCollection()
    .filter(log => log.provider === 'Facebook Marketplace')
    .filter(log => !jobId || log.runId === `marketplace-job-${jobId}`)
    .slice(0, limit);
  res.json({ ok: true, logs, total: logs.length });
});

app.post('/api/marketplace/jobs', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const apartmentId = Number(req.body?.apartmentId);
  const apartment = (db.apartments || []).find(item => Number(item.id) === apartmentId);
  if (!apartment) return res.status(404).json({ error: 'Apartamento no encontrado.' });
  if (apartment.status !== 'vacant' && req.body?.force !== true) {
    return res.status(409).json({ error: 'El apartamento debe estar marcado como Disponible antes de publicarlo.' });
  }

  const active = ensureMarketplaceJobs().find(job =>
    Number(job.apartmentId) === apartmentId && ['queued', 'claimed', 'processing'].includes(job.status));
  if (active) return res.json({ ok: true, alreadyQueued: true, job: marketplaceJobView(active) });

  const listing = marketplaceListingSnapshot(apartment, req);
  if (!Number(listing.price)) return res.status(400).json({ error: 'Configura el canon mensual antes de publicar.' });
  if (!listing.photoUrls.length) return res.status(400).json({ error: 'Agrega al menos una foto al apartamento antes de publicar.' });
  if (!listing.address) return res.status(400).json({ error: 'Configura la dirección para Marketplace antes de publicar.' });

  const now = new Date().toISOString();
  const job = {
    id: nextMarketplaceJobId(),
    apartmentId,
    apartmentName: listing.apartmentName,
    status: 'queued',
    publish: req.body?.publish !== false,
    listing,
    createdAt: now,
    updatedAt: now,
    createdBy: req.auth?.name || 'Administrador',
    claimedAt: null,
    claimedBy: null,
    attempts: 0,
    error: null,
    message: 'Esperando al worker Android.',
    listingUrl: null,
  };
  ensureMarketplaceJobs().push(job);
  appendScraperLog({
    source: 'render', provider: 'Facebook Marketplace', runId: `marketplace-job-${job.id}`,
    stage: 'queued', level: 'info', message: `Apartamento ${job.apartmentName}: publicación agregada a la cola local.`,
    details: { jobId: job.id, apartmentId: job.apartmentId, photos: listing.photoCount, publish: job.publish },
  }, { persist: false });
  saveData();
  console.log(`[MARKETPLACE] Job ${job.id} queued for apartment ${job.apartmentName}; photos=${listing.photoCount}.`);
  res.status(201).json({ ok: true, job: marketplaceJobView(job) });
});

app.post('/api/marketplace/jobs/:id/retry', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const job = ensureMarketplaceJobs().find(item => Number(item.id) === Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Trabajo de Marketplace no encontrado.' });
  if (['queued', 'claimed', 'processing'].includes(job.status)) {
    return res.status(409).json({ error: 'El trabajo todavía está activo.' });
  }
  const apartment = (db.apartments || []).find(item => Number(item.id) === Number(job.apartmentId));
  if (!apartment) return res.status(404).json({ error: 'Apartamento no encontrado.' });
  job.listing = marketplaceListingSnapshot(apartment, req);
  job.status = 'queued';
  job.claimedAt = null;
  job.claimedBy = null;
  job.startedAt = null;
  job.finishedAt = null;
  job.updatedAt = new Date().toISOString();
  job.error = null;
  job.message = 'Reintento en espera del worker Android.';
  appendScraperLog({
    source: 'render', provider: 'Facebook Marketplace', runId: `marketplace-job-${job.id}`,
    stage: 'retry_queued', level: 'info', message: `Reintento ${Number(job.attempts || 0) + 1} agregado a la cola.`,
    details: { jobId: job.id, apartmentId: job.apartmentId },
  }, { persist: false });
  saveData();
  res.json({ ok: true, job: marketplaceJobView(job) });
});

app.post('/api/marketplace/jobs/:id/cancel', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const job = ensureMarketplaceJobs().find(item => Number(item.id) === Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Trabajo de Marketplace no encontrado.' });
  if (job.status === 'published') return res.status(409).json({ error: 'La publicación ya fue creada.' });
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  job.updatedAt = job.finishedAt;
  job.message = 'Cancelado por el administrador.';
  saveData();
  res.json({ ok: true, job: marketplaceJobView(job) });
});

app.get('/worker/v1/marketplace/jobs/next', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.headers['x-worker-id'] || req.query.deviceId);
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  const nowMs = Date.now();
  const staleMs = 20 * 60 * 1000;
  const jobs = ensureMarketplaceJobs();
  for (const job of jobs) {
    if (!['claimed', 'processing'].includes(job.status)) continue;
    const claimedAt = new Date(job.claimedAt || job.startedAt || 0).getTime();
    if (claimedAt && nowMs - claimedAt > staleMs) {
      job.status = 'queued';
      job.claimedAt = null;
      job.claimedBy = null;
      job.message = 'Trabajo recuperado después de una ejecución interrumpida.';
      job.updatedAt = new Date().toISOString();
    }
  }
  const job = jobs
    .filter(item => item.status === 'queued')
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0))[0];
  if (!job) {
    saveData();
    return res.json({ ok: true, job: null, nextCheckSeconds: 300, serverTime: new Date().toISOString() });
  }
  const now = new Date().toISOString();
  job.status = 'claimed';
  job.claimedAt = now;
  job.claimedBy = deviceId;
  job.updatedAt = now;
  job.attempts = (Number(job.attempts) || 0) + 1;
  appendScraperLog({
    source: 'render', provider: 'Facebook Marketplace', runId: `marketplace-job-${job.id}`,
    deviceId, stage: 'claimed', level: 'info', message: `Trabajo entregado al navegador local; intento ${job.attempts}.`,
    details: { jobId: job.id, apartmentId: job.apartmentId, attempt: job.attempts },
  }, { persist: false });
  job.message = 'Trabajo entregado al navegador local del teléfono.';
  saveData();
  console.log(`[MARKETPLACE] Job ${job.id} claimed by ${deviceId}.`);
  res.json({
    ok: true,
    job: {
      id: job.id,
      apartmentId: job.apartmentId,
      apartmentName: job.apartmentName,
      publish: job.publish === true,
      listing: job.listing,
      attempt: job.attempts,
    },
    serverTime: now,
  });
});

app.post('/worker/v1/marketplace/jobs/:id/events', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.headers['x-worker-id'] || req.body?.deviceId);
  const job = ensureMarketplaceJobs().find(item => Number(item.id) === Number(req.params.id));
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  if (!job) return res.status(404).json({ error: 'Trabajo de Marketplace no encontrado.' });
  if (job.claimedBy && job.claimedBy !== deviceId) return res.status(409).json({ error: 'El trabajo pertenece a otro dispositivo.' });
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 80) : [];
  if (!events.length) return res.status(400).json({ error: 'No se recibieron eventos de Marketplace.' });
  let persisted = 0;
  events.forEach(event => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    appendScraperLog({
      source: 'app', provider: 'Facebook Marketplace', runId: `marketplace-job-${job.id}`,
      deviceId, stage: event.stage || 'marketplace', level: event.level || 'info',
      message: event.message || 'Evento local de Marketplace.', eventAt: event.eventAt,
      durationMs: event.durationMs, details: { ...(event.details || {}), jobId: job.id, apartmentId: job.apartmentId },
    }, { persist: false });
    persisted += 1;
  });
  saveData();
  res.json({ ok: true, persisted, serverTime: new Date().toISOString() });
});

app.post('/worker/v1/marketplace/jobs/:id/status', requirePortableWorker, (req, res) => {
  const deviceId = workerProtocol.normalizeWorkerId(req.headers['x-worker-id'] || req.body?.deviceId);
  const job = ensureMarketplaceJobs().find(item => Number(item.id) === Number(req.params.id));
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  if (!job) return res.status(404).json({ error: 'Trabajo de Marketplace no encontrado.' });
  if (job.claimedBy && job.claimedBy !== deviceId) return res.status(409).json({ error: 'El trabajo pertenece a otro dispositivo.' });
  const allowed = ['processing', 'needs_login', 'needs_review', 'published', 'failed'];
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado de Marketplace inválido.' });
  const now = new Date().toISOString();
  job.status = status;
  job.updatedAt = now;
  if (status === 'processing' && !job.startedAt) job.startedAt = now;
  if (['needs_login', 'needs_review', 'published', 'failed'].includes(status)) job.finishedAt = now;
  job.error = String(req.body?.error || '').trim().slice(0, 1200) || null;
  job.message = String(req.body?.message || '').trim().slice(0, 1200) || null;
  const candidateUrl = String(req.body?.listingUrl || '').trim().slice(0, 1000);
  if (/^https:\/\/(?:www\.|web\.|m\.)?facebook\.com\/marketplace\/item\//i.test(candidateUrl)) {
    job.listingUrl = candidateUrl;
  }
  if (status === 'published') {
    const apartment = (db.apartments || []).find(item => Number(item.id) === Number(job.apartmentId));
    if (apartment && job.listingUrl) apartment.marketplaceUrl = job.listingUrl;
  }
  appendScraperLog({
    source: 'render', provider: 'Facebook Marketplace', runId: `marketplace-job-${job.id}`,
    deviceId, stage: `status_${status}`,
    level: status === 'published' ? 'success' : status === 'processing' ? 'info' : status === 'failed' ? 'error' : 'warn',
    message: job.message || `Marketplace cambió a ${status}.`,
    details: { jobId: job.id, apartmentId: job.apartmentId, status, hasListingUrl: Boolean(job.listingUrl) },
  }, { persist: false });
  saveData();
  console.log(`[MARKETPLACE] Job ${job.id} status=${status} device=${deviceId}; message=${String(job.message || '').slice(0, 240)}.`);
  res.json({ ok: true, job: marketplaceJobView(job), serverTime: now });
});

app.get('/api/scraper/schedule', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  res.json({ ok: true, schedule: workerScheduleConfig() });
});

app.put('/api/scraper/schedule', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const body = req.body || {};
  const intervalHours = Math.min(168, Math.max(1, Math.floor(Number(body.intervalHours))));
  const startAt = String(body.startAt || '07:00').trim();
  const timezone = String(body.timezone || 'America/Bogota').trim().slice(0, 80);
  const executionMode = ['portable', 'render'].includes(String(body.executionMode || '').trim().toLowerCase())
    ? String(body.executionMode).trim().toLowerCase()
    : workerScheduleConfig().executionMode;
  const providers = [...new Set((Array.isArray(body.providers) ? body.providers : [])
    .map(value => String(value).trim().toLowerCase())
    .filter(value => ['air-e', 'water', 'gas'].includes(value)))];
  if (!Number.isFinite(intervalHours) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startAt) || !timezone || !providers.length) {
    return res.status(400).json({ error: 'Frecuencia, hora, zona horaria y al menos un servicio son obligatorios.' });
  }
  const value = JSON.stringify({ intervalHours, startAt, timezone, providers, executionMode });
  const existing = (db.settings || []).find(item => item.key === 'portable_worker_schedule');
  if (existing) existing.value = value;
  else {
    if (!Array.isArray(db.settings)) db.settings = [];
    db.settings.push({ id: nextId.settings || 1, key: 'portable_worker_schedule', value });
    nextId.settings = (nextId.settings || 1) + 1;
  }
  saveData();
  applyServiceExecutionMode();
  res.json({ ok: true, schedule: workerScheduleConfig() });
});

app.post('/worker/v1/results', requirePortableWorker, (req, res) => {
  const body = req.body || {};
  const deviceId = workerProtocol.normalizeWorkerId(body.deviceId || req.headers['x-worker-id']);
  if (!deviceId) return res.status(400).json({ error: 'deviceId inválido' });
  const inspection = workerProtocol.inspectWorkerResults(body, { deviceId });
  const records = inspection.records;
  if (!records.length) {
    appendScraperLog({
      source: 'render', deviceId, runId: body.runId, stage: 'results_inspection', level: 'error',
      message: 'Render no aceptó ningún resultado enviado por el worker.',
      received: inspection.received, accepted: 0, rejected: inspection.rejected.length,
      details: { confirmed: 0, issueCount: 0, acceptedByProvider: inspection.acceptedByProvider, rejectedByProvider: inspection.rejectedByProvider, truncated: inspection.truncated },
    });
    console.warn(`[WORKER RESULTS] ${deviceId}: received=${inspection.received}, accepted=0, rejected=${inspection.rejected.length}.`, inspection.rejected.slice(0, 12));
    return res.status(400).json({
      error: 'No se recibieron resultados válidos',
      received: inspection.received,
      accepted: 0,
      confirmed: 0,
      issueCount: 0,
      persisted: 0,
      rejectedCount: inspection.rejected.length,
      rejected: inspection.rejected.slice(0, 50),
      acceptedByProvider: inspection.acceptedByProvider,
      rejectedByProvider: inspection.rejectedByProvider,
    });
  }
  const mergeResult = mergePortableWorkerRecords(records, { runId: body.runId, deviceId });
  const persisted = mergeResult.persisted;
  const worker = ensurePortableWorkerCollection().find(item => item.deviceId === deviceId) || upsertPortableWorker({ deviceId });
  if (worker) {
    worker.lastSeenAt = new Date().toISOString();
    worker.lastRunAt = body.capturedAt || worker.lastSeenAt;
    worker.lastRunId = String(body.runId || '').slice(0, 120) || null;
    worker.lastResultCount = persisted;
    worker.lastError = inspection.rejected.length
      ? `Se recibieron ${inspection.received} registro(s), se aceptaron ${inspection.accepted} y se rechazaron ${inspection.rejected.length}.`
      : null;
    saveData();
  }
  console.log(
    `[WORKER RESULTS] ${deviceId}: received=${inspection.received}, accepted=${inspection.accepted}, ` +
    `confirmed=${inspection.confirmed}, issues=${inspection.issueCount}, persisted=${persisted}, ` +
    `acceptedByProvider=${JSON.stringify(inspection.acceptedByProvider)}`,
  );
  appendScraperLog({
    source: 'render', deviceId, runId: body.runId, stage: 'results_receipt',
    level: inspection.rejected.length || inspection.issueCount ? 'warn' : 'success',
    message: `Render procesó ${inspection.received} resultado(s): ${inspection.confirmed} confirmados, ${inspection.issueCount} con incidencia y ${persisted} persistidos.`,
    received: inspection.received, accepted: inspection.accepted, persisted, rejected: inspection.rejected.length,
    details: {
      confirmed: inspection.confirmed,
      issueCount: inspection.issueCount,
      acceptedByProvider: inspection.acceptedByProvider,
      confirmedByProvider: inspection.confirmedByProvider,
      issueByProvider: inspection.issueByProvider,
      rejectedByProvider: inspection.rejectedByProvider,
      truncated: inspection.truncated,
    },
  });
  if (mergeResult.changes.length) {
    notifyUtilityPaymentChanges(mergeResult.changes, { runId: body.runId, deviceId })
      .catch(error => console.error('[WHATSAPP CLOUD] utility change notification error:', error.message));
  }
  res.json({
    ok: true,
    deviceId,
    received: inspection.received,
    accepted: inspection.accepted,
    confirmed: inspection.confirmed,
    issueCount: inspection.issueCount,
    persisted,
    rejectedCount: inspection.rejected.length,
    rejected: inspection.rejected.slice(0, 50),
    acceptedByProvider: inspection.acceptedByProvider,
    rejectedByProvider: inspection.rejectedByProvider,
    truncated: inspection.truncated,
    serverTime: new Date().toISOString(),
  });
});

app.get('/api/scraper/workers', (req, res) => {
  res.json({
    enabled: portableWorkerEnabled(),
    workers: ensurePortableWorkerCollection().map(worker => ({ ...worker })),
  });
});

app.get('/api/scraper/logs', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const requestedLimit = Number(req.query.limit || 160);
  const limit = Number.isFinite(requestedLimit) ? Math.min(300, Math.max(1, Math.floor(requestedLimit))) : 160;
  const source = ['render', 'app'].includes(String(req.query.source || '').toLowerCase())
    ? String(req.query.source).toLowerCase()
    : null;
  const deviceId = workerProtocol.normalizeWorkerId(req.query.deviceId);
  const logs = ensureScraperLogCollection()
    .filter(log => (!source || log.source === source) && (!deviceId || log.deviceId === deviceId))
    .slice(0, limit);
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    summary: scraperLogSummary(),
    logs,
  });
});

// Trigger Air-e scrape manually (admin only, via auth)
app.post('/api/scrape-air-e', async (req, res) => {
  if (requireRenderScraperMode(res)) return;
  try {
    res.json({ ok: true, message: 'Scrape iniciado. Los resultados se guardarán en utilityRecords.' });
    const results = await servicesScraper.scrapeAirE();
    // Persist results per apartment. A shared NIC is expected to generate a
    // separate visible record for every apartment that uses that service.
    if (!db.utilityRecords) db.utilityRecords = [];
    for (const r of results) {
      const existing = db.utilityRecords.findIndex(
        (u) => {
          if (u.provider !== 'Air-e') return false;
          const sameApartmentId = r.apartmentId !== null && r.apartmentId !== undefined &&
            u.apartmentId !== null && u.apartmentId !== undefined &&
            Number(u.apartmentId) === Number(r.apartmentId);
          const sameApartmentName = String(r.apartment || '').trim() &&
            String(u.apartment || '').trim() === String(r.apartment || '').trim();
          if (sameApartmentId || sameApartmentName) return true;
          return !r.apartmentId && !r.apartment && !u.apartmentId && !u.apartment &&
            u.nic === r.nic;
        }
      );
      if (existing >= 0) {
        db.utilityRecords[existing] = mergeUtilityRecord(db.utilityRecords[existing], r);
      } else {
        db.utilityRecords.push(r);
      }
    }
    saveData();
    console.log(`[AIR-E MANUAL] Stored ${results.length} records.`);
  } catch (e) {
    console.error('[SCRAPE-AIR-E ERROR]', e.message);
  }
});

// Trigger a read-only Triple A water check. The browser request returns
// immediately; the hourly scheduler and this manual endpoint share the same
// overlap guard inside services-scraper.cjs.
app.post('/api/scrape-water', (req, res) => {
  if (requireRenderScraperMode(res)) return;
  res.json({ ok: true, message: 'Consulta de agua iniciada. Los resultados se guardarán en utilityRecords.' });
  servicesScraper.runWaterScrapeOnce('manual').catch(error => console.error('[TRIPLE A MANUAL] Scrape error:', error.message));
});

app.post('/api/scrape-gas', (req, res) => {
  if (requireRenderScraperMode(res)) return;
  res.json({ ok: true, message: 'Consulta de gas iniciada. Los resultados se guardarán en utilityRecords.' });
  servicesScraper.runGasScrapeOnce('manual').catch(error => console.error('[GAS MANUAL] Scrape error:', error.message));
});

// Public URL for services admin (for residents' individual link)
app.get('/api/public/utility-status/:apartmentId', (req, res) => {
  const aptId = Number(req.params.apartmentId);
  const apt = db.apartments.find(a => a.id === aptId);
  if (!apt) return res.status(404).json({ error: 'Apartamento no encontrado' });

  // Only return public info (no credentials)
  const svcConfig = {
    water: { id: 'water', name: 'Agua', provider: 'Triple A', url: 'https://portal.aaa.com.co/poliz' },
    gas: { id: 'gas', name: 'Gas', provider: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
    electricity: { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
  };

  let electricityInfo = null;
  const correctNic = apt.electricityPaymentCode || apt.nic || '';
  if (correctNic && db.utilityRecords) {
    const directElecRecords = db.utilityRecords
      .filter(r => r.provider === 'Air-e' &&
        (Number(r.apartmentId) === Number(apt.id) || r.apartment === apt.name));
    const elecRecords = (directElecRecords.length ? directElecRecords : db.utilityRecords
      .filter(r => r.nic === correctNic && r.provider === 'Air-e' && !r.apartmentId && !r.apartment))
      .sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
    if (elecRecords.length > 0) {
      const latest = elecRecords[0];
      electricityInfo = {
        ...utilityTenantPaymentView(latest),
        deudaText: latest.deudaText || null,
        actualizado: latest.scrapedAt,
      };
    }
  }

  res.json({
    apartment: apt,
    services: {
      electricity: {
        ...svcConfig.electricity,
        payCode: apt.electricityPaymentCode || apt.nic || '',
        payment: electricityInfo,
      },
      water: { ...svcConfig.water, payCode: apt.waterPaymentCode || '', payment: utilityTenantPaymentView(latestUtilityRecord('Triple A', apt)) },
      gas: {
        ...svcConfig.gas,
        payCode: apt.gasPaymentCode || '',
        payment: utilityTenantPaymentView(latestUtilityRecord('Gases del Caribe', apt)),
      },
    },
  });
});

app.post('/api/save', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Invalid data' });
  let count = 0;
  Object.keys(incoming).forEach(col => {
    if (Array.isArray(incoming[col])) {
      db[col] = incoming[col].map(item => {
        if (!item.id) item.id = nextId[col] || 1;
        if (item.id >= (nextId[col] || 1)) nextId[col] = item.id + 1;
        return item;
      });
      count += db[col].length;
    }
  });
  saveData();
  res.json({ ok: true, saved: count });
});

app.post('/api/reset-db', (req, res) => {
  try {
    const dataFile = DATA_FILE;
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
    [PHOTOS_DIR, CONTRACTS_DIR].forEach(d => {
      if (fs.existsSync(d)) {
        const files = fs.readdirSync(d);
        files.forEach(f => { try { fs.unlinkSync(path.join(d, f)); } catch {} });
      }
    });
    db = JSON.parse(JSON.stringify(INITIAL_DATA));
    recalcNextId();
    saveData();
    res.json({ ok: true, message: 'Base de datos restablecida a valores iniciales' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bulk-add/:collection', (req, res) => {
  const col = req.params.collection;
  if (!db[col]) return res.status(404).json({ error: 'Collection not found' });
  const items = req.body;
  const added = items.map(item => {
    const newItem = { ...item, id: nextId[col] || 1 };
    if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
    nextId[col] = (nextId[col] || 1) + 1;
    db[col].push(newItem);
    return newItem;
  });
  saveData();
  res.status(201).json(added);
});

app.post('/api/upload/photo', (req, res) => {
  if (!upload) return res.status(500).json({ error: 'Upload not available' });
  upload.single('photo')(req, res, async error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'La foto supera el l\u00edmite de 20 MB' : error.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const stored = await putR2Buffer({
        section: 'apartments/photos', fileName: req.file.originalname, buffer: req.file.buffer, mimeType: req.file.mimetype,
      });
      const photo = {
        id: nextId.photos || 1, apartmentId: Number(req.body.apartmentId),
        filename: r2SafeFileName(req.file.originalname), originalName: req.file.originalname,
        storageKey: stored.storageKey, size: stored.size, mimeType: stored.mimeType,
        url: `/api/public/photos/${nextId.photos || 1}`, uploadedAt: new Date().toISOString(),
      };
      nextId.photos = (nextId.photos || 1) + 1;
      db.photos.push(photo);
      saveData();
      res.status(201).json(photo);
    } catch (storageError) { res.status(503).json({ error: storageError.message }); }
  });
});

app.get('/api/public/photos/:id', async (req, res) => {
  const photo = (db.photos || []).find(item => Number(item.id) === Number(req.params.id));
  if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
  if (photo.storageKey && r2Ready()) {
    try {
      await streamR2Object(photo.storageKey, res, { fileName: photo.originalName || photo.filename, mimeType: photo.mimeType });
      return;
    } catch (error) { return res.status(502).json({ error: `No fue posible leer la foto permanente: ${error.message}` }); }
  }
  if (typeof photo.data === 'string' && /^data:image\//i.test(photo.data)) {
    const match = photo.data.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (!match) return res.status(422).json({ error: 'Formato de foto no compatible' });
    try {
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=300');
      return res.send(Buffer.from(match[2], 'base64'));
    } catch (error) { return res.status(422).json({ error: 'No fue posible leer la foto guardada: ' + error.message }); }
  }
  const legacyPath = path.join(PHOTOS_DIR, photo.filename || '');
  if (!photo.filename || !fs.existsSync(legacyPath)) return res.status(404).json({ error: 'Foto no disponible' });
  res.sendFile(legacyPath);
});

app.delete('/api/photo/:id', async (req, res) => {
  const idx = db.photos.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Photo not found' });
  const photo = db.photos[idx];
  try {
    if (photo.storageKey) await deleteR2Object(photo.storageKey, photo.size);
    else if (photo.filename) fs.unlinkSync(path.join(PHOTOS_DIR, photo.filename));
  } catch (error) { return res.status(502).json({ error: `No fue posible eliminar la foto permanente: ${error.message}` }); }
  db.photos.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

function normalizeTemplateVariables(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim().replace(/^\{\{\s*|\s*\}\}$/g, '').slice(0, 100);
    const key = value.toLocaleLowerCase('es');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= 120) break;
  }
  return result;
}

function parseManualTemplateVariables(raw) {
  if (Array.isArray(raw)) return normalizeTemplateVariables(raw);
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    if (Array.isArray(parsed)) return normalizeTemplateVariables(parsed);
  } catch { }
  return normalizeTemplateVariables(String(raw || '').split(/[\n,;]+/));
}

async function inspectContractTemplate(buffer, fileName, mimeType) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (extension === '.docx') {
    const doc = new Docxtemplater(new PizZip(buffer), {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
    });
    const fullText = String(doc.getFullText() || '');
    const variables = [];
    for (const match of fullText.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) variables.push(match[1]);
    return { format: 'docx', detectedVariables: normalizeTemplateVariables(variables), supportsGeneration: true };
  }
  if (extension === '.pdf' || String(mimeType || '').toLowerCase() === 'application/pdf') {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
    const fields = document.getForm().getFields().map(field => field.getName());
    return {
      format: 'pdf',
      detectedVariables: normalizeTemplateVariables(fields),
      supportsGeneration: fields.length > 0,
    };
  }
  throw new Error('Formato no compatible. Usa PDF o Word .docx. Los archivos .doc antiguos deben convertirse a .docx.');
}

function contractTemplateView(item) {
  return {
    id: item.id,
    name: item.name,
    originalName: item.originalName,
    format: item.format,
    mimeType: item.mimeType,
    size: item.size,
    detectedVariables: normalizeTemplateVariables(item.detectedVariables),
    manualVariables: normalizeTemplateVariables(item.manualVariables),
    variables: normalizeTemplateVariables([...(item.detectedVariables || []), ...(item.manualVariables || [])]),
    supportsGeneration: Boolean(item.supportsGeneration),
    uploadedAt: item.uploadedAt,
    updatedAt: item.updatedAt || item.uploadedAt,
  };
}

function truthyTemplateValue(value) {
  return value === true || ['1', 'true', 'sí', 'si', 'yes', 'on', 'x'].includes(String(value || '').trim().toLocaleLowerCase('es'));
}

async function generateFromContractTemplate(template, values) {
  const source = await getR2Buffer(template.storageKey);
  if (template.format === 'docx') {
    const doc = new Docxtemplater(new PizZip(source), {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' },
      nullGetter: () => '',
    });
    doc.render(values || {});
    return { buffer: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }), mimeType: template.mimeType, extension: '.docx' };
  }
  if (template.format === 'pdf') {
    const document = await PDFDocument.load(source, { ignoreEncryption: false });
    const form = document.getForm();
    for (const field of form.getFields()) {
      if (!Object.prototype.hasOwnProperty.call(values || {}, field.getName())) continue;
      const value = values[field.getName()];
      if (field instanceof PDFTextField) field.setText(String(value ?? ''));
      else if (field instanceof PDFCheckBox) {
        if (truthyTemplateValue(value)) field.check();
        else field.uncheck();
      }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
        const selected = String(value ?? '');
        if (selected) field.select(selected);
      }
    }
    return { buffer: Buffer.from(await document.save()), mimeType: 'application/pdf', extension: '.pdf' };
  }
  throw new Error('La plantilla no admite generación automática.');
}

app.get('/api/contract-templates', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  res.json((db.contractTemplates || []).map(contractTemplateView));
});

app.post('/api/contract-templates', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  if (!upload) return res.status(500).json({ error: 'Carga de archivos no disponible' });
  upload.single('template')(req, res, async error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'La plantilla supera el límite de 20 MB' : error.message });
    if (!req.file) return res.status(400).json({ error: 'Selecciona una plantilla PDF o Word .docx' });
    try {
      const inspection = await inspectContractTemplate(req.file.buffer, req.file.originalname, req.file.mimetype);
      const stored = await putR2Buffer({
        section: 'contract-templates',
        fileName: req.file.originalname,
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      });
      const now = new Date().toISOString();
      const record = {
        id: nextId.contractTemplates || 1,
        name: String(req.body?.name || path.basename(req.file.originalname, path.extname(req.file.originalname))).trim().slice(0, 140),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        storageKey: stored.storageKey,
        size: stored.size,
        format: inspection.format,
        detectedVariables: inspection.detectedVariables,
        manualVariables: parseManualTemplateVariables(req.body?.manualVariables),
        supportsGeneration: inspection.supportsGeneration,
        uploadedAt: now,
        updatedAt: now,
      };
      db.contractTemplates.push(record);
      nextId.contractTemplates = record.id + 1;
      saveData();
      res.status(201).json(contractTemplateView(record));
    } catch (templateError) {
      res.status(400).json({ error: templateError.message || 'No fue posible analizar la plantilla.' });
    }
  });
});

app.put('/api/contract-templates/:id', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const template = (db.contractTemplates || []).find(item => Number(item.id) === Number(req.params.id));
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  if (req.body?.name !== undefined) template.name = String(req.body.name || '').trim().slice(0, 140) || template.name;
  if (req.body?.manualVariables !== undefined) template.manualVariables = parseManualTemplateVariables(req.body.manualVariables);
  template.updatedAt = new Date().toISOString();
  saveData();
  res.json(contractTemplateView(template));
});

app.get('/api/contract-templates/:id/file', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const template = (db.contractTemplates || []).find(item => Number(item.id) === Number(req.params.id));
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  try {
    await streamR2Object(template.storageKey, res, { fileName: template.originalName, mimeType: template.mimeType });
  } catch (error) { res.status(502).json({ error: `No fue posible leer la plantilla: ${error.message}` }); }
});

app.post('/api/contract-templates/:id/generate', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const template = (db.contractTemplates || []).find(item => Number(item.id) === Number(req.params.id));
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  if (!template.supportsGeneration) {
    return res.status(422).json({ error: 'Este PDF no contiene campos rellenables. Añade campos AcroForm o usa Word con variables {{campo}}.' });
  }
  try {
    const generated = await generateFromContractTemplate(template, req.body?.values || {});
    const baseName = r2SafeFileName(template.name || 'contrato').replace(/\.[^.]+$/, '');
    res.setHeader('Content-Type', generated.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}-generado${generated.extension}`)}`);
    res.send(generated.buffer);
  } catch (error) { res.status(400).json({ error: error.message || 'No fue posible generar el contrato.' }); }
});

app.delete('/api/contract-templates/:id', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const index = (db.contractTemplates || []).findIndex(item => Number(item.id) === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const [template] = db.contractTemplates.splice(index, 1);
  try { await deleteR2Object(template.storageKey, template.size); }
  catch (error) { db.contractTemplates.splice(index, 0, template); return res.status(502).json({ error: `No fue posible eliminar la plantilla: ${error.message}` }); }
  saveData();
  res.json({ ok: true });
});

app.post('/api/upload/contract', (req, res) => {
  if (!upload) return res.status(500).json({ error: 'Upload not available' });
  upload.single('contract')(req, res, async error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'El contrato supera el l\u00edmite de 20 MB' : error.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const stored = await putR2Buffer({
        section: 'apartments/contracts', fileName: req.file.originalname, buffer: req.file.buffer, mimeType: req.file.mimetype,
      });
      if (!Array.isArray(db.contractFiles)) db.contractFiles = [];
      const file = {
        id: nextId.contractFiles || Date.now(), contractId: Number(req.body.contractId),
        filename: r2SafeFileName(req.file.originalname), originalName: req.file.originalname,
        storageKey: stored.storageKey, size: stored.size, mimeType: stored.mimeType,
        uploadedAt: new Date().toISOString(),
      };
      nextId.contractFiles = (nextId.contractFiles || file.id) + 1;
      db.contractFiles.push(file);
      saveData();
      res.status(201).json(file);
    } catch (storageError) { res.status(503).json({ error: storageError.message }); }
  });
});

app.post('/api/generate-contract', (req, res) => {
  const { body } = req;
  if (!body || !body.arrendatario_nombre || !body.apto) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  const pythonScript = path.join('C:', 'Contratos', 'generador_gui.pyw');
  if (!fs.existsSync(pythonScript)) {
    return res.status(200).json({ ok: true, note: 'Script no disponible, usa el generador web' });
  }
  const tempFile = path.join(__dirname, 'data', '_temp_contract_data.json');
  fs.writeFileSync(tempFile, JSON.stringify(body, null, 2));
  const proc = spawn('pythonw', [pythonScript, '--batch', tempFile], { detached: true, stdio: 'ignore' });
  proc.unref();
  res.json({ ok: true, message: 'Generador iniciado en el PC. Revisa la carpeta C:\\Contratos\\salida' });
});

// ─── PRESENCIA ───
app.post('/api/tenant/presence/heartbeat', (req, res) => {
  const userId = 'tenant-' + req.auth.tenantId;
  const status = ['online', 'away', 'offline'].includes(req.body?.status) ? req.body.status : 'online';
  if (!db.presence) db.presence = [];
  const idx = db.presence.findIndex(p => p.userId === userId);
  const record = { userId, status, lastSeen: new Date().toISOString(), apartmentId: req.auth.apartmentId };
  if (idx >= 0) db.presence[idx] = { ...db.presence[idx], ...record };
  else { record.id = nextId.presence || 1; nextId.presence = record.id + 1; db.presence.push(record); }
  saveData();
  res.json({ ok: true });
});

app.get('/api/tenant/presence', (req, res) => {
  res.json((db.presence || []).filter(item => item.userId === 'admin'));
});

app.post('/api/tenant/messages', (req, res) => {
  const content = String(req.body?.content || '').trim();
  if (!content || content.length > 4000) return res.status(400).json({ error: 'Mensaje inválido' });
  const roomId = 'admin-' + req.auth.apartmentId;
  const newItem = {
    id: nextId.messages || 1, roomId, from: 'tenant-' + req.auth.tenantId, to: 'admin', content,
    createdAt: new Date().toISOString(), read: false, type: 'text', apartmentId: req.auth.apartmentId,
  };
  if (!db.messages) db.messages = [];
  db.messages.push(newItem);
  nextId.messages = newItem.id + 1;
  saveData();
  res.status(201).json(newItem);
});

app.get('/api/tenant/messages/updates/:since', (req, res) => {
  const roomId = 'admin-' + req.auth.apartmentId;
  const since = req.params.since;
  res.json((db.messages || []).filter(item => item.roomId === roomId && item.createdAt >= since));
});

app.post('/api/presence/heartbeat', (req, res) => {
  const { userId, status } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!db.presence) db.presence = [];
  const idx = db.presence.findIndex(p => p.userId === userId);
  const record = { userId, status: status || 'online', lastSeen: new Date().toISOString() };
  if (idx >= 0) { db.presence[idx] = { ...db.presence[idx], ...record }; }
  else { nextId.presence = (nextId.presence || 0) + 1; record.id = nextId.presence; db.presence.push(record); }
  saveData();
  res.json({ ok: true });
});

// ─── MENSAJES ───
app.post('/api/messages', (req, res) => {
  const col = 'messages';
  if (!db[col]) db[col] = [];
  const newItem = { ...req.body, id: nextId[col] || 1 };
  if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
  db[col].push(newItem);
  nextId[col] = (nextId[col] || 1) + 1;
  saveData();
  res.status(201).json(newItem);
});

app.get('/api/messages/updates/:since', (req, res) => {
  const since = req.params.since;
  const messages = db.messages || [];
  const filtered = messages.filter(m => m.createdAt >= since);
  res.json(filtered);
});

// ─── WHATSAPP ───
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const savedToken = cloudConfig().verifyToken;
  // Meta verifies the callback before the production access token and phone ID
  // exist.  Requiring the entire Cloud configuration here prevents the safe
  // bootstrap sequence from ever completing.
  if (savedToken && mode === 'subscribe' && token === savedToken) {
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
});

app.post('/api/whatsapp/webhook', (req, res) => {
  const body = req.body;
  if (!cloudReady()) {
    console.error('[WHATSAPP CLOUD] webhook ignored: Cloud API is not configured');
    return res.status(503).json({ error: 'WhatsApp Cloud API no configurada' });
  }
  if (!validCloudSignature(req)) {
    console.error('[WHATSAPP CLOUD] webhook rejected: invalid signature');
    return res.sendStatus(401);
  }
  if (body.object !== 'whatsapp_business_account') {
    console.error('[WHATSAPP CLOUD] webhook ignored: unexpected object');
    return res.sendStatus(404);
  }
  const messageCount = (body.entry || []).reduce((total, entry) => total + (entry.changes || []).reduce((count, change) =>
    count + (change.field === 'messages' ? (change.value?.messages || []).length : 0), 0), 0);
  console.log(`[WHATSAPP CLOUD] webhook accepted: ${messageCount} incoming message event(s)`);
  res.sendStatus(200);
  for (const entry of body.entry || []) for (const change of entry.changes || []) {
    if (change.field !== 'messages') continue;
    for (const msg of change.value.messages || []) {
      handleCloudInbound(msg).catch(err => console.error('[WHATSAPP CLOUD] inbound error:', err.message));
    }
  }
});

app.get('/api/whatsapp/cloud/status', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const c = cloudConfig();
  res.json({ ready: !!cloudReady(), enabled: c.enabled, configured: {
    accessToken: !!c.token, phoneNumberId: !!c.phoneNumberId, verifyToken: !!c.verifyToken, appSecret: !!c.appSecret, graphVersion: !!c.graphVersion,
  }, conversations: db.whatsappConversations.length, contacts: db.whatsappContacts.length,
  quarantined: db.whatsappAuthStates.length, blocked: db.whatsappBlockedUsers.length });
});

app.get('/api/whatsapp/cloud/conversations', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  let repaired = false;
  const conversations = db.whatsappConversations.map(c => {
    const context = repairCloudConversationContext(c);
    repaired ||= context.changed;
    const windowOpen = cloudServiceWindowOpen(c);
    const tenant = context.tenant;
    const apartment = context.apartment;
    const conversationMessages = (db.whatsappMessages || []).filter(m => m.conversationId === c.id);
    const lastMessage = conversationMessages[conversationMessages.length - 1] || null;
    return { ...c, tenantName: tenant?.name || 'Inquilino autorizado', apartmentName: apartment?.name || null,
      windowOpen, windowUntil: c.customerServiceWindowUntil || null,
      lastMessageAt: lastMessage?.createdAt || c.lastInboundAt || c.createdAt,
      messages: lastMessage ? [lastMessage] : [] };
  });
  if (repaired) saveData();
  res.json(conversations);
});

app.get('/api/whatsapp/cloud/contacts', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const contacts = (db.tenants || []).map(tenant => {
    const contract = activeContractForTenant(tenant.id);
    if (!tenant.phone) return null;
    const apartmentId = tenantApartmentId(tenant);
    const apartment = (db.apartments || []).find(a => Number(a.id) === Number(apartmentId));
    const conversation = (db.whatsappConversations || []).find(c => samePhone(c.phone, tenant.phone));
    const explicit = (db.whatsappContacts || []).find(c => samePhone(c.phone, tenant.phone));
    const windowOpen = cloudServiceWindowOpen(conversation);
    return { tenantId: tenant.id, name: tenant.name || 'Inquilino', phone: normalizePhone(tenant.phone), apartmentId,
      apartmentName: apartment?.name || null, activeContract: !!contract, hasApartmentAssociation: apartmentId != null,
      conversationId: conversation?.id || null,
      windowOpen, source: explicit?.source || 'database' };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  res.json(contacts);
});

// A tenant remains a contact even before sending the first message. Outside
// the 24-hour window, WhatsApp requires the approved greeting template.
app.post('/api/whatsapp/cloud/start-conversation', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const tenantId = Number(req.body?.tenantId);
  const tenant = (db.tenants || []).find(item => Number(item.id) === tenantId);
  if (!tenant?.phone) return res.status(404).json({ error: 'El inquilino no tiene un teléfono registrado' });
  const contact = authorizedCloudContact(tenant.phone);
  if (!contact) return res.status(409).json({ error: 'El inquilino no tiene un contrato activo autorizado' });
  const conversation = getCloudConversation(contact);
  const now = Date.now();
  if (cloudServiceWindowOpen(conversation)) {
    return res.json({ ok: true, conversationId: conversation.id, windowOpen: true, sentTemplate: false });
  }
  try {
    const result = await sendCloudGreetingTemplate(contact.phone, tenant.name);
    addCloudMessage(conversation, 'out', {
      type: 'template', text: `Hola, ${firstName(tenant.name)}, ¿cómo estás? ¿Podemos hablar un momento?`,
      template: process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino',
      whatsappMessageId: result.messages?.[0]?.id || null,
    });
    saveData();
    res.json({ ok: true, conversationId: conversation.id, windowOpen: false, sentTemplate: true });
  } catch (error) { res.status(502).json({ error: `No fue posible enviar la plantilla de saludo: ${error.message}` }); }
});

// Send the approved rent/services template from an apartment card without
// opening the administrator's personal WhatsApp account. The conversation is
// returned so the UI can take the administrator directly to WhatsApp Cloud.
// The apartment card now uses the preparation endpoint below so it cannot
// bypass the administrator's preview/confirmation step.
app.post('/api/whatsapp/cloud/prepare-tenant-template', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const tenantId = Number(req.body?.tenantId);
  const tenant = (db.tenants || []).find(item => Number(item.id) === tenantId);
  if (!tenant?.phone) return res.status(404).json({ error: 'El inquilino no tiene un teléfono registrado' });
  const contact = authorizedCloudContact(tenant.phone);
  if (!contact) return res.status(409).json({ error: 'El inquilino no tiene un contrato activo autorizado' });
  const contract = activeContractForTenant(tenant.id);
  const apartmentId = Number(contact.apartmentId || contract?.apartmentId || 0);
  const apartment = (db.apartments || []).find(item => Number(item.id) === apartmentId);
  if (!apartment) return res.status(409).json({ error: 'El inquilino no tiene un apartamento activo asociado' });
  const period = String(req.body?.period || colombiaDate().slice(0, 7));
  const conversation = getCloudConversation({ ...contact, tenantId: tenant.id, apartmentId: apartment.id });
  try {
    const preview = cloudTemplatePreview(conversation, 'payment_reminder', period);
    res.json({ ok: true, conversationId: conversation.id, period, preview });
  } catch (error) {
    res.status(400).json({ error: `No fue posible preparar la vista previa: ${error.message}` });
  }
});

app.post('/api/whatsapp/cloud/send-tenant-template', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const tenantId = Number(req.body?.tenantId);
  const tenant = (db.tenants || []).find(item => Number(item.id) === tenantId);
  if (!tenant?.phone) return res.status(404).json({ error: 'El inquilino no tiene un teléfono registrado' });
  const contact = authorizedCloudContact(tenant.phone);
  if (!contact) return res.status(409).json({ error: 'El inquilino no tiene un contrato activo autorizado' });
  const contract = activeContractForTenant(tenant.id);
  const apartmentId = Number(contact.apartmentId || contract?.apartmentId || 0);
  const apartment = (db.apartments || []).find(item => Number(item.id) === apartmentId);
  if (!apartment) return res.status(409).json({ error: 'El inquilino no tiene un apartamento activo asociado' });
  const period = String(req.body?.period || colombiaDate().slice(0, 7));
  const conversation = getCloudConversation({ ...contact, tenantId: tenant.id, apartmentId: apartment.id });
  let preview;
  try { preview = cloudTemplatePreview(conversation, 'payment_reminder', period); }
  catch (error) { return res.status(400).json({ error: `No fue posible preparar la vista previa: ${error.message}` }); }
  if (String(req.body?.previewFingerprint || '').trim() !== preview.fingerprint) {
    return res.status(409).json({ error: 'Primero revisa y confirma la vista previa antes de enviar.', preview });
  }
  try {
    const result = await sendCloudPaymentReminderTemplate(tenant.phone, tenant.name, period, apartment);
    addCloudMessage(conversation, 'out', {
      type: 'template',
      text: preview.previewText, templatePreviewText: preview.previewText,
      templateVariables: preview.variables,
      template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios',
      whatsappMessageId: result.messages?.[0]?.id || null,
    });
    saveData();
    res.json({ ok: true, conversationId: conversation.id, sentTemplate: true, period, preview });
  } catch (error) {
    res.status(502).json({ error: `No fue posible enviar la plantilla de cobro: ${error.message}` });
  }
});

app.get('/api/whatsapp/cloud/conversations/:id/messages', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const id = Number(req.params.id);
  if (!db.whatsappConversations.some(c => c.id === id)) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json((db.whatsappMessages || []).filter(m => m.conversationId === id));
});

// Cloud API no puede retirar un mensaje del WhatsApp del destinatario. This
// cleanup only removes Laujim's local record and any copies of the media that
// Laujim archived; the response makes that boundary explicit to the inbox.
async function purgeCloudMessageMedia(message) {
  const warnings = [];
  if (message?.media?.storageKey && r2Ready()) {
    try { await deleteR2Object(message.media.storageKey, message.media.size); }
    catch (error) { warnings.push(`R2: ${error.message}`); }
  }
  if (message?.mediaId && cloudReady()) {
    try { await cloudGraphRequest(`/${encodeURIComponent(message.mediaId)}`, 'DELETE'); }
    catch (error) { warnings.push(`Media de Meta: ${error.message}`); }
  }
  return warnings;
}

app.delete('/api/whatsapp/cloud/messages/:messageId', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const messageId = Number(req.params.messageId);
  const index = db.whatsappMessages.findIndex(item => Number(item.id) === messageId);
  if (index < 0) return res.status(404).json({ error: 'Mensaje no encontrado' });
  const [message] = db.whatsappMessages.splice(index, 1);
  const warnings = await purgeCloudMessageMedia(message);
  await saveData();
  res.json({
    ok: true,
    localDeleted: true,
    remoteMessageDeleted: false,
    mediaDeleted: !warnings.some(warning => warning.startsWith('R2:') || warning.startsWith('Media de Meta:')),
    warnings,
    notice: 'El mensaje ya no aparece en Laujim; Meta no permite retirarlo del WhatsApp del destinatario.',
  });
});

app.delete('/api/whatsapp/cloud/conversations/:id', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const conversationId = Number(req.params.id);
  const conversationIndex = db.whatsappConversations.findIndex(item => Number(item.id) === conversationId);
  if (conversationIndex < 0) return res.status(404).json({ error: 'Conversación no encontrada' });
  const messages = db.whatsappMessages.filter(item => Number(item.conversationId) === conversationId);
  const warnings = (await Promise.all(messages.map(purgeCloudMessageMedia))).flat();
  db.whatsappMessages = db.whatsappMessages.filter(item => Number(item.conversationId) !== conversationId);
  db.whatsappConversations.splice(conversationIndex, 1);
  await saveData();
  res.json({
    ok: true,
    localDeleted: true,
    remoteMessagesDeleted: false,
    messageCount: messages.length,
    warnings,
    notice: 'La conversación ya no aparece en Laujim; Meta no permite borrar sus mensajes del WhatsApp del destinatario.',
  });
});

// ─── AUTOMATIC PAYMENT EVENTS ─────────────────────────────────────────────
// The Android worker sends a short-lived notification event here. The server
// stores only the parsed/masked fields needed for reconciliation.
app.get('/api/payments/automation', (req, res) => {
  ensurePaymentAutomationCollections();
  const events = db.paymentEvents.slice(0, 120).map(event => ({
    ...event,
    apartmentName: event.apartmentName || (db.apartments || []).find(item => Number(item.id) === Number(event.apartmentId))?.name || null,
    candidates: (event.candidates || []).map(candidate => ({
      ...candidate,
      apartmentName: candidate.apartmentName || (db.apartments || []).find(item => Number(item.id) === Number(candidate.apartmentId))?.name || 'Apartamento',
    })),
  }));
  const rules = db.paymentRules.map(rule => ({
    ...rule,
    apartmentName: (db.apartments || []).find(item => Number(item.id) === Number(rule.apartmentId))?.name || 'Apartamento',
  }));
  res.json({
    ok: true,
    events,
    rules,
    alerts: db.paymentAlerts.slice(0, 80),
    pending: events.filter(event => event.status === 'pending_association').length,
    autoConfirmed: events.filter(event => event.status === 'auto_confirmed').length,
  });
});

app.post('/api/payments/automation/events', (req, res) => {
  const input = req.body || {};
  if (!automaticPaymentIsRentOnly(input)) {
    return res.status(422).json({ ok: false, ignored: true, error: 'Las notificaciones automáticas solo se usan para pagos del canon; los servicios se consultan por su scraper.' });
  }
  const result = evaluateAutomaticPayment(input);
  const event = result.event;
  const apartment = event.apartmentId ? (db.apartments || []).find(item => Number(item.id) === Number(event.apartmentId)) : null;
  res.status(result.duplicate ? 200 : 201).json({
    ok: true,
    duplicate: result.duplicate,
    status: result.status,
    event: { ...event, apartmentName: event.apartmentName || apartment?.name || null },
    payment: result.payment,
    candidates: result.candidates,
    message: result.status === 'auto_confirmed'
      ? `Pago registrado automáticamente para el apartamento ${event.apartmentName || apartment?.name || 'asociado'}.`
      : 'Pago recibido y enviado a la cola de asociación.',
  });
});

app.post('/api/payments/automation/events/:id/associate', (req, res) => {
  try {
    const result = associateAutomaticPaymentEvent(req.params.id, req.body?.apartmentId, req.body?.remember !== false, req.auth?.name || 'Administrador');
    res.json({ ok: true, ...result, message: `Gracias por confirmar. El pago quedó asociado al apartamento ${result.apartment.name}.` });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/payments/automation/events/:id/dismiss', (req, res) => {
  try {
    const event = dismissAutomaticPaymentEvent(req.params.id, req.body?.reason || 'Falsa alarma');
    res.json({ ok: true, event, message: 'Ok, fue marcada como falsa alarma y no se registró como pago.' });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.post('/api/payments/automation/rules', (req, res) => {
  ensurePaymentAutomationCollections();
  const body = req.body || {};
  if (!automaticPaymentIsRentOnly(body)) return res.status(422).json({ error: 'Las reglas automáticas solo pueden asociarse al canon, no a servicios públicos.' });
  const apartment = (db.apartments || []).find(item => Number(item.id) === Number(body.apartmentId));
  const identifier = String(body.identifier || '').trim();
  if (!apartment || !identifier) return res.status(400).json({ error: 'Apartamento e identificador del remitente son obligatorios.' });
  const rule = {
    id: nextId.paymentRules++, provider: String(body.provider || 'desconocido').trim().slice(0, 80),
    providerKey: paymentProviderKey(body.provider), identifier: identifier.slice(0, 120),
    identifierMasked: maskedPaymentIdentifier(identifier), apartmentId: apartment.id,
    amountMode: body.amountMode === 'fixed' ? 'fixed' : 'current_rent', amount: body.amountMode === 'fixed' ? parseAutomaticPaymentAmount(body.amount) : null,
    paymentPurpose: 'rent', paymentConcept: 'canon',
    tolerance: Math.max(0, Number(body.tolerance) || 0), active: true, source: 'manual', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  if (rule.amountMode === 'fixed' && !rule.amount) return res.status(400).json({ error: 'El valor fijo de la regla no es válido.' });
  db.paymentRules.unshift(rule); saveData();
  res.status(201).json({ ok: true, rule: { ...rule, apartmentName: apartment.name } });
});

// Lightweight inbox feed used by the Android background notification service.
// It returns metadata only; media remains behind the authenticated proxy above.
app.get('/api/whatsapp/cloud/notifications', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const sinceValue = String(req.query?.since || '').trim();
  const sinceMs = sinceValue ? new Date(sinceValue).getTime() : 0;
  let repaired = false;
  const items = (db.whatsappMessages || [])
    .filter(message => message.direction === 'in' && Number.isFinite(new Date(message.createdAt).getTime()) && new Date(message.createdAt).getTime() > sinceMs)
    .slice(-50)
    .map(message => {
      const conversation = db.whatsappConversations.find(item => Number(item.id) === Number(message.conversationId));
      const context = conversation ? repairCloudConversationContext(conversation) : { tenant: null, apartment: null, changed: false };
      repaired ||= context.changed;
      const tenant = context.tenant;
      const apartment = context.apartment;
      return {
        id: message.id,
        conversationId: message.conversationId,
        tenantName: tenant?.name || 'Inquilino autorizado',
        apartmentName: apartment?.name || conversation?.apartmentId || '—',
        type: message.type || 'text',
        text: message.text || '',
        createdAt: message.createdAt,
      };
    });
  if (repaired) saveData();
  res.json({ items });
});

// The Android background service also consumes the durable scraper stream for
// useful results/errors. Heartbeats, config reads and credential reads are
// deliberately excluded so the phone only alerts on something actionable.
app.get('/api/notifications/events', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const sinceValue = String(req.query?.since || '').trim();
  const sinceMs = sinceValue ? new Date(sinceValue).getTime() : 0;
  const ignoredStages = new Set(['register', 'heartbeat', 'config', 'credentials', 'events_received']);
  const isFacebookPublicationSuccess = log => {
    const stage = String(log.stage || '').toLowerCase();
    const message = String(log.message || '').toLowerCase();
    const status = log.details && typeof log.details === 'object'
      ? String(log.details.status || '').toLowerCase()
      : '';
    if (status === 'published' || stage === 'status_published' || stage === 'published') return true;
    return String(log.level || '').toLowerCase() === 'success'
      && /publicad[oa]|publicaci[oó]n.*exitosa|published/.test(message)
      && !/login|inici[óo].*sesi[óo]n|procesando|processing/.test(message);
  };
  const isScraperFailure = log => ['warn', 'error'].includes(String(log.level || '').toLowerCase());
  const items = ensureScraperLogCollection()
    .filter(log => !ignoredStages.has(String(log.stage || '').toLowerCase()))
    .filter(log => log.provider === 'Facebook Marketplace'
      ? isFacebookPublicationSuccess(log)
      : isScraperFailure(log))
    .filter(log => {
      const time = new Date(log.createdAt || log.eventAt || 0).getTime();
      return Number.isFinite(time) && time > sinceMs;
    })
    .sort((left, right) => new Date(left.createdAt || left.eventAt || 0) - new Date(right.createdAt || right.eventAt || 0))
    .slice(-50)
    .map(log => {
      const facebook = log.provider === 'Facebook Marketplace';
      return {
        id: `${facebook ? 'facebook' : 'scraper'}-${log.id}`,
        category: facebook ? 'facebook' : 'scraper',
        title: facebook ? 'Facebook Marketplace' : `Scraper · ${log.provider || 'Servicios públicos'}`,
        text: log.message,
        level: log.level,
        provider: log.provider || null,
        stage: log.stage,
        status: log.details && typeof log.details === 'object' ? log.details.status || null : null,
        createdAt: log.createdAt || log.eventAt,
      };
    });
  const paymentItems = (db.paymentEvents || [])
    .filter(event => {
      const time = new Date(event.createdAt || event.receivedAt || 0).getTime();
      return Number.isFinite(time) && time > sinceMs;
    })
    .slice(0, 50)
    .map(event => ({
      id: `payment-${event.id}`,
      category: 'payments',
      title: 'Pagos automáticos',
      text: event.status === 'pending_association'
        ? `Pago recibido por $${Number(event.amount || 0).toLocaleString('es-CO')} sin apartamento identificado.`
        : `Pago de $${Number(event.amount || 0).toLocaleString('es-CO')} · ${event.apartmentName || 'apartamento asociado'} · ${event.status}`,
      level: event.status === 'pending_association' ? 'warn' : 'success',
      provider: event.provider || null,
      createdAt: event.createdAt || event.receivedAt,
    }));
  items.push(...paymentItems);
  items.sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
  res.json({ items });
});

// Media is proxied through the authenticated backend so the browser never
// receives the Cloud API access token.
app.get('/api/whatsapp/cloud/messages/:messageId/media', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const message = (db.whatsappMessages || []).find(item => Number(item.id) === Number(req.params.messageId));
  if (!message?.mediaId && !message?.media?.storageKey) return res.status(404).json({ error: 'Este mensaje no contiene un archivo' });
  if (message.media?.storageKey && r2Ready()) {
    try {
      await streamR2Object(message.media.storageKey, res, { fileName: message.media.fileName, mimeType: message.media.mimeType });
      return;
    } catch (error) {
      // Older WhatsApp media can still be fetched from Meta while it remains
      // available, so a transient R2 error does not make the inbox unusable.
      console.error('[R2] media proxy error:', error.message);
    }
  }
  try {
    const info = await cloudGraphRequest(`/${encodeURIComponent(message.mediaId)}`);
    if (!info.url) throw new Error('WhatsApp no entregó una URL para este archivo');
    const remoteUrl = new URL(info.url);
    const c = cloudConfig();
    const proxy = https.request({
      hostname: remoteUrl.hostname, port: remoteUrl.port || 443,
      path: remoteUrl.pathname + remoteUrl.search, method: 'GET',
      headers: { Authorization: `Bearer ${c.token}` },
    }, remote => {
      if (remote.statusCode < 200 || remote.statusCode >= 300) {
        remote.resume();
        return res.status(502).json({ error: 'WhatsApp no pudo entregar el archivo solicitado' });
      }
      const fileName = message.media?.fileName || `whatsapp-${message.id}`;
      res.setHeader('Content-Type', remote.headers['content-type'] || message.media?.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      if (remote.headers['content-length']) res.setHeader('Content-Length', remote.headers['content-length']);
      remote.pipe(res);
    });
    proxy.on('error', error => {
      if (!res.headersSent) res.status(502).json({ error: error.message });
      else res.end();
    });
    proxy.setTimeout(30000, () => proxy.destroy(new Error('La descarga del archivo tardó demasiado')));
    proxy.end();
  } catch (error) { res.status(502).json({ error: error.message }); }
});

// Payment proofs are kept as regular payment records so they share the same
// history and reports, but nothing reaches the collected-income metrics until
// an administrator explicitly approves it.
app.get('/api/whatsapp/cloud/payment-validations', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const validations = (db.payments || []).filter(payment => payment.status === 'pending_validation').map(payment => {
    const apartment = (db.apartments || []).find(item => Number(item.id) === Number(payment.apartmentId));
    const tenant = (db.tenants || []).find(item => Number(item.id) === Number(payment.tenantId));
    return { ...payment, apartmentName: apartment?.name || 'Apartamento', tenantName: tenant?.name || 'Inquilino' };
  }).sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
  res.json(validations);
});

app.get('/api/whatsapp/cloud/payment-validations/:id/proof', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment?.receiptMedia?.storageKey) return res.status(404).json({ error: 'El comprobante no está disponible en el almacenamiento permanente' });
  try {
    await streamR2Object(payment.receiptMedia.storageKey, res, {
      fileName: payment.receiptMedia.fileName || `comprobante-${payment.id}`,
      mimeType: payment.receiptMedia.mimeType,
    });
  } catch (error) { res.status(502).json({ error: `No fue posible abrir el comprobante: ${error.message}` }); }
});

// OCR can be retried after a temporary model/network failure without asking
// the tenant to send the same proof again. The original file remains private
// in R2 and the OCR result is the only derived data written to the payment.
app.post('/api/whatsapp/cloud/payment-validations/:id/ocr', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment?.receiptMedia?.storageKey) return res.status(404).json({ error: 'El comprobante no está disponible para OCR' });
  try {
    const buffer = await getR2Buffer(payment.receiptMedia.storageKey);
    const ocr = await analysePaymentProofMedia({
      buffer,
      mimeType: payment.receiptMedia.mimeType,
      fileName: payment.receiptMedia.fileName,
    });
    payment.receiptOcr = ocr;
    payment.receiptMedia.ocr = ocr;
    payment.updatedAt = new Date().toISOString();
    saveData();
    res.json({ ok: true, ocr });
  } catch (error) {
    res.status(502).json({ error: `No fue posible repetir el OCR: ${error.message}` });
  }
});

// Shared payment-validation logic, reused by the HTTP endpoints and by the
// WhatsApp admin chat (APROBAR/RECHAZAR commands).
function approveCloudPayment(payment, amount, by) {
  const finalAmount = amount === undefined ? payment.amount : Number(amount);
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) throw new Error('El valor aprobado debe ser mayor que cero');
  payment.amount = finalAmount;
  payment.status = 'approved';
  payment.approvedAt = new Date().toISOString();
  payment.approvedBy = by || 'Administrador';
  payment.updatedAt = payment.approvedAt;
  saveData();
  return payment;
}

function rejectCloudPayment(payment, reason, by) {
  payment.status = 'rejected';
  payment.rejectedAt = new Date().toISOString();
  payment.rejectedBy = by || 'Administrador';
  payment.rejectionReason = String(reason || '').trim();
  payment.updatedAt = payment.rejectedAt;
  saveData();
  return payment;
}

app.post('/api/whatsapp/cloud/payment-validations/:id/approve', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  if (payment.status !== 'pending_validation') return res.status(409).json({ error: 'Este comprobante ya fue revisado' });
  try {
    res.json(approveCloudPayment(payment, req.body?.amount, req.auth?.name));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/whatsapp/cloud/payment-validations/:id/reject', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  if (payment.status !== 'pending_validation') return res.status(409).json({ error: 'Este comprobante ya fue revisado' });
  rejectCloudPayment(payment, req.body?.reason, req.auth?.name);
  res.json(payment);
});

// Useful for checking the scheduled reminder setup without waiting for the
// next hourly run. It still sends only reminders that are due today.
app.post('/api/whatsapp/cloud/reminders/run', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  try { res.json(await runPaymentReminders({ force: req.body?.force === true })); }
  catch (error) { res.status(502).json({ error: error.message }); }
});

app.post('/api/whatsapp/cloud/send', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const { conversationId, text } = req.body || {};
  const conversation = db.whatsappConversations.find(c => c.id === Number(conversationId));
  if (!conversation || !text || !String(text).trim()) return res.status(400).json({ error: 'Conversación y texto son requeridos' });
  if (!cloudServiceWindowOpen(conversation)) {
    return res.status(409).json({ error: 'La ventana gratuita de servicio terminó; se requiere una plantilla aprobada.' });
  }
  try {
    const result = await sendCloudText(conversation.phone, String(text).trim());
    const message = addCloudMessage(conversation, 'out', { type: 'text', text: String(text).trim(), whatsappMessageId: result.messages?.[0]?.id || null });
    saveData(); res.json({ ok: true, id: result.messages?.[0]?.id || null, message });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

// Inline Android notification replies use the same Cloud API path as the
// inbox, then persist the outgoing message so the conversation stays in sync.
app.post('/api/whatsapp/cloud/quick-reply', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const conversation = db.whatsappConversations.find(c => c.id === Number(req.body?.conversationId));
  const text = String(req.body?.text || '').trim();
  if (!conversation || !text) return res.status(400).json({ error: 'Conversación y texto son requeridos' });
  if (!cloudServiceWindowOpen(conversation)) {
    return res.status(409).json({ error: 'La ventana de 24 horas terminó; usa una plantilla aprobada.' });
  }
  try {
    const result = await sendCloudText(conversation.phone, text);
    const message = addCloudMessage(conversation, 'out', { type: 'text', text, whatsappMessageId: result.messages?.[0]?.id || null });
    saveData();
    res.json({ ok: true, id: result.messages?.[0]?.id || null, message });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

// Build the exact values that the approved template would receive without
// calling Meta. This lets the administrator verify the latest stored scraper
// data before sending anything to a tenant.
app.post('/api/whatsapp/cloud/template-preview', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const conversation = db.whatsappConversations.find(c => c.id === Number(req.body?.conversationId));
  const template = String(req.body?.template || '').trim();
  if (!conversation || !['greeting', 'payment_reminder'].includes(template)) {
    return res.status(400).json({ error: 'Conversación y plantilla válida son requeridas' });
  }
  try {
    res.json({ ok: true, preview: cloudTemplatePreview(conversation, template, req.body?.period) });
  } catch (error) {
    res.status(400).json({ error: `No fue posible preparar la vista previa: ${error.message}` });
  }
});

// Templates can be sent from the inbox even after the 24-hour service window.
// Their approval and category are enforced by Meta before delivery.
app.post('/api/whatsapp/cloud/send-template', async (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const conversation = db.whatsappConversations.find(c => c.id === Number(req.body?.conversationId));
  const template = String(req.body?.template || '').trim();
  if (!conversation || !['greeting', 'payment_reminder'].includes(template)) {
    return res.status(400).json({ error: 'Conversación y plantilla válida son requeridas' });
  }
  const context = resolveCloudConversationContext(conversation);
  const tenant = context.tenant;
  const apartment = context.apartment;
  const requestedFingerprint = String(req.body?.previewFingerprint || '').trim();
  let preview;
  try {
    preview = cloudTemplatePreview(conversation, template, req.body?.period);
  } catch (error) {
    return res.status(400).json({ error: `No fue posible preparar la vista previa: ${error.message}` });
  }
  if (!requestedFingerprint) {
    return res.status(409).json({ error: 'Primero revisa y confirma la vista previa de la plantilla.', preview });
  }
  if (preview.canSend === false) {
    return res.status(409).json({ error: preview.warning || 'La conversación no está asociada a un apartamento.', preview });
  }
  if (requestedFingerprint !== preview.fingerprint) {
    return res.status(409).json({ error: 'Los datos cambiaron desde la vista previa. Revisa la versión actual antes de enviar.', preview });
  }
  try {
    let result;
    let message;
    if (template === 'greeting') {
      result = await sendCloudGreetingTemplate(conversation.phone, tenant?.name);
      message = addCloudMessage(conversation, 'out', {
        type: 'template', text: preview.previewText, templatePreviewText: preview.previewText,
        templateVariables: preview.variables,
        template: process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino',
        whatsappMessageId: result.messages?.[0]?.id || null,
      });
    } else {
      const period = String(req.body?.period || colombiaDate().slice(0, 7));
      result = await sendCloudPaymentReminderTemplate(conversation.phone, tenant?.name, period, apartment);
      message = addCloudMessage(conversation, 'out', {
        type: 'template', text: preview.previewText, templatePreviewText: preview.previewText,
        templateVariables: preview.variables,
        template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios',
        whatsappMessageId: result.messages?.[0]?.id || null,
      });
    }
    saveData();
    res.json({ ok: true, id: result.messages?.[0]?.id || null, message, preview });
  } catch (error) {
    res.status(502).json({ error: `No fue posible enviar la plantilla: ${error.message}` });
  }
});

app.post('/api/whatsapp/cloud/send-media', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  if (!cloudUpload) return res.status(500).json({ error: 'La carga de archivos no está disponible' });
  cloudUpload.single('file')(req, res, async error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el límite de 16 MB' : error.message });
    const { conversationId, caption } = req.body || {};
    const conversation = db.whatsappConversations.find(c => c.id === Number(conversationId));
    if (!conversation || !req.file) return res.status(400).json({ error: 'Conversación y archivo son requeridos' });
    if (!cloudServiceWindowOpen(conversation)) {
      return res.status(409).json({ error: 'La ventana de 24 h terminó; no se puede enviar un archivo libre sin una plantilla aprobada.' });
    }
    try {
      const file = await transcodeVoiceNote(req.file);
      const media = {
        kind: cloudMediaKind(file), mimeType: file.mimetype || 'application/octet-stream',
        fileName: file.originalname || 'archivo', size: file.size, voice: !!file.voice,
      };
      const uploaded = await uploadCloudMedia(file);
      media.id = uploaded.id;
      Object.assign(media, await putR2Buffer({
        section: 'whatsapp/outbound', fileName: media.fileName, buffer: file.buffer, mimeType: media.mimeType,
      }));
      media.archiveStatus = 'stored';
      const result = await sendCloudMedia(conversation.phone, media, String(caption || '').trim());
      const message = addCloudMessage(conversation, 'out', {
        type: media.kind, text: String(caption || '').trim(), mediaId: media.id, media,
        whatsappMessageId: result.messages?.[0]?.id || null,
      });
      saveData();
      res.json({ ok: true, id: result.messages?.[0]?.id || null, mediaId: media.id, message });
    } catch (uploadError) { res.status(502).json({ error: uploadError.message }); }
  });
});


// ─── ADMIN PASSWORD & SECURITY ───
app.post('/api/admin/verify-password', (req, res) => {
  const { password } = req.body || {};
  if (adminPasswordMatches(password)) {
    return res.json({ ok: true, role: 'admin', name: 'Administrador' });
  }
  res.status(401).json({ error: 'Contraseña inválida' });
});

app.post('/api/admin/change-password', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const { currentPassword, newPassword } = req.body || {};
  if (!adminPasswordMatches(currentPassword)) {
    return res.status(401).json({ error: 'Contraseña actual inválida' });
  }
  if (!newPassword || String(newPassword).length < 10) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres' });
  }
  saveAdminPassword(newPassword);
  db.authSessions = (db.authSessions || []).filter(session => session.role !== 'admin');
  saveData();
  res.json({ ok: true, message: 'Contraseña actualizada. Inicia sesión nuevamente.' });
});

const adminRecoveryAttempts = new Map();

function adminRecoverySecret() {
  return String(process.env.ADMIN_RECOVERY_CODE || process.env.SECURITY_QUESTION_ANSWER || '').trim();
}

app.get('/api/admin/recovery-status', (req, res) => {
  res.json({ ok: true, enabled: Boolean(adminRecoverySecret()) });
});

app.post('/api/admin/recover-password', (req, res) => {
  const identity = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  const recent = (adminRecoveryAttempts.get(identity) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  recent.push(now);
  adminRecoveryAttempts.set(identity, recent);

  const expected = adminRecoverySecret();
  const { recoveryCode, newPassword } = req.body || {};
  if (!expected) return res.status(503).json({ error: 'Configura ADMIN_RECOVERY_CODE en Render para habilitar la recuperación.' });
  if (!constantTimeEqual(String(recoveryCode || '').trim(), expected)) return res.status(401).json({ error: 'Código de recuperación inválido' });
  if (!newPassword || String(newPassword).length < 10) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 10 caracteres' });

  saveAdminPassword(newPassword);
  db.authSessions = (db.authSessions || []).filter(session => session.role !== 'admin');
  saveData();
  adminRecoveryAttempts.delete(identity);
  res.json({ ok: true, message: 'Contraseña recuperada. Ya puedes iniciar sesión.' });
});

app.post('/api/admin/verify-security-question', (req, res) => {
  const { answer } = req.body || {};
  const expected = process.env.SECURITY_QUESTION_ANSWER || '';
  if (expected && constantTimeEqual((answer || '').toLowerCase().trim(), expected.toLowerCase().trim())) {
    return res.json({ ok: true, message: 'Respuesta correcta' });
  }
  res.status(401).json({ error: 'Respuesta incorrecta' });
});

// ─── CREDENCIALES DE PORTALES DE SERVICIOS PÚBLICOS ───
// Admin-only. Secrets are encrypted at rest (AES-256-GCM) via encryptSecret.

app.get('/api/portal-credentials', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const records = (db.portalCredentials || []).map(rec => ({
    id: rec.id,
    provider: rec.provider,
    username: decryptSecret(rec.username),
    password: decryptSecret(rec.password),
    updatedAt: rec.updatedAt,
  }));
  res.json({ ok: true, data: records });
});

app.put('/api/portal-credentials/:provider', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const provider = String(req.params.provider || '').trim().toLowerCase();
  if (!provider) return res.status(400).json({ error: 'Proveedor requerido' });
  const { username, password } = req.body || {};
  if (username === undefined || username === null || String(username).trim() === '') {
    return res.status(400).json({ error: 'Usuario requerido' });
  }
  if (password === undefined || password === null || String(password).trim() === '') {
    return res.status(400).json({ error: 'Contraseña requerida' });
  }
  if (!db.portalCredentials) db.portalCredentials = [];
  const index = db.portalCredentials.findIndex(rec => rec.provider === provider);
  const updatedAt = new Date().toISOString();
  let record;
  if (index === -1) {
    record = {
      id: nextId.portalCredentials || 1,
      provider,
      username: encryptSecret(String(username).trim()),
      password: encryptSecret(String(password)),
      updatedAt,
    };
    db.portalCredentials.push(record);
    nextId.portalCredentials = record.id + 1;
  } else {
    record = {
      ...db.portalCredentials[index],
      username: encryptSecret(String(username).trim()),
      password: encryptSecret(String(password)),
      updatedAt,
    };
    db.portalCredentials[index] = record;
  }
  saveData();
  res.json({ ok: true, id: record.id, provider: record.provider, updatedAt });
});

app.delete('/api/portal-credentials/:provider', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const provider = String(req.params.provider || '').trim().toLowerCase();
  const before = (db.portalCredentials || []).length;
  db.portalCredentials = (db.portalCredentials || []).filter(rec => rec.provider !== provider);
  if (before !== (db.portalCredentials || []).length) saveData();
  res.json({ ok: true });
});

app.get('/api/leads', (req, res) => {
  res.json(db.leads || []);
});

app.post('/api/leads', (req, res) => {
  const newLead = { ...req.body, id: nextId.leads || 1 };
  if (!newLead.createdAt) newLead.createdAt = new Date().toISOString();
  db.leads.push(newLead);
  nextId.leads = (nextId.leads || 1) + 1;
  saveData();
  res.status(201).json(newLead);
});

// ─── CONTRATO + AUTO-PASSWORD ───
app.post('/api/contracts', (req, res) => {
  const col = 'contracts';
  if (!db[col]) return res.status(404).json({ error: 'Collection not found' });
  const newItem = { ...req.body, id: nextId[col] || 1 };
  if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
  db[col].push(newItem);
  nextId[col] = (nextId[col] || 1) + 1;
  saveData();
  syncPasswordFromTenant(newItem.tenantId, newItem.apartmentId);
  res.status(201).json(newItem);
});

// ─── DELETE TENANT + CLEANUP ───
app.delete('/api/tenants/:id', async (req, res) => {
  const id = Number(req.params.id);
  const index = (db.tenants || []).findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const removedTenant = db.tenants[index];
  const removedPhones = [removedTenant?.phone].filter(Boolean).map(normalizePhone).filter(Boolean);
  ensureCloudCollections();
  const revokedAt = new Date().toISOString();
  for (const contact of db.whatsappContacts) {
    if (Number(contact.tenantId) !== id) continue;
    contact.enabled = false;
    contact.revokedAt = revokedAt;
    contact.revocationReason = 'tenant_removed';
  }
  db.whatsappAuthStates = db.whatsappAuthStates.filter(state => !removedPhones.some(phone => samePhone(phone, state.phone)));
  for (const conversation of db.whatsappConversations) {
    if (Number(conversation.tenantId) !== id && !removedPhones.some(phone => samePhone(phone, conversation.phone))) continue;
    conversation.tenantId = null;
    conversation.apartmentId = null;
    conversation.status = 'revoked';
    conversation.lastInboundAt = null;
    conversation.customerServiceWindowUntil = null;
  }
  db.tenants.splice(index, 1);
  const linkedContracts = (db.contracts || []).filter(c => c.tenantId === id);
  for (const contract of linkedContracts) {
    const pwdIdx = (db.passwords || []).findIndex(p => p.apartmentId === contract.apartmentId);
    if (pwdIdx !== -1) db.passwords.splice(pwdIdx, 1);
  }
  saveData();
  // Best effort remote block. The local revoke is authoritative even if Meta
  // is temporarily unavailable.
  for (const phone of removedPhones) {
    try { await blockCloudUser(phone, 'tenant_removed'); }
    catch (error) { console.error('[WHATSAPP CLOUD] tenant removal block error:', error.message); }
  }
  res.json({ success: true });
});

// ─── RUTAS GENÉRICAS ───

app.get('/api/:collection', (req, res) => {
  const col = req.params.collection;
  if (!db[col]) return res.status(404).json({ error: 'Collection not found' });
  res.json(db[col]);
});

app.get('/api/:collection/count', (req, res) => {
  const col = req.params.collection;
  if (!db[col]) return res.status(404).json({ error: 'Collection not found' });
  res.json({ count: db[col].length });
});

app.get('/api/:collection/where/:field/:value', (req, res) => {
  const { collection, field, value } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const results = db[collection].filter(item => String(item[field]) === String(value));
  res.json(results);
});

app.get('/api/:collection/first/:field/:value', (req, res) => {
  const { collection, field, value } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const item = db[collection].find(item => String(item[field]) === String(value));
  res.json(item || null);
});

app.get('/api/:collection/filter/:field/:value', (req, res) => {
  const { collection, field, value } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const results = db[collection].filter(item => String(item[field]) === String(value));
  res.json(results);
});

app.get('/api/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const item = db[collection].find(i => i.id === Number(id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.post('/api/:collection', (req, res) => {
  const col = req.params.collection;
  if (!db[col]) return res.status(404).json({ error: 'Collection not found' });
  const newItem = { ...req.body, id: nextId[col] || 1 };
  if (!newItem.createdAt) newItem.createdAt = new Date().toISOString();
  if (col === 'apartments') {
    normalizeApartmentServiceLinks(newItem);
    newItem.gasAccountId = defaultGasAccountId(newItem, db.apartments);
  }
  db[col].push(newItem);
  nextId[col] = (nextId[col] || 1) + 1;
  saveData();
  res.status(201).json(newItem);
});

app.put('/api/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const index = db[collection].findIndex(i => i.id === Number(id));
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  db[collection][index] = { ...db[collection][index], ...req.body };
  if (collection === 'apartments') {
    normalizeApartmentServiceLinks(db[collection][index]);
    db[collection][index].gasAccountId = defaultGasAccountId(db[collection][index], db.apartments);
  }
  try {
    await saveData();
  } catch (error) {
    return res.status(503).json({ error: 'El cambio se guardó localmente, pero Aiven no confirmó la persistencia.' });
  }
  res.json(db[collection][index]);
});

app.delete('/api/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const index = db[collection].findIndex(i => i.id === Number(id));
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  db[collection].splice(index, 1);
  saveData();
  res.json({ success: true });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PROJECT_DIR = path.resolve(__dirname);
const EDITOR_ENABLED = process.env.EDITOR_ENABLED === 'true';
const EDITOR_AUTH = { username: process.env.EDITOR_USERNAME || '', password: process.env.EDITOR_PASSWORD || '' };

function editorAuth(req, res, next) {
  if (!EDITOR_ENABLED) return res.status(404).end('Editor disabled');
  if (!EDITOR_AUTH.username || !EDITOR_AUTH.password) return res.status(503).end('Editor credentials are not configured');
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) return res.status(401).set('WWW-Authenticate', 'Basic realm="Editor"').end('Auth required');
  const buf = Buffer.from(auth.slice(6), 'base64').toString();
  const [u, p] = buf.split(':');
  if (!constantTimeEqual(u, EDITOR_AUTH.username) || !constantTimeEqual(p, EDITOR_AUTH.password)) return res.status(403).end('Bad auth');
  next();
}

function safePath(p) {
  const resolved = path.resolve(PROJECT_DIR, p || '');
  if (!resolved.startsWith(PROJECT_DIR)) return null;
  return resolved;
}

app.get('/editor/api/list', editorAuth, (req, res) => {
  const dir = safePath(req.query.dir || '');
  if (!dir) return res.status(400).json({ error: 'Invalid path' });
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true }).map(d => ({
      name: d.name,
      dir: d.isDirectory(),
      size: d.isFile() ? fs.statSync(path.join(dir, d.name)).size : 0,
    })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
    res.json({ dir: req.query.dir || '', items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/editor/api/read', editorAuth, (req, res) => {
  const file = safePath(req.query.file);
  if (!file) return res.status(400).json({ error: 'Invalid path' });
  try {
    const content = fs.readFileSync(file, 'utf-8');
    res.json({ content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/editor/api/write', editorAuth, (req, res) => {
  const file = safePath(req.body.file);
  if (!file) return res.status(400).json({ error: 'Invalid path' });
  try {
    fs.writeFileSync(file, req.body.content, 'utf-8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/editor/api/exec', editorAuth, (req, res) => {
  const cmd = req.body.cmd;
  if (!cmd || cmd.length > 500) return res.status(400).json({ error: 'Invalid command' });
  exec(cmd, { cwd: PROJECT_DIR, timeout: 30000 }, (err, stdout, stderr) => {
    res.json({ stdout: stdout || '', stderr: stderr || '', code: err ? err.code : 0 });
  });
});

app.use('/editor', editorAuth, express.static(path.join(__dirname, 'editor')));

app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'dist', 'index.html'), err => {
    if (err) {
      console.error('Error sending index.html:', err.message);
      res.status(500).send('Error loading the app.');
    }
  });
});

// Prefer the APK bundled by the web build. Keep the GitHub release as a
// fallback for older deployments that do not yet contain the public asset.
app.get('/app-debug.apk', (req, res) => {
  const localApk = path.join(__dirname, 'dist', 'app-debug.apk');
  if (fs.existsSync(localApk)) {
    return res.download(localApk, 'laujim-app-debug.apk', {
      headers: { 'Content-Type': 'application/vnd.android.package-archive' },
    });
  }
  res.redirect(302, 'https://github.com/jimcarlos111278-cloud/laujim-app/releases/latest/download/app-debug.apk');
});

app.use(express.static(path.resolve(__dirname, 'dist')));

app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, 'dist', 'index.html'), err => {
    if (err) {
      console.error('Error sending index.html:', err.message);
      res.status(500).send('Error loading the app.');
    }
  });
});

  app.listen(PORT, '0.0.0.0', () => {
    console.log('============================================');
    console.log('  GESTION DE APARTAMENTOS - SERVIDOR');
    console.log('============================================');
    console.log('');
    console.log('  Puerto:    ' + PORT);
    console.log('  Node:      ' + process.version);
    console.log('  Cwd:       ' + process.cwd());
    console.log('============================================');
  });

  (async () => {
    let loaded = false;
    const hasConfiguredDatabase = Boolean(process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL);
    databaseState = hasConfiguredDatabase ? 'connecting' : 'file-mode';
    try {
      if (await initPostgres()) {
        const pgData = await loadFromPostgres();
        if (pgData?.data) {
          // Aiven is the durable source of truth. File mtimes are not reliable
          // after a Render checkout: a stale tracked JSON gets a fresh mtime
          // and would otherwise overwrite newer production data on every deploy.
          db = pgData.data;
          const repairedApartmentFloors = repairApartmentFloors();
          recalcNextId();
          console.log('Data loaded from PostgreSQL (Aiven is source of truth)');
          if (repairedApartmentFloors) await saveToPostgres();
          loaded = true;
          databaseState = 'postgresql';
        }
      }
    } catch (e) {
      databaseError = e.message;
      databaseState = 'error';
      console.error('PostgreSQL init failed:', e.message);
    }
    if (!loaded) {
      // When production has a database configured, never silently serve the
      // initial/local snapshot after a connection failure. That is what made
      // the dashboard look like it had lost all apartments.
      if (hasConfiguredDatabase && !pgPool) {
        databaseReady = false;
        console.error('Server not ready - PostgreSQL is configured but unavailable.');
        return;
      }
      loadData();
      if (pgPool) {
        // Seed Aiven from the local snapshot ONLY when it actually contains
        // data. Pushing an empty/INITIAL_DATA snapshot (or a stale committed
        // file) over a live Aiven store is what caused data to "revert to an
        // old point" after every deploy.
        const hasData = Object.values(db).some(v => Array.isArray(v) && v.length > 0);
        if (hasData) {
          try { await saveToPostgres(); } catch (e) { console.error('PG save error:', e.message); }
        } else {
          console.log('Aiven store empty and no local data to seed; starting fresh.');
        }
        databaseState = 'postgresql';
      } else {
        databaseState = 'file-mode';
      }
    }
    databaseReady = true;
    databaseLoadedAt = new Date().toISOString();
    console.log('Server ready - PostgreSQL: ' + (pgPool ? 'connected' : 'file mode') + `; apartments: ${Array.isArray(db.apartments) ? db.apartments.length : 0}`);

    // Check when the service starts and then once an hour. The log prevents a
    // deployment restart from sending the same scheduled reminder twice.
    runPaymentReminders().catch(error => console.error('[WHATSAPP CLOUD] reminder run error:', error.message));
    setInterval(() => {
      runPaymentReminders().catch(error => console.error('[WHATSAPP CLOUD] reminder run error:', error.message));
    }, 60 * 60 * 1000).unref();
    scheduleAdministrativeDueReminders();

    // Init services scraper with DB reference. In portable mode the phone or
    // PC/VPS owns the browser, so Render must not consume Browserless quota.
    servicesScraper.init(db, saveData);
    applyServiceExecutionMode();

  })();
}

if (require.main === module) startServer();

module.exports = {
  buildAdminDebtReport,
  buildCloudGlobalServicesReport,
  buildCloudServicesImageData,
  buildCloudApartmentServicesInfo,
  renderCloudServicesReportImage,
  cloudAdminGreeting,
  cloudApartmentFloor,
  cloudServiceState,
  confirmCloudRentPayments,
  registerCloudUnexpectedExpense,
  registerCloudRentPayment,
  parseCloudMoney,
  splitCloudText,
  cloudServiceAmounts,
  cloudServicesReportImageHtml,
  utilityChangeTemplateData,
  utilityPaymentDecision,
  mergeUtilityRecord,
};
