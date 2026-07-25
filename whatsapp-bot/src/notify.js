import { createServer } from 'http';

let client = null;

export function setClient(c) {
  client = c;
}

export function startNotifyServer(port) {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

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
          const number = data.to.replace(/[^0-9]/g, '') + '@c.us';
          await client.sendMessage(number, data.text);
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        } else if (req.url === '/status') {
          res.writeHead(200);
          res.end(JSON.stringify({
            ready: !!client,
            authenticated: client ? !!(client.info) : false,
            number: client && client.info ? client.info.wid.user : null,
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
  });

  server.listen(port, () => {
    console.log('Notify HTTP server on port ' + port);
    console.log('  POST /send - Send a WhatsApp message');
    console.log('  GET  /status - Bot status');
  });

  return server;
}
