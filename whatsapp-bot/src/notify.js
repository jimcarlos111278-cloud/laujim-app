import { createServer } from 'http';
import { log, getLogs } from './logger.js';

let client = null;
let currentQrBase64 = null;
let pendingPairingPhone = null;
let currentPairingCode = null;
let qrTimestamp = 0;
let lastError = null;

export function setClient(c) {
  client = c;
}

export function setQr(qrBase64) {
  currentQrBase64 = qrBase64;
  qrTimestamp = Date.now();
}

export function setPendingPairingPhone(phone) {
  pendingPairingPhone = phone;
}

export function getPendingPairingPhone() {
  return pendingPairingPhone;
}

export function clearPendingPairingPhone() {
  pendingPairingPhone = null;
}

export function setPairingCode(code) {
  currentPairingCode = code;
}

export function getPairingCode() {
  return currentPairingCode;
}

export function clearPairingCode() {
  currentPairingCode = null;
}

export function getQrTimestamp() {
  return qrTimestamp;
}

export function setLastError(err) {
  lastError = err;
}

export function getLastError() {
  return lastError;
}

export function startNotifyServer(port) {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      if (req.url === '/status') {
        const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : null;
        res.writeHead(200);
        res.end(JSON.stringify({
          ready: !!client,
          authenticated: !!(client?.user),
          number,
          qrTimestamp,
          lastError,
        }));
      } else if (req.url === '/qr') {
        if (currentQrBase64) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from(currentQrBase64, 'base64'));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No QR available' }));
        }
      } else if (req.url === '/pairing-code') {
        res.writeHead(200);
        res.end(JSON.stringify({
          code: currentPairingCode,
          phone: pendingPairingPhone,
        }));
      } else if (req.url === '/log') {
        res.writeHead(200);
        res.end(JSON.stringify({ error: lastError }));
      } else if (req.url === '/logs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getLogs()));
      } else if (req.url === '/proxy-status') {
        const proxyUrl = process.env.BOT_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          botProxySet: !!process.env.BOT_PROXY,
          httpsProxySet: !!process.env.HTTPS_PROXY,
          httpProxySet: !!process.env.HTTP_PROXY,
          activeProxyUrl: proxyUrl ? proxyUrl.replace(/:([^:@]+)@/, ':***@') : null,
          proxyType: proxyUrl ? (proxyUrl.startsWith('socks') ? 'socks' : 'http') : null,
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);

          if (req.url === '/send') {
            if (!client) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'WhatsApp client not ready' }));
              return;
            }
            if (!data.to || !data.text) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'to and text required' }));
              return;
            }
            const number = data.to.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
            await client.sendMessage(number, { text: data.text });
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          } else if (req.url === '/status') {
            const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : null;
            res.writeHead(200);
            res.end(JSON.stringify({
              ready: !!client,
              authenticated: !!(client?.user),
              number,
              qrTimestamp,
              lastError,
            }));
          } else if (req.url === '/request-code') {
            if (!client) {
              res.writeHead(503);
              res.end(JSON.stringify({ error: 'WhatsApp client not ready' }));
              return;
            }
            const phone = data.phone?.replace(/[^0-9]/g, '');
            if (!phone || phone.length < 10) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Número inválido' }));
              return;
            }
            setPendingPairingPhone(phone);
            try {
              const code = await client.requestPairingCode(phone);
              setPairingCode(code);
              res.writeHead(200);
              res.end(JSON.stringify({ ok: true, code }));
            } catch (e) {
              clearPendingPairingPhone();
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Error al solicitar código: ' + e.message }));
            }
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  });

  server.listen(port, () => {
    log('Notify HTTP server on port ' + port);
    log('  POST /send - Send a WhatsApp message');
    log('  POST /request-code - Request pairing code');
    log('  GET  /status - Bot status');
    log('  GET  /qr - QR code image');
    log('  GET  /pairing-code - Get pairing code');
    log('  GET  /logs - Recent log entries');
    log('  GET  /proxy-status - Proxy configuration');
  });

  return server;
}
