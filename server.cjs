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
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = file.fieldname === 'contract' ? CONTRACTS_DIR : PHOTOS_DIR;
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + ext);
    },
  });
  upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
} catch (e) { console.error('MULTER SETUP FAILED:', e.message); upload = null; }

const { INITIAL_DATA } = require('./db.cjs');

let db = { ...INITIAL_DATA };
let nextId = {};

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

// ─── WhatsApp helper ───
function isBotEnabled() {
  const setting = (db.settings || []).find(s => s.key === 'whatsapp_bot_enabled');
  return setting ? setting.value === 'true' : false;
}

function sendWhatsApp(to, text) {
  const botUrl = process.env.WHATSAPP_BOT_URL;
  if (botUrl && isBotEnabled()) {
    const postData = JSON.stringify({ to, text });
    const url = new URL('/send', botUrl);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => { if (res.statusCode !== 200) console.error('Bot send error:', data); });
    });
    req.on('error', (e) => console.error('Bot send error:', e.message));
    req.write(postData);
    req.end();
    return;
  }
  const token = (db.settings || []).find(s => s.key === 'whatsapp_api_token')?.value;
  const phoneNumberId = (db.settings || []).find(s => s.key === 'whatsapp_phone_number_id')?.value;
  if (!token || !phoneNumberId) return;
  const postData = JSON.stringify({
    messaging_product: 'whatsapp', to, type: 'text', text: { body: text },
  });
  const opts = {
    hostname: 'graph.facebook.com', path: `/v21.0/${phoneNumberId}/messages`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
  };
  const req = https.request(opts, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => { if (res.statusCode !== 200 && res.statusCode !== 201) console.error('WhatsApp API error:', data); });
  });
  req.on('error', (e) => console.error('WhatsApp send error:', e.message));
  req.write(postData);
  req.end();
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
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
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
  for (const name of ['whatsappContacts', 'whatsappConversations', 'whatsappMessages', 'whatsappAuthStates', 'whatsappBlockedUsers', 'whatsappProcessedMessages']) {
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
  if (!contract) return null;
  return { phone: normalizePhone(phone), tenantId: tenant.id, apartmentId: contract.apartmentId, source: 'database' };
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

function sendCloudText(to, body) {
  return cloudApiRequest('/messages', 'POST', {
    messaging_product: 'whatsapp', to: normalizePhone(to), type: 'text', text: { body },
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
    // Content and media identifiers are persisted only after authorization.
    addCloudMessage(conversation, 'in', { type, text: type === 'text' ? (message.text?.body || '') : '', mediaId: message[type]?.id || null, whatsappMessageId: message.id });
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
  ['messages', 'payments', 'expenses', 'leads', 'settings', 'authSessions', 'presence'].forEach(k => { if (!db[k]) db[k] = []; });
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

app.get('/api/system/stats', (req, res) => {
  let dbSize = 0;
  try { if (fs.existsSync(DATA_FILE)) dbSize = fs.statSync(DATA_FILE).size; } catch {}
  const collections = {};
  Object.keys(db).forEach(key => { if (Array.isArray(db[key])) collections[key] = db[key].length; });
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    uptime: os.uptime(),
    totalmem: os.totalmem(),
    freemem: os.freemem(),
    heapUsed: process.memoryUsage().heapUsed,
    heapTotal: process.memoryUsage().heapTotal,
    rss: process.memoryUsage().rss,
    pid: process.pid,
    nodeVersion: process.version,
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
      { id: 'water', name: 'Agua', provider: 'Triple A', url: 'https://portal.aaa.com.co/pagos' },
      { id: 'gas', name: 'Gas', provider: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
      { id: 'electricity', name: 'Energía', provider: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
    ],
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
  upload.single('photo')(req, res, () => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const photo = {
      id: nextId.photos || 1,
      apartmentId: Number(req.body.apartmentId),
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: '/uploads/photos/' + req.file.filename,
      uploadedAt: new Date().toISOString(),
    };
    nextId.photos = (nextId.photos || 1) + 1;
    db.photos.push(photo);
    saveData();
    res.status(201).json(photo);
  });
});

app.delete('/api/photo/:id', (req, res) => {
  const idx = db.photos.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Photo not found' });
  const photo = db.photos[idx];
  const filePath = path.join(PHOTOS_DIR, photo.filename);
  try { fs.unlinkSync(filePath); } catch {}
  db.photos.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

app.post('/api/upload/contract', (req, res) => {
  if (!upload) return res.status(500).json({ error: 'Upload not available' });
  upload.single('contract')(req, res, () => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const file = {
      id: Date.now(),
      contractId: Number(req.body.contractId),
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: '/uploads/contracts/' + req.file.filename,
      uploadedAt: new Date().toISOString(),
    };
    res.status(201).json(file);
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
  if (!cloudReady()) return res.status(503).json({ error: 'WhatsApp Cloud API no configurada' });
  if (!validCloudSignature(req)) return res.sendStatus(401);
  if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);
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
  res.json(db.whatsappConversations.map(c => ({ ...c, messages: (db.whatsappMessages || []).filter(m => m.conversationId === c.id).slice(-1) })));
});

app.get('/api/whatsapp/cloud/conversations/:id/messages', (req, res) => {
  if (!requireCloudAdmin(req, res)) return;
  ensureCloudCollections();
  const id = Number(req.params.id);
  if (!db.whatsappConversations.some(c => c.id === id)) return res.status(404).json({ error: 'Conversación no encontrada' });
  res.json((db.whatsappMessages || []).filter(m => m.conversationId === id));
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
    addCloudMessage(conversation, 'out', { type: 'text', text: String(text).trim(), whatsappMessageId: result.messages?.[0]?.id || null });
    saveData(); res.json({ ok: true, id: result.messages?.[0]?.id || null });
  } catch (error) { res.status(502).json({ error: error.message }); }
});

// Legacy relay is deliberately opt-in. Production uses Cloud API only.
app.post('/api/whatsapp/send', (req, res) => {
  if (!LEGACY_BAILEYS_ENABLED) {
    return res.status(410).json({ error: 'El relay Baileys está desactivado. Usa WhatsApp Cloud API.' });
  }
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ error: 'to and text required' });
  sendWhatsApp(to, text);
  res.json({ ok: true });
});

// ─── WHATSAPP BOT MANAGEMENT ───
let botProcess = null;
let botRestartTimer = null;

function startBot() {
  if (!LEGACY_BAILEYS_ENABLED) { console.log('[BOT] Legacy Baileys relay disabled'); return; }
  if (BOT_IS_EXTERNAL) { console.log('[BOT] External service, skipping local spawn'); return; }
  const botDir = path.join(__dirname, 'whatsapp-bot');
  if (!fs.existsSync(botDir) || botProcess) return;
  try {
    const apiBaseUrl = 'http://localhost:' + PORT + '/api';
    botProcess = spawn('node', ['index.js'], {
      cwd: botDir,
      stdio: 'pipe',
      env: { ...process.env, PORT: '3002', NODE_OPTIONS: '--max_old_space_size=256', API_BASE_URL: apiBaseUrl },
    });
    botProcess.stdout.on('data', (data) => console.log('[BOT]', data.toString().trim()));
    botProcess.stderr.on('data', (data) => console.error('[BOT]', data.toString().trim()));
    botProcess.on('close', (code) => {
      console.log('[BOT] Process exited with code', code);
      botProcess = null;
      if (code !== 0 && code !== null) {
        clearTimeout(botRestartTimer);
        botRestartTimer = setTimeout(startBot, 10000);
        console.log('[BOT] Will restart in 10s');
      }
    });
    console.log('[BOT] Started (PID ' + botProcess.pid + ')');
  } catch (e) {
    console.error('[BOT] Start failed:', e.message);
  }
}

const BOT_URL = process.env.WHATSAPP_BOT_URL || 'http://localhost:3002';
const BOT_IS_EXTERNAL = !!process.env.WHATSAPP_BOT_URL;
const LEGACY_BAILEYS_ENABLED = process.env.ENABLE_LEGACY_BAILEYS === 'true';

async function fetchBotBuffer(path) {
  try {
    const url = new URL(path, BOT_URL);
    return await new Promise((resolve, reject) => {
      const mod = require(url.protocol === 'https:' ? 'https' : 'http');
      mod.get(url.href, (resp) => {
        if (resp.statusCode !== 200) { resp.resume(); resolve(null); return; }
        const chunks = [];
        resp.on('data', chunk => chunks.push(chunk));
        resp.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).setTimeout(3000, () => reject(new Error('timeout')));
    });
  } catch { return null; }
}

async function proxyPostToBot(path, body) {
  const url = new URL(path, BOT_URL);
  const postData = JSON.stringify(body);
  const mod = require(url.protocol === 'https:' ? 'https' : 'http');
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': 'Bearer ' + (process.env.BOT_ADMIN_TOKEN || ''),
      },
    };
    const req2 = mod.request(opts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: data }); }
      });
    });
    req2.on('error', reject);
    req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('timeout')); });
    req2.write(postData);
    req2.end();
  });
}

app.get('/api/whatsapp-bot/status', async (req, res) => {
  const tracked = botProcess !== null && !botProcess.killed;
  let running = tracked;
  let authenticated = false;
  let number = null;
  let qr = null;
  let pid = tracked ? botProcess.pid : null;

  let qrTimestamp = 0;
  let lastError = null;
  const statusBuf = await fetchBotBuffer('/status');
  if (statusBuf) {
    try {
      const data = JSON.parse(statusBuf.toString());
      running = true;
      authenticated = data.authenticated || false;
      number = data.number || null;
      qrTimestamp = data.qrTimestamp || 0;
      lastError = data.lastError || null;
    } catch {}
  }

  if (running && !authenticated) {
    const qrBuf = await fetchBotBuffer('/qr');
    if (qrBuf && qrBuf.length > 0) {
      qr = qrBuf.toString('base64');
    }
  }

  res.json({ running, pid, authenticated, number, qr, qrTimestamp, lastError });
});

app.get('/api/whatsapp-bot/logs', async (req, res) => {
  const buf = await fetchBotBuffer('/logs');
  if (!buf) return res.json([]);
  try { res.json(JSON.parse(buf.toString())); } catch { res.json([]); }
});

app.get('/api/whatsapp-bot/clear-logs', async (req, res) => {
  const buf = await fetchBotBuffer('/clear-logs');
  if (!buf) return res.json({ error: 'Bot not reachable' });
  try { res.json(JSON.parse(buf.toString())); } catch { res.json({ error: 'Parse error' }); }
});

app.get('/api/whatsapp-bot/proxy-status', async (req, res) => {
  const buf = await fetchBotBuffer('/proxy-status');
  if (!buf) return res.json({ error: 'Bot not reachable' });
  try { res.json(JSON.parse(buf.toString())); } catch { res.json({ error: 'Parse error' }); }
});

app.get('/api/whatsapp-bot/info', async (req, res) => {
  const statusBuf = await fetchBotBuffer('/status');
  const groupsBuf = await fetchBotBuffer('/groups');
  let number = null;
  let groups = [];
  let activeSessions = 0;
  if (statusBuf) { try { const d = JSON.parse(statusBuf.toString()); number = d.number; } catch {} }
  if (groupsBuf) { try { const d = JSON.parse(groupsBuf.toString()); groups = Object.keys(d.groups || {}); activeSessions = d.count || 0; } catch {} }
  res.json({ number, groups, activeSessions });
});

app.post('/api/whatsapp-bot/start', (req, res) => {
  if (!LEGACY_BAILEYS_ENABLED) {
    return res.status(410).json({ error: 'Baileys está desactivado para producción. Configura WhatsApp Cloud API.' });
  }
  if (BOT_IS_EXTERNAL) {
    return res.json({ ok: true, message: 'El bot corre como servicio independiente en laujim-whatsapp-bot.onrender.com' });
  }
  if (botProcess && !botProcess.killed) {
    return res.status(400).json({ error: 'El bot ya está en ejecución' });
  }
  try {
    startBot();
    if (botProcess) {
      res.json({ ok: true, message: 'Bot iniciado', pid: botProcess.pid });
    } else {
      res.status(500).json({ error: 'No se pudo iniciar el bot' });
    }
  } catch (e) {
    res.status(500).json({ error: 'Error al iniciar bot: ' + e.message });
  }
});

app.post('/api/whatsapp-bot/stop', (req, res) => {
  if (BOT_IS_EXTERNAL) {
    return res.json({ ok: true, message: 'El bot corre como servicio independiente en laujim-whatsapp-bot.onrender.com' });
  }
  clearTimeout(botRestartTimer);
  if (!botProcess || botProcess.killed) {
    return res.status(400).json({ error: 'El bot no está en ejecución' });
  }
  try {
    botProcess.kill('SIGTERM');
    setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        botProcess.kill('SIGKILL');
      }
    }, 5000);
    res.json({ ok: true, message: 'Bot detenido' });
  } catch (e) {
    res.status(500).json({ error: 'Error al detener bot: ' + e.message });
  }
});

app.post('/api/whatsapp-bot/reset-session', async (req, res) => {
  if (BOT_IS_EXTERNAL) {
    try {
      const result = await proxyPostToBot('/reset-session', {});
      if (result.error) return res.status(500).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
    }
  }
  try {
    clearTimeout(botRestartTimer);
    if (botProcess && !botProcess.killed) {
      botProcess.kill('SIGTERM');
      botProcess = null;
    }
    const botDir = path.join(__dirname, 'whatsapp-bot');
    const sessionsDir = path.join(botDir, 'sessions');
    const dataDir = path.join(botDir, 'data');
    const sessionFile = path.join(dataDir, 'session-store.json');
    const wwebjsCache = path.join(botDir, '.wwebjs_cache');
    const baileysSessions = path.join(dataDir, 'baileys-sessions');

    if (fs.existsSync(sessionsDir)) {
      fs.rmSync(sessionsDir, { recursive: true, force: true });
    }
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
    if (fs.existsSync(wwebjsCache)) {
      fs.rmSync(wwebjsCache, { recursive: true, force: true });
    }
    if (fs.existsSync(baileysSessions)) {
      fs.rmSync(baileysSessions, { recursive: true, force: true });
    }

    setTimeout(startBot, 2000);

    res.json({ ok: true, message: 'Sesión eliminada. El bot se está reiniciando — espera el QR en la página.' });
  } catch (e) {
    res.status(500).json({ error: 'Error al resetear sesión: ' + e.message });
  }
});

app.post('/api/whatsapp-bot/request-code', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Número de teléfono requerido' });
  try {
    const result = await proxyPostToBot('/request-code', { phone });
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
  }
});

app.get('/api/whatsapp-bot/pairing-code', async (req, res) => {
  const botUrl = process.env.WHATSAPP_BOT_URL || 'http://localhost:3002';
  try {
    const url = new URL('/pairing-code', botUrl);
    const mod = require(url.protocol === 'https:' ? 'https' : 'http');
    const result = await new Promise((resolve, reject) => {
      mod.get(url.href, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ error: data }); }
        });
      }).on('error', reject).setTimeout(5000, () => reject(new Error('timeout')));
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
  }
});

// ─── WHATSAPP BOT NEW ENDPOINTS (Proyecto Sabanilla) ───
app.get('/api/whatsapp-bot/leads', (req, res) => {
  res.json(db.leads || []);
});

app.get('/api/whatsapp-bot/sessions', async (req, res) => {
  const buf = await fetchBotBuffer('/sessions');
  if (!buf) return res.json({ count: 0, sessions: [] });
  try { res.json(JSON.parse(buf.toString())); } catch { res.json({ count: 0, sessions: [] }); }
});

// ─── WHATSAPP BOT CHAT (web conversations) ───
app.get('/api/whatsapp-bot/wa/conversations', async (req, res) => {
  const { jid } = req.query;
  const path = jid ? '/wa/conversations/' + encodeURIComponent(jid) : '/wa/conversations';
  const buf = await fetchBotBuffer(path);
  if (!buf) return res.json({ conversations: [] });
  try { res.json(JSON.parse(buf.toString())); } catch { res.json({ conversations: [] }); }
});

app.post('/api/whatsapp-bot/wa/send', async (req, res) => {
  try {
    const result = await proxyPostToBot('/wa/send', req.body);
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
  }
});

app.post('/api/whatsapp-bot/wa/mark-read', async (req, res) => {
  try {
    const result = await proxyPostToBot('/wa/mark-read', req.body);
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
  }
});

app.get('/api/whatsapp-bot/ladder', async (req, res) => {
  const buf = await fetchBotBuffer('/ladder');
  if (!buf) return res.json([]);
  try { res.json(JSON.parse(buf.toString())); } catch { res.json([]); }
});

app.post('/api/whatsapp-bot/discover', async (req, res) => {
  try {
    const result = await proxyPostToBot('/discover', {});
    if (result.error) return res.status(500).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Error al conectar con el bot: ' + e.message });
  }
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
        try { await saveToPostgres(); } catch (e) { console.error('PG save error:', e.message); }
      }
    }
    console.log('Server ready - PostgreSQL: ' + (pgPool ? 'connected' : 'file mode'));

    if (LEGACY_BAILEYS_ENABLED && process.env.AUTO_START_BOT !== 'false' && !BOT_IS_EXTERNAL) {
      startBot();
    }
  })();
}

startServer();
