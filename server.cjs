const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const { exec } = require('child_process');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 1011;
const AUTH_TOKEN = 'laujim laujim';

app.use(cors({ exposedHeaders: ['x-auth-token'], allowedHeaders: ['Content-Type', 'x-auth-token'] }));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && !req.path.startsWith('/api/antecedentes/police') && req.path !== '/api/login' && req.path !== '/api/version' && req.path !== '/api/data-version' && !req.path.startsWith('/api/public/')) {
    const token = req.headers['x-auth-token'];
    if (token !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'No autorizado' });
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

[DATA_DIR, BACKUP_DIR, PHOTOS_DIR, CONTRACTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

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
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const { INITIAL_DATA } = require('./db.cjs');

let db = { ...INITIAL_DATA };
let nextId = {};

// ─── PostgreSQL persistence (when DATABASE_URL is set) ───
let pgPool = null;

async function initPostgres() {
  if (!process.env.DATABASE_URL) return false;
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
  console.log('PostgreSQL connected');
  return true;
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
  ['messages', 'payments', 'expenses'].forEach(k => { if (!db[k]) db[k] = []; });
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
  // Fire-and-forget PostgreSQL save
  if (pgPool) {
    saveToPostgres().catch(e => console.error('PG save error:', e.message));
  }
}

// ─── Async startup ───

async function startServer() {
  let loaded = false;
  // Try PostgreSQL first
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
  // Fallback to JSON file (or initial data)
  if (!loaded) {
    loadData();
    // If PostgreSQL is available but was empty, write initial data to it
    if (pgPool) {
      saveToPostgres().catch(e => console.error('PG initial save error:', e.message));
    }
  }

// ─── RUTAS ESPECÍFICAS (SIN PARÁMETROS DE COLECCIÓN) ───
// Deben ir ANTES de las rutas genéricas /:collection o Express las capturará como nombre de colección

app.get('/api/data-version', (req, res) => {
  res.json({ version: dataVersion });
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
  const { token, username, password } = req.body;
  if (token) {
    if (token === AUTH_TOKEN) {
      return res.json({ authenticated: true, role: 'admin', name: 'Administrador' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
  if (username === 'admin' && password === 'laujim123') {
    return res.json({ authenticated: true, role: 'admin', name: 'Administrador' });
  }
  const pwdRecord = (db.passwords || []).find(p => {
    const apt = (db.apartments || []).find(a => a.id === p.apartmentId && a.name === username);
    return apt && p.password === password;
  });
  if (pwdRecord) {
    const apt = (db.apartments || []).find(a => a.id === pwdRecord.apartmentId);
    return res.json({ authenticated: true, role: 'tenant', apartmentId: pwdRecord.apartmentId, name: apt?.name });
  }
  res.status(401).json({ error: 'Credenciales inválidas' });
});

app.get('/api/public/vacants', (req, res) => {
  const vacants = (db.apartments || []).filter(a => a.status === 'vacant').map(a => ({
    id: a.id, name: a.name, description: a.description || '', monthlyRent: a.monthlyRent,
    rooms: a.rooms, bathrooms: a.bathrooms, area: a.area, floor: a.floor, paymentDueDay: a.paymentDueDay, notes: a.notes || '',
  }));
  const photos = (db.photos || []).filter(p => vacants.some(a => a.id === Number(p.apartmentId)));
  res.json({ apartments: vacants, photos });
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
    // Also clear uploads
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

app.post('/api/upload/photo', upload.single('photo'), (req, res) => {
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

app.post('/api/upload/contract', upload.single('contract'), (req, res) => {
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

// ─── PRESENCIA (CHAT ONLINE STATUS) ───
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

// ─── MENSAJES (CHAT) ───
// Ruta específica para polling incremental de mensajes nuevos
app.get('/api/messages/updates/:since', (req, res) => {
  const since = req.params.since;
  const messages = db.messages || [];
  const filtered = messages.filter(m => m.createdAt >= since);
  res.json(filtered);
});

// ─── RUTAS GENÉRICAS (CON PARÁMETROS :collection) ───
// Van después de todas las rutas específicas para evitar colisiones

// Antecedentes - consulta automática a la Policía
const https = require('https');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function proxyGet(hostname, port, path, cookies) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': UA };
    if (cookies) headers.Cookie = cookies;
    const opts = { hostname, port, path, method: 'GET', rejectUnauthorized: false, headers };
    const req = https.request(opts, (res) => {
      const cookies = (res.headers['set-cookie'] || []).join('; ');
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ body: data, cookies }));
    });
    req.on('error', reject);
    req.end();
  });
}

function proxyPost(hostname, port, path, body, cookies, redirects = 3) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname, port, path, method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Cookie': cookies
      },
      rejectUnauthorized: false
    };
    const req = https.request(opts, (res) => {
      // Follow redirect (302/301)
      if ((res.statusCode === 302 || res.statusCode === 301) && res.headers.location && redirects > 0) {
        const loc = res.headers.location;
        const url = new URL(loc, 'https://' + hostname + ':' + port);
        // Change method to GET for redirect (standard behavior for 302)
        proxyGet(url.hostname, url.port || 443, url.pathname + url.search, cookies).then(r => resolve(r.body)).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const policeCookieStore = {};

// Serve the police page via proxy (for captcha iframe flow)
app.get('/api/antecedentes/police-page', async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const host = 'antecedentes.policia.gov.co';
    const port = 7005;
    const p = '/WebJudicial/antecedentes.xhtml';
    const result = await proxyGet(host, port, p);

    // Extract form action from the page
    const actionMatch = result.body.match(/<form[^>]*action="([^"]*)"/i);
    const formAction = actionMatch ? actionMatch[1] : p;

    policeCookieStore[sessionId] = {
      cookies: result.cookies,
      formAction,
      host,
      port,
    };

    let html = result.body;
    // Add <base> tag so relative resources load from police
    html = html.replace('<head>', '<head><base href="https://' + host + ':' + port + '/WebJudicial/" />');
    // Rewrite form action to our proxy
    html = html.replace(/action="[^"]*"/i, 'action="/api/antecedentes/police-submit?session=' + sessionId + '"');

    // Auto-fill cédula input if doc query param is provided
    const doc = req.query.doc || '';
    if (doc) {
      const script = '<script>setTimeout(function(){var e=document.getElementById("cedulaInput");if(e){e.value="' + doc.replace(/"/g, '\\"') + '";e.dispatchEvent(new Event("input"));}},500);<\/script>';
      html = html.replace('</head>', script + '</head>');
    }

    // Strip CSP if present
    res.removeHeader('Content-Security-Policy');
    res.cookie('police_session', sessionId, { httpOnly: true, sameSite: 'lax', maxAge: 300000 });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.send(html);
  } catch (e) {
    res.status(500).send('Error al cargar la página de la Policía');
  }
});

// Handle form submission from the proxied police page
app.post('/api/antecedentes/police-submit', async (req, res) => {
  const { session } = req.query;
  const sd = policeCookieStore[session];
  if (!sd) {
    return res.send('<script>window.parent.postMessage({status:"error",detail:"Sesi\u00f3n expirada. Vuelve a intentar."},"*");</script>');
  }

  try {
    const postData = new URLSearchParams(req.body).toString();
    const result = await proxyPost(sd.host, sd.port, sd.formAction, postData, sd.cookies);
    delete policeCookieStore[session];

    // Parse result
    const clean = result.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES');
    const hasRecords = /REGISTRA ANTECEDENTES|TIENE ANTECEDENTES|CON ANTECEDENTES|S\u00cd REGISTRA/i.test(result);
  const captchaBlock = /g-recaptcha|recaptcha|data-sitekey|No soy un robot|I'm not a robot|recaptcha-checkbox|reCAPTCHA|cuota gratuita|captcha/i.test(result);
    const errorMatch = result.match(/<span[^>]*class="[^"]*error[^"]*"[^>]*>([^<]+)/i);

    let status, detail;
    if (clean) {
      status = 'clean';
      detail = '';
    } else if (hasRecords) {
      status = 'flagged';
      detail = errorMatch ? errorMatch[1] : 'Tiene antecedentes judiciales';
    } else if (captchaBlock || /Términos de uso|Acepto que|Ley Ángel|Ley 2455|index\.xhtml/i.test(result)) {
      status = 'captcha';
      detail = 'Captcha inválido o expirado.';
    } else {
      status = 'error';
      detail = errorMatch ? errorMatch[1] : 'No se pudo determinar el resultado. Intenta manualmente.';
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
      '<script>window.parent.postMessage(' + JSON.stringify({ status, detail }) + ',"*");</script>' +
      '<p style="font-family:sans-serif;text-align:center;padding:20px;color:#666;">' +
      (status === 'clean' ? 'Sin antecedentes' : status === 'flagged' ? 'Con antecedentes' : status === 'captcha' ? 'Captcha' : 'Error') +
      ' &mdash; Cerrando...</p></body></html>'
    );
  } catch (e) {
    res.send('<script>window.parent.postMessage({status:"error",detail:"' + e.message.replace(/"/g, '\\"') + '"},"*");</script>');
  }
});

async function checkAntecedentes(document) {
  const hostname = 'antecedentes.policia.gov.co';
  const port = 7005;
  const path = '/WebJudicial/antecedentes.xhtml';

  // Step 1: GET the initial page to extract JSF view state
  const { body, cookies } = await proxyGet(hostname, port, path);
  const viewState = (body.match(/<input[^>]*name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/) || [])[1] || '';
  const actionRaw = (body.match(/<form[^>]*action="([^"]*)"[^>]*method="[^"]*post/i) || body.match(/<form[^>]*action="([^"]*)"/) || [])[1] || path;
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  const actionUrl = actionRaw.startsWith('/') || actionRaw.startsWith('http') ? actionRaw : dir + actionRaw.replace(/^\.\//, '');

  // Step 2: POST the form with the document
  const postBody = new URLSearchParams();
  postBody.append('form', 'form');
  postBody.append('cedulaInput', document);
  postBody.append('javax.faces.ViewState', viewState);
  postBody.append('g-recaptcha-response', '');

  const result = await proxyPost(hostname, port, actionUrl, postBody.toString(), cookies);

  // Step 3: Parse the result
  const clean = result.includes('NO TIENE ASUNTOS PENDIENTES CON LAS AUTORIDADES JUDICIALES');
  const hasRecords = /REGISTRA ANTECEDENTES|TIENE ANTECEDENTES|CON ANTECEDENTES|S\u00cd REGISTRA/i.test(result);
    const captchaBlock = /g-recaptcha|recaptcha|data-sitekey|No soy un robot|I'm not a robot|recaptcha-checkbox|reCAPTCHA|cuota gratuita|captcha/i.test(result);
  const errorMsg = result.match(/<span[^>]*class="[^"]*error[^"]*"[^>]*>([^<]+)/i);

  if (clean) {
    return { status: 'clean', clean: true, detail: '' };
  }
  if (hasRecords) {
    return { status: 'flagged', clean: false, detail: errorMsg ? errorMsg[1] : '' };
  }
  if (captchaBlock || /Términos de uso|Acepto que|Ley Ángel|Ley 2455|index\.xhtml/i.test(result)) {
    return { status: 'captcha', message: 'El sitio requiere resolver un captcha.' };
  }
  const preview = result.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 2000);
  console.log('[Antecedentes] Response preview for ' + document + ':', preview);
  return { status: 'error', message: errorMsg ? errorMsg[1] : 'Respuesta inesperada. Preview: ' + preview };
}

app.post('/api/antecedentes/check', async (req, res) => {
  const { document } = req.body;
  if (!document || !document.trim()) return res.status(400).json({ error: 'Cédula requerida' });
  try {
    const result = await checkAntecedentes(document.trim());
    res.json(result);
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

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
const EDITOR_AUTH = { username: 'admin', password: 'admin123' };

function editorAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) return res.status(401).set('WWW-Authenticate', 'Basic realm="Editor"').end('Auth required');
  const buf = Buffer.from(auth.slice(6), 'base64').toString();
  const [u, p] = buf.split(':');
  if (u !== EDITOR_AUTH.username || p !== EDITOR_AUTH.password) return res.status(403).end('Bad auth');
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

app.use(express.static(path.join(__dirname, 'dist')));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

  app.listen(PORT, '0.0.0.0', () => {
    console.log('============================================');
    console.log('  GESTION DE APARTAMENTOS - SERVIDOR');
    console.log('============================================');
    console.log('');
    console.log('  En este PC:    http://localhost:' + PORT);
    console.log('  Contraseña:    laujim laujim');
    if (pgPool) console.log('  Base de datos: PostgreSQL (permanente)');
    console.log('');
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log('  En tu red:     http://' + net.address + ':' + PORT);
        }
      }
    }
    console.log('');
    console.log('  Abre cualquiera de esas URLs en el navegador');
    console.log('  de cualquier dispositivo en el mismo WiFi.');
    if (!pgPool) console.log('  Los datos se guardan en este PC.');
    console.log('============================================');
  });
}

startServer();
