import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, isLidUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as sessionStore from './src/session-store.js';
import * as authFlow from './src/auth-flow.js';
import * as messageRelay from './src/message-relay.js';
import * as adminCommands from './src/admin-cmds.js';
import * as scripts from './src/scripts.js';
import * as notify from './src/notify.js';
import * as heartbeat from './src/heartbeat.js';
import { log } from './src/logger.js';

log('');
log('============================================');
log('  WHATSAPP RELAY BOT (Baileys)');
log('============================================');
log('');

sessionStore.load();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = process.env.SESSION_PATH || path.join(__dirname, 'data', 'baileys-sessions');
try { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}

const GRUPOS_PATH = path.join(__dirname, 'data', 'grupos.json');

let sock = null;
let reconnectTimer = null;
let sessionTimeoutInterval = null;
let aptoToGroupJid = {};
let botNumber = null;
let botName = null;
let discoverAttempts = 0;
const lidToJid = new Map();

function loadGroupMapping() {
  try {
    if (fs.existsSync(GRUPOS_PATH)) {
      aptoToGroupJid = JSON.parse(fs.readFileSync(GRUPOS_PATH, 'utf-8'));
      log('Group mapping loaded: ' + Object.keys(aptoToGroupJid).length + ' groups');
    }
  } catch (e) {
    log('Error loading group mapping: ' + e.message);
    aptoToGroupJid = {};
  }
}

function saveGroupMapping() {
  try {
    fs.writeFileSync(GRUPOS_PATH, JSON.stringify(aptoToGroupJid, null, 2), 'utf-8');
  } catch (e) {
    log('Error saving group mapping: ' + e.message);
  }
}

async function discoverGroups() {
  try {
    const groups = await sock.groupFetchAllParticipating();
    const discovered = {};
    const ambiguousApartments = new Set();
    let count = 0;
    for (const [jid, g] of Object.entries(groups)) {
      const match = g.subject.match(/\b(\d{3})\b/);
      if (match) {
        const apto = match[1];
        if (discovered[apto] && discovered[apto] !== jid) {
          delete discovered[apto];
          ambiguousApartments.add(apto);
          log('GROUP DISCOVER ERROR: more than one participating group matches apto=' + apto);
          continue;
        }
        if (ambiguousApartments.has(apto)) continue;
        discovered[apto] = jid;
        if (aptoToGroupJid[apto] !== jid) {
          log('GROUP DISCOVER: apto=' + apto + ' jid=' + jid + ' name="' + g.subject + '"');
          count++;
        }
      }
    }
    // This response contains only groups in which the bot currently belongs;
    // replacing the cache prevents authorizing a stale or removed group.
    aptoToGroupJid = discovered;
    saveGroupMapping();
    if (count > 0) discoverAttempts = 0;
    log('Group discovery: ' + count + ' new, ' + Object.keys(aptoToGroupJid).length + ' total mapped');
    if (count === 0 && Object.keys(aptoToGroupJid).length === 0 && discoverAttempts < 3) {
      discoverAttempts++;
      log('No groups found, retry ' + discoverAttempts + '/3 in 30s...');
      setTimeout(discoverGroups, 30000);
    }
  } catch (e) {
    log('Group discovery error: ' + e.message);
    if (discoverAttempts < 3) {
      discoverAttempts++;
      setTimeout(discoverGroups, 30000);
    }
  }
}

function getProxyAgent() {
  const proxyUrl = process.env.BOT_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  log('BOT_PROXY env: ' + (process.env.BOT_PROXY ? 'SET (redacted)' : 'NOT SET'));
  log('HTTPS_PROXY env: ' + (process.env.HTTPS_PROXY ? 'SET (redacted)' : 'NOT SET'));
  log('HTTP_PROXY env: ' + (process.env.HTTP_PROXY ? 'SET (redacted)' : 'NOT SET'));
  if (!proxyUrl) return undefined;
  log('Using proxy: ' + proxyUrl.replace(/:([^:@]+)@/, ':***@'));
  try {
    if (proxyUrl.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
    return new HttpsProxyAgent(proxyUrl);
  } catch (e) {
    log('Proxy agent error: ' + e.message);
    return undefined;
  }
}

async function startBot() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  loadGroupMapping();

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

  const pendingPhone = notify.getPendingPairingPhone();
  if (pendingPhone) {
    setTimeout(async () => {
      try {
        log('Requesting pairing code for ' + pendingPhone + '...');
        const code = await sock.requestPairingCode(pendingPhone);
        notify.setPairingCode(code);
        notify.clearPendingPairingPhone();
        notify.setQr(null);
        log('Pairing code for ' + pendingPhone + ': ' + code);
      } catch (e) {
        log('Pairing code error: ' + e.message);
      }
    }, 3000);
  }

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
      botNumber = number;
      botName = sock?.user?.name || 'Relay Bot';
      log('Connected. Number: ' + number);
      log('sock.user: id=' + (sock?.user?.id || '') + ' lid=' + (sock?.user?.lid || '') + ' verified=' + (!!sock?.user));
      notify.setClient(sock);
      notify.setLastError(null);
      heartbeat.startHeartbeat();

      discoverGroups();

      if (sessionTimeoutInterval) clearInterval(sessionTimeoutInterval);
      sessionTimeoutInterval = setInterval(() => {
        const before = sessionStore.getActiveSessions().length;
        sessionStore.cleanupExpired();
        const after = sessionStore.getActiveSessions().length;
        if (before !== after) log('SESSION CLEANUP: ' + (before - after) + ' expired sessions removed');
      }, 60000);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const reason = err?.message || 'unknown';
      const code = err?.output?.statusCode || err?.statusCode || err?.data?.code;
      log('Disconnected. Reason: ' + reason + ' Code: ' + code);
      heartbeat.stopHeartbeat();
      notify.setLastError('Disconnected: ' + reason + ' (code: ' + code + ')');
      if (sessionTimeoutInterval) clearInterval(sessionTimeoutInterval);

      if (code === DisconnectReason.loggedOut || code === 401) {
        log('Session logged out. Clearing session files...');
        notify.setQr(null);
        notify.setClient(null);
        sessionStore.expireAll();
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
      log('=== MSG UPDATE === ' + JSON.stringify({ key, update }));
    }
  });

  sock.ev.on('message-receipt.update', updates => {
    for (const { key, receipt } of updates) {
      log('=== RECEIPT === ' + JSON.stringify({ key, receipt }));
    }
  });

  const COMMANDS = ['/help', '/status', '/endsession', '/relogin', '/cancel'];
  const GROUP_COMMANDS = ['/session', '/close', '/who', '/status', '/ping'];

  function matchCommand(text) {
    const trimmed = text.trim();
    for (const cmd of COMMANDS) {
      if (trimmed.toLowerCase() === cmd) return cmd;
    }
    for (const cmd of GROUP_COMMANDS) {
      if (trimmed.toLowerCase() === cmd) return cmd;
    }
    return null;
  }

  async function handlePrivateCommand(callerJid, command, sendReply) {
    switch (command) {
      case '/help': {
        await sendReply(scripts.get('cmd_help'));
        return true;
      }
      case '/status': {
        const session = sessionStore.getSession(callerJid);
        if (!session) {
          await sendReply(scripts.get('cmd_status_none'));
          return true;
        }
        const remaining = Math.max(0, 1800000 - (Date.now() - new Date(session.lastActivity).getTime()));
        const min = Math.floor(remaining / 60000);
        await sendReply(scripts.get('cmd_status_active', {
          apto: session.apartment,
          lastActivity: session.lastActivity || 'desconocido',
          remaining: min + ' minutos',
        }));
        return true;
      }
      case '/endsession':
      case '/logout': {
        sessionStore.deleteSession(callerJid);
        await sendReply(scripts.get('cmd_endsession_done'));
        return true;
      }
      case '/relogin': {
        sessionStore.deleteSession(callerJid);
        authFlow.cancelAuth(callerJid);
        await sendReply(scripts.get('cmd_relogin_prompt'));
        return true;
      }
      case '/cancel': {
        authFlow.cancelAuth(callerJid);
        await sendReply(scripts.get('cmd_cancel_done'));
        return true;
      }
      default:
        return false;
    }
  }

  async function waitForLidMap(lidJid, timeoutMs) {
    if (lidToJid.has(lidJid)) return lidToJid.get(lidJid);
    if (timeoutMs <= 0) return null;
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (lidToJid.has(lidJid)) {
          clearInterval(check); clearTimeout(fallback);
          resolve(lidToJid.get(lidJid));
        }
      }, 200);
      const fallback = setTimeout(() => {
        clearInterval(check);
        resolve(null);
      }, timeoutMs);
    });
  }

  async function sendReply(targetJid, content) {
    const activeSession = isLidUser(targetJid) ? sessionStore.getSession(targetJid) : null;
    const destination = activeSession?.replyJid || lidToJid.get(targetJid) || targetJid;
    log('=== SEND target=' + targetJid + ' route=' + destination + ' text="' + (content || '').slice(0, 50) + '" ===');
    try {
      const result = await sock.sendMessage(destination, { text: content });
      log('=== SEND OK id=' + (result?.key?.id || '') + ' ===');
    } catch (e) {
      log('=== SEND ERROR: ' + e.message + ' ===');
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

        const isGroup = remoteJid.endsWith('@g.us');
        const isPrivate = remoteJid.endsWith('@s.whatsapp.net') || isLidUser(remoteJid);
        if (!isGroup && !isPrivate) continue;

        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     '';
        if (!text.trim()) continue;

        const command = matchCommand(text);

        if (isPrivate) {
          const callerJid = remoteJid;
          const senderPn = msg.key?.senderPn || null;
          // senderPn is supplied by WhatsApp when remoteJid is a privacy LID.
          // It is retained only as an internal delivery route.
          const replyJid = isLidUser(callerJid)
            ? (senderPn || lidToJid.get(callerJid) || callerJid)
            : callerJid;
          if (isLidUser(callerJid) && senderPn) lidToJid.set(callerJid, senderPn);
          const route = { replyJid };
          log('PRIVATE ROUTE: caller=' + callerJid + ' senderPn=' + (senderPn || '') + ' reply=' + replyJid);
          log('PRIVATE from=' + callerJid + ' text="' + text.slice(0, 50) + '"');

          if (command && ['/help', '/status', '/endsession', '/logout', '/relogin', '/cancel'].includes(command)) {
            log('PRIVATE COMMAND: ' + command);
            const replyFn = (content) => sendReply(callerJid, content);
            await handlePrivateCommand(callerJid, command, replyFn);
            continue;
          }

          if (authFlow.isInAuth(callerJid)) {
            log('PRIVATE: continuing auth');
            const retryDiscover = async () => { try { await discoverGroups(); } catch (e) { log('RETRY DISCOVER error: ' + e.message); } };
            const result = await authFlow.handleMessage(callerJid, text,
              sendReply,
              aptoToGroupJid,
              retryDiscover,
              route);
            if (result.action === 'authenticated' && result.session) {
              const lidJid = result.session.callerJid;
              sessionStore.setSession(lidJid, result.session);
              if (result.session.replyJid) lidToJid.set(lidJid, result.session.replyJid);
              log('PRIVATE AUTH OK: apto=' + result.session.apartment + ' group=' + result.session.groupJid + ' lid=' + lidJid);
              await sendReply(lidJid, scripts.get('session_created', { apto: result.session.apartment }));
            }
            log('PRIVATE AUTH: action=' + result.action);
            continue;
          }

          const session = sessionStore.getSession(callerJid);
          if (session && session.state === 'ACTIVE') {
            log('PRIVATE RELAY: apto=' + session.apartment + ' group=' + session.groupJid);
            await messageRelay.relayToGroup(sock, session, text, msg);
            sessionStore.updateSession(callerJid, {});
            continue;
          }

          log('PRIVATE: starting auth');
          const retryDiscover = async () => { try { await discoverGroups(); } catch (e) { log('RETRY DISCOVER error: ' + e.message); } };
          const result = await authFlow.handleMessage(callerJid, text,
            sendReply,
            aptoToGroupJid,
            retryDiscover,
            route);
          log('PRIVATE AUTH: action=' + result.action);
        }

        if (isGroup) {
          log('GROUP from=' + remoteJid + ' participant=' + (msg.key.participant || '') + ' text="' + text.slice(0, 50) + '"');

          const groupJid = remoteJid;

          if (command && ['/session', '/close', '/who', '/status', '/ping'].includes(command)) {
            let groupMetadata = null;
            try {
              groupMetadata = await sock.groupMetadata(groupJid);
            } catch (e) { /* ignore */ }
            if (!adminCommands.isAuthorized(msg, sock, groupMetadata)) {
              log('GROUP: unauthorized command attempt');
              await sendReply(groupJid, scripts.get('group_not_authorized'));
              continue;
            }
            const session = sessionStore.getSessionByGroup(groupJid);
            log('GROUP COMMAND: ' + command + ' session=' + (session ? session.callerJid : 'none'));
            await adminCommands.handleGroupCommand(command, [], session, sock, groupJid, null);
            continue;
          }

          const session = sessionStore.getSessionByGroup(groupJid);
          if (session && session.state === 'ACTIVE') {
            log('GROUP RELAY: to user=' + session.callerJid);
            const participant = msg.key.participant || groupJid;
            const senderName = msg.pushName || 'Miembro del grupo';
            const displayText = text;
            await messageRelay.relayToUser(sock, session, displayText, msg);
            sessionStore.updateSession(session.callerJid, {});
            continue;
          }

          log('GROUP: no active session for this group, ignoring');
        }
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
