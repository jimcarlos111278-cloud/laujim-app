import * as sessionStore from './session-store.js';
import * as scripts from './scripts.js';

export function isAuthorized(msg, sock, groupMetadata) {
  if (msg.key.fromMe) return true;
  const participant = msg.key.participant || msg.key.remoteJid;
  if (!groupMetadata || !groupMetadata.participants) return false;
  return groupMetadata.participants.some(p => p.id === participant && (p.admin === 'admin' || p.admin === 'superadmin'));
}

export function isAuthorizedForRelay(msg, groupMetadata, groupJid) {
  if (msg.key.fromMe) return true;
  if (!groupMetadata || !groupMetadata.participants) {
    const session = sessionStore.getSessionByGroup(groupJid);
    return !!session;
  }
  const participant = msg.key.participant || msg.key.remoteJid;
  const isAdmin = groupMetadata.participants.some(p => p.id === participant && (p.admin === 'admin' || p.admin === 'superadmin'));
  if (isAdmin) return true;
  const session = sessionStore.getSessionByGroup(groupJid);
  return !!session;
}

export async function handleGroupCommand(command, args, session, sock, groupJid, sendToTenant) {
  switch (command) {
    case '/session': {
      if (!session) {
        await sock.sendMessage(groupJid, { text: scripts.get('group_session_none') });
        return true;
      }
      await sock.sendMessage(groupJid, {
        text: scripts.get('group_session_info', {
          name: session.tenantName,
          apto: session.apto,
          createdAt: session.createdAt || 'desconocido',
          lastActivity: session.lastActivity || 'desconocido',
        }),
      });
      return true;
    }

    case '/who': {
      if (!session) {
        await sock.sendMessage(groupJid, { text: scripts.get('group_session_none') });
        return true;
      }
      await sock.sendMessage(groupJid, {
        text: scripts.get('group_who', { name: session.tenantName, apto: session.apto }),
      });
      return true;
    }

    case '/close': {
      if (!session) {
        await sock.sendMessage(groupJid, { text: scripts.get('group_session_none') });
        return true;
      }
      sessionStore.closeExistingSessionForGroup(session.groupJid);
      await sock.sendMessage(groupJid, { text: scripts.get('group_close_done') });
      if (typeof sendToTenant === 'function' && session.conversationJid) {
        try {
          await sendToTenant(session.conversationJid, scripts.get('session_closed'));
        } catch (e) { /* ignore */ }
      }
      return true;
    }

    case '/status': {
      if (!session) {
        await sock.sendMessage(groupJid, { text: scripts.get('group_session_none') });
        return true;
      }
      await sock.sendMessage(groupJid, {
        text: scripts.get('group_session_info', {
          name: session.tenantName,
          apto: session.apto,
          createdAt: session.createdAt || 'desconocido',
          lastActivity: session.lastActivity || 'desconocido',
        }),
      });
      return true;
    }

    case '/ping': {
      await sock.sendMessage(groupJid, { text: scripts.get('group_ping') });
      return true;
    }

    default:
      return false;
  }
}
