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

  const lidToJid = new Map();

  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (c.lid && c.jid && c.jid.endsWith('@s.whatsapp.net')) {
        const lidJid = c.lid.endsWith('@lid') ? c.lid : c.lid + '@lid';
        if (!lidToJid.has(lidJid)) {
          lidToJid.set(lidJid, c.jid);
          log('LID MAP: ' + lidJid + ' -> ' + c.jid + ' (' + (c.name || c.notify || '') + ')');
        }
      }
    }
  });

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
      log('sock.user: id=' + (sock?.user?.id || '') + ' lid=' + (sock?.user?.lid || '') + ' verified=' + (!!sock?.user));
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

  sock.ev.on('messages.update', updates => {
    for (const { key, update } of updates) {
      log('=== MSG UPDATE === id=' + (key?.id || '') + ' status=' + (update?.status ?? '') + ' jid=' + (key?.remoteJid || ''));
    }
  });

  sock.ev.on('message-receipt.update', updates => {
    for (const { key, receipt } of updates) {
      log('=== RECEIPT === id=' + (key?.id || '') + ' receipt=' + (receipt ?? '') + ' jid=' + (key?.remoteJid || ''));
    }
  });

  function getTimeoutPromise(ms) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_' + ms + 'ms')), ms));
  }

  // Wait for LID MAP with timeout
  async function waitForLidMap(lidJid, timeoutMs) {
    if (lidToJid.has(lidJid)) return lidToJid.get(lidJid);
    if (timeoutMs <= 0) return null;
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (lidToJid.has(lidJid)) {
          clearInterval(check);
          clearTimeout(fallback);
          resolve(lidToJid.get(lidJid));
        }
      }, 200);
      const fallback = setTimeout(() => {
        clearInterval(check);
        resolve(null);
      }, timeoutMs);
    });
  }

  // Centralised send with full instrumentation
  async function sendWithLog(targetJid, content, label) {
    log('=== SEND START === ' + label + ' JID=' + targetJid);
    log('sock.exists=' + !!sock + ' ws.readyState=' + (sock?.ws?.readyState));
    try {
      const result = await Promise.race([
        sock.sendMessage(targetJid, { text: content }),
        getTimeoutPromise(15000),
      ]);
      log('=== SEND OK === ' + label + ' id=' + (result?.key?.id || 'unknown'));
      return result;
    } catch (e) {
      log('=== SEND ERROR === ' + label + ' JID=' + targetJid + ' err=' + e.message);
      return null;
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    log('=== UPSERT START === type=' + type + ' count=' + messages.length);
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

        log('=== MESSAGE PARSED === remoteJid=' + remoteJid + ' isLid=' + isLid);

        const phone = isNormal ? remoteJid.replace('@s.whatsapp.net', '') : remoteJid;
        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     '';
        log('MSG from=' + phone + ' text="' + (text || '').slice(0, 50) + '"');
        if (!text.trim()) continue;

        if (isLid) {
          log('LID_EXTRA: pushName=' + (msg.pushName || '') + ' participant=' + (msg.key.participant || ''));
        }

        // -- DIRECT TEST: send "TEST" before any auth logic --
        log('=== TEST SEND === intentando enviar TEST a ' + remoteJid);
        await sendWithLog(remoteJid, 'TEST', 'DIRECT_TEST');
        log('=== TEST SEND === completado');

        // Resolve @lid: wait up to 3s for LID MAP
        let replyTarget = remoteJid;
        if (isLid) {
          const resolved = await waitForLidMap(remoteJid, 3000);
          if (resolved) {
            replyTarget = resolved;
            log('LID RESOLVED: ' + remoteJid + ' -> ' + replyTarget);
          } else {
            log('LID UNRESOLVED: ' + remoteJid + ' usando @lid como fallback');
          }
        }

        log('=== AUTH START === phone=' + phone + ' type=' + type);

        if (adminCommands.isAdminMessage(phone)) {
          log('Branch: admin cmd');
          const handled = await adminCommands.handleCommand(phone, text, sock,
            (content) => sendWithLog(replyTarget, content, 'ADMIN_REPLY'));
          if (handled) { log('Branch: admin cmd handled'); continue; }
        }

        if (authFlow.isInAuth(phone)) {
          log('Branch: inAuth');
          const result = await authFlow.handleMessage(phone, text,
            (content) => sendWithLog(replyTarget, content, 'AUTH_REPLY'),
            remoteJid);
          log('=== AUTH RESULT === action=' + result.action);
          continue;
        }

        const session = sessionStore.getSession(phone);
        if (session && session.status === 'activo') {
          log('Branch: relay session=' + session.apto + ' jid=' + (session.jid || 'none'));
          log('Relaying from ' + session.apto + ': ' + text.slice(0, 50));
          await messageRelay.relayToChat(phone, session, text, sock);
          await sendWithLog(replyTarget, scripts.get('confirmation_sent'), 'CONFIRMATION');
          continue;
        }

        log('Branch: start auth (no session)');
        const result = await authFlow.handleMessage(phone, text,
          (content) => sendWithLog(replyTarget, content, 'AUTH_START'),
          remoteJid);
        log('=== AUTH RESULT === action=' + result.action);
      } catch (e) {
        log('=== UPSERT ERROR === ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' '));
      }
    }
    log('=== UPSERT END ===');
  });
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT: ' + err.message + ' ' + err.stack);
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED: ' + reason);
});

process.on('SIGTERM', () => {
  log('SIGTERM received, closing WebSocket gracefully...');
  if (sock?.ws?.readyState === sock?.ws?.OPEN) {
    sock.ws.close(1000, 'deploy');
  }
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  log('SIGINT received, closing WebSocket gracefully...');
  if (sock?.ws?.readyState === sock?.ws?.OPEN) {
    sock.ws.close(1000, 'shutdown');
  }
  setTimeout(() => process.exit(0), 3000);
});

const BOT_PORT = parseInt(process.env.BOT_PORT || '3002', 10);
notify.startNotifyServer(BOT_PORT);

startBot().catch(e => log('FATAL: ' + e.message + ' ' + e.stack));
