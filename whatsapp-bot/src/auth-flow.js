import * as api from './api-client.js';
import * as scripts from './scripts.js';
import { log } from './logger.js';

const AUTH_TIMEOUT = 5 * 60 * 1000;

const states = new Map();

function getState(callerJid) {
  return states.get(callerJid) || null;
}

function setState(callerJid, state, data) {
  const existing = states.get(callerJid);
  if (existing && existing.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    states.delete(callerJid);
  }, AUTH_TIMEOUT);
  states.set(callerJid, { state, data: data || {}, timer });
}

function clearState(callerJid) {
  const s = states.get(callerJid);
  if (s && s.timer) clearTimeout(s.timer);
  states.delete(callerJid);
}

export function isInAuth(callerJid) {
  const s = getState(callerJid);
  return s && (s.state === 'awaiting_phone' || s.state === 'awaiting_apto' || s.state === 'awaiting_cedula');
}

export function resetAuth(callerJid) {
  clearState(callerJid);
}

export function cancelAuth(callerJid) {
  clearState(callerJid);
}

export async function handleMessage(callerJid, message, sendReply, aptoToGroupJid, retryDiscover, route = {}) {
  let authState = getState(callerJid);

  // WhatsApp may use a privacy LID for the incoming chat. senderPn is the
  // private delivery route and must never be rendered in relayed text.
  if (authState && route.replyJid && authState.data.replyJid !== route.replyJid) {
    setState(callerJid, authState.state, { ...authState.data, replyJid: route.replyJid });
    authState = getState(callerJid);
  }
  if (!authState) {
    setState(callerJid, 'awaiting_phone', { lidJid: callerJid, replyJid: route.replyJid || null });
    await sendReply(callerJid, scripts.get('auth_prompt_phone'));
    return { action: 'auth_phone' };
  }

  if (authState.state === 'awaiting_phone') {
    const phone = message.trim().replace(/\D/g, '');
    if (!/^3\d{9}$/.test(phone)) {
      await sendReply(callerJid, scripts.get('auth_invalid_phone'));
      return { action: 'auth_phone' };
    }
    const declaredPhoneJid = '57' + phone + '@s.whatsapp.net';
    setState(callerJid, 'awaiting_apto', {
      ...authState.data,
      declaredPhoneJid,
      lidJid: callerJid,
      replyJid: route.replyJid || authState.data.replyJid || null,
    });
    log('AUTH: phone received for lid=' + callerJid + ' route=' + (route.replyJid || 'unavailable'));
    await sendReply(callerJid, scripts.get('auth_welcome'));
    return { action: 'auth_apto' };
  }

  if (authState.state === 'awaiting_apto') {
    const apto = message.trim();
    if (!/^\d{3}$/.test(apto)) {
      await sendReply(authState.data.lidJid, scripts.get('auth_invalid_apto'));
      return { action: 'auth_apto' };
    }
    const apt = await api.getApartmentByName(apto);
    if (!apt || !apt.id) {
      log('AUTH: getApartmentByName(' + apto + ') returned: ' + JSON.stringify(apt));
      await sendReply(authState.data.lidJid, scripts.get('auth_apto_not_found', { apto }));
      return { action: 'auth_apto' };
    }
    let groupJid = aptoToGroupJid[apto];
    if (!groupJid) {
      if (typeof retryDiscover === 'function') {
        await retryDiscover();
        groupJid = aptoToGroupJid[apto];
      }
      if (!groupJid) {
        await sendReply(authState.data.lidJid, '❌ No hay un grupo configurado para el apartamento *' + apto + '*.\n\nContacta al administrador.');
        clearState(callerJid);
        return { action: 'auth_failed' };
      }
    }
    authState.data.apto = apto;
    authState.data.aptId = apt.id;
    authState.data.groupJid = groupJid;
    setState(callerJid, 'awaiting_cedula', authState.data);
    await sendReply(authState.data.lidJid, scripts.get('auth_prompt_cedula'));
    return { action: 'auth_cedula' };
  }

  if (authState.state === 'awaiting_cedula') {
    const cedula = message.trim();
    if (cedula.length < 5) {
      await sendReply(authState.data.lidJid, scripts.get('auth_invalid_cedula'));
      return { action: 'auth_cedula' };
    }
    const result = await api.login(authState.data.apto, cedula);
    if (result.authenticated && result.role === 'tenant') {
      const tenantName = result.name || authState.data.apto;
      const sessionData = {
        callerJid: authState.data.lidJid,
        replyJid: authState.data.replyJid || null,
        apartment: authState.data.apto,
        groupJid: authState.data.groupJid,
        tenantName,
        state: 'ACTIVE',
      };
      clearState(callerJid);
      return { action: 'authenticated', session: sessionData };
    } else {
      await sendReply(authState.data.lidJid, scripts.get('auth_failed'));
      setState(callerJid, 'awaiting_phone', {});
      return { action: 'auth_failed' };
    }
  }

  return { action: 'unknown' };
}
