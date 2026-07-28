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
  return s && (s.state === 'awaiting_apto' || s.state === 'awaiting_cedula' ||
    s.state === 'menu_main' || s.state === 'menu_vacants' ||
    s.state === 'menu_info_apto' || s.state === 'lead_name' ||
    s.state === 'lead_phone' || s.state === 'lead_email');
}

export function resetAuth(convJid) {
  clearState(convJid);
}

export function cancelAuth(convJid) {
  clearState(convJid);
}

export async function handleMessage(convJid, message, sendToTenant, aptoToGroupJid, retryDiscover, deliveryJidOverride) {
  let authState = getState(convJid);
  log('AUTH: handleMessage convJid=' + convJid + ' state=' + (authState?.state || 'none') + ' message="' + (message || '') + '"');

  const sendViaBot = async (text, source) => {
    await sendToTenant(convJid, text, source || 'AUTH', deliveryJidOverride);
  };

  if (!authState) {
    if (message === '0') {
      return { action: 'return_menu' };
    }
    setState(convJid, 'menu_main', {});
    log('AUTH: showing main menu for convJid=' + convJid);
    await sendViaBot(scripts.get('menu_main'), 'MENU_MAIN');
    return { action: 'menu' };
  }

  if (authState.state === 'menu_main') {
    const opt = message.trim();
    log('AUTH: menu_main option=' + opt + ' convJid=' + convJid);
    if (opt === '1') {
      try {
        const vacantsData = await api.getVacants();
        const apts = vacantsData.apartments || [];
        if (apts.length === 0) {
          await sendViaBot(scripts.get('menu_vacants_empty'), 'MENU_VACANTS_EMPTY');
          setState(convJid, 'menu_main', {});
          return { action: 'menu' };
        }
        const lines = apts.map(a =>
          '• *Apto {name}* — ${rent}/mes — {rooms} hab, {bathrooms} baños'
            .replace('{name}', a.name).replace('{rent}', a.monthlyRent || '0')
            .replace('{rooms}', a.rooms || '?').replace('{bathrooms}', a.bathrooms || '?')
        );
        const vacantsText = lines.join('\n');
        await sendViaBot(scripts.get('menu_vacants_header', { vacants: vacantsText }), 'MENU_VACANTS');
        setState(convJid, 'menu_main', {});
        return { action: 'menu' };
      } catch (e) {
        log('AUTH: vacants fetch error: ' + e.message);
        await sendViaBot('❌ Error al consultar disponibilidad.\n\nEscribe *0* para volver al menú.', 'MENU_VACANTS_ERROR');
        setState(convJid, 'menu_main', {});
        return { action: 'menu' };
      }
    }
    if (opt === '2') {
      await sendViaBot(scripts.get('menu_info_apto_prompt'), 'MENU_INFO_APTO');
      setState(convJid, 'menu_info_apto', {});
      return { action: 'menu_info_apto' };
    }
    if (opt === '3') {
      await sendViaBot(scripts.get('lead_prompt_name'), 'LEAD_NAME');
      setState(convJid, 'lead_name', {});
      return { action: 'lead' };
    }
    if (opt === '4') {
      setState(convJid, 'awaiting_apto', {});
      await sendViaBot(scripts.get('auth_welcome'), 'AUTH_WELCOME');
      return { action: 'auth_apto' };
    }
    await sendViaBot(scripts.get('menu_invalid'), 'MENU_INVALID');
    return { action: 'menu' };
  }

  if (authState.state === 'menu_vacants') {
    const opt = message.trim();
    if (opt === '0') {
      await sendViaBot(scripts.get('menu_zero'), 'MENU_ZERO');
      setState(convJid, 'menu_main', {});
      return { action: 'menu' };
    }
    if (opt === '3') {
      await sendViaBot(scripts.get('lead_prompt_name'), 'LEAD_NAME');
      setState(convJid, 'lead_name', {});
      return { action: 'lead' };
    }
    if (opt === '4') {
      setState(convJid, 'awaiting_apto', {});
      await sendViaBot(scripts.get('auth_welcome'), 'AUTH_WELCOME');
      return { action: 'auth_apto' };
    }
    await sendViaBot('❌ Opción inválida. Responde *3* para interés, *4* para login o *0* para volver.', 'MENU_INVALID');
    return { action: 'menu' };
  }

  if (authState.state === 'menu_info_apto') {
    const apto = message.trim();
    if (apto === '0') {
      await sendViaBot(scripts.get('menu_zero'), 'MENU_ZERO');
      setState(convJid, 'menu_main', {});
      return { action: 'menu' };
    }
    try {
      const apt = await api.getApartmentByName(apto);
      if (!apt || !apt.id) {
        await sendViaBot(scripts.get('menu_info_apto_not_found', { apto }), 'MENU_INFO_NOT_FOUND');
        return { action: 'menu_info_apto' };
      }
      await sendViaBot(scripts.get('menu_info_apto_result', {
        apto: apt.name,
        rent: apt.monthlyRent || '0',
        rooms: apt.rooms || '?',
        bathrooms: apt.bathrooms || '?',
        area: apt.area || '?',
        description: apt.description || 'Sin descripción',
      }), 'MENU_INFO_RESULT');
      setState(convJid, 'menu_main', {});
    } catch (e) {
      log('AUTH: apto info error: ' + e.message);
      await sendViaBot('❌ Error al consultar. Intenta de nuevo o escribe *0* para volver.', 'MENU_INFO_ERROR');
    }
    return { action: 'menu' };
  }

  if (authState.state === 'lead_name') {
    const name = message.trim();
    if (name.length < 2) {
      await sendViaBot('❌ Por favor escribe un nombre válido (mínimo 2 caracteres):', 'LEAD_NAME_INVALID');
      return { action: 'lead' };
    }
    setState(convJid, 'lead_phone', { ...authState.data, name });
    await sendViaBot(scripts.get('lead_prompt_phone'), 'LEAD_PHONE');
    return { action: 'lead' };
  }

  if (authState.state === 'lead_phone') {
    const phone = message.trim().replace(/[^0-9]/g, '');
    if (phone.length < 8) {
      await sendViaBot('❌ Por favor escribe un número válido (ej: 573001234567):', 'LEAD_PHONE_INVALID');
      return { action: 'lead' };
    }
    setState(convJid, 'lead_email', { ...authState.data, phone });
    await sendViaBot(scripts.get('lead_prompt_email'), 'LEAD_EMAIL');
    return { action: 'lead' };
  }

  if (authState.state === 'lead_email') {
    const email = message.trim();
    const data = { ...authState.data, email, source: 'whatsapp', createdAt: new Date().toISOString() };
    clearState(convJid);
    try {
      await api.submitLead(data);
      log('LEAD saved: name=' + data.name + ' phone=' + data.phone + ' email=' + data.email);
      await sendViaBot(scripts.get('lead_thanks', { name: data.name }), 'LEAD_THANKS');
    } catch (e) {
      log('LEAD save error: ' + e.message);
      await sendViaBot(scripts.get('lead_error'), 'LEAD_ERROR');
    }
    setState(convJid, 'menu_main', {});
    return { action: 'lead_done' };
  }

  if (authState.state === 'awaiting_apto') {
    const apto = message.trim();
    log('AUTH: awaiting_apto convJid=' + convJid + ' apto="' + apto + '" validFormat=' + /^\d{3}$/.test(apto));
    if (!/^\d{3}$/.test(apto)) {
      await sendViaBot(scripts.get('auth_invalid_apto'), 'AUTH_INVALID_APTO');
      return { action: 'auth_apto' };
    }
    const apt = await api.getApartmentByName(apto);
    log('AUTH: getApartmentByName(' + apto + ') returned=' + JSON.stringify(apt).slice(0, 100));
    if (!apt || !apt.id) {
      log('AUTH: getApartmentByName(' + apto + ') returned empty');
      await sendViaBot(scripts.get('auth_apto_not_found', { apto }), 'AUTH_APTO_NOT_FOUND');
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
        await sendViaBot('❌ No hay un grupo configurado para el apartamento *' + apto + '*.\n\nContacta al administrador.', 'AUTH_NO_GROUP');
        setState(convJid, 'menu_main', {});
        return { action: 'auth_failed' };
      }
    }
    setState(convJid, 'awaiting_cedula', { apto, aptId: apt.id, groupJid });
    log('AUTH: state set to awaiting_cedula convJid=' + convJid + ' apto=' + apto + ' groupJid=' + groupJid);
    await sendViaBot(scripts.get('auth_prompt_cedula'), 'AUTH_PROMPT_CEDULA');
    return { action: 'auth_cedula' };
  }

  if (authState.state === 'awaiting_cedula') {
    const cedula = message.trim();
    log('AUTH: awaiting_cedula convJid=' + convJid + ' apto=' + authState.data.apto + ' cedulaLength=' + cedula.length);
    if (cedula.length < 5) {
      await sendViaBot(scripts.get('auth_invalid_cedula'), 'AUTH_INVALID_CEDULA');
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
      await sendViaBot(scripts.get('auth_failed'), 'AUTH_FAILED');
      setState(convJid, 'awaiting_apto', {});
      return { action: 'auth_failed' };
    }
  }

  log('AUTH: unknown state convJid=' + convJid + ' state=' + authState.state);
  return { action: 'unknown' };
}

export async function autoAuthByPhone(convJid, phone, sendToTenant, aptoToGroupJid, retryDiscover) {
  log('AUTO_AUTH: checking phone=' + phone + ' convJid=' + convJid);
  try {
    const tenant = await api.getTenantByPhone(phone);
    log('AUTO_AUTH: tenant lookup result=' + JSON.stringify(tenant).slice(0, 100));
    if (!tenant || !tenant.id) {
      log('AUTO_AUTH: no tenant found for phone=' + phone);
      return null;
    }

    let apartmentId = tenant.apartmentId;
    if (!apartmentId) {
      log('AUTO_AUTH: tenant.apartmentId not set, looking up active contract for tenant=' + tenant.id);
      try {
        const contracts = await api.getTenantContracts(tenant.id);
        const active = contracts.find(c => !c.endDate || new Date(c.endDate) > new Date());
        if (active) apartmentId = active.apartmentId;
      } catch (e2) {
        log('AUTO_AUTH: contract lookup error: ' + e2.message);
      }
    }
    if (!apartmentId) {
      log('AUTO_AUTH: no apartmentId found for tenant=' + tenant.id);
      return null;
    }

    let apto = '';
    try {
      const apt = await api.getApartmentById(apartmentId);
      if (apt && apt.name) apto = String(apt.name);
    } catch (e3) {
      log('AUTO_AUTH: apartment lookup error: ' + e3.message);
    }
    if (!apto) {
      log('AUTO_AUTH: could not resolve apto for apartmentId=' + apartmentId);
      return null;
    }

    let groupJid = aptoToGroupJid[apto];
    if (!groupJid && typeof retryDiscover === 'function') {
      await retryDiscover();
      groupJid = aptoToGroupJid[apto];
    }
    if (!groupJid && apto) {
      const apt = await api.getApartmentByName(apto).catch(() => null);
      if (apt && apt.id) {
        const key = Object.keys(aptoToGroupJid).find(k => aptoToGroupJid[k] === (apt.groupJid || ''));
        if (key) groupJid = aptoToGroupJid[key];
      }
    }
    return {
      apto,
      groupJid: groupJid || '',
      tenantName: tenant.name || 'Inquilino',
      state: 'ACTIVE',
    };
  } catch (e) {
    log('AUTO_AUTH error: ' + e.message);
    return null;
  }
}