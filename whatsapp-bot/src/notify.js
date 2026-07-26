import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { log, getLogs, clearLogs } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
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

    if (!isAuthorized(req) && req.url !== '/status' && req.url !== '/log' && req.url !== '/qr' && req.url !== '/pairing-code') {
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
      } else if (req.url === '/groups') {
        try {
          const gruposPath = join(DATA_DIR, 'grupos.json');
          const raw = readFileSync(gruposPath, 'utf-8');
          const data = JSON.parse(raw);
          sendJson(res, 200, { groups: data, count: Object.keys(data).length });
        } catch {
          sendJson(res, 200, { groups: {}, count: 0 });
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
    log('  GET  /proxy-status - Proxy config');
    log('  POST /request-code - Pairing code');
    log('Auth: BOT_ADMIN_TOKEN required on all routes except /status');
  });

  return server;
}
