import { Capacitor, registerPlugin } from '@capacitor/core';

const AuthorizedCallerScreening = registerPlugin('AuthorizedCallerScreening');

function nativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

function normalizedPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length === 12) return digits.slice(2);
  return digits;
}

export async function getCallScreeningStatus() {
  if (!nativeAndroid()) return { native: false, supported: false, message: 'Disponible únicamente en la APK Android de Laujim.' };
  try {
    return { native: true, ...(await AuthorizedCallerScreening.getStatus()) };
  } catch (error) {
    return { native: true, supported: false, message: error.message || 'No fue posible consultar el filtro de llamadas.' };
  }
}

export async function syncAuthorizedCallerNumbers(tenants) {
  if (!nativeAndroid()) return getCallScreeningStatus();
  const numbers = [...new Set((tenants || []).map(tenant => normalizedPhone(tenant.phone)).filter(Boolean))];
  return { native: true, ...(await AuthorizedCallerScreening.syncAuthorizedNumbers({ numbers })) };
}

export async function requestCallScreeningRole() {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await AuthorizedCallerScreening.requestScreeningRole()) };
}

export async function setCallScreeningEnabled(enabled) {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await AuthorizedCallerScreening.setEnabled({ enabled })) };
}
