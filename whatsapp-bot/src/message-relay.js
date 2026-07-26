import * as scripts from './scripts.js';
import { log } from './logger.js';

export async function relayToGroup(sock, session, text) {
  if (!sock || !session || !session.groupJid) return;
  const prefix = scripts.get('relay_from_tenant', {
    apto: session.apto,
  });
  const fullText = prefix + '\n' + text;
  try {
    const result = await sock.sendMessage(session.groupJid, { text: fullText });
    log('RELAY_TO_GROUP: apto=' + session.apto + ' id=' + (result?.key?.id || ''));
  } catch (e) {
    log('RELAY_TO_GROUP ERROR: ' + e.message);
  }
}
