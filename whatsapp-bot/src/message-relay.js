import * as api from './api-client.js';
import * as sessionStore from './session-store.js';
import * as scripts from './scripts.js';
import { log } from './logger.js';

let lastCheck = new Date(0).toISOString();
let pollTimer = null;
let onNewAdminMsg = null;
let botDisabled = false;

export function onAdminMessage(callback) {
  onNewAdminMsg = callback;
}

export async function relayToChat(phone, session, content, client) {
  const roomId = 'admin-' + session.aptId;
  const msg = await api.sendMessage(roomId, 'apt-' + session.aptId, 'admin', content, 'whatsapp');

  const adminNumbers = scripts.getAdminNumbers();
  for (const num of adminNumbers) {
    if (!client) break;
    const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
    const adminMsg = scripts.get('notif_admin_new', { apto: session.apto, nombre: session.tenantName, content: preview });
    try {
      await client.sendMessage(num + '@s.whatsapp.net', { text: adminMsg });
      log('Notified admin ' + num);
    } catch (e) {
      log('Error notifying admin ' + num + ': ' + e.message);
    }
  }

  return msg;
}

export async function startPolling(client) {
  if (pollTimer) clearInterval(pollTimer);
  const interval = parseInt(process.env.POLL_INTERVAL || '3000', 10);

  const poll = async () => {
    try {
      const enabled = await api.getSetting('whatsapp_bot_enabled');
      botDisabled = enabled === 'false' || enabled === null;
    } catch {}
    if (botDisabled) return;

    try {
      const messages = await api.getMessagesSince(lastCheck);
      if (messages.length > 0) {
        const sorted = messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        lastCheck = new Date(new Date(sorted[sorted.length - 1].createdAt).getTime() + 1).toISOString();

        const activeSessions = sessionStore.getActiveSessions();

        for (const msg of sorted) {
          if (msg.from !== 'admin') continue;
          if (msg.source === 'whatsapp') continue;

          const session = activeSessions.find(s => 'admin-' + s.aptId === msg.roomId);
          if (!session) continue;

          if (onNewAdminMsg) {
            onNewAdminMsg(session, msg);
          }

          const phone = session.phone;
          const text = scripts.get('relay_admin_prefix', { content: msg.content });

          try {
            let jid = session.jid || phone + '@s.whatsapp.net';
            if (jid.endsWith('@lid')) jid = jid.replace('@lid', '@s.whatsapp.net');
            await client.sendMessage(jid, { text });
            log('Forwarded admin reply to ' + session.apto + ' (' + jid + ')');
          } catch (e) {
            log('Error forwarding to tenant ' + phone + ': ' + e.message);
          }
        }
      }
    } catch (e) {
      log('Polling error: ' + e.message);
    }
  };

  poll();
  pollTimer = setInterval(poll, interval);
  log('Message polling started (every ' + interval + 'ms)');
}
