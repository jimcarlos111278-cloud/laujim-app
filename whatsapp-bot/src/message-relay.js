import * as scripts from './scripts.js';
import { log } from './logger.js';

function formatTimestamp() {
  return new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export async function relayToGroup(sock, session, text, originalMsg) {
  if (!sock || !session || !session.groupJid) return;
  const prefix = scripts.get('relay_from_tenant', {
    apto: session.apartment,
  });
  const fullText = prefix + '\n' + text;
  try {
    const result = await sock.sendMessage(session.groupJid, { text: fullText });
    log('RELAY_TO_GROUP: ' + session.apartment + ' id=' + (result?.key?.id || ''));
  } catch (e) {
    log('RELAY_TO_GROUP ERROR: ' + e.message);
  }
}

export async function relayToUser(sock, session, text, originalMsg) {
  if (!sock || !session || !session.callerJid) return;
  const prefix = scripts.get('relay_from_group', {
    apto: session.apartment,
  });
  const fullText = prefix + '\n' + text;
  try {
    const result = await sock.sendMessage(session.callerJid, { text: fullText });
    log('RELAY_TO_USER: ' + session.apartment + ' id=' + (result?.key?.id || ''));
  } catch (e) {
    log('RELAY_TO_USER ERROR: ' + e.message);
  }
}
