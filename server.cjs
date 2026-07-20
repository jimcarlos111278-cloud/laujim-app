const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { spawn } = require('child_process');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 1011;
const AUTH_TOKEN = 'laujim laujim';

app.use(cors({ exposedHeaders: ['x-auth-token'], allowedHeaders: ['Content-Type', 'x-auth-token'] }));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/login' && req.path !== '/api/version' && !req.path.startsWith('/api/public/')) {
    const token = req.headers['x-auth-token'];
    if (token !== AUTH_TOKEN) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }
  next();
});

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PHOTOS_DIR = path.join(UPLOADS_DIR, 'photos');
const CONTRACTS_DIR = path.join(UPLOADS_DIR, 'contracts');

[DATA_DIR, PHOTOS_DIR, CONTRACTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

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

const INITIAL_DATA = {
  users: [
    { id: 1, username: 'admin', password: 'admin123', role: 'owner', name: 'Administrador' },
    { id: 2, username: 'invitado', password: 'invitado123', role: 'guest', name: 'Invitado' },
  ],
  apartments: [
    { id: 1, name: '101 Casa', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 1, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 2, name: '102 Aparta Estudio', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 1, area: 0, rooms: 1, bathrooms: 1, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 3, name: '201', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 2, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 4, name: '202', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 2, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 5, name: '203', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 2, area: 0, rooms: 3, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 6, name: '301', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 3, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 7, name: '302', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 3, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 8, name: '303', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 3, area: 0, rooms: 3, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 9, name: '401', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 4, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 10, name: '402', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 4, area: 0, rooms: 2, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 11, name: '403', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 4, area: 0, rooms: 3, bathrooms: 2, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
    { id: 12, name: '404', description: '', monthlyRent: 0, depositAmount: 0, paymentDueDay: 5, status: 'vacant', floor: 4, area: 0, rooms: 2, bathrooms: 1, notes: '', nic: '', waterReadingDay: 10, gasReadingDay: 12, electricityReadingDay: 15, createdAt: new Date().toISOString() },
  ],
  tenants: [],
  contracts: [],
  payments: [],
  expenses: [],
  utilityPayments: [],
  vacancies: [],
  familyMembers: [],
  settings: [],
  photos: [],
};

let db = { ...INITIAL_DATA };
let nextId = {};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      db = JSON.parse(raw);
    } else {
      db = JSON.parse(JSON.stringify(INITIAL_DATA));
    }
  } catch { db = JSON.parse(JSON.stringify(INITIAL_DATA)); }
  Object.keys(db).forEach(key => {
    const arr = db[key];
    if (Array.isArray(arr) && arr.length > 0) {
      nextId[key] = Math.max(...arr.map(i => i.id || 0)) + 1;
    } else {
      nextId[key] = 1;
    }
  });
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

loadData();

app.get('/api/version', (req, res) => {
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(__dirname, 'dist', 'version.json'), 'utf-8'));
    res.json(ver);
  } catch {
    res.json({ build: '0', date: '', time: '' });
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

app.post('/api/login', (req, res) => {
  const { token } = req.body;
  if (token === AUTH_TOKEN) {
    res.json({ authenticated: true, role: 'owner', name: 'Propietario' });
  } else {
    res.status(401).json({ error: 'Token inválido' });
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
  console.log('  Los datos se guardan en este PC.');
  console.log('============================================');
});
