import * as scripts from './scripts.js';
import { log } from './logger.js';
import * as ladder from './ladder.js';

export async function relayToGroup(sock, session, text) {
  log('RELAY_TO_GROUP: entered sock=' + !!sock + ' session=' + !!session + ' groupJid=' + (session?.groupJid || 'none') + ' apto=' + (session?.apto || 'none') + ' textLength=' + (text?.length || 0));
  if (!sock || !session || !session.groupJid) {
    log('RELAY_TO_GROUP: skipped - missing sock/session/groupJid');
    return;
  }
  const prefix = scripts.get('relay_from_tenant', { apto: session.apto });
  const fullText = prefix + '\n' + text;
  const groupShort = session.groupJid.split('@')[0].slice(0, 6) + '...g.us';
  log('RELAY_TO_GROUP: prefix="' + prefix.slice(0, 40) + '" fullTextLength=' + fullText.length + ' groupJid=' + session.groupJid);
  ladder.push('Bot→Grp', 'Bot', groupShort, 'RELAY_TO_GROUP', fullText, '', 'PENDING', '', session.apto);
  try {
    const result = await sock.sendMessage(session.groupJid, { text: fullText });
    const msgId = result?.key?.id || '';
    log('RELAY_TO_GROUP OK: apto=' + session.apto + ' id=' + msgId + ' groupJid=' + session.groupJid);
    ladder.updateLatest('OK', 'id=' + msgId);
  } catch (e) {
    log('RELAY_TO_GROUP ERROR: apto=' + session.apto + ' groupJid=' + session.groupJid + ' error=' + e.message);
    ladder.updateLatest('ERROR', e.message.slice(0, 40));
  }
}
