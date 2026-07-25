import * as api from './api-client.js';

const DEFAULTS = {
  auth_welcome: '🏢 *Bienvenido al sistema de mensajería*\n\nPara identificarte, escribe tu *número de apartamento* (ej: 203)',
  auth_invalid_apto: '❌ El número de apartamento debe ser de 3 dígitos.\n\nIntenta de nuevo:',
  auth_apto_not_found: '❌ No encontré el apartamento *{apto}*.\n\nVerifica el número e intenta de nuevo:',
  auth_prompt_cedula: '🪪 Ahora escribe tu *cédula* (número de documento):',
  auth_invalid_cedula: '❌ La cédula debe tener al menos 5 dígitos.\n\nIntenta de nuevo:',
  auth_success: '✅ *Autenticado correctamente*\n\nYa puedes enviar mensajes al administrador. Tus mensajes serán respondidos a la brevedad.',
  auth_failed: '❌ Los datos no coinciden con nuestros registros.\n\nEscribe tu *número de apartamento* para intentar de nuevo:',
  auth_timeout: '⏰ Tiempo de espera agotado. Escribe cualquier mensaje para iniciar de nuevo.',
  auth_blocked: '❌ Tu acceso ha sido bloqueado. Contacta al administrador.',
  relay_admin_prefix: '✉️ *Administrador*:\n{content}',
  notif_admin_new: '📩 *[{apto} - {nombre}]*\n{content}',
  confirmation_sent: '✅ Mensaje enviado al administrador.',
  cmd_not_found: '❌ Comando no reconocido. Escribe !ayuda para ver los comandos disponibles.',
  cmd_listar_empty: '📋 No hay sesiones activas.',
  cmd_cortar_usage: '❌ Usa: !cortar <apto>\nEj: !cortar 203',
  cmd_cortar_done: '✅ Sesión del apto {apto} cerrada.',
  cmd_bloquear_usage: '❌ Usa: !bloquear <apto>\nEj: !bloquear 203',
  cmd_bloquear_done: '✅ Apto {apto} bloqueado.',
  cmd_mensajes_usage: '❌ Usa: !mensajes <apto>\nEj: !mensajes 203',
  cmd_mensajes_empty: '📭 No hay mensajes para el apto {apto}',
  session_closed: '🔒 Tu sesión ha sido cerrada por el administrador.',
  session_blocked: '🚫 Has sido bloqueado. Contacta al administrador.',
  cmd_help: '📚 *Comandos disponibles:*\n\n!listar — Muestra sesiones activas\n!cortar <apto> — Cierra sesión de un inquilino\n!bloquear <apto> — Bloquea permanentemente\n!mensajes <apto> — Últimos 5 mensajes\n!ayuda — Muestra esta ayuda',
};

let cache = { ...DEFAULTS };
let lastFetch = 0;

export async function load() {
  try {
    const settings = await api.getSettings();
    for (const key of Object.keys(DEFAULTS)) {
      const val = settings['whatsapp_bot_msg_' + key];
      if (val) cache[key] = val;
    }
  } catch {}
  lastFetch = Date.now();
}

export function get(key, placeholders) {
  let text = cache[key] || DEFAULTS[key] || key;
  if (placeholders) {
    for (const [k, v] of Object.entries(placeholders)) {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    }
  }
  return text;
}
