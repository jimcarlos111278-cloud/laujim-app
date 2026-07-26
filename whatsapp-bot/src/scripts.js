const DEFAULTS = {
  auth_welcome: '🏢 *Bienvenido al sistema de mensajería*\n\nPara identificarte, escribe tu *número de apartamento* (ej: 203)',
  auth_invalid_apto: '❌ El número de apartamento debe ser de 3 dígitos.\n\nIntenta de nuevo:',
  auth_apto_not_found: '❌ No encontré el apartamento *{apto}*.\n\nVerifica el número e intenta de nuevo:',
  auth_prompt_cedula: '🪪 Ahora escribe tu *cédula* (número de documento):',
  auth_invalid_cedula: '❌ La cédula debe tener al menos 5 dígitos.\n\nIntenta de nuevo:',
  auth_failed: '❌ Los datos no coinciden con nuestros registros.\n\nEscribe tu *número de apartamento* para intentar de nuevo:',
  auth_timeout: '⏰ Tiempo de espera agotado. Escribe cualquier mensaje para iniciar de nuevo.',
  session_created: '✅ *Sesión iniciada*\n\nTu conversación con el grupo *{apto}* ya está activa. Escribe lo que necesites.',
  session_expired: '⏰ Tu sesión ha expirado por inactividad. Escribe cualquier mensaje para iniciar de nuevo.',
  session_closed: '🔒 Tu sesión ha sido cerrada.',
  relay_from_tenant: '📩 *Inquilino Apto {apto}*\n{content}',
  relay_from_group: '📩 *Grupo {apto}*\n{content}',
  cmd_help: '📚 *Comandos disponibles:*\n\n/help — Muestra esta ayuda\n/status — Estado de tu sesión\n/endsession — Finaliza tu sesión\n/relogin — Finaliza sesión y reinicia autenticación\n/cancel — Cancela la autenticación en curso',
  cmd_status_active: '✅ *Sesión activa*\n\nApartamento: *{apto}*\nActividad: {lastActivity}\nTiempo restante: {remaining}',
  cmd_status_none: '❌ No tienes una sesión activa.',
  cmd_endsession_done: '🔒 Sesión finalizada. Gracias por usar el servicio.',
  cmd_relogin_prompt: '🔒 Sesión finalizada. Escribe cualquier mensaje para iniciar autenticación.',
  cmd_cancel_done: '❌ Autenticación cancelada. Escribe cualquier mensaje para empezar de nuevo.',
  group_session_info: '*Sesión activa:*\nInquilino: {name}\nApartamento: {apto}\nDesde: {createdAt}',
  group_session_none: 'No hay sesión activa para este apartamento.',
  group_who: 'Inquilino: *{name}* — Apartamento *{apto}* — Activo',
  group_close_done: 'Sesión cerrada por administrador.',
  group_ping: 'pong 🤖',
  unknown_command: '❌ Comando no reconocido. Escribe /help para ver los comandos disponibles.',
  group_not_authorized: 'No tienes permiso para usar este comando.',
};

let cache = { ...DEFAULTS };

export function get(key, placeholders) {
  let text = cache[key] || DEFAULTS[key] || key;
  if (placeholders) {
    for (const [k, v] of Object.entries(placeholders)) {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    }
  }
  return text;
}
