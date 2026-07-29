import * as scripts from './scripts.js';
import { log } from './logger.js';
import * as ladder from './ladder.js';

async function downloadMedia(sock, msg) {
  try {
    if (msg.imageMessage) return await sock.downloadMediaMessage(msg);
    if (msg.videoMessage) return await sock.downloadMediaMessage(msg);
    if (msg.documentMessage) return await sock.downloadMediaMessage(msg);
    if (msg.audioMessage) return await sock.downloadMediaMessage(msg);
  } catch (e) {
    log('DOWNLOAD_MEDIA error: ' + e.message);
  }
  return null;
}

function getMediaInfo(msg) {
  if (msg.imageMessage) {
    return { type: 'image', caption: msg.imageMessage.caption || '', mimetype: msg.imageMessage.mimetype || 'image/jpeg', filename: null };
  }
  if (msg.videoMessage) {
    return { type: 'video', caption: msg.videoMessage.caption || '', mimetype: msg.videoMessage.mimetype || 'video/mp4', filename: null };
  }
  if (msg.documentMessage) {
    return { type: 'document', caption: msg.documentMessage.caption || '', mimetype: msg.documentMessage.mimetype || 'application/octet-stream', filename: msg.documentMessage.fileName || 'documento' };
  }
  return null;
}

function getTextContent(msg) {
  return msg.message?.conversation ||
         msg.message?.extendedTextMessage?.text ||
         msg.message?.imageMessage?.caption ||
         msg.message?.videoMessage?.caption ||
         msg.message?.documentMessage?.caption ||
         '';
}

export async function relayToGroup(sock, session, msg, adminName) {
  log('RELAY_TO_GROUP: entered sock=' + !!sock + ' session=' + !!session + ' groupJid=' + (session?.groupJid || 'none') + ' apto=' + (session?.apto || 'none'));
  if (!sock || !session || !session.groupJid) {
    log('RELAY_TO_GROUP: skipped - missing sock/session/groupJid');
    return null;
  }

  const mediaInfo = getMediaInfo(msg);
  const text = getTextContent(msg);
  const prefix = scripts.get('relay_from_tenant', { apto: session.apto, name: session.tenantName || '', adminName: adminName || '' });
  const fullCaption = prefix + (text ? '\n' + text : '');
  const groupShort = session.groupJid.split('@')[0].slice(0, 6) + '...g.us';
  const relayType = mediaInfo ? mediaInfo.type.toUpperCase() : 'TEXT';

  ladder.push('Bot→Grp', 'Bot', groupShort, 'RELAY_' + relayType, text, '', 'PENDING', '', session.apto);

  try {
    let result;
    if (mediaInfo && mediaInfo.type === 'image') {
      const buffer = await downloadMedia(sock, msg);
      if (buffer) {
        result = await sock.sendMessage(session.groupJid, { image: buffer, caption: fullCaption });
      } else {
        result = await sock.sendMessage(session.groupJid, { text: fullCaption + '\n\n🖼 [Imagen]' });
      }
    } else if (mediaInfo && mediaInfo.type === 'video') {
      const buffer = await downloadMedia(sock, msg);
      if (buffer) {
        result = await sock.sendMessage(session.groupJid, { video: buffer, caption: fullCaption });
      } else {
        result = await sock.sendMessage(session.groupJid, { text: fullCaption + '\n\n🎬 [Video]' });
      }
    } else if (mediaInfo && mediaInfo.type === 'document') {
      const buffer = await downloadMedia(sock, msg);
      if (buffer) {
        result = await sock.sendMessage(session.groupJid, { document: buffer, mimetype: mediaInfo.mimetype, fileName: mediaInfo.filename, caption: fullCaption });
      } else {
        result = await sock.sendMessage(session.groupJid, { text: fullCaption + '\n\n📄 [' + mediaInfo.filename + ']' });
      }
    } else {
      const fullText = prefix + '\n' + text;
      result = await sock.sendMessage(session.groupJid, { text: fullText });
    }

    const msgId = result?.key?.id || '';
    log('RELAY_TO_GROUP OK: apto=' + session.apto + ' groupJid=' + session.groupJid + ' type=' + relayType + ' id=' + msgId);
    ladder.updateLatest('OK', '');
    return msgId || null;
  } catch (e) {
    log('RELAY_TO_GROUP ERROR: apto=' + session.apto + ' groupJid=' + session.groupJid + ' error=' + e.message);
    ladder.updateLatest('ERROR', e.message.slice(0, 40));
    return null;
  }
}
