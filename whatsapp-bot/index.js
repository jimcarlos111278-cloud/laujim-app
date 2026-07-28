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
import * as api from './src/api-client.js';
import { log } from './src/logger.js';
import * as ladder from './src/ladder.js';

log('');
log('============================================');
log('  WHATSAPP RELAY BOT (Baileys v6)');
log('  Proyecto Sabanilla v2.8.0');
log('============================================');
log('');

sessionStore.load();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSION_DIR = process.env.SESSION_PATH || path.join(DATA_DIR, 'baileys-sessions');
try { if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true }); } catch {}
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const GRUPOS_PATH = path.join(DATA_DIR, 'grupos.json');

let sock = null;
let reconnectTimer = null;
let sessionTimeoutInterval = null;
let aptoToGroupJid = {};
let botNumber = null;
let botName = null;
let discoverAttempts = 0;
let cachedSettings = {};

async function loadSettings() {
  try {
    const settings = await api.getSettings();
    const map = {};
    for (const s of settings) map[s.key] = s.value;
    cachedSettings = map;
    const enabled = map['whatsapp_bot_enabled'] === 'true';
    if (!enabled && sock) {
      log('SETTINGS: bot disabled by setting');
    }
    const msgPrefix = 'whatsapp_bot_msg_';
    const scriptUpdates = {};
    for (const [key, val] of Object.entries(map)) {
      if (key.startsWith(msgPrefix)) {
        scriptUpdates[key.slice(msgPrefix.length)] = val;
      }
    }
    if (Object.keys(scriptUpdates).length > 0) {
      scripts.setCache(scriptUpdates);
      log('SETTINGS: loaded ' + Object.keys(scriptUpdates).length + ' script overrides');
    }
    log('SETTINGS: loaded ' + Object.keys(map).length + ' settings');
  } catch (e) {
    log('SETTINGS: load error: ' + e.message);
  }
}

function getAdminName() {
  return cachedSettings['whatsapp_bot_admin_name'] || 'Administrador';
}

function getAdminPhone() {
  return cachedSettings['whatsapp_admin_phone'] || '';
}

function loadGroupMapping() {
  try {
    if (fs.existsSync(GRUPOS_PATH)) {
      aptoToGroupJid = JSON.parse(fs.readFileSync(GRUPOS_PATH, 'utf-8'));
      log('Group mapping loaded: ' + Object.keys(aptoToGroupJid).length + ' groups (cached)');
    }
  } catch (e) {
    log('Error loading group mapping: ' + e.message);
    aptoToGroupJid = {};
  }
}

function saveGroupMapping() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
          log('GROUP DISCOVER: multiple groups match apto=' + apto + ', skipping');
          continue;
        }
        if (ambiguousApartments.has(apto)) continue;
        discovered[apto] = jid;
        if (aptoToGroupJid[apto] !== jid) {
          log('GROUP DISCOVER: apto=' + apto + ' group=' + g.subject);
          count++;
        }
      }
    }
    aptoToGroupJid = discovered;
    saveGroupMapping();
    if (count > 0) discoverAttempts = 0;
    log('Group discovery: ' + count + ' new, ' + Object.keys(aptoToGroupJid).length + ' total');
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

function maskJid(jid) {
  if (!jid) return '';
  return jid.split('@')[0].slice(0, 4) + '...@' + jid.split('@')[1];
}

function getProxyAgent() {
  const proxyUrl = process.env.BOT_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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
  loadSettings().catch(e => log('SETTINGS startup error: ' + e.message));

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
  if (agent) sockOpts.agent = agent;

  sock = makeWASocket(sockOpts);
  notify.setClient(sock);

  const pendingPhone = notify.getPendingPairingPhone();
  if (pendingPhone) {
    setTimeout(async () => {
      try {
        log('Requesting pairing code...');
        const code = await sock.requestPairingCode(pendingPhone);
        notify.setPairingCode(code);
        notify.clearPendingPairingPhone();
        notify.setQr(null);
        log('Pairing code ready');
      } catch (e) {
        log('Pairing code error: ' + e.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log('QR received');
      notify.clearPairingCode();
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 1, color: { dark: '#000', light: '#fff' } });
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        notify.setQr(base64);
        notify.setLastError(null);
      } catch (e) {
        log('Error generating QR: ' + e.message);
      }
    }

    if (connection === 'open') {
      const number = sock?.user?.id ? sock.user.id.split(':')[0].replace('@s.whatsapp.net', '') : 'unknown';
      botNumber = number;
      botName = sock?.user?.name || 'Relay Bot';
      log('Connected. Number: ' + number);
      notify.setClient(sock);
      notify.setLastError(null);
      heartbeat.startHeartbeat();

      discoverGroups();

      if (sessionTimeoutInterval) clearInterval(sessionTimeoutInterval);
      sessionTimeoutInterval = setInterval(() => {
        const before = sessionStore.getActiveSessions().length;
        sessionStore.cleanupExpired();
        const after = sessionStore.getActiveSessions().length;
        if (before !== after) log('SESSION CLEANUP: ' + (before - after) + ' expired');
      }, 60000);

      setInterval(loadSettings, 60000);
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
      const id = key?.id || '';
      const status = update?.status ?? '';
      const statusNames = { 0: 'ERROR', 1: 'PENDING', 2: 'SERVER_ACK', 3: 'DELIVERY_ACK', 4: 'READ', 5: 'PLAYED' };
      const sname = statusNames[status] || 'STATUS_' + status;
      if (id && status !== undefined) {
        log('=== MSG STATUS === id=' + id + ' status=' + status + ' (' + sname + ')');
        ladder.updateByMsgId(id, sname, '');
      }
    }
  });

  sock.ev.on('message-receipt.update', updates => {
    for (const { key, receipt } of updates) {
      const id = key?.id || '';
      if (id && receipt) {
        const rtype = receipt?.type || '';
        log('=== RECEIPT === id=' + id + ' type=' + rtype);
        ladder.updateByMsgId(id, 'RECEIPT_' + rtype, '');
      }
    }
  });

  const COMMANDS = ['/help', '/status', '/endsession', '/relogin', '/cancel', '/menu'];
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

  async function sendToTenant(convJid, content, source) {
    if (!sock) { log('SEND_TO_TENANT: no sock, skipping source=' + (source || '?')); return false; }
    const session = sessionStore.getSession(convJid);
    const deliveryJid = session?.deliveryJid || convJid;
    const masked = deliveryJid.split('@')[0].slice(0, 4) + '...@' + deliveryJid.split('@')[1];
    const sessionInfo = session ? 'apto=' + session.apto + ' deliveryJid=' + session.deliveryJid : 'no-session';
    log('SEND_TO_TENANT source=' + (source || '?') + ' session=' + sessionInfo + ' deliveryJid=' + deliveryJid + ' contentLen=' + (content || '').length + ' contentStart="' + (content || '').slice(0, 80) + '"');
    const aptoLabel = session?.apto || '';
    ladder.push('Bot→Usr', 'Bot', maskJid(deliveryJid), source, content, '', 'PENDING', '', aptoLabel);
    try {
      const result = await sock.sendMessage(deliveryJid, { text: content });
      const msgId = result?.key?.id || '';
      log('SEND_TO_TENANT OK source=' + (source || '?') + ' id=' + msgId + ' route=' + masked);
      ladder.updateLatest('OK', 'id=' + msgId);
      return true;
    } catch (e) {
      log('SEND_TO_TENANT ERROR source=' + (source || '?') + ' ' + e.message + ' deliveryJid=' + deliveryJid);
      ladder.updateLatest('ERROR', e.message.slice(0, 40));
      return false;
    }
  }

  async function handlePrivateCommand(convJid, command) {
    const session = sessionStore.getSession(convJid);
    switch (command) {
      case '/help': {
        await sendToTenant(convJid, scripts.get('cmd_help'));
        return true;
      }
      case '/status': {
        if (!session) {
          await sendToTenant(convJid, scripts.get('cmd_status_none'));
          return true;
        }
        const remaining = Math.max(0, 1800000 - (Date.now() - new Date(session.lastActivity).getTime()));
        const min = Math.floor(remaining / 60000);
        await sendToTenant(convJid, scripts.get('cmd_status_active', {
          apto: session.apto,
          lastActivity: session.lastActivity || 'desconocido',
          remaining: min + ' minutos',
        }));
        return true;
      }
      case '/endsession':
      case '/logout': {
        sessionStore.deleteSession(convJid);
        await sendToTenant(convJid, scripts.get('cmd_endsession_done'));
        return true;
      }
      case '/relogin': {
        sessionStore.deleteSession(convJid);
        authFlow.cancelAuth(convJid);
        await sendToTenant(convJid, scripts.get('cmd_relogin_prompt'));
        return true;
      }
      case '/cancel': {
        authFlow.cancelAuth(convJid);
        await sendToTenant(convJid, scripts.get('cmd_cancel_done'));
        return true;
      }
      case '/menu': {
        authFlow.cancelAuth(convJid);
        const retryDiscover = async () => { try { await Promise.race([discoverGroups(), new Promise(r => setTimeout(r, 10000))]); } catch {} };
        const result = await authFlow.handleMessage(convJid, '', sendToTenant, aptoToGroupJid, retryDiscover);
        return true;
      }
      default:
        return false;
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    log('=== UPSERT START === type=' + type + ' count=' + messages.length);
    for (const msg of messages) {
      try {
        const msgKey = msg.key;
        log('MSG_KEY: fromMe=' + msgKey.fromMe + ' id=' + (msgKey.id || '') + ' remoteJid=' + (msgKey.remoteJid || '') + ' participant=' + (msgKey.participant || '') + ' senderPn=' + (msgKey.senderPn || '') + ' conversationJid=' + (msgKey.conversationJid || ''));

        if (msgKey.fromMe) { log('MSG: skipped fromMe'); continue; }
        if (!msg.message) { log('MSG: skipped no message body'); continue; }

        const remoteJid = msgKey.remoteJid;
        if (!remoteJid) { log('MSG: skipped no remoteJid'); continue; }

        const isGroup = remoteJid.endsWith('@g.us');
        const isPrivate = remoteJid.endsWith('@s.whatsapp.net') || isLidUser(remoteJid);
        log('MSG: remoteJid=' + remoteJid + ' isGroup=' + isGroup + ' isPrivate=' + isPrivate + ' isLidUser=' + isLidUser(remoteJid));
        if (!isGroup && !isPrivate) { log('MSG: skipped not group nor private'); continue; }

        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption ||
                     msg.message.documentMessage?.caption ||
                     '';
        log('MSG: text="' + (text || '').slice(0, 80) + '" textLength=' + (text?.length || 0));

        const command = matchCommand(text);
        log('MSG: matchedCommand=' + (command || 'none'));

        if (isPrivate) {
          const convJid = remoteJid;
          const senderPnRaw = msgKey.senderPn || '';
          const deliveryJid = senderPnRaw || convJid;
          log('PRIVATE: convJid=' + convJid + ' senderPnRaw="' + senderPnRaw + '" deliveryJid=' + deliveryJid + ' same=' + (convJid === deliveryJid));

          if (command && ['/help', '/status', '/endsession', '/logout', '/relogin', '/cancel', '/menu'].includes(command)) {
            log('PRIVATE COMMAND: ' + command);
            ladder.push('Usr→Bot', maskJid(convJid), 'Bot', 'CMD_' + command, text, '', '', '', '');
            await handlePrivateCommand(convJid, command);
            continue;
          }

          if (authFlow.isInAuth(convJid)) {
            log('PRIVATE: continuing auth convJid=' + convJid + ' deliveryJid=' + deliveryJid);
            ladder.updateLatest('AUTH_CONTINUE', '');
          const retryDiscover = async () => { try { await Promise.race([discoverGroups(), new Promise(r => setTimeout(r, 10000))]); } catch (e) { log('RETRY DISCOVER error: ' + e.message); } };
          const result = await authFlow.handleMessage(convJid, text, sendToTenant, aptoToGroupJid, retryDiscover);


          if (result.action === 'authenticated' && result.session) {
              const existing = sessionStore.closeExistingSessionForGroup(result.session.groupJid);
              if (existing) log('PRIVATE AUTH: replaced existing session for group ' + result.session.groupJid);
              sessionStore.setSession(convJid, {
                ...result.session,
                conversationJid: convJid,
                deliveryJid,
              });
              log('PRIVATE AUTH OK: apto=' + result.session.apto + ' convJid=' + convJid + ' deliveryJid=' + deliveryJid);
              ladder.push('Bot→Usr', 'Bot', maskJid(deliveryJid), 'SESSION_CREATED', '✅ Sesión iniciada apto=' + result.session.apto, '', '', '', result.session.apto);
              await sendToTenant(convJid, scripts.get('session_created', { apto: result.session.apto }));
            }
            log('PRIVATE AUTH: action=' + result.action);
            continue;
          }

          const session = sessionStore.getSession(convJid);
          log('PRIVATE: session lookup convJid=' + convJid + ' found=' + !!session + ' state=' + (session?.state || 'none') + ' apto=' + (session?.apto || 'none'));

          if (session && session.state === 'ACTIVE') {
            const hasMedia = !!(msg.message.imageMessage || msg.message.videoMessage || msg.message.documentMessage || msg.message.audioMessage);
            if (hasMedia) {
              log('PRIVATE MEDIA RELAY: apto=' + session.apto + ' groupJid=' + session.groupJid);
              ladder.push('Usr→Bot', maskJid(convJid), 'Bot', 'RELAY_MEDIA', text, '', '', '', session.apto);
              await messageRelay.relayToGroup(sock, session, msg, getAdminName());
            } else if (text) {
              log('PRIVATE RELAY: apto=' + session.apto + ' groupJid=' + session.groupJid + ' text="' + text.slice(0, 40) + '"');
              ladder.push('Usr→Bot', maskJid(convJid), 'Bot', 'RELAY_TO_GROUP', text, '', '', '', session.apto);
              await messageRelay.relayToGroup(sock, session, msg, getAdminName());
            } else {
              log('PRIVATE: no text and no media, skipping');
            }
            sessionStore.updateSession(convJid, {});
            continue;
          }

          log('PRIVATE: no active session, trying auto-auth by phone');
          const phone = convJid.split('@')[0];
          const retryDiscover = async () => { try { await Promise.race([discoverGroups(), new Promise(r => setTimeout(r, 10000))]); } catch {} };
          const autoSession = await Promise.race([
            authFlow.autoAuthByPhone(convJid, phone, sendToTenant, aptoToGroupJid, retryDiscover),
            new Promise(r => setTimeout(() => r(null), 5000)),
          ]);

          if (autoSession && autoSession.apto) {
            const existing = sessionStore.closeExistingSessionForGroup(autoSession.groupJid);
            sessionStore.setSession(convJid, { ...autoSession, conversationJid: convJid, deliveryJid });
            log('AUTO_AUTH OK: convJid=' + convJid + ' phone=' + phone + ' apto=' + autoSession.apto + ' name=' + autoSession.tenantName);
            ladder.push('Bot→Usr', 'Bot', maskJid(deliveryJid), 'AUTO_AUTH', '✅ Auto auth apto=' + autoSession.apto, '', '', '', autoSession.apto);
            await sendToTenant(convJid, scripts.get('auto_auth_welcome', { name: autoSession.tenantName, apto: autoSession.apto }), 'AUTO_AUTH');
            continue;
          }

          log('PRIVATE: auto-auth failed, starting menu flow convJid=' + convJid);
          ladder.push('Usr→Bot', maskJid(convJid), 'Bot', 'MENU_START', text, '', '', '', '');
          const result = await authFlow.handleMessage(convJid, text, sendToTenant, aptoToGroupJid, retryDiscover);
          log('PRIVATE MENU: action=' + result.action);
        }

        if (isGroup) {
          const groupJid = remoteJid;
          const displayJid = groupJid.split('@')[0].slice(0, 6) + '...g.us';
          log('GROUP: groupJid=' + groupJid + ' senderPn=' + (msgKey.senderPn || '') + ' participant=' + (msgKey.participant || '') + ' fromMe=' + msgKey.fromMe);

          const session = sessionStore.getSessionByGroup(groupJid);

          let groupMetadata = null;
          let groupSubject = '';
          if (!session) {
            try {
              groupMetadata = await sock.groupMetadata(groupJid);
              groupSubject = groupMetadata?.subject || '';
              log('GROUP: metadata fetched participantsCount=' + (groupMetadata?.participants?.length || 0) + ' subject="' + groupSubject + '"');
            } catch (e) {
              log('GROUP: metadata fetch failed: ' + e.message);
            }
          } else {
            groupSubject = 'apto ' + session.apto;
            log('GROUP: using session cache for groupJid=' + groupJid + ' apto=' + session.apto);
          }

          if (command && ['/session', '/close', '/who', '/status', '/ping'].includes(command)) {
            if (!adminCommands.isAuthorized(msg, sock, groupMetadata)) {
              log('GROUP: unauthorized command attempt command=' + command);
              ladder.push('Grp→Bot', displayJid, 'Bot', 'GRP_CMD_UNAUTH', command, '', '', '', '');
              continue;
            }
            const session = sessionStore.getSessionByGroup(groupJid);
            log('GROUP COMMAND: ' + command + ' session=' + (session ? 'found apto=' + session.apto : 'none'));
            ladder.push('Grp→Bot', displayJid, 'Bot', 'GRP_CMD_' + command, text, '', '', '', session?.apto || '');
            await adminCommands.handleGroupCommand(command, [], session, sock, groupJid, sendToTenant);
            continue;
          }

          const participant = msgKey.participant || '';
          const authResult = adminCommands.isAuthorizedForRelay(msg, groupMetadata, groupJid);
          log('GROUP: participant=' + participant + ' isAuthorized=' + authResult + ' groupMetadata=' + (groupMetadata ? 'ok' : 'null'));
          if (!authResult) {
            log('GROUP: non-admin message ignored participant=' + participant);
            ladder.push('Grp→Bot', displayJid, 'Bot', 'GRP_SKIP_UNAUTH', text, '', '', '', '');
            continue;
          }

          log('GROUP: getSessionByGroup groupJid=' + groupJid + ' found=' + !!session + ' state=' + (session?.state || 'none') + ' apto=' + (session?.apto || 'none'));
          if (session && session.state === 'ACTIVE') {
            log('GROUP RELAY: apto=' + session.apto + ' convJid=' + (session.conversationJid || 'none') + ' deliveryJid=' + (session.deliveryJid || 'none') + ' text="' + text.slice(0, 40) + '"');
            ladder.push('Grp→Bot', displayJid + '(' + groupSubject + ')', 'Bot', 'GROUP_RELAY', text, '', '', '', session.apto);
            const displayText = text;
            const prefix = scripts.get('relay_from_group', { apto: session.apto, adminName: getAdminName() });
            const fullText = prefix + '\n' + displayText;
            log('GROUP RELAY: prefix="' + prefix.slice(0, 40) + '" fullTextLength=' + fullText.length);
            await sendToTenant(session.conversationJid, fullText, 'GROUP_RELAY');
            sessionStore.updateSession(session.conversationJid, {});
            log('GROUP RELAY: completed call to sendToTenant');
            continue;
          }

          const apto = aptoToGroupJid ? Object.keys(aptoToGroupJid).find(k => aptoToGroupJid[k] === groupJid) : null;
          log('GROUP: no active session for groupJid=' + groupJid + ' mappedApto=' + (apto || 'none') + ' aptoToGroupJid keys=' + Object.keys(aptoToGroupJid || {}).length);
          ladder.push('Grp→Bot', displayJid, 'Bot', 'GRP_NO_SESSION', text, '', '', '', apto || '');
        }
      } catch (e) {
        log('=== UPSERT ERROR === ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' '));
      }
    }
    const ladderDump = ladder.printSession(12);
    if (ladderDump) log(ladderDump);
    log('=== UPSERT END ===');
  });
}

process.on('uncaughtException', (err) => {
  log('UNCAUGHT: ' + err.message);
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED: ' + (reason?.message || reason));
});

process.on('SIGTERM', () => {
  log('SIGTERM received, closing...');
  if (sock?.ws?.readyState === sock?.ws?.OPEN) sock.ws.close(1000, 'deploy');
  setTimeout(() => process.exit(0), 3000);
});

process.on('SIGINT', () => {
  log('SIGINT received, closing...');
  if (sock?.ws?.readyState === sock?.ws?.OPEN) sock.ws.close(1000, 'shutdown');
  setTimeout(() => process.exit(0), 3000);
});

const BOT_PORT = parseInt(process.env.PORT || process.env.BOT_PORT || '3002', 10);
notify.startNotifyServer(BOT_PORT);

startBot().catch(e => log('FATAL: ' + e.message));
