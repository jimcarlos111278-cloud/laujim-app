const DEFAULTS = {
  auth_welcome: '🤖 *Laujim Bot de atención*\n\nEste canal es automático y tus mensajes no se envían al administrador hasta verificar tu identidad.\n\nPara continuar, escribe tu *número de apartamento* (ej: 203):',
  auth_invalid_apto: '❌ El número de apartamento debe ser de 3 dígitos.\n\nIntenta de nuevo:',
  auth_apto_not_found: '❌ No encontré el apartamento *{apto}*.\n\nVerifica el número e intenta de nuevo:',
  auth_prompt_cedula: '🪪 Ahora escribe tu *cédula* (número de documento):',
  auth_invalid_cedula: '❌ La cédula debe tener al menos 5 dígitos.\n\nIntenta de nuevo:',
  auth_failed: '❌ Los datos no coinciden con nuestros registros. Tus mensajes siguen sin ser entregados al administrador.\n\nEscribe tu *número de apartamento* para intentar de nuevo:',
  auth_timeout: '⏰ Tiempo de espera agotado. Escribe cualquier mensaje para iniciar de nuevo.',
  session_created: '✅ *Sesión iniciada*\n\nTu conversación con el grupo *{apto}* ya está activa. Escribe lo que necesites.',
  session_expired: '⏰ Tu sesión ha expirado por inactividad. Escribe cualquier mensaje para iniciar de nuevo.',
  session_closed: '🔒 Tu sesión ha sido cerrada.',
  relay_from_tenant: '*Inquilino Apto {apto}*',
  relay_from_group: '*Mensaje del grupo {apto}*',
  cmd_help: '📚 *Comandos disponibles:*\n\n/help — Muestra esta ayuda\n/status — Estado de tu sesión\n/endsession — Finaliza tu sesión\n/relogin — Finaliza sesión y reinicia autenticación\n/cancel — Cancela la autenticación en curso\n/menu — Menú principal',
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
  menu_main: '🏢 *Hola! Bienvenido*\n\nElige una opción:\n\n1️⃣ Ver apartamentos disponibles\n2️⃣ Consultar información de un apto\n3️⃣ 📝 Registrar mi interés\n4️⃣ 🔑 Soy residente (iniciar sesión)\n\nResponde con el *número* de la opción:',
  menu_invalid: '❌ Opción inválida. Responde 1, 2, 3 o 4.',
  menu_vacants_header: '🏢 *Apartamentos disponibles*\n\n{vacants}\n\nResponde *3* para registrar tu interés o *4* para iniciar sesión.\nO escribe *0* para volver al menú principal.',
  menu_vacants_empty: '🏢 No hay apartamentos disponibles en este momento.\n\nEscribe *0* para volver al menú principal.',
  menu_info_apto_prompt: '🔍 Escribe el *número de apartamento* que deseas consultar (ej: 203):',
  menu_info_apto_not_found: '❌ No encontré el apartamento *{apto}*.\n\nIntenta con otro número o escribe *0* para volver:',
  menu_info_apto_result: '🏢 *Apartamento {apto}*\n\n💰 Canón: ${rent}\n🛏 Habitaciones: {rooms}\n🚿 Baños: {bathrooms}\n📐 Área: {area}m²\n📝 {description}\n\nResponde *3* para registrar tu interés o *0* para volver al menú.',
  lead_prompt_name: '📝 *Gracias por tu interés!*\n\nEscribe tu *nombre completo*:',
  lead_prompt_phone: '📱 Ahora escribe tu *número de teléfono* (ej: 573001234567):',
  lead_prompt_email: '📧 Ahora escribe tu *correo electrónico*:',
  lead_thanks: '✅ *Gracias {name}!*\n\nHemos recibido tu información. Nos pondremos en contacto contigo pronto.\n\nEscribe *0* para volver al menú principal.',
  lead_error: '❌ Hubo un error al guardar tus datos. Intenta de nuevo más tarde.\n\nEscribe *0* para volver al menú principal.',
  auto_auth_welcome: '✅ *Bienvenido {name}!*\n\nHemos identificado tu número. Tu sesión con el grupo *{apto}* está activa.\n\nEscribe lo que necesites o /menu para más opciones.',
  auto_auth_not_found: '🏢 No encontré tu número en nuestros registros.\n\nElige una opción:\n\n1️⃣ Ver apartamentos disponibles\n2️⃣ Consultar información de un apto\n3️⃣ 📝 Registrar mi interés\n4️⃣ 🔑 Soy residente (iniciar sesión)',
  menu_zero: '🏢 *Menú Principal*\n\n1️⃣ Ver apartamentos disponibles\n2️⃣ Consultar información de un apto\n3️⃣ 📝 Registrar mi interés\n4️⃣ 🔑 Soy residente (iniciar sesión)',
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

export function getDefaults() {
  return { ...DEFAULTS };
}

export function setCache(newCache) {
  cache = { ...cache, ...newCache };
}

export function getCache() {
  return { ...cache };
}

export function resetToDefaults() {
  cache = { ...DEFAULTS };
}
