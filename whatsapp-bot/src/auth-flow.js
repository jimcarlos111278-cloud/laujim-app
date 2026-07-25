import * as sessionStore from './session-store.js';
import * as api from './api-client.js';
import * as scripts from './scripts.js';

const AUTH_TIMEOUT = 5 * 60 * 1000;

const states = new Map();

function getState(phone) {
  return states.get(phone) || null;
}

function setState(phone, state, data) {
  states.set(phone, { state, data: data || {}, timer: null, expiresAt: Date.now() + AUTH_TIMEOUT });
}

function clearState(phone) {
  const s = states.get(phone);
  if (s && s.timer) clearTimeout(s.timer);
  states.delete(phone);
}

export function isAuthenticated(phone) {
  const session = sessionStore.getSession(phone);
  return session && session.status === 'activo';
}

export function isInAuth(phone) {
  const s = getState(phone);
  return s && (s.state === 'awaiting_apto' || s.state === 'awaiting_cedula');
}

export function resetAuth(phone) {
  clearState(phone);
}

export async function handleMessage(phone, message, sendReply) {
  const session = sessionStore.getSession(phone);
  if (session && session.status === 'activo') {
    return { action: 'relay', session };
  }

  if (session && session.status === 'bloqueado') {
    await sendReply(scripts.get('auth_blocked'));
    return { action: 'blocked' };
  }

  const authState = getState(phone);
  if (!authState) {
    setState(phone, 'awaiting_apto', {});
    await sendReply(scripts.get('auth_welcome'));
    return { action: 'auth_apto' };
  }

  if (authState.state === 'awaiting_apto') {
    const apto = message.trim();
    if (!/^\d{3}$/.test(apto)) {
      await sendReply(scripts.get('auth_invalid_apto'));
      return { action: 'auth_apto' };
    }
    const apt = await api.getApartmentByName(apto);
    if (!apt || !apt.id) {
      await sendReply(scripts.get('auth_apto_not_found', { apto }));
      return { action: 'auth_apto' };
    }
    authState.data.apto = apto;
    authState.data.aptId = apt.id;
    setState(phone, 'awaiting_cedula', authState.data);
    await sendReply(scripts.get('auth_prompt_cedula'));
    return { action: 'auth_cedula' };
  }

  if (authState.state === 'awaiting_cedula') {
    const cedula = message.trim();
    if (cedula.length < 5) {
      await sendReply(scripts.get('auth_invalid_cedula'));
      return { action: 'auth_cedula' };
    }
    const result = await api.login(authState.data.apto, cedula);
    if (result.authenticated && result.role === 'tenant') {
      const tenantName = result.name || authState.data.apto;
      sessionStore.setSession(phone, {
        apto: authState.data.apto,
        aptId: authState.data.aptId,
        tenantName,
        status: 'activo',
        createdAt: new Date().toISOString(),
      });
      clearState(phone);
      await sendReply(scripts.get('auth_success'));
      return { action: 'authenticated', session: sessionStore.getSession(phone) };
    } else {
      await sendReply(scripts.get('auth_failed'));
      setState(phone, 'awaiting_apto', {});
      return { action: 'auth_failed' };
    }
  }

  return { action: 'unknown' };
}

export function startTimeoutChecker(phone, sendReply) {
  const interval = setInterval(() => {
    const authState = getState(phone);
    if (authState && Date.now() > authState.expiresAt) {
      clearState(phone);
      sendReply(scripts.get('auth_timeout'));
      clearInterval(interval);
    }
  }, 60000);
  return interval;
}
