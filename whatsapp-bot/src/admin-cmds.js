import * as sessionStore from './session-store.js';
import * as api from './api-client.js';
import * as scripts from './scripts.js';

function normalizePhone(phone) {
  return phone.replace(/[^0-9]/g, '');
}

export function isAdminMessage(phone) {
  const numbers = scripts.getAdminNumbers();
  if (numbers.length === 0) return false;
  return numbers.some(n => normalizePhone(phone) === n);
}

export async function handleCommand(phone, text, client, sendReply) {
  const cmd = text.trim();
  if (!cmd.startsWith('!')) return false;

  const parts = cmd.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case 'listar': {
      const active = sessionStore.getActiveSessions();
      if (active.length === 0) {
        await sendReply(scripts.get('cmd_listar_empty'));
      } else {
        let reply = '📋 *Sesiones activas:*\n\n';
        active.forEach((s, i) => {
          reply += (i + 1) + '. *' + s.apto + '* — ' + s.tenantName + '\n';
          reply += '   Última actividad: ' + timeAgo(s.lastActivity) + '\n';
        });
        await sendReply(reply);
      }
      return true;
    }

    case 'cortar': {
      if (args.length === 0) {
        await sendReply(scripts.get('cmd_cortar_usage'));
        return true;
      }
      const apto = args[0];
      const session = sessionStore.getSessionByApto(apto);
      if (!session) {
        await sendReply('❌ No hay sesión activa para el apto ' + apto);
        return true;
      }
      sessionStore.deleteSession(session.phone);
      try {
        await client.sendMessage(session.phone + '@c.us', scripts.get('session_closed'));
      } catch (e) { /* ignore */ }
      await sendReply(scripts.get('cmd_cortar_done', { apto }));
      return true;
    }

    case 'bloquear': {
      if (args.length === 0) {
        await sendReply(scripts.get('cmd_bloquear_usage'));
        return true;
      }
      const apto = args[0];
      const session = sessionStore.getSessionByApto(apto);
      if (!session) {
        await sendReply('❌ No hay sesión activa para el apto ' + apto);
        return true;
      }
      sessionStore.updateSession(session.phone, { status: 'bloqueado' });
      try {
        await client.sendMessage(session.phone + '@c.us', scripts.get('session_blocked'));
      } catch (e) { /* ignore */ }
      await sendReply(scripts.get('cmd_bloquear_done', { apto }));
      return true;
    }

    case 'mensajes': {
      if (args.length === 0) {
        await sendReply(scripts.get('cmd_mensajes_usage'));
        return true;
      }
      const apto = args[0];
      const session = sessionStore.getSessionByApto(apto);
      if (!session) {
        await sendReply('❌ No hay sesión activa para el apto ' + apto);
        return true;
      }
      try {
        const msgs = await api.getMessagesByRoom('admin-' + session.aptId);
        const recent = msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
        if (recent.length === 0) {
          await sendReply(scripts.get('cmd_mensajes_empty', { apto }));
        } else {
          let reply = '📬 *Últimos mensajes - Apto ' + apto + '*\n\n';
          recent.reverse().forEach(m => {
            const who = m.from === 'admin' ? 'Admin' : session.tenantName;
            const when = timeAgo(m.createdAt);
            reply += '*' + who + '* (' + when + '):\n' + m.content + '\n\n';
          });
          await sendReply(reply + '\n───\nPara responder, usa el chat web.');
        }
      } catch (e) {
        await sendReply('❌ Error al obtener mensajes: ' + e.message);
      }
      return true;
    }

    case 'ayuda':
    case 'help': {
      await sendReply(scripts.get('cmd_help'));
      return true;
    }

    default:
      await sendReply(scripts.get('cmd_not_found'));
      return true;
  }
}

function timeAgo(isoString) {
  if (!isoString) return 'desconocido';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'hace ' + seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return 'hace ' + minutes + 'min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'hace ' + hours + 'h';
  const days = Math.floor(hours / 24);
  return 'hace ' + days + 'd';
}
