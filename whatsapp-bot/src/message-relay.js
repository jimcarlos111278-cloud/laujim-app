import * as scripts from './scripts.js';
import { log } from './logger.js';

export async function relayToGroup(sock, session, text) {
  log('RELAY_TO_GROUP: entered sock=' + !!sock + ' session=' + !!session + ' groupJid=' + (session?.groupJid || 'none') + ' apto=' + (session?.apto || 'none') + ' textLength=' + (text?.length || 0));
  if (!sock || !session || !session.groupJid) {
    log('RELAY_TO_GROUP: skipped - missing sock/session/groupJid');
    return;
  }
  const prefix = scripts.get('relay_from_tenant', { apto: session.apto });
  const fullText = prefix + '\n' + text;
  log('RELAY_TO_GROUP: prefix="' + prefix.slice(0, 40) + '" fullTextLength=' + fullText.length + ' groupJid=' + session.groupJid);
  try {
    const result = await sock.sendMessage(session.groupJid, { text: fullText });
    log('RELAY_TO_GROUP OK: apto=' + session.apto + ' id=' + (result?.key?.id || '') + ' groupJid=' + session.groupJid);
  } catch (e) {
    log('RELAY_TO_GROUP ERROR: apto=' + session.apto + ' groupJid=' + session.groupJid + ' error=' + e.message);
  }
}
