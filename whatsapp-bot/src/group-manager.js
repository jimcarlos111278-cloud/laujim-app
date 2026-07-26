import { log } from './logger.js';

export async function ensureGroupForApto(sock, apto, adminPhone) {
  if (!sock) { log('GROUP_MGR: no sock'); return null; }
  const name = `Apto ${apto}`;
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [jid, g] of Object.entries(groups)) {
      if (g.subject === name) {
        log('GROUP_MGR: already exists apto=' + apto + ' jid=' + jid);
        return jid;
      }
    }
    log('GROUP_MGR: creating group ' + name);
    const { id } = await sock.groupCreate(name, []);
    log('GROUP_MGR: created apto=' + apto + ' jid=' + id);
    if (adminPhone) {
      const adminJid = adminPhone.includes('@') ? adminPhone : adminPhone + '@s.whatsapp.net';
      try {
        await sock.groupParticipantsUpdate(id, [adminJid], 'add');
        log('GROUP_MGR: added admin ' + adminJid);
      } catch (e) {
        log('GROUP_MGR: admin add failed: ' + e.message);
      }
    }
    return id;
  } catch (e) {
    log('GROUP_MGR error: ' + e.message);
    return null;
  }
}
