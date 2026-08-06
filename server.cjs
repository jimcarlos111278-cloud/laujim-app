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
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 1011;
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;
let requestCount = 0;

process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err.message, err.stack); });
process.on('unhandledRejection', (reason) => { console.error('UNHANDLED:', reason); });

app.get('/health', (req, res) => res.send('ok'));

app.use(cors({ exposedHeaders: ['x-auth-token'], allowedHeaders: ['Content-Type', 'x-auth-token'] }));
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) requestCount++;
  const isPublicApi = req.path === '/api/login' || req.path === '/api/version' ||
    req.path.startsWith('/api/public/') || req.path === '/api/whatsapp/webhook';
  if (req.path.startsWith('/api/') && !isPublicApi) {
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
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const bucket = String(process.env.R2_BUCKET || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const endpoint = String(process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')).trim();
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

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

function samePhone(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return left && right && (left === right || left.slice(-10) === right.slice(-10));
}

function tenantBelongsToApartment(tenant, apartmentId) {
  if (Number(tenant?.apartmentId) === Number(apartmentId)) return true;
  return (db.contracts || []).some(c =>
    Number(c.tenantId) === Number(tenant?.id) &&
    Number(c.apartmentId) === Number(apartmentId) &&
    c.status !== 'terminated' && c.status !== 'cancelled' &&
    (!c.endDate || new Date(c.endDate).getTime() >= Date.now())
  );
}

function ensureCloudCollections() {
  for (const name of ['whatsappContacts', 'whatsappConversations', 'whatsappMessages', 'whatsappAuthStates', 'whatsappBlockedUsers', 'whatsappProcessedMessages', 'paymentReminderLogs']) {
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
    expiresAt: state.expiresAt,
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

function isCloudBlocked(phone) {
  ensureCloudCollections();
  return db.whatsappBlockedUsers.some(item => samePhone(item.phone, phone));
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
  if (explicit) return explicit;

  const tenant = (db.tenants || []).find(t => samePhone(t.phone, phone));
  if (!tenant) return null;
  const contract = (db.contracts || []).find(c => Number(c.tenantId) === Number(tenant.id) &&
    c.status !== 'terminated' && c.status !== 'cancelled' &&
    (!c.endDate || new Date(c.endDate).getTime() >= Date.now()));
  return {
    phone: normalizePhone(phone),
    tenantId: tenant.id,
    apartmentId: contract?.apartmentId ?? tenant.linkedAptId ?? null,
    source: 'database',
  };
}

function getCloudConversation(contact) {
  ensureCloudCollections();
  let conversation = db.whatsappConversations.find(c => samePhone(c.phone, contact.phone));
  if (!conversation) {
    conversation = { id: nextId.whatsappConversations++, phone: normalizePhone(contact.phone), tenantId: contact.tenantId,
      apartmentId: contact.apartmentId, status: 'active', createdAt: new Date().toISOString(), lastInboundAt: null,
      customerServiceWindowUntil: null };
    db.whatsappConversations.push(conversation);
  }
  return conversation;
}

function addCloudMessage(conversation, direction, message) {
  ensureCloudCollections();
  const record = { id: nextId.whatsappMessages++, conversationId: conversation.id, direction,
    type: message.type || 'text', text: message.text || '', mediaId: message.mediaId || null,
    media: message.media || null,
    whatsappMessageId: message.whatsappMessageId || null, createdAt: new Date().toISOString() };
  db.whatsappMessages.push(record);
  return record;
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
  if (!cloudReady()) return Promise.reject(new Error('WhatsApp Cloud API no estÃ¡ configurada'));
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
        } catch { reject(new Error('Respuesta invÃ¡lida de Cloud API')); }
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

async function archiveCloudInboundMedia(media) {
  if (!media?.id) return media;
  try {
    const file = await downloadCloudMedia(media.id);
    const stored = await putR2Buffer({
      section: 'whatsapp/inbound', fileName: media.fileName || `whatsapp-${media.id}`,
      buffer: file.buffer, mimeType: media.mimeType || file.mimeType,
    });
    return { ...media, ...stored, archiveStatus: 'stored' };
  } catch (error) {
    console.error('[R2] inbound WhatsApp media archive error:', error.message);
    return { ...media, archiveStatus: 'pending_or_failed', archiveError: error.message };
  }
}

function uploadCloudMedia(file) {
  const c = cloudConfig();
  if (!cloudReady()) return Promise.reject(new Error('WhatsApp Cloud API no estÃ¡ configurada'));
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
        } catch { reject(new Error('Respuesta invÃ¡lida al cargar el archivo')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('La carga del archivo tardÃ³ demasiado')));
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
    messaging_product: 'whatsapp', to: normalizePhone(to), type, [type]: content,
  });
}

function sendCloudText(to, body) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'text', text: { body },
  });
}

function firstName(name) {
  return String(name || 'hola').trim().split(/\s+/)[0] || 'hola';
}

function sendCloudGreetingTemplate(to, name) {
  const templateName = String(process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino').trim();
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'template',
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
// tenant's first name and the payment period as body variables.
function sendCloudPaymentReminderTemplate(to, name, period) {
  const templateName = String(process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago').trim();
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'template',
    template: {
      name: templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: [
        { type: 'text', text: firstName(name) },
        { type: 'text', text: cloudPeriodLabel(period) },
      ] }],
    },
  });
}

function colombiaDate(date = new Date()) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${values.year}-${values.month}-${values.day}`;
}

function paymentPeriod(payment) {
  return String(payment?.period || payment?.date || '').slice(0, 7);
}

function paymentCountsAsCollected(payment) {
  return payment?.status !== 'pending_validation' && payment?.status !== 'rejected';
}

function activeContractForApartment(apartmentId) {
  const now = Date.now();
  return (db.contracts || []).find(contract => Number(contract.apartmentId) === Number(apartmentId) &&
    contract.status !== 'terminated' && contract.status !== 'cancelled' &&
    (!contract.endDate || new Date(contract.endDate).getTime() >= now));
}

function paymentReminderOffsets(apartment) {
  const offsets = Array.isArray(apartment?.paymentReminderDays) ? apartment.paymentReminderDays : [-3, 0, 3];
  return [...new Set(offsets.map(Number).filter(day => Number.isInteger(day) && day >= -15 && day <= 31))];
}

async function runPaymentReminders({ force = false } = {}) {
  ensureCloudCollections();
  const today = colombiaDate();
  const period = today.slice(0, 7);
  const [year, month] = period.split('-').map(Number);
  const result = { checked: 0, sent: 0, skipped: 0, failed: 0, period };
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
      if (!force && db.paymentReminderLogs.some(log => log.key === key)) { result.skipped++; continue; }
      const alreadyPaid = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment.id) &&
        payment.type === 'rent' && paymentPeriod(payment) === period && paymentCountsAsCollected(payment));
      const awaitingReview = (db.payments || []).some(payment => Number(payment.apartmentId) === Number(apartment.id) &&
        payment.type === 'rent' && paymentPeriod(payment) === period && payment.status === 'pending_validation');
      if (alreadyPaid || awaitingReview) { result.skipped++; continue; }
      const log = { id: nextId.paymentReminderLogs++, key, apartmentId: apartment.id, tenantId: tenant.id, period, offset,
        createdAt: new Date().toISOString(), status: 'sent' };
      try {
        const sent = await sendCloudPaymentReminderTemplate(tenant.phone, tenant.name, period);
        const conversation = getCloudConversation({ phone: tenant.phone, tenantId: tenant.id, apartmentId: apartment.id });
        addCloudMessage(conversation, 'out', { type: 'template', text: `Recordatorio de pago (${period})`,
          template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago', whatsappMessageId: sent.messages?.[0]?.id || null });
        db.paymentReminderLogs.push(log);
        result.sent++;
      } catch (error) {
        db.paymentReminderLogs.push({ ...log, status: 'failed', error: error.message });
        result.failed++;
        console.error('[WHATSAPP CLOUD] payment reminder error:', error.message);
      }
    }
  }
  saveData();
  return result;
}

function cloudInteractiveReply(message) {
  const reply = message?.interactive?.button_reply || message?.interactive?.list_reply;
  return reply ? { id: String(reply.id || ''), title: String(reply.title || '') } : null;
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
  const details = {
    apartmentId: Number(conversation.apartmentId), contractId: contract?.id || null, tenantId: conversation.tenantId || null,
    amount: Number(contract?.monthlyRent || apartment?.monthlyRent || 0), date: colombiaDate(), period, type: 'rent',
    paymentMode: 'full', status: 'pending_validation', origin: 'whatsapp', submittedAt,
    receiptMedia: media, receiptMessageId: messageId,
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
      messaging_product: 'whatsapp', block_users: [{ user: normalized }],
    });
    record.remoteBlocked = true;
  } catch (error) {
    console.error('[WHATSAPP CLOUD] block user error:', error.message);
  }
  saveData();
  return record;
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

// ── Debt query intent (servicios públicos) ────────────────────────────────
const DEBT_QUERY_RE =
  /(?:cu[aá]nto\s+(?:debo|debe|vale|es|hay\s+que\s+pagar)|deuda|deudas|factura|facturas|servicios|energ[ií]a|aire|recibo|recibos)/i;

function isDebtQuery(text) {
  return DEBT_QUERY_RE.test(String(text || '').trim());
}

function buildDebtReply(contact) {
  const aptId = Number(contact.apartmentId);
  const apt = (db.apartments || []).find(a => Number(a.id) === aptId);
  const nic = apt?.electricityPaymentCode || apt?.nic || '';
  const records = (db.utilityRecords || [])
    .filter(r => r.provider === 'Air-e' && (r.nic === nic || (apt && r.apartment === apt.name)))
    .sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
  const latest = records[0];
  if (!latest) {
    return 'No tengo datos de tu deuda de servicios en este momento. Si acabas de sincronizar, espera unos minutos y vuelve a preguntar.';
  }
  const debt = Number(latest.deudaCOP || 0);
  const facturas = Number(latest.numFacturas || 0);
  const when = latest.scrapedAt ? new Date(latest.scrapedAt).toLocaleString('es-CO', { dateStyle: 'short' }) : '';
  if (debt <= 0) {
    return `Tu deuda de energía (Air-e) está al día 🎉 (0 facturas pendientes). Datos del ${when}.`;
  }
  return `Tu deuda de energía (Air-e) es de $${debt.toLocaleString('es-CO')}, correspondiente a ${facturas} factura${facturas === 1 ? '' : 's'} pendiente${facturas === 1 ? '' : 's'} (valor máximo de factura). Datos del ${when}.`;
}

async function handleCloudInbound(message) {
  const phone = normalizePhone(message.from);
  if (!phone || isCloudMessageProcessed(message.id)) return;
  markCloudMessageProcessed(message.id);
  pruneCloudCollections();

  if (isCloudBlocked(phone)) {
    saveData();
    return;
  }

  const known = authorizedCloudContact(phone);
  if (known) {
    const conversation = getCloudConversation(known);
    conversation.lastInboundAt = new Date().toISOString();
    conversation.customerServiceWindowUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const type = message.type || 'unknown';
    const interactive = cloudInteractiveReply(message);
    // Content and media identifiers are persisted only after authorization.
    const media = await archiveCloudInboundMedia(cloudInboundMedia(message, type));
    const incoming = addCloudMessage(conversation, 'in', {
      type, text: type === 'text' ? (message.text?.body || '') : (interactive?.title || media?.caption || ''),
      mediaId: media?.id || null, media, whatsappMessageId: message.id,
    });
    const writtenConfirmation = type === 'text' && /^(?:ya\s+)?(?:lo\s+)?pag(?:u[eé]|ue)(?:\.|\s|$)/i.test(message.text?.body || '');
    const confirmedWithButton = type === 'interactive' && (interactive?.id === 'payment_confirmed' || /^ya\s+pag(?:u[eé]|ue)/i.test(interactive?.title || ''));
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
    if (confirmedWithButton || writtenConfirmation) {
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
    if (media && paymentProofIsActive(conversation)) {
      const payment = createPendingPaymentFromProof(conversation, media, incoming.id);
      if (payment) {
        conversation.paymentProofRequestedAt = null;
        conversation.paymentProofPeriod = null;
        console.log(`[WHATSAPP CLOUD] payment proof pending validation: ${payment.id}`);
      }
    }
    saveData();
    return;
  }

  const state = getCloudAuthState(phone);
  const text = message.type === 'text' ? String(message.text?.body || '').trim() : '';
  if (!state || new Date(state.expiresAt).getTime() < Date.now()) {
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
  saveData();
  await sendCloudText(phone, '✅ Identidad verificada. Desde ahora tus mensajes llegarán al administrador por este canal.');
}

// ─── PostgreSQL persistence ───
let pgPool = null;

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
  const result = await pgPool.query('SELECT value FROM store WHERE key = $1', ['database']);
  if (result.rows.length > 0) {
    return result.rows[0].value;
  }
  return null;
}

async function saveToPostgres() {
  if (!pgPool) return;
  await pgPool.query(
    'INSERT INTO store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    ['database', JSON.stringify(db)]
  );
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
  ['messages', 'payments', 'expenses', 'leads', 'settings', 'authSessions', 'presence', 'paymentReminderLogs'].forEach(k => { if (!db[k]) db[k] = []; });
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
  if (pgPool) {
    saveToPostgres().catch(e => console.error('PG save error:', e.message));
  }
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

app.get('/api/data/all', (req, res) => {
  res.json(JSON.parse(JSON.stringify(db)));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = process.env.ADMIN_USERNAME || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (adminUsername && adminPassword && constantTimeEqual(username, adminUsername) && constantTimeEqual(password, adminPassword)) {
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
  const apt = (db.apartments || []).find(a => a.name === apartmentLogin || String(a.id) === apartmentLogin);
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
  res.json({ apartment, tenant, contract, payments });
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
      { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List' },
    ],
  });
});

// ── SERVICIOS PÚBLICOS (Air-e, Triple A, Gases del Caribe) ──
const SERVICES_CONFIG = {
  water:      { id: 'water', name: 'Agua', provider: 'Triple A', url: 'https://portal.aaa.com.co/polizas' },
  gas:        { id: 'gas', name: 'Gas', provider: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
  electricity:{ id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List' },
};

// Get all utility records for an apartment (admin)
app.get('/api/services/utility-records/:apartmentId', (req, res) => {
  const aptId = Number(req.params.apartmentId);
  if (!db.utilityRecords) db.utilityRecords = [];
  const records = db.utilityRecords.filter(r => {
    // Match by apartment name (e.g. "101", "201") or by electricityPaymentCode
    const apt = db.apartments.find(a => a.id === aptId);
    if (!apt) return false;
    return r.apartment === apt.name || r.nic === (apt.electricityPaymentCode || apt.nic);
  });
  // Sort by scrapedAt DESC, then by periodo DESC
  records.sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || '') || (b.periodo || '').localeCompare(a.periodo || ''));
  res.json(records);
});

// Get latest utility status for all apartments (admin)
app.get('/api/utility-status', (req, res) => {
  if (!db.utilityRecords) db.utilityRecords = [];
  const apts = db.apartments || [];
  const status = apts.map(apt => {
    const records = db.utilityRecords.filter(r =>
      r.apartment === apt.name || r.nic === (apt.electricityPaymentCode || apt.nic)
    );
    const latest = records.length > 0 ? records.reduce((a, b) =>
      (b.scrapedAt || '').localeCompare(a.scrapedAt || '') > 0 ? b : a
    ) : null;

    return {
      id: apt.id,
      name: apt.name,
      electricity: latest && latest.provider === 'Air-e'
        ? {
            deudaCOP: latest.deudaCOP,
            numFacturas: latest.numFacturas,
            deudaText: latest.deudaText,
            nic: latest.nic,
            scrapedAt: latest.scrapedAt,
          }
        : null,
      // Triple A and Gases will be populated later
      water: null,
      gas: null,
    };
  });
  res.json(status);
});

// Trigger Air-e scrape manually (admin only, via auth)
app.post('/api/scrape-air-e', async (req, res) => {
  try {
    res.json({ ok: true, message: 'Scrape iniciado. Los resultados se guardarán en utilityRecords.' });
    const results = await servicesScraper.scrapeAirE();
    // Persist results (one current-debt record per NIC)
    if (!db.utilityRecords) db.utilityRecords = [];
    for (const r of results) {
      const existing = db.utilityRecords.findIndex(
        (u) => u.nic === r.nic && u.provider === 'Air-e'
      );
      if (existing >= 0) {
        db.utilityRecords[existing] = { ...db.utilityRecords[existing], ...r };
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

// Public URL for services admin (for residents' individual link)
app.get('/api/public/utility-status/:apartmentId', (req, res) => {
  const aptId = Number(req.params.apartmentId);
  const apt = db.apartments.find(a => a.id === aptId);
  if (!apt) return res.status(404).json({ error: 'Apartamento no encontrado' });

  // Only return public info (no credentials)
  const svcConfig = {
    water: { id: 'water', name: 'Agua', provider: 'Triple A', url: 'https://portal.aaa.com.co/poliz' },
    gas: { id: 'gas', name: 'Gas', provider: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
    electricity: { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List' },
  };

  let electricityInfo = null;
  const correctNic = apt.electricityPaymentCode || apt.nic || '';
  if (correctNic && db.utilityRecords) {
    const elecRecords = db.utilityRecords
      .filter(r => r.nic === correctNic && r.provider === 'Air-e')
      .sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
    if (elecRecords.length > 0) {
      const latest = elecRecords[0];
      electricityInfo = {
        deudaCOP: latest.deudaCOP,
        numFacturas: latest.numFacturas,
        deudaText: latest.deudaText,
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
      water: { ...svcConfig.water, payCode: apt.waterPaymentCode || '' },
      gas: { ...svcConfig.gas, payCode: apt.gasPaymentCode || '' },
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
  res.json(db.whatsappConversations.map(c => {
    const tenant = (db.tenants || []).find(t => Number(t.id) === Number(c.tenantId));
    const apartment = (db.apartments || []).find(a => Number(a.id) === Number(c.apartmentId));
    return { ...c, tenantName: tenant?.name || 'Inquilino autorizado', apartmentName: apartment?.name || null,
      messages: (db.whatsappMessages || []).filter(m => m.conversationId === c.id).slice(-1) };
  }));
});

app.get('/api/whatsapp/cloud/contacts', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const now = Date.now();
  const contacts = (db.tenants || []).map(tenant => {
    const contract = (db.contracts || []).find(c => Number(c.tenantId) === Number(tenant.id) &&
      c.status !== 'terminated' && c.status !== 'cancelled' && (!c.endDate || new Date(c.endDate).getTime() >= now));
    if (!tenant.phone) return null;
    const apartmentId = contract?.apartmentId ?? tenant.linkedAptId ?? null;
    const apartment = (db.apartments || []).find(a => Number(a.id) === Number(apartmentId));
    const conversation = (db.whatsappConversations || []).find(c => samePhone(c.phone, tenant.phone));
    const explicit = (db.whatsappContacts || []).find(c => samePhone(c.phone, tenant.phone));
    const windowOpen = !!conversation?.customerServiceWindowUntil && new Date(conversation.customerServiceWindowUntil).getTime() > now;
    return { tenantId: tenant.id, name: tenant.name || 'Inquilino', phone: normalizePhone(tenant.phone), apartmentId,
      apartmentName: apartment?.name || null, activeContract: !!contract, conversationId: conversation?.id || null,
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
  if (conversation.customerServiceWindowUntil && new Date(conversation.customerServiceWindowUntil).getTime() > now) {
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

app.get('/api/whatsapp/cloud/conversations/:id/messages', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const id = Number(req.params.id);
  if (!db.whatsappConversations.some(c => c.id === id)) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json((db.whatsappMessages || []).filter(m => m.conversationId === id));
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

app.post('/api/whatsapp/cloud/payment-validations/:id/approve', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  if (payment.status !== 'pending_validation') return res.status(409).json({ error: 'Este comprobante ya fue revisado' });
  const amount = req.body?.amount === undefined ? payment.amount : Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'El valor aprobado debe ser mayor que cero' });
  payment.amount = amount;
  payment.status = 'approved';
  payment.approvedAt = new Date().toISOString();
  payment.approvedBy = req.auth?.name || 'Administrador';
  payment.updatedAt = payment.approvedAt;
  saveData();
  res.json(payment);
});

app.post('/api/whatsapp/cloud/payment-validations/:id/reject', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  const payment = (db.payments || []).find(item => Number(item.id) === Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado' });
  if (payment.status !== 'pending_validation') return res.status(409).json({ error: 'Este comprobante ya fue revisado' });
  payment.status = 'rejected';
  payment.rejectedAt = new Date().toISOString();
  payment.rejectedBy = req.auth?.name || 'Administrador';
  payment.rejectionReason = String(req.body?.reason || '').trim();
  payment.updatedAt = payment.rejectedAt;
  saveData();
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
  if (!conversation.customerServiceWindowUntil || new Date(conversation.customerServiceWindowUntil).getTime() < Date.now()) {
    return res.status(409).json({ error: 'La ventana gratuita de servicio terminó; se requiere una plantilla aprobada.' });
  }
  try {
    const result = await sendCloudText(conversation.phone, String(text).trim());
    const message = addCloudMessage(conversation, 'out', { type: 'text', text: String(text).trim(), whatsappMessageId: result.messages?.[0]?.id || null });
    saveData(); res.json({ ok: true, id: result.messages?.[0]?.id || null, message });
  } catch (error) { res.status(502).json({ error: error.message }); }
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
  const tenant = (db.tenants || []).find(item => Number(item.id) === Number(conversation.tenantId));
  try {
    let result;
    let message;
    if (template === 'greeting') {
      result = await sendCloudGreetingTemplate(conversation.phone, tenant?.name);
      message = addCloudMessage(conversation, 'out', {
        type: 'template', text: `Hola, ${firstName(tenant?.name)}, ¿cómo estás? ¿Podemos hablar un momento?`,
        template: process.env.WHATSAPP_GREETING_TEMPLATE || 'saludo_inquilino',
        whatsappMessageId: result.messages?.[0]?.id || null,
      });
    } else {
      const period = String(req.body?.period || colombiaDate().slice(0, 7));
      result = await sendCloudPaymentReminderTemplate(conversation.phone, tenant?.name, period);
      message = addCloudMessage(conversation, 'out', {
        type: 'template', text: `Recordatorio de pago — ${cloudPeriodLabel(period)}`,
        template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'recordatorio_pago',
        whatsappMessageId: result.messages?.[0]?.id || null,
      });
    }
    saveData();
    res.json({ ok: true, id: result.messages?.[0]?.id || null, message });
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
    if (!conversation.customerServiceWindowUntil || new Date(conversation.customerServiceWindowUntil).getTime() < Date.now()) {
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
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (adminPassword && constantTimeEqual(password, adminPassword)) {
    return res.json({ ok: true, role: 'admin', name: 'Administrador' });
  }
  res.status(401).json({ error: 'Contraseña inválida' });
});

app.post('/api/admin/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword || !constantTimeEqual(currentPassword, adminPassword)) {
    return res.status(401).json({ error: 'Contraseña actual inválida' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  return res.status(409).json({ error: 'Actualiza ADMIN_PASSWORD en Render; las contraseñas no se guardan en la base de datos.' });
  const setting = (db.settings || []).find(s => s.key === 'admin_password');
  if (setting) {
    setting.value = newPassword;
  } else {
    db.settings.push({ id: nextId.settings || 1, key: 'admin_password', value: newPassword });
    nextId.settings = (nextId.settings || 1) + 1;
  }
  saveData();
  res.json({ ok: true, message: 'Contraseña actualizada' });
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
app.delete('/api/tenants/:id', (req, res) => {
  const id = Number(req.params.id);
  const index = (db.tenants || []).findIndex(t => t.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  db.tenants.splice(index, 1);
  const linkedContracts = (db.contracts || []).filter(c => c.tenantId === id);
  for (const contract of linkedContracts) {
    const pwdIdx = (db.passwords || []).findIndex(p => p.apartmentId === contract.apartmentId);
    if (pwdIdx !== -1) db.passwords.splice(pwdIdx, 1);
  }
  saveData();
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
  db[col].push(newItem);
  nextId[col] = (nextId[col] || 1) + 1;
  saveData();
  res.status(201).json(newItem);
});

app.put('/api/:collection/:id', (req, res) => {
  const { collection, id } = req.params;
  if (!db[collection]) return res.status(404).json({ error: 'Collection not found' });
  const index = db[collection].findIndex(i => i.id === Number(id));
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  db[collection][index] = { ...db[collection][index], ...req.body };
  saveData();
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

// APKs are published as GitHub Release assets so deployments stay light while
// the stable in-app URL always points to the most recent Android installer.
app.get('/app-debug.apk', (req, res) => {
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
    try {
      if (await initPostgres()) {
        const pgData = await loadFromPostgres();
        if (pgData) {
          db = pgData;
          recalcNextId();
          console.log('Data loaded from PostgreSQL');
          loaded = true;
        }
      }
    } catch (e) {
      console.error('PostgreSQL init failed, using JSON file:', e.message);
    }
    if (!loaded) {
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
      }
    }
    console.log('Server ready - PostgreSQL: ' + (pgPool ? 'connected' : 'file mode'));

    // Check when the service starts and then once an hour. The log prevents a
    // deployment restart from sending the same scheduled reminder twice.
    runPaymentReminders().catch(error => console.error('[WHATSAPP CLOUD] reminder run error:', error.message));
    setInterval(() => {
      runPaymentReminders().catch(error => console.error('[WHATSAPP CLOUD] reminder run error:', error.message));
    }, 60 * 60 * 1000).unref();

    // Init services scraper with DB reference and start 24h scheduler
    servicesScraper.init(db, saveData);
    servicesScraper.startScheduler();

  })();
}

startServer();
