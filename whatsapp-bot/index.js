import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, isLidUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { rm } from 'fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as sessionStore from './src/session-store.js';
import * as authFlow from './src/auth-flow.js';
import * as adminCommands from './src/admin-cmds.js';
import * as messageRelay from './src/message-relay.js';
import * as notify from './src/notify.js';
import * as heartbeat from './src/heartbeat.js';
import * as scripts from './src/scripts.js';
import { log } from './src/logger.js';

log('');
log('============================================');
log('  WHATSAPP PROXY BOT (Baileys)');
log('============================================');
log('');

sessionStore.load();
scripts.load().catch(e => log('Scripts load error: ' + e.message));

const SESSION_DIR = process.env.SESSION_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'baileys-sessions');
try { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}

let sock = null;
let reconnectTimer = null;

function getProxyAgent() {
  const proxyUrl = process.env.BOT_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  log('BOT_PROXY env: ' + (process.env.BOT_PROXY ? 'SET (redacted)' : 'NOT SET'));
  log('HTTPS_PROXY env: ' + (process.env.HTTPS_PROXY ? 'SET (redacted)' : 'NOT SET'));
  log('HTTP_PROXY env: ' + (process.env.HTTP_PROXY ? 'SET (redacted)' : 'NOT SET'));
  if (!proxyUrl) return undefined;
  log('Using proxy: ' + proxyUrl.replace(/:([^:@]+)@/, ':***@'));
  try {
    if (proxyUrl.startsWith('socks')) {
      return new SocksProxyAgent(proxyUrl);
    }
    return new HttpsProxyAgent(proxyUrl);
  } catch (e) {
    log('Proxy agent error: ' + e.message);
    return undefined;
  }
}

async function startBot() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  const { version } = await fetchLatestBaileysVersion();
  log('WA version: ' + version.join('.'));

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const sockOpts = {
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['Laujim APP', 'Chrome', '1.0'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    qrTimeout: 0,
    keepAliveIntervalMs: 25000,
  };

  const agent = getProxyAgent();
  if (agent) {
    sockOpts.agent = agent;
    log('Proxy agent configured and attached to Baileys');
  } else {
    log('No proxy agent - connecting directly');
  }

  sock = makeWASocket(sockOpts);

  notify.setClient(sock);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log('QR received from WhatsApp');
      notify.clearPairingCode();
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 1, color: { dark: '#000', light: '#fff' } });
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        notify.setQr(base64);
        notify.setLastError(null);
        log('QR ready (base64, length: ' + base64.length + ')');
      } catch (e) {
        log('Error generating QR: ' + e.message);
      }
    }

    if (connection === 'open') {
      const number = sock?.user?.id ? sock.user.id.split(':')[0].replace('@s.whatsapp.net', '') : 'unknown';
      log('Connected. Number: ' + number);
      notify.setClient(sock);
      notify.setLastError(null);
      heartbeat.startHeartbeat();
      messageRelay.startPolling(sock);
      messageRelay.onAdminMessage((session, msg) => {
        log('Admin reply for ' + session.apto + ': ' + msg.content.slice(0, 50));
      });
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const reason = err?.message || 'unknown';
      const code = err?.output?.statusCode || err?.statusCode || err?.data?.code;
      log('Disconnected. Reason: ' + reason + ' Code: ' + code);
      heartbeat.stopHeartbeat();
      notify.setLastError('Disconnected: ' + reason + ' (code: ' + code + ')');

      if (code === DisconnectReason.loggedOut || code === 401) {
        log('Session logged out. Clearing session files...');
        notify.setQr(null);
        notify.setClient(null);
        try {
          if (fs.existsSync(SESSION_DIR)) {
            const files = fs.readdirSync(SESSION_DIR);
            for (const f of files) fs.rmSync(path.join(SESSION_DIR, f), { recursive: true, force: true });
            log('Session directory cleared (' + files.length + ' files)');
          }
        } catch (e) {
          log('Error clearing session: ' + e.message);
        }
        reconnectTimer = setTimeout(startBot, 30000);
      } else {
        log('Reconnecting in 5s...');
        reconnectTimer = setTimeout(startBot, 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  function getTimeoutPromise(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_' + ms + 'ms')), ms));
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    log('Messages event type=' + type + ' count=' + messages.length);
    for (const msg of messages) {
      try {
        log('MSG key=' + msg.key?.remoteJid + ' fromMe=' + msg.key?.fromMe + ' hasMsg=' + !!msg.message);
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;
        const isLid = isLidUser(remoteJid);
        const isNormal = remoteJid.endsWith('@s.whatsapp.net');
        if (!isLid && !isNormal) continue;

        const phone = isNormal ? remoteJid.replace('@s.whatsapp.net', '') : remoteJid;
        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     '';
        log('MSG from=' + phone + ' text="' + (text || '').slice(0, 50) + '"');
        if (!text.trim()) continue;

        async function sendReply(content) {
          try {
            await Promise.race([
              sock.sendMessage(remoteJid, { text: content }),
              getTimeoutPromise(15000),
            ]);
          } catch (e) {
            log('Error sending reply to ' + remoteJid + ': ' + e.message);
          }
        }

        log('Handler branch: phone=' + phone + ' type=' + type);

        if (adminCommands.isAdminMessage(phone)) {
          log('Branch: admin cmd');
          const handled = await adminCommands.handleCommand(phone, text, sock, sendReply);
          if (handled) { log('Branch: admin cmd handled'); continue; }
        }

        if (authFlow.isInAuth(phone)) {
          log('Branch: inAuth');
          const result = await authFlow.handleMessage(phone, text, sendReply, remoteJid);
          log('Branch: inAuth result action=' + result.action);
          continue;
        }

        const session = sessionStore.getSession(phone);
        if (session && session.status === 'activo') {
          log('Branch: relay session=' + session.apto + ' jid=' + (session.jid || 'none'));
          log('Relaying from ' + session.apto + ': ' + text.slice(0, 50));
          await messageRelay.relayToChat(phone, session, text, sock);
          await sendReply(scripts.get('confirmation_sent'));
          continue;
        }

        log('Branch: start auth (no session)');
        const result = await authFlow.handleMessage(phone, text, sendReply, remoteJid);
        log('Branch: start auth result action=' + result.action);
      } catch (e) {
        log('MSG HANDLER ERROR: ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' '));
      }
    }
  });
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT: ' + err.message + ' ' + err.stack);
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED: ' + reason);
});

const BOT_PORT = parseInt(process.env.BOT_PORT || '3002', 10);
notify.startNotifyServer(BOT_PORT);

startBot().catch(e => log('FATAL: ' + e.message + ' ' + e.stack));
