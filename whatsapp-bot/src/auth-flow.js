import * as api from './api-client.js';
import * as scripts from './scripts.js';
import { log } from './logger.js';

const AUTH_TIMEOUT = 5 * 60 * 1000;

const states = new Map();

function getState(convJid) {
  return states.get(convJid) || null;
}

function setState(convJid, state, data) {
  const existing = states.get(convJid);
  if (existing && existing.timer) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    states.delete(convJid);
  }, AUTH_TIMEOUT);
  states.set(convJid, { state, data: data || {}, timer });
}

function clearState(convJid) {
  const s = states.get(convJid);
  if (s && s.timer) clearTimeout(s.timer);
  states.delete(convJid);
}

export function isInAuth(convJid) {
  const s = getState(convJid);
  return s && (s.state === 'awaiting_apto' || s.state === 'awaiting_cedula');
}

export function resetAuth(convJid) {
  clearState(convJid);
}

export function cancelAuth(convJid) {
  clearState(convJid);
}

export async function handleMessage(convJid, message, sendToTenant, aptoToGroupJid, retryDiscover) {
  let authState = getState(convJid);
  log('AUTH: handleMessage convJid=' + convJid + ' state=' + (authState?.state || 'none') + ' message="' + (message || '').slice(0, 30) + '"');

  if (!authState) {
    log('AUTH: no existing state, starting new auth for convJid=' + convJid);
    setState(convJid, 'awaiting_apto', {});
    await sendToTenant(convJid, scripts.get('auth_welcome'), 'AUTH_WELCOME');
    return { action: 'auth_apto' };
  }

  if (authState.state === 'awaiting_apto') {
    const apto = message.trim();
    log('AUTH: awaiting_apto convJid=' + convJid + ' apto="' + apto + '" validFormat=' + /^\d{3}$/.test(apto));
    if (!/^\d{3}$/.test(apto)) {
      await sendToTenant(convJid, scripts.get('auth_invalid_apto'), 'AUTH_INVALID_APTO');
      return { action: 'auth_apto' };
    }
    const apt = await api.getApartmentByName(apto);
    log('AUTH: getApartmentByName(' + apto + ') returned=' + JSON.stringify(apt).slice(0, 100));
    if (!apt || !apt.id) {
      log('AUTH: getApartmentByName(' + apto + ') returned empty');
      await sendToTenant(convJid, scripts.get('auth_apto_not_found', { apto }), 'AUTH_APTO_NOT_FOUND');
      return { action: 'auth_apto' };
    }
    let groupJid = aptoToGroupJid[apto];
    log('AUTH: aptoToGroupJid lookup apto=' + apto + ' groupJid=' + (groupJid || 'none'));
    if (!groupJid) {
      if (typeof retryDiscover === 'function') {
        log('AUTH: retrying group discovery for apto=' + apto);
        await retryDiscover();
        groupJid = aptoToGroupJid[apto];
        log('AUTH: after retry apto=' + apto + ' groupJid=' + (groupJid || 'none'));
      }
      if (!groupJid) {
        log('AUTH: no group configured for apto=' + apto);
        await sendToTenant(convJid, '❌ No hay un grupo configurado para el apartamento *' + apto + '*.\n\nContacta al administrador.', 'AUTH_NO_GROUP');
        clearState(convJid);
        return { action: 'auth_failed' };
      }
    }
    setState(convJid, 'awaiting_cedula', { apto, aptId: apt.id, groupJid });
    log('AUTH: state set to awaiting_cedula convJid=' + convJid + ' apto=' + apto + ' groupJid=' + groupJid);
    await sendToTenant(convJid, scripts.get('auth_prompt_cedula'), 'AUTH_PROMPT_CEDULA');
    return { action: 'auth_cedula' };
  }

  if (authState.state === 'awaiting_cedula') {
    const cedula = message.trim();
    log('AUTH: awaiting_cedula convJid=' + convJid + ' apto=' + authState.data.apto + ' cedulaLength=' + cedula.length);
    if (cedula.length < 5) {
      await sendToTenant(convJid, scripts.get('auth_invalid_cedula'), 'AUTH_INVALID_CEDULA');
      return { action: 'auth_cedula' };
    }
    const result = await api.login(authState.data.apto, cedula);
    log('AUTH: login result apto=' + authState.data.apto + ' authenticated=' + result.authenticated + ' role=' + result.role + ' name=' + (result.name || 'none'));
    if (result.authenticated && result.role === 'tenant') {
      const tenantName = result.name || authState.data.apto;
      log('AUTH: authenticated convJid=' + convJid + ' apto=' + authState.data.apto + ' tenantName=' + tenantName + ' groupJid=' + authState.data.groupJid);
      clearState(convJid);
      return {
        action: 'authenticated',
        session: {
          apto: authState.data.apto,
          groupJid: authState.data.groupJid,
          tenantName,
          state: 'ACTIVE',
        },
      };
    } else {
      log('AUTH: login failed convJid=' + convJid + ' result=' + JSON.stringify(result).slice(0, 80));
      await sendToTenant(convJid, scripts.get('auth_failed'), 'AUTH_FAILED');
      setState(convJid, 'awaiting_apto', {});
      return { action: 'auth_failed' };
    }
  }

  log('AUTH: unknown state convJid=' + convJid + ' state=' + authState.state);
  return { action: 'unknown' };
}
