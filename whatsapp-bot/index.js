import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
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
console.log('  WHATSAPP PROXY BOT (Baileys)');
console.log('============================================');
console.log('');

sessionStore.load();
scripts.load();

const SESSION_DIR = process.env.SESSION_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'baileys-sessions');
try { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}

let sock = null;
let reconnectTimer = null;

async function startBot() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const { version } = await fetchLatestBaileysVersion();
  console.log('WA version: ' + version.join('.'));

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['Laujim APP', 'Chrome', '1.0'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    qrTimeout: 60,
    keepAliveIntervalMs: 25000,
  });

  notify.setClient(sock);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('QR received from WhatsApp');
      notify.clearPairingCode();
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 1, color: { dark: '#000', light: '#fff' } });
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        notify.setQr(base64);
        notify.setLastError(null);
        console.log('QR ready (base64, length: ' + base64.length + ')');
        const pendingPhone = notify.getPendingPairingPhone();
        if (pendingPhone) {
          try {
            const code = await sock.requestPairingCode(pendingPhone);
            notify.setPairingCode(code);
            console.log('Pairing code requested for ' + pendingPhone + ': ' + code);
          } catch (e) {
            console.error('Error requesting pairing code:', e.message);
            notify.setLastError('Error pairing code: ' + e.message);
          }
        }
      } catch (e) {
        console.error('Error generating QR:', e.message);
      }
    }

    if (connection === 'open') {
      const number = sock?.user?.id ? sock.user.id.split(':')[0].replace('@s.whatsapp.net', '') : 'unknown';
      console.log('Connected. Number: ' + number);
      notify.setClient(sock);
      notify.setLastError(null);
      heartbeat.startHeartbeat();
      messageRelay.startPolling(sock);
      messageRelay.onAdminMessage((session, msg) => {
        console.log('Admin reply for', session.apto, ':', msg.content.slice(0, 50));
      });
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.message || 'unknown';
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('Disconnected. Reason:', reason, 'Code:', code);
      heartbeat.stopHeartbeat();
      notify.setLastError('Disconnected: ' + reason + ' (code: ' + code + ')');

      if (code === DisconnectReason.loggedOut) {
        console.log('Session logged out. Restarting for new QR...');
        notify.setQr(null);
        notify.setClient(null);
        reconnectTimer = setTimeout(startBot, 3000);
      } else {
        console.log('Will reconnect in 10s...');
        reconnectTimer = setTimeout(startBot, 10000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) continue;

      const phone = remoteJid.replace('@s.whatsapp.net', '');
      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   '';
      if (!text.trim()) continue;

      async function sendReply(content) {
        try {
          await sock.sendMessage(remoteJid, { text: content });
        } catch (e) {
          console.error('Error sending reply:', e.message);
        }
      }

      if (adminCommands.isAdminMessage(phone)) {
        const handled = await adminCommands.handleCommand(phone, text, sock, sendReply);
        if (handled) continue;
      }

      if (authFlow.isInAuth(phone)) {
        await authFlow.handleMessage(phone, text, sendReply);
        continue;
      }

      const session = sessionStore.getSession(phone);
      if (session && session.status === 'activo') {
        console.log('Relaying from', session.apto, ':', text.slice(0, 50));
        await messageRelay.relayToChat(phone, session, text, sock);
        await sendReply(scripts.get('confirmation_sent'));
        continue;
      }

      await authFlow.handleMessage(phone, text, sendReply);
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED:', reason);
});

const BOT_PORT = parseInt(process.env.BOT_PORT || '3002', 10);
notify.startNotifyServer(BOT_PORT);

startBot().catch(e => console.error('FATAL:', e.message, e.stack));
