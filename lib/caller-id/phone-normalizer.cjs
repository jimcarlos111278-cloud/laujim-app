let parsePhoneNumberFromString = null;
try {
  parsePhoneNumberFromString = require('libphonenumber-js').parsePhoneNumberFromString;
} catch {
  // Fallback si no está instalado en el contenedor
}

/**
 * Normaliza un número telefónico raw a formato E.164 (+57XXXXXXXXXX)
 * @param {string} raw - Número en cualquier formato
 * @param {string} defaultCountry - Código de país por defecto (CO)
 * @returns {string|null} - Formato E.164 o null si es inválido
 */
function normalizePhone(raw, defaultCountry = 'CO') {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (parsePhoneNumberFromString) {
    try {
      const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
      if (parsed && parsed.isValid()) return parsed.number;
    } catch {}
  }

  // Fallback nativo rápido (Colombia +57)
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+57${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('57')) {
    return `+${digits}`;
  }
  return digits ? `+${digits}` : null;
}

module.exports = { normalizePhone };
