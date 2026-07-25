import 'dotenv/config';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import * as sessionStore from './src/session-store.js';
import * as authFlow from './src/auth-flow.js';
import * as adminCommands from './src/admin-cmds.js';
import * as messageRelay from './src/message-relay.js';
import * as notify from './src/notify.js';
import * as heartbeat from './src/heartbeat.js';
import * as scripts from './src/scripts.js';

console.log('');
console.log('============================================');
console.log('  WHATSAPP PROXY BOT');
console.log('============================================');
console.log('');

sessionStore.load();
scripts.load();

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'whatsapp-proxy', dataPath: './sessions' }),
  puppeteer: {
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-gpu'],
  },
});

client.on('qr', async (qr) => {
  console.log('Escanea este QR con WhatsApp:');
  qrcode.generate(qr, { small: true });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const qrPath = path.join(__dirname, 'qr.png');
  try {
    await QRCode.toFile(qrPath, qr, { width: 400, margin: 1, color: { dark: '#000', light: '#fff' } });
    console.log('QR guardado como imagen:', qrPath);
    const { exec } = await import('child_process');
    exec(`start "" "${qrPath}"`);
  } catch (e) {
    console.error('Error generando QR imagen:', e.message);
  }
});

client.on('ready', () => {
  console.log('✅ WhatsApp client ready');
  console.log('   Número: ' + (client.info ? client.info.wid.user : 'desconocido'));

  heartbeat.startHeartbeat();
  messageRelay.startPolling(client);

  messageRelay.onAdminMessage((session, msg) => {
    console.log('Admin reply for', session.apto, ':', msg.content.slice(0, 50));
  });
});

client.on('authenticated', () => {
  console.log('WhatsApp authenticated');
});

client.on('auth_failure', (msg) => {
  console.error('WhatsApp auth failure:', msg);
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp disconnected:', reason);
  heartbeat.stopHeartbeat();
});

client.on('message', async (msg) => {
  if (msg.fromMe) return;
  if (msg.isStatus) return;
  if (msg.type !== 'chat' && msg.type !== 'text') return;

  const phone = msg.from.replace('@c.us', '').replace('@s.whatsapp.net', '');
  const text = msg.body.trim();
  if (!text) return;

  async function sendReply(content) {
    try {
      await client.sendMessage(msg.from, content);
    } catch (e) {
      console.error('Error sending reply:', e.message);
    }
  }

  if (adminCommands.isAdminMessage(phone)) {
    const handled = await adminCommands.handleCommand(phone, text, client, sendReply);
    if (handled) return;
  }

  if (authFlow.isInAuth(phone)) {
    await authFlow.handleMessage(phone, text, sendReply);
    return;
  }

  const session = sessionStore.getSession(phone);
  if (session && session.status === 'activo') {
    console.log('Relaying from', session.apto, ':', text.slice(0, 50));
    await messageRelay.relayToChat(phone, session, text, client);
    await sendReply(scripts.get('confirmation_sent'));
    return;
  }

  await authFlow.handleMessage(phone, text, sendReply);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED:', reason);
});

const BOT_PORT = parseInt(process.env.BOT_PORT || '3002', 10);
notify.setClient(client);
notify.startNotifyServer(BOT_PORT);

client.initialize();
