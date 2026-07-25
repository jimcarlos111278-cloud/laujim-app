import { createServer } from 'http';

let client = null;
let currentQrBase64 = null;

export function setClient(c) {
  client = c;
}

export function setQr(qrBase64) {
  currentQrBase64 = qrBase64;
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

    // GET endpoints
    if (req.method === 'GET') {
      if (req.url === '/status') {
        const number = client?.user?.id ? client.user.id.split(':')[0].replace('@s.whatsapp.net', '') : null;
        res.writeHead(200);
        res.end(JSON.stringify({
          ready: !!client,
          authenticated: !!(client?.user),
          number,
        }));
      } else if (req.url === '/qr') {
        if (currentQrBase64) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from(currentQrBase64, 'base64'));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No QR available' }));
        }
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      return;
    }

    // POST endpoints
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
            }));
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
    console.log('Notify HTTP server on port ' + port);
    console.log('  POST /send - Send a WhatsApp message');
    console.log('  GET  /status - Bot status');
    console.log('  GET  /qr - QR code image');
  });

  return server;
}
