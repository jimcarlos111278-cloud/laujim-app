function nativeAndroid() {
  const capacitor = window.Capacitor;
  return Boolean(capacitor?.isNativePlatform?.() && capacitor.getPlatform?.() === 'android');
}

function callerScreeningPlugin() {
  const capacitor = window.Capacitor;
  const plugin = capacitor?.registerPlugin?.('AuthorizedCallerScreening') || capacitor?.Plugins?.AuthorizedCallerScreening;
  if (!plugin) throw new Error('El filtro de llamadas no está disponible en esta instalación.');
  return plugin;
}

function normalizedPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length === 12) return digits.slice(2);
  return digits;
}

export async function getCallScreeningStatus() {
  if (!nativeAndroid()) return { native: false, supported: false, message: 'Disponible únicamente en la APK Android de Laujim.' };
  try {
    return { native: true, ...(await callerScreeningPlugin().getStatus()) };
  } catch (error) {
    return { native: true, supported: false, message: error.message || 'No fue posible consultar el filtro de llamadas.' };
  }
}

export async function syncAuthorizedCallerNumbers(tenants) {
  if (!nativeAndroid()) return getCallScreeningStatus();
  const numbers = [...new Set((tenants || []).map(tenant => normalizedPhone(tenant.phone)).filter(Boolean))];
  return { native: true, ...(await callerScreeningPlugin().syncAuthorizedNumbers({ numbers })) };
}

export async function requestCallScreeningRole() {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await callerScreeningPlugin().requestScreeningRole()) };
}

export async function setCallScreeningEnabled(enabled) {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await callerScreeningPlugin().setEnabled({ enabled })) };
}

export async function setAllowCallsFromContacts(enabled) {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await callerScreeningPlugin().setAllowContacts({ enabled })) };
}

export async function requestProtectedSmsRole() {
  if (!nativeAndroid()) return getCallScreeningStatus();
  return { native: true, ...(await callerScreeningPlugin().requestSmsRole()) };
}

export async function getAuthorizedSmsMessages() {
  if (!nativeAndroid()) return { native: false, messages: [] };
  return { native: true, ...(await callerScreeningPlugin().getAuthorizedSmsMessages()) };
}
