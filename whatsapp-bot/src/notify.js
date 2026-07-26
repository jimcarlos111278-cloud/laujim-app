import { createServer } from 'http';
import { readFileSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log, getLogs, clearLogs } from './logger.js';
import * as ladder from './ladder.js';
import * as api from './api-client.js';
import * as groupManager from './group-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const SESSION_DIR = process.env.SESSION_PATH || join(DATA_DIR, 'baileys-sessions');
const GRUPOS_PATH = join(DATA_DIR, 'grupos.json');
const BOT_ADMIN_TOKEN = process.env.BOT_ADMIN_TOKEN || '';
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:1011',
  'https://laujim-app.onrender.com',
];

let client = null;
let currentQrBase64 = null;
let pendingPairingPhone = null;
let currentPairingCode = null;
let qrTimestamp = 0;
let lastError = null;

export function setClient(c) { client = c; }
export function setQr(qrBase64) { currentQrBase64 = qrBase64; qrTimestamp = Date.now(); }
export function setPendingPairingPhone(phone) { pendingPairingPhone = phone; }
export function getPendingPairingPhone() { return pendingPairingPhone; }
export function clearPendingPairingPhone() { pendingPairingPhone = null; }
export function setPairingCode(code) { currentPairingCode = code; }
export function getPairingCode() { return currentPairingCode; }
export function clearPairingCode() { currentPairingCode = null; }
export function getQrTimestamp() { return qrTimestamp; }
export function setLastError(err) { lastError = err; }
export function getLastError() { return lastError; }

function isAuthorized(req) {
  if (!BOT_ADMIN_TOKEN) return true;
  const auth = req.headers['authorization'] || req.headers['x-bot-token'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  return token === BOT_ADMIN_TOKEN;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function loadGroupMapping() {
  try {
    if (existsSync(GRUPOS_PATH)) {
      return JSON.parse(readFileSync(GRUPOS_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveGroupMapping(mapping) {
  try {
    const dir = dirname(GRUPOS_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(GRUPOS_PATH, JSON.stringify(mapping, null, 2), 'utf-8');
  } catch (e) {
    log('GROUPS save error: ' + e.message);
  }
}

export function startNotifyServer(port) {
  const server = createServer(async (req, res) => {
    const origin = req.headers['origin'] || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'http://localhost:5173';
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Bot-Token');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const publicPaths = ['/status', '/log', '/qr', '/pairing-code', '/', '/info', '/groups', '/proxy-status', '/logs', '/ladder', '/sessions', '/leads'];
    if (!isAuthorized(req) && !publicPaths.includes(req.url)) {
      sendJson(res, 401, { error: 'Unauthorized. Set BOT_ADMIN_TOKEN or provide Authorization header.' });
      return;
    }

    if (req.method === 'GET') {
      if (req.url === '/status') {
        const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : null;
        sendJson(res, 200, {
          ready: !!client,
          authenticated: !!(client?.user),
          number,
          qrTimestamp,
          lastError,
        });
      } else if (req.url === '/qr') {
        if (currentQrBase64) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from(currentQrBase64, 'base64'));
        } else {
          sendJson(res, 404, { error: 'No QR available' });
        }
      } else if (req.url === '/pairing-code') {
        sendJson(res, 200, {
          code: currentPairingCode,
          phone: pendingPairingPhone,
        });
      } else if (req.url === '/log') {
        sendJson(res, 200, { error: lastError });
      } else if (req.url === '/logs') {
        sendJson(res, 200, getLogs());
      } else if (req.url === '/clear-logs') {
        clearLogs();
        sendJson(res, 200, { ok: true });
      } else if (req.url === '/proxy-status') {
        sendJson(res, 200, {
          botProxySet: !!process.env.BOT_PROXY,
          proxyConfigured: !!(process.env.BOT_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY),
        });
      } else if (req.url === '/ladder') {
        sendJson(res, 200, ladder.getLadder());
      } else if (req.url === '/groups') {
        try {
          const raw = readFileSync(GRUPOS_PATH, 'utf-8');
          const data = JSON.parse(raw);
          sendJson(res, 200, { groups: data, count: Object.keys(data).length });
        } catch {
          sendJson(res, 200, { groups: {}, count: 0 });
        }
      } else if (req.url === '/sessions') {
        try {
          const buf = await fetch('http://localhost:' + port + '/info').then(r => r.json()).catch(() => ({}));
        } catch {}
        import('./session-store.js').then(ss => {
          const active = ss.getActiveSessions();
          sendJson(res, 200, { count: active.length, sessions: active.map(s => ({ apto: s.apto, tenantName: s.tenantName, lastActivity: s.lastActivity })) });
        }).catch(() => sendJson(res, 200, { count: 0, sessions: [] }));
      } else if (req.url === '/leads') {
        try {
          const leads = await api.getLeads();
          sendJson(res, 200, leads);
        } catch (e) {
          sendJson(res, 200, []);
        }
      } else if (req.url === '/info') {
        const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : null;
        const groupsPath = join(DATA_DIR, 'grupos.json');
        let groupsCount = 0;
        try { const raw = readFileSync(groupsPath, 'utf-8'); groupsCount = Object.keys(JSON.parse(raw)).length; } catch {}
        sendJson(res, 200, {
          number,
          groups: groupsCount,
          activeSessions: 0,
          ready: !!client,
          authenticated: !!(client?.user),
          qrTimestamp,
          lastError,
        });
      } else if (req.url === '/') {
        const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : '—';
        const groupsPath = join(DATA_DIR, 'grupos.json');
        let groupsCount = 0;
        let groupsList = '';
        try {
          const raw = readFileSync(groupsPath, 'utf-8');
          const g = JSON.parse(raw);
          groupsCount = Object.keys(g).length;
          groupsList = Object.entries(g).map(([a, j]) => '<tr><td>' + a + '</td><td class="jid">' + j.split('@')[0].slice(0, 8) + '…</td></tr>').join('');
        } catch {}
        const ready = !!client;
        const auth = !!(client?.user);
        const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Laujim WhatsApp Bot</title><style>' +
          '*,body{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}' +
          '.container{max-width:900px;margin:0 auto;padding:20px}' +
          'h1{font-size:1.5rem;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:10px}' +
          '.sub{color:#64748b;font-size:.85rem;margin-bottom:24px}' +
          '.card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;margin-bottom:16px}' +
          '.card h2{font-size:1rem;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}' +
          '.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:.8rem;font-weight:600}' +
          '.badge-green{background:#065f46;color:#6ee7b7}.badge-red{background:#7f1d1d;color:#fca5a5}.badge-amber{background:#78350f;color:#fcd34d}' +
          '.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:12px}' +
          '.stat{background:#0f172a;border-radius:8px;padding:12px;text-align:center}' +
          '.stat .num{font-size:1.5rem;font-weight:700;color:#3b82f6}' +
          '.stat .label{font-size:.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.5px}' +
          'table{width:100%;border-collapse:collapse;font-size:.85rem}' +
          'th{text-align:left;padding:6px 8px;color:#64748b;font-weight:500;border-bottom:1px solid #334155}' +
          'td{padding:6px 8px;border-bottom:1px solid #1e293b}.jid{font-family:monospace;font-size:.75rem;color:#64748b}' +
          '.qr-box{text-align:center;padding:16px}.qr-box img{width:200px;height:200px;border-radius:8px;margin-bottom:8px}' +
          '.pairing{display:flex;gap:8px;margin-top:12px}' +
          '.pairing input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.9rem}' +
          '.pairing button{padding:8px 16px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-weight:600;cursor:pointer}' +
          '.pairing button:hover{background:#2563eb}.pairing button:disabled{opacity:.5}' +
          '.code-box{background:#0f172a;border:2px dashed #3b82f6;border-radius:12px;padding:16px;text-align:center;margin-top:12px}' +
          '.code-box .code{font-size:2rem;font-weight:700;letter-spacing:8px;color:#60a5fa}' +
          '.footer{text-align:center;padding:20px;color:#475569;font-size:.75rem}' +
          '.footer a{color:#3b82f6;text-decoration:none}' +
          '</style></head><body><div class="container">' +
          '<h1><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Laujim WhatsApp Bot</h1>' +
          '<p class="sub">' + (auth ? '✅ Conectado como <strong>' + number + '</strong>' : '⏳ Esperando vinculación') + '</p>' +
          '<div class="card"><h2>🔌 Estado</h2>' +
          '<span class="badge ' + (ready ? 'badge-green' : 'badge-red') + '">' + (ready ? '● En ejecución' : '○ Detenido') + '</span> ' +
          '<span class="badge ' + (auth ? 'badge-green' : 'badge-amber') + '">' + (auth ? '✓ Autenticado' : '✗ No autenticado') + '</span>' +
          (lastError ? '<div style="margin-top:8px;padding:8px 12px;background:#7f1d1d;border-radius:8px;font-size:.8rem">⚠️ ' + lastError + '</div>' : '') +
          '<div class="stat-grid"><div class="stat"><div class="num">' + groupsCount + '</div><div class="label">Grupos</div></div>' +
          '<div class="stat"><div class="num">0</div><div class="label">Sesiones</div></div>' +
          '<div class="stat"><div class="num">' + (auth ? number : '—') + '</div><div class="label">Número</div></div></div></div>' +

          (!auth && qrTimestamp > 0 ? '<div class="card"><h2>📱 Escanea el QR</h2><div class="qr-box"><img src="/qr" alt="QR"/><p style="font-size:.8rem;color:#64748b">WhatsApp → Vincular dispositivo</p></div>' +
          '<div class="relative" style="text-align:center;margin:12px 0"><span style="color:#475569;font-size:.8rem">— o usa código de vinculación —</span></div>' +
          '<div class="pairing"><input type="text" id="phone" placeholder="573001234567"/><button onclick="fetch(\'/request-code\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify({phone:document.getElementById(\'phone\').value.replace(/[^0-9]/g,\'\')})}).then(r=>r.json()).then(d=>{if(d.code)document.getElementById(\'code\').innerText=d.code;else alert(d.error)}).catch(e=>alert(e))">Obtener código</button></div>' +
          '<div id="code" class="code-box" style="display:none"></div></div>' : '') +

          (groupsCount > 0 ? '<div class="card"><h2>👥 Grupos descubiertos</h2><table><thead><tr><th>Apto</th><th>JID</th></tr></thead><tbody>' + groupsList + '</tbody></table></div>' : '') +

          '<div class="card"><h2>🔗 Enlaces</h2>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.85rem">' +
          '<a href="https://laujim-app.onrender.com/whatsapp-bot" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">📊 Panel administración</a>' +
          '<a href="/ladder" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">📋 Delivery Ladder</a>' +
          '<a href="/logs" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">📝 Logs</a>' +
          '<a href="/groups" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">👥 Groups JSON</a>' +
          '<a href="/leads" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">📥 Leads JSON</a>' +
          '<a href="/sessions" style="color:#3b82f6;text-decoration:none;padding:8px;background:#0f172a;border-radius:8px;text-align:center">🔐 Sesiones JSON</a>' +
          '</div></div>' +

          '<div class="footer">Laujim WhatsApp Bot · Proyecto Sabanilla · <a href="https://github.com/anomalyco/opencode">opencode</a></div>' +
          '</div>' +
          '<script>fetch(\'/pairing-code\').then(r=>r.json()).then(d=>{if(d.code){document.getElementById(\'code\').innerText=d.code;document.getElementById(\'code\').style.display=\'block\'}})</script>' +
          '</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
      return;
    }

    if (req.method === 'POST') {
      const data = await parseBody(req);

      if (req.url === '/request-code') {
        if (!client) {
          sendJson(res, 503, { error: 'WhatsApp client not ready' });
          return;
        }
        const phone = data.phone?.replace(/[^0-9]/g, '');
        if (!phone || phone.length < 10) {
          sendJson(res, 400, { error: 'Número inválido' });
          return;
        }
        setPendingPairingPhone(phone);
        try {
          const code = await client.requestPairingCode(phone);
          setPairingCode(code);
          clearPendingPairingPhone();
          sendJson(res, 200, { ok: true, code });
        } catch (e) {
          clearPendingPairingPhone();
          sendJson(res, 500, { error: 'Error al solicitar código: ' + e.message });
        }
      } else if (req.url === '/reset-session') {
        try {
          if (existsSync(SESSION_DIR)) {
            rmSync(SESSION_DIR, { recursive: true, force: true });
          }
          mkdirSync(SESSION_DIR, { recursive: true });
          log('Session reset by API request');
          sendJson(res, 200, { ok: true, message: 'Sesión eliminada. El bot se reiniciará.' });
          setTimeout(() => process.exit(0), 1000);
        } catch (e) {
          sendJson(res, 500, { error: 'Error al resetear sesión: ' + e.message });
        }
      } else if (req.url === '/groups/create') {
        if (!client) {
          sendJson(res, 503, { error: 'WhatsApp client not ready' });
          return;
        }
        const { apto, adminPhone } = data || {};
        if (!apto) {
          sendJson(res, 400, { error: 'apto requerido' });
          return;
        }
        try {
          const jid = await groupManager.ensureGroupForApto(client, apto, adminPhone || '');
          if (jid) {
            const mapping = loadGroupMapping();
            mapping[String(apto)] = jid;
            saveGroupMapping(mapping);
            sendJson(res, 200, { ok: true, jid, apto });
          } else {
            sendJson(res, 500, { error: 'No se pudo crear el grupo' });
          }
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      } else if (req.url === '/discover') {
        if (!client) {
          sendJson(res, 503, { error: 'WhatsApp client not ready' });
          return;
        }
        import('./session-store.js').then(ss => {
          res.json({ ok: true, message: 'Discovery triggered' });
        }).catch(() => sendJson(res, 200, { ok: true }));
      } else if (req.url === '/send') {
        if (!client) {
          sendJson(res, 503, { error: 'WhatsApp client not ready' });
          return;
        }
        const { to, text } = data || {};
        if (!to || !text) {
          sendJson(res, 400, { error: 'to and text required' });
          return;
        }
        try {
          await client.sendMessage(to, { text });
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { error: e.message });
        }
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  });

  server.listen(port, () => {
    log('Notify HTTP server on port ' + port);
    log('  GET  /status - Bot status (no auth)');
    log('  GET  /info - Bot info (number, groups)');
    log('  GET  /qr - QR code image');
    log('  GET  /pairing-code - Get pairing code');
    log('  GET  /logs - Recent logs');
    log('  GET  /clear-logs - Clear logs');
    log('  GET  /groups - Group mapping');
    log('  GET  /sessions - Active sessions');
    log('  GET  /leads - Lead list');
    log('  GET  /ladder - Delivery trace ladder');
    log('  GET  /proxy-status - Proxy config');
    log('  GET  / - Service info');
    log('  POST /request-code - Pairing code');
    log('  POST /reset-session - Clear session & restart');
    log('  POST /groups/create - Auto-create WhatsApp group');
    log('  POST /send - Send text message');
    log('Auth: BOT_ADMIN_TOKEN required on POST routes');
  });

  return server;
}
