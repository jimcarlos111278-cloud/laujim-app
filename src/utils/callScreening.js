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

export const CALL_GUARD_STORAGE_KEY = 'laujim_call_guard_config';

export const DEFAULT_CALL_GUARD_CONFIG = {
  blockUnknown: true,          // Bloquear números que no estén en la base de datos de inquilinos
  blockFraud: true,            // Bloquear automáticamente números con reportes de fraude/extorsión
  allowContacts: true,         // Permitir números en la agenda del celular
  allowDelivery: true,         // Permitir repartidores y empresas de envíos (Rappi, Servientrega, etc.)
  allowBanks: true,            // Permitir llamadas de validación y seguridad de bancos
  checkWhatsApp: true,         // Verificar si el número tiene WhatsApp registrado
  trackFrequency: true,        // Registrar insistencia y número de llamadas recibidas
  callerIdLookup: true,        // Búsqueda de nombre/identificador público (estilo Truecaller)
  notifyOnBlock: true,         // Enviar notificación al teléfono cuando se bloquea una llamada
};

export const DELIVERY_WHITELIST = [
  { name: 'Rappi Envíos / Repartidores', pattern: '6013163535', category: 'delivery' },
  { name: 'Servientrega Logística', pattern: '6017700200', category: 'delivery' },
  { name: 'Servientrega Servicio', pattern: '6015115115', category: 'delivery' },
  { name: 'Coordinadora Mercantil', pattern: '6014868000', category: 'delivery' },
  { name: 'Inter Rapidísimo PBX', pattern: '6015605000', category: 'delivery' },
  { name: 'MercadoLibre Envíos', pattern: '6017441111', category: 'delivery' },
  { name: 'Amazon / DHL Express', pattern: '6013289000', category: 'delivery' },
];

export const BANK_WHITELIST = [
  { name: 'Bancolombia Sucursal Telefónica', pattern: '6013430000', category: 'bank' },
  { name: 'Bancolombia Medellín', pattern: '6045109000', category: 'bank' },
  { name: 'Bancolombia Barranquilla', pattern: '6053618888', category: 'bank' },
  { name: 'Davivienda Call Center', pattern: '6013383838', category: 'bank' },
  { name: 'BBVA Colombia', pattern: '6014010101', category: 'bank' },
  { name: 'Banco de Bogotá', pattern: '6013820000', category: 'bank' },
  { name: 'Banco Falabella', pattern: '6015878000', category: 'bank' },
];

export function getCallGuardConfig() {
  try {
    const raw = localStorage.getItem(CALL_GUARD_STORAGE_KEY);
    if (!raw) return DEFAULT_CALL_GUARD_CONFIG;
    return { ...DEFAULT_CALL_GUARD_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CALL_GUARD_CONFIG;
  }
}

export function saveCallGuardConfig(config) {
  try {
    const merged = { ...DEFAULT_CALL_GUARD_CONFIG, ...config };
    localStorage.setItem(CALL_GUARD_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return DEFAULT_CALL_GUARD_CONFIG;
  }
}

// Analizador en vivo de un número (Simulación y Diagnóstico Inteligente)
export async function analyzeIncomingNumber(rawPhone, tenantsList = []) {
  const norm = normalizedPhone(rawPhone);
  const config = getCallGuardConfig();

  // 1. Verificar si está en inquilinos autorizados
  const tenantMatch = tenantsList.find(t => normalizedPhone(t.phone) === norm);
  if (tenantMatch) {
    return {
      phone: norm,
      verdict: 'ALLOW',
      reason: 'Inquilino registrado en Laujim',
      identity: tenantMatch.name || `Inquilino Apto ${tenantMatch.apartmentId || ''}`,
      entityType: 'tenant',
      fraudReported: false,
      hasWhatsApp: true,
      callFrequency: 1,
      tag: 'Inquilino Autorizado',
      color: 'emerald'
    };
  }

  // 2. Verificar Whitelist de Domicilios / Mensajería
  if (config.allowDelivery) {
    const delMatch = DELIVERY_WHITELIST.find(d => norm.includes(d.pattern) || d.pattern.includes(norm));
    if (delMatch) {
      return {
        phone: norm,
        verdict: 'ALLOW',
        reason: 'Empresa de envíos verificada (Whitelist)',
        identity: delMatch.name,
        entityType: 'delivery',
        fraudReported: false,
        hasWhatsApp: false,
        callFrequency: 1,
        tag: 'Mensajería / Domicilios',
        color: 'blue'
      };
    }
  }

  // 3. Verificar Whitelist de Bancos
  if (config.allowBanks) {
    const bankMatch = BANK_WHITELIST.find(b => norm.includes(b.pattern) || b.pattern.includes(norm));
    if (bankMatch) {
      return {
        phone: norm,
        verdict: 'ALLOW',
        reason: 'Línea de seguridad bancaria oficial (Whitelist)',
        identity: bankMatch.name,
        entityType: 'bank',
        fraudReported: false,
        hasWhatsApp: false,
        callFrequency: 1,
        tag: 'Entidad Bancaria',
        color: 'indigo'
      };
    }
  }

  // 4. Verificación de Fraude / Extorsión (Detección de patrones conocidos)
  const isSuspiciousPattern = norm.startsWith('3000') || norm.startsWith('311000') || norm.length < 10;
  const isKnownFraudPrefix = ['320987', '310999', '301666', '350111'].some(p => norm.startsWith(p));

  if (isKnownFraudPrefix || isSuspiciousPattern) {
    return {
      phone: norm,
      verdict: 'BLOCK',
      reason: 'Reportado por fraude / extorsión (Lista Negra Gaula/Spam)',
      identity: 'Sospechoso de Extorsión / Llamada Automatizada',
      entityType: 'fraud',
      fraudReported: true,
      hasWhatsApp: false,
      callFrequency: 4,
      tag: 'PELIGRO: Fraude Detectado',
      color: 'rose'
    };
  }

  // 5. Número desconocido estándar
  const hasWa = norm.startsWith('3') && norm.length === 10; // En Colombia líneas móviles válidas suelen tener WhatsApp
  if (config.blockUnknown) {
    return {
      phone: norm,
      verdict: 'BLOCK',
      reason: 'Número desconocido no registrado en la base de datos',
      identity: config.callerIdLookup ? 'Número móvil no registrado' : 'Desconocido',
      entityType: 'unknown',
      fraudReported: false,
      hasWhatsApp: hasWa,
      callFrequency: 2,
      tag: 'Bloqueado (No en Agenda)',
      color: 'amber'
    };
  }

  return {
    phone: norm,
    verdict: 'ALLOW',
    reason: 'Permitido (Filtro de desconocidos desactivado)',
    identity: 'Llamada Entrante',
    entityType: 'allowed_unknown',
    fraudReported: false,
    hasWhatsApp: hasWa,
    callFrequency: 1,
    tag: 'Permitido con Advertencia',
    color: 'slate'
  };
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

