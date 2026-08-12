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

const app = express();
const PORT = process.env.PORT || 1011;
const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)) * 60 * 60 * 1000;
let requestCount = 0;
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
  if (req.path.startsWith('/api/')) requestCount++;
  const isPublicApi = req.path === '/api/login' || req.path === '/api/version' ||
    req.path === '/api/ready' || req.path.startsWith('/api/public/') || req.path === '/api/whatsapp/webhook';
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

function sendCloudInteractiveList(to, body, buttonTitle, sections) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'interactive',
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

const CLOUD_ADMIN_WHATSAPP_URL = 'https://laujim-app.onrender.com/whatsapp';

function sendCloudAdminAccessButton(to, body) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'interactive',
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
// tenant's first name and the payment period as body variables, plus two
// reply buttons: "Ya pagué" (id: payment_confirmed) and "No he pagado"
// (id: payment_pending). The buttons are defined in the template itself.
function cloudTemplateDebtValue(state) {
  if (state?.debt !== null && state?.debt !== undefined && Number.isFinite(Number(state.debt))) {
    return '$' + Number(state.debt).toLocaleString('es-CO');
  }
  if (state?.known) return '$0 · Al día';
  return 'Sin dato confirmado';
}

function cloudPaymentTemplateData(apartment, period) {
  const summary = cloudApartmentServices(apartment);
  const { contract, amount } = cloudRentAmount(apartment);
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
    parameters: [
      { type: 'text', text: firstName(apartment?.tenantName || '') },
      { type: 'text', text: String(apartment?.name || '—') },
      { type: 'text', text: cloudPeriodLabel(periodKey) },
      { type: 'text', text: '$' + Number(amount || 0).toLocaleString('es-CO') },
      { type: 'text', text: cloudFormatFullDate(colombiaDate(dueDate)) },
      { type: 'text', text: rentStatus },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.electricity) },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.water) },
      { type: 'text', text: cloudTemplateDebtValue(summary.states.gas) },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.electricity, 'electricity') },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.water, 'water') },
      { type: 'text', text: cloudServicePaymentLink(apartment, summary.records.gas, 'gas') },
    ],
  };
}

// Create and approve this body in WhatsApp Manager as `cobro_canon_servicios`.
// Variable order: name, apartment, period, rent, due date, rent status,
// Air-e debt, Triple A debt, gas debt, and the three payment URLs. The body
// should end by asking the tenant to attach the rent payment proof.
function sendCloudPaymentReminderTemplate(to, name, period, apartment = null) {
  const templateName = String(process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios').trim();
  const resolvedApartment = apartment || {};
  const data = cloudPaymentTemplateData(resolvedApartment, period);
  if (name) data.parameters[0].text = firstName(name);
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'template',
    template: {
      name: templateName, language: { code: 'es_CO' },
      components: [{ type: 'body', parameters: data.parameters }],
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
        const sent = await sendCloudPaymentReminderTemplate(tenant.phone, tenant.name, period, apartment);
        const conversation = getCloudConversation({ phone: tenant.phone, tenantId: tenant.id, apartmentId: apartment.id });
        addCloudMessage(conversation, 'out', { type: 'template', text: `Recordatorio de pago (${period})`,
          template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios', whatsappMessageId: sent.messages?.[0]?.id || null });
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

// Shared service-record helpers must live outside startServer(). The WhatsApp
// admin handlers are declared before startServer and use the same records as
// the HTTP utility endpoints.
function latestUtilityRecord(provider, apartment) {
  const records = (db.utilityRecords || []).filter(record =>
    record.provider === provider &&
    (Number(record.apartmentId) === Number(apartment?.id) || record.apartment === apartment?.name)
  );
  return records.sort((a, b) => new Date(b.checkedAt || b.scrapedAt || b.updatedAt || 0) - new Date(a.checkedAt || a.scrapedAt || a.updatedAt || 0))[0] || null;
}

function utilityDebtAmount(record) {
  if (!record) return null;
  // Prefer explicit total-debt fields. numFacturas is metadata and must never
  // be interpreted as a currency value.
  const fields = [
    'deudaTotalCOP', 'totalDeudaCOP', 'saldoTotalCOP', 'deudaCOP',
    'totalCOP', 'saldoCOP', 'amountCOP', 'valorCOP', 'deudaTotal',
    'deuda', 'total', 'amount', 'valor',
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

function utilityPaymentView(record) {
  if (!record) return null;
  const checkedAt = record.checkedAt || record.scrapedAt || record.updatedAt || null;
  return {
    status: record.status || 'unknown',
    deudaCOP: utilityDebtAmount(record),
    numFacturas: Number(record.numFacturas) || (record.status === 'pending' ? 1 : 0),
    factura: record.factura || record.invoiceNumber || null,
    periodo: record.periodo || record.period || null,
    actualizado: checkedAt,
    checkedAt,
    error: record.error || null,
  };
}

function buildDebtReply(contact) {
  const aptId = Number(contact.apartmentId);
  const apt = (db.apartments || []).find(a => Number(a.id) === aptId);
  const nic = apt?.electricityPaymentCode || apt?.nic || '';
  const directElectricityRecords = (db.utilityRecords || [])
    .filter(r => r.provider === 'Air-e' && apt &&
      (Number(r.apartmentId) === Number(apt.id) || r.apartment === apt.name));
  const electricityRecords = (directElectricityRecords.length ? directElectricityRecords : (db.utilityRecords || [])
    .filter(r => r.provider === 'Air-e' && !r.apartmentId && !r.apartment && r.nic === nic))
    .sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
  const electricity = electricityRecords[0] || null;
  const water = latestUtilityRecord('Triple A', apt);
  const gas = latestUtilityRecord('Gases del Caribe', apt);
  if (!electricity && !water && !gas) {
    return 'No tengo datos de tu deuda de servicios en este momento. Si acabas de sincronizar, espera unos minutos y vuelve a preguntar.';
  }

  const utilityLine = (label, record, paidText) => {
    if (!record) return `${label}: sin datos de consulta.`;
    const debt = utilityDebtAmount(record);
    const facturas = Number(record.numFacturas) || (record.status === 'pending' ? 1 : 0);
    const isTotalDebt = record.provider === 'Air-e' || record.deudaLabel === 'Deuda Total';
    const checkedAt = record.checkedAt || record.scrapedAt || record.updatedAt;
    const when = checkedAt && !Number.isNaN(new Date(checkedAt).getTime())
      ? ` Datos del ${new Date(checkedAt).toLocaleString('es-CO', { dateStyle: 'short' })}.`
      : '';
    if (debt !== null && debt > 0) {
      if (isTotalDebt) {
        return `${label}: Deuda Total de $${debt.toLocaleString('es-CO')}.${when}`;
      }
      return `${label}: deuda de $${debt.toLocaleString('es-CO')}, correspondiente a ${facturas} factura${facturas === 1 ? '' : 's'} pendiente${facturas === 1 ? '' : 's'}.${when}`;
    }
    if (record.status === 'pending') {
      if (isTotalDebt) {
        return `${label}: Deuda Total pendiente; el portal no informó el valor.${when}`;
      }
      return `${label}: hay ${facturas || 1} factura${facturas === 1 ? '' : 's'} pendiente${facturas === 1 ? '' : 's'}, pero el portal no informó el valor.${when}`;
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

function cloudApartmentsForFloor(floor) {
  return occupiedCloudApartments().filter(apartment => cloudApartmentFloor(apartment) === Number(floor));
}

function cloudListSections(title, rows) {
  return [{ title, rows }];
}

function cloudServicePaymentLink(apartment, record, service) {
  const fieldByService = {
    electricity: 'electricityPaymentUrl',
    water: 'waterPaymentUrl',
    gas: 'gasPaymentUrl',
  };
  const recordField = fieldByService[service];
  const configured = record?.[recordField] || apartment?.[recordField];
  if (configured) return String(configured);
  if (service === 'electricity') {
    const nic = apartment?.electricityPaymentCode || apartment?.nic;
    if (nic) return `https://portal.air-e.com/Pagar#/User/${encodeURIComponent(nic)}/NUMEROCONTRATO`;
  }
  if (service === 'gas' && apartment?.gasPaymentCode) return 'https://portal.gascaribe.com/payments';
  return 'No configurado';
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
        description: `${cloudApartmentsForFloor(floor).length} apartamento(s) configurado(s)`,
      })),
      { id: 'services_back', title: '↩️ Servicios', description: 'Volver a opciones de servicios' },
    ]));
  } catch (error) {
    console.error('[WHATSAPP CLOUD] services floors menu error:', error.message);
    await sendCloudText(phone, `${body}\n• "piso 1" ... "piso 5" → seleccionar piso\n• Escribe 403 → consulta directa\n• "SALIR" → menú principal`);
  }
}

async function sendCloudServiceApartmentsMenu(phone, floor) {
  const apartments = cloudApartmentsForFloor(floor);
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
    const updatedAt = record?.checkedAt || record?.scrapedAt || record?.updatedAt;
    lines.push('', `${service.icon} *${service.label}:* ${state.label}`);
    lines.push(cloudServiceReference(apartment, record, service.key));
    if (updatedAt) lines.push(`Actualizado: ${new Date(updatedAt).toLocaleString('es-CO')}`);
    lines.push(`💳 *${service.paymentLabel}:* ${cloudServicePaymentLink(apartment, record, service.key)}`);
  }
  return lines.join('\n');
}

function buildCloudDetailedGlobalServicesReport() {
  const summaries = occupiedCloudApartments().map(cloudApartmentServices);
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
    'ℹ️ Todos los valores se muestran como *Deuda Total*. Los datos no confirmados pueden revisarse manualmente por apartamento.',
  ].filter(Boolean).join('\n\n');
}

function buildCloudDetailedApartmentServicesInfo(apartment) {
  const summary = cloudApartmentServices(apartment);
  return [
    `📊 *Servicios — Apartamento ${apartment.name}*`,
    '',
    cloudServiceDisplayBlock(summary),
    '',
    'ℹ️ Todos los valores corresponden a *Deuda Total*.',
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
  if (process.env.LAUJIM_LEGACY_SERVICE_REPORT !== 'true') return buildCloudDetailedGlobalServicesReport();
  const summaries = (db.apartments || [])
    .map(cloudApartmentServices)
    .sort((left, right) => String(left.apartment.name).localeCompare(String(right.apartment.name), 'es', { numeric: true }));
  const debt = summaries.filter(summary => Object.values(summary.states).some(state => state.hasDebt));
  const pending = summaries.filter(summary => !debt.includes(summary) && Object.values(summary.states).some(state => !state.known));
  const paid = summaries.filter(summary => !debt.includes(summary) && !pending.includes(summary));
  const period = cloudPeriodLabel(colombiaDate().slice(0, 7));
  const section = (title, entries) => entries.length
    ? [`${title} (${entries.length}):`, ...entries.map(cloudApartmentServicesLine)].join('\n\n')
    : '';
  return [
    `📊 *Reporte global de servicios — ${period}*`,
    section('🔴 *DEUDAS CONFIRMADAS*', debt),
    section('🟡 *PENDIENTES / SIN DATOS*', pending),
    section('🟢 *AL DÍA*', paid),
    '━━━━━━━━━━━━━━━━━━━━',
    'Los valores de Air-e corresponden a *Deuda Total*. Las consultas sin datos pueden revisarse manualmente por apartamento.',
  ].filter(Boolean).join('\n\n');
}

function buildCloudApartmentServicesInfo(apartment) {
  if (process.env.LAUJIM_LEGACY_SERVICE_REPORT !== 'true') return buildCloudDetailedApartmentServicesInfo(apartment);
  const summary = cloudApartmentServices(apartment);
  const { records, states } = summary;
  return [
    `🏢 *Apartamento ${apartment.name}*`,
    '',
    '*⚡ Energía (Air-e)*',
    `   NIC: ${apartment.nic || apartment.electricityPaymentCode || '—'}`,
    `   ${states.electricity.label}`,
    records.electricity?.scrapedAt ? `   Actualizado: ${new Date(records.electricity.scrapedAt).toLocaleString('es-CO')}` : '',
    apartment.electricityPaymentUrl ? `   Pago: ${apartment.electricityPaymentUrl}` : '',
    '',
    '*💧 Agua (Triple A)*',
    `   N° Póliza: ${apartment.waterPaymentCode || '—'}`,
    `   ${states.water.label}`,
    records.water?.checkedAt ? `   Actualizado: ${new Date(records.water.checkedAt).toLocaleString('es-CO')}` : '',
    apartment.waterPaymentUrl ? `   Pago: ${apartment.waterPaymentUrl}` : '',
    '',
    '*🔥 Gas (Gases del Caribe)*',
    `   N° Contrato: ${apartment.gasPaymentCode || '—'}`,
    `   ${states.gas.label}`,
    apartment.gasPaymentUrl ? `   Pago: ${apartment.gasPaymentUrl}` : '',
  ].filter(Boolean).join('\n');
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

async function sendCloudGlobalServices(phone) {
  await sendCloudTextChunks(phone, buildCloudGlobalServicesReport());
  await sendCloudServicesMenu(phone);
}

function cloudRentAmount(apartment, fallbackAmount = 0) {
  const contract = activeContractForApartment(apartment?.id);
  const amount = Number(contract?.monthlyRent || apartment?.monthlyRent || fallbackAmount || 0);
  return { contract, amount: Number.isFinite(amount) ? amount : 0 };
}

function activeTenantForApartment(apartment) {
  const contract = activeContractForApartment(apartment?.id);
  const tenant = contract && (db.tenants || []).find(item => Number(item.id) === Number(contract.tenantId));
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

  if (isCloudBlocked(phone)) {
    saveData();
    return;
  }

  if (isCloudAdminPhone(phone)) {
    await handleCloudAdminMessage(phone, message);
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
    const pendingWithButton = type === 'interactive' && (interactive?.id === 'payment_pending' || /^no\s+he\s+pagado/i.test(interactive?.title || ''));
    if (pendingWithButton) {
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
  pgSaveChain = pgSaveChain
    .catch(() => {})
    .then(() => saveToPostgres())
    .catch(error => console.error('PG save error:', error.message));
  return pgSaveChain;
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
  ['messages', 'payments', 'expenses', 'leads', 'settings', 'authSessions', 'presence', 'paymentReminderLogs', 'utilityRecords', 'scraperWorkers', 'scraperLogs'].forEach(k => { if (!db[k]) db[k] = []; });
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
    queuePostgresSave();
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
  if (!db.utilityRecords) db.utilityRecords = [];
  const apts = db.apartments || [];
  const status = apts.map(apt => {
    const electricityRecord = latestUtilityRecord('Air-e', apt);
    const water = utilityPaymentView(latestUtilityRecord('Triple A', apt));
    const gas = utilityPaymentView(latestUtilityRecord('Gases del Caribe', apt));
    return {
      id: apt.id,
      name: apt.name,
       electricity: electricityRecord
         ? {
             deudaCOP: utilityDebtAmount(electricityRecord),
             numFacturas: electricityRecord.numFacturas,
             deudaText: electricityRecord.deudaText,
             nic: electricityRecord.nic,
             scrapedAt: electricityRecord.scrapedAt,
           }
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
    saved?.intervalHours ?? process.env.PORTABLE_WORKER_INTERVAL_HOURS ?? process.env.SERVICES_SCRAPE_INTERVAL_HOURS ?? 12,
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
    electricityPaymentCode: apt.electricityPaymentCode || apt.nic || null,
  }));
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

function mergePortableWorkerRecords(records) {
  if (!Array.isArray(db.utilityRecords)) db.utilityRecords = [];
  let persisted = 0;
  for (const result of records) {
    const sameApartment = record => (
      (result.apartmentId !== null && result.apartmentId !== undefined && Number(record.apartmentId) === Number(result.apartmentId)) ||
      (result.apartment && String(record.apartment || '').trim() === String(result.apartment).trim())
    );
    const index = db.utilityRecords.findIndex(record => {
      if (record.provider !== result.provider) return false;
      if (result.provider === 'Air-e' && result.nic && record.nic) return String(record.nic) === String(result.nic);
      return sameApartment(record);
    });
    if (index >= 0) db.utilityRecords[index] = { ...db.utilityRecords[index], ...result };
    else db.utilityRecords.push(result);
    persisted += 1;
  }
  if (persisted) saveData();
  return persisted;
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
      details: { acceptedByProvider: inspection.acceptedByProvider, rejectedByProvider: inspection.rejectedByProvider, truncated: inspection.truncated },
    });
    console.warn(`[WORKER RESULTS] ${deviceId}: received=${inspection.received}, accepted=0, rejected=${inspection.rejected.length}.`, inspection.rejected.slice(0, 12));
    return res.status(400).json({
      error: 'No se recibieron resultados válidos',
      received: inspection.received,
      accepted: 0,
      persisted: 0,
      rejectedCount: inspection.rejected.length,
      rejected: inspection.rejected.slice(0, 50),
      acceptedByProvider: inspection.acceptedByProvider,
      rejectedByProvider: inspection.rejectedByProvider,
    });
  }
  const persisted = mergePortableWorkerRecords(records);
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
    `persisted=${persisted}, rejected=${inspection.rejected.length}, ` +
    `acceptedByProvider=${JSON.stringify(inspection.acceptedByProvider)}`,
  );
  appendScraperLog({
    source: 'render', deviceId, runId: body.runId, stage: 'results_receipt',
    level: inspection.rejected.length ? 'warn' : 'success',
    message: `Render procesó ${inspection.received} resultado(s): ${inspection.accepted} aceptados y ${persisted} persistidos.`,
    received: inspection.received, accepted: inspection.accepted, persisted, rejected: inspection.rejected.length,
    details: { acceptedByProvider: inspection.acceptedByProvider, rejectedByProvider: inspection.rejectedByProvider, truncated: inspection.truncated },
  });
  res.json({
    ok: true,
    deviceId,
    received: inspection.received,
    accepted: inspection.accepted,
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
    electricity: { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Mis-Facturas/Listado-de-Facturas#/List' },
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
      water: { ...svcConfig.water, payCode: apt.waterPaymentCode || '', payment: utilityPaymentView(latestUtilityRecord('Triple A', apt)) },
      gas: {
        ...svcConfig.gas,
        payCode: apt.gasPaymentCode || '',
        payment: utilityPaymentView(latestUtilityRecord('Gases del Caribe', apt)),
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
  const apartment = (db.apartments || []).find(item => Number(item.id) === Number(conversation.apartmentId));
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
      result = await sendCloudPaymentReminderTemplate(conversation.phone, tenant?.name, period, apartment);
      message = addCloudMessage(conversation, 'out', {
        type: 'template', text: `Cobro de canon y servicios — ${cloudPeriodLabel(period)}`,
        template: process.env.WHATSAPP_PAYMENT_REMINDER_TEMPLATE || 'cobro_canon_servicios',
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
          recalcNextId();
          console.log('Data loaded from PostgreSQL (Aiven is source of truth)');
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
  buildCloudApartmentServicesInfo,
  cloudAdminGreeting,
  cloudApartmentFloor,
  cloudServiceState,
  confirmCloudRentPayments,
  registerCloudUnexpectedExpense,
  registerCloudRentPayment,
  parseCloudMoney,
  splitCloudText,
};
