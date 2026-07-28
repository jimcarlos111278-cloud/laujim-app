import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Save, Play, Square, RefreshCw, Edit3, Eye, RotateCcw, Smartphone, AlertCircle, CheckCircle, XCircle, Key, Terminal, Globe, ExternalLink, FileText, Shield, Menu, Image, Video, FilePlus, Phone, Search } from 'lucide-react';
import { getAuth } from '../utils/auth';
import { getBase, AUTH_TOKEN } from '../utils/config';

const DEFAULT_SCRIPTS = {
  auth_welcome: '🏢 *Bienvenido al sistema de mensajería*\n\nPara identificarte, escribe tu *número de apartamento* (ej: 203)',
  auth_invalid_apto: '❌ El número de apartamento debe ser de 3 dígitos.\n\nIntenta de nuevo:',
  auth_apto_not_found: '❌ No encontré el apartamento *{apto}*.\n\nVerifica el número e intenta de nuevo:',
  auth_prompt_cedula: '🪪 Ahora escribe tu *cédula* (número de documento):',
  auth_invalid_cedula: '❌ La cédula debe tener al menos 5 dígitos.\n\nIntenta de nuevo:',
  auth_failed: '❌ Los datos no coinciden con nuestros registros.\n\nEscribe tu *número de apartamento* para intentar de nuevo:',
  auth_timeout: '⏰ Tiempo de espera agotado. Escribe cualquier mensaje para iniciar de nuevo.',
  session_created: '✅ *Sesión iniciada*\n\nTu conversación con el grupo *{apto}* ya está activa. Escribe lo que necesites.',
  session_closed: '🔒 Tu sesión ha sido cerrada.',
  relay_from_tenant: '📩 *Inquilino Apto {apto}*',
  relay_from_group: '📩 *Grupo {apto}*',
  cmd_help: '📚 *Comandos:*\n\n/help — Ayuda\n/status — Tu sesión\n/endsession — Cerrar sesión\n/relogin — Reiniciar autenticación\n/cancel — Cancelar autenticación\n/menu — Menú principal',
  cmd_status_active: '✅ *Sesión activa*\n\nApartamento: *{apto}*\nActividad: {lastActivity}\nTiempo restante: {remaining}',
  cmd_status_none: '❌ No tienes una sesión activa.',
  cmd_endsession_done: '🔒 Sesión finalizada.',
  cmd_relogin_prompt: '🔒 Sesión finalizada. Escribe cualquier mensaje para iniciar autenticación.',
  cmd_cancel_done: '❌ Autenticación cancelada.',
  group_session_info: '*Sesión activa:*\nInquilino: {name}\nDesde: {createdAt}\nÚltima actividad: {lastActivity}',
  group_session_none: 'No hay sesión activa para este apartamento.',
  group_who: 'Inquilino: *{name}* ({caller})',
  group_close_done: 'Sesión cerrada por administrador.',
  group_ping: 'pong 🤖',
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

const SCRIPT_LABELS = {
  auth_welcome: 'Bienvenida',
  auth_invalid_apto: 'Apto inválido',
  auth_apto_not_found: 'Apto no encontrado',
  auth_prompt_cedula: 'Solicitar cédula',
  auth_invalid_cedula: 'Cédula inválida',
  auth_failed: 'Autenticación fallida',
  auth_timeout: 'Tiempo agotado',
  session_created: 'Sesión creada',
  session_closed: 'Sesión cerrada',
  relay_from_tenant: 'Prefijo inquilino → grupo',
  relay_from_group: 'Prefijo grupo → inquilino',
  cmd_help: 'Ayuda',
  cmd_status_active: 'Estado activo',
  cmd_status_none: 'Sin sesión',
  cmd_endsession_done: 'Sesión finalizada',
  cmd_relogin_prompt: 'Reinicio auth',
  cmd_cancel_done: 'Auth cancelada',
  group_session_info: 'Info sesión grupo',
  group_session_none: 'Sin sesión grupo',
  group_who: 'Quién es',
  group_close_done: 'Cierre por admin',
  group_ping: 'Ping',
  group_not_authorized: 'No autorizado',
  menu_main: 'Menú principal',
  menu_vacants_header: 'Disponibles (lista)',
  menu_vacants_empty: 'Sin disponibles',
  menu_info_apto_prompt: 'Consultar apto prompt',
  menu_info_apto_not_found: 'Apto no encontrado',
  menu_info_apto_result: 'Info apto detalle',
  lead_prompt_name: 'Lead - nombre',
  lead_prompt_phone: 'Lead - teléfono',
  lead_prompt_email: 'Lead - email',
  lead_thanks: 'Lead - gracias',
  auto_auth_welcome: 'Auto auth bienvenida',
  auto_auth_not_found: 'Auto auth no encontrado',
  menu_zero: 'Volver menú',
};

export default function WhatsAppBot() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [botStatus, setBotStatus] = useState({ running: false, authenticated: false, number: null, pid: null });
  const [botInfo, setBotInfo] = useState({ number: null, groups: [], activeSessions: 0 });
  const [botEnabled, setBotEnabled] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
  const [adminName, setAdminName] = useState('');
  const [scripts, setScripts] = useState({ ...DEFAULT_SCRIPTS });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [editingScript, setEditingScript] = useState(null);
  const [scriptPreview, setScriptPreview] = useState(false);
  const [qrImage, setQrImage] = useState(null);
  const [qrAge, setQrAge] = useState('');
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState(null);
  const [pairingCodeLoading, setPairingCodeLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [proxyStatus, setProxyStatus] = useState(null);
  const [botLogs, setBotLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const qrTimestampRef = useRef(0);
  const logsRef = useRef(null);
  const [leads, setLeads] = useState([]);
  const [showLeads, setShowLeads] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [showSessions, setShowSessions] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [chatConversations, setChatConversations] = useState([]);
  const [activeChatJid, setActiveChatJid] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [passwordOld, setPasswordOld] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [secAnswer, setSecAnswer] = useState('');
  const [secVerified, setSecVerified] = useState(false);

  async function fetchProxyStatus() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/proxy-status', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) setProxyStatus(await res.json());
    } catch {}
  }

  async function fetchLogs() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/logs', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) setBotLogs(await res.json());
    } catch {}
  }

  useEffect(() => {
    if (!auth || auth.role !== 'admin') { navigate('/login', { replace: true }); return; }
    loadConfig();
    fetchStatus();
    fetchBotInfo();
    fetchProxyStatus();
    fetchConversations();
    const iv = setInterval(fetchStatus, 5000);
    const infoIv = setInterval(fetchBotInfo, 15000);
    const chatIv = setInterval(fetchConversations, 3000);
    const ageIv = setInterval(() => {
      const ts = qrTimestampRef.current;
      if (ts > 0) {
        const secs = Math.floor((Date.now() - ts) / 1000);
        setQrAge(secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'min');
      }
    }, 1000);
    return () => { clearInterval(iv); clearInterval(infoIv); clearInterval(chatIv); clearInterval(ageIv); };
  }, []);

  useEffect(() => {
    if (!showLogs) return;
    fetchLogs();
    const iv = setInterval(fetchLogs, 3000);
    return () => clearInterval(iv);
  }, [showLogs]);

  useEffect(() => {
    if (activeChatJid) {
      fetchMessages(activeChatJid);
      handleMarkRead(activeChatJid);
      const iv = setInterval(() => { fetchMessages(activeChatJid); fetchConversations(); }, 3000);
      return () => clearInterval(iv);
    } else {
      setChatMessages([]);
    }
  }, [activeChatJid]);

  async function loadConfig() {
    try {
      const s = await fetch(getBase() + '/settings', { headers: { 'x-auth-token': AUTH_TOKEN } }).then(r => r.json()).catch(() => []);
      const getVal = (k, def) => s.find(x => x.key === k)?.value || def;
      setBotEnabled(getVal('whatsapp_bot_enabled', 'false') === 'true');
      setAdminPhone(getVal('whatsapp_admin_phone', '3107203822'));
      setAdminName(getVal('whatsapp_bot_admin_name', 'Administrador'));
      const loaded = {};
      for (const key of Object.keys(DEFAULT_SCRIPTS)) {
        loaded[key] = getVal('whatsapp_bot_msg_' + key, DEFAULT_SCRIPTS[key]);
      }
      setScripts(loaded);
    } catch {}
  }

  async function fetchBotInfo() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/info', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        setBotInfo(data);
        if (data.number && botStatus.number !== data.number) {
          setBotStatus(s => ({ ...s, number: data.number }));
        }
      }
    } catch {}
  }

  async function fetchLeads() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/leads', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) setLeads(await res.json());
    } catch {}
  }

  async function fetchSessions() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/sessions', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) setSessions(await res.json());
    } catch {}
  }

  async function fetchConversations() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/wa/conversations', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        setChatConversations(data.conversations || []);
      }
    } catch {}
  }

  async function fetchMessages(jid) {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/wa/conversations?jid=' + encodeURIComponent(jid), { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
      }
    } catch {}
  }

  async function handleSendReply() {
    if (!replyText.trim() || !activeChatJid) return;
    setSendingReply(true);
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/wa/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ jid: activeChatJid, text: replyText.trim() }),
      });
      if (res.ok) {
        setReplyText('');
        setTimeout(() => { fetchMessages(activeChatJid); fetchConversations(); }, 500);
      } else {
        const data = await res.json();
        showAction(data.error || 'Error al enviar mensaje', 'error');
      }
    } catch (e) {
      showAction('Error: ' + e.message, 'error');
    }
    setSendingReply(false);
  }

  async function handleMarkRead(jid) {
    try {
      await fetch(getBase() + '/whatsapp-bot/wa/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ jid }),
      });
    } catch {}
  }

  async function fetchStatus() {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/status', { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
        if (data.qr) setQrImage(data.qr);
        if (data.qrTimestamp) {
          qrTimestampRef.current = data.qrTimestamp;
          const secs = Math.floor((Date.now() - data.qrTimestamp) / 1000);
          setQrAge(secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'min');
        }
      }
    } catch {}
    setStatusLoading(false);
  }

  async function upsertSetting(key, value) {
    const settings = await fetch(getBase() + '/settings', { headers: { 'x-auth-token': AUTH_TOKEN } }).then(r => r.json()).catch(() => []);
    const existing = settings.find(s => s.key === key);
    const headers = { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN };
    if (existing) {
      await fetch(getBase() + '/settings/' + existing.id, { method: 'PUT', headers, body: JSON.stringify({ ...existing, value }) });
    } else {
      await fetch(getBase() + '/settings', { method: 'POST', headers, body: JSON.stringify({ key, value }) });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await upsertSetting('whatsapp_bot_enabled', botEnabled ? 'true' : 'false');
      await upsertSetting('whatsapp_admin_phone', adminPhone);
      await upsertSetting('whatsapp_bot_admin_name', adminName);
      for (const [key, value] of Object.entries(scripts)) {
        await upsertSetting('whatsapp_bot_msg_' + key, value);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      showAction('Configuración guardada', 'success');
    } catch (e) {
      showAction('Error al guardar: ' + e.message, 'error');
    }
    setSaving(false);
  }

  async function handleBotAction(action) {
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
      });
      const data = await res.json();
      if (res.ok) {
        showAction(data.message || 'Ok', 'success');
        setTimeout(fetchStatus, 2000);
      } else {
        showAction(data.error || 'Error', 'error');
      }
    } catch (e) {
      showAction('Error: ' + e.message, 'error');
    }
  }

  function showAction(msg, type) {
    setActionMsg({ msg, type });
    setTimeout(() => setActionMsg(null), 5000);
  }

  async function handleRequestCode() {
    const phone = pairingPhone.replace(/[^0-9]/g, '');
    if (!phone || phone.length < 10) {
      showAction('Ingresa un número válido con código de país (ej: 573001234567)', 'error');
      return;
    }
    setPairingCodeLoading(true);
    setPairingCode(null);
    try {
      const res = await fetch(getBase() + '/whatsapp-bot/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (res.ok && data.code) {
        setPairingCode(data.code);
        showAction('Código generado. Revísalo abajo.', 'success');
      } else {
        showAction(data.error || 'Error al solicitar código', 'error');
      }
    } catch (e) {
      showAction('Error: ' + e.message, 'error');
    }
    setPairingCodeLoading(false);
  }

  useEffect(() => {
    if (!pairingCode && pairingCodeLoading) {
      const iv2 = setInterval(async () => {
        try {
          const res = await fetch(getBase() + '/whatsapp-bot/pairing-code', {
            headers: { 'x-auth-token': AUTH_TOKEN },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.code) setPairingCode(data.code);
          }
        } catch {}
      }, 2000);
      return () => clearInterval(iv2);
    }
  }, [pairingCode, pairingCodeLoading]);

  async function handleChangePassword() {
    if (!passwordNew || passwordNew.length < 6) {
      showAction('La nueva contraseña debe tener al menos 6 caracteres', 'error');
      return;
    }
    if (passwordNew !== passwordConfirm) {
      showAction('Las contraseñas no coinciden', 'error');
      return;
    }
    setPasswordChanging(true);
    try {
      const res = await fetch(getBase() + '/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ currentPassword: passwordOld, newPassword: passwordNew }),
      });
      const data = await res.json();
      if (res.ok) {
        showAction('Contraseña actualizada', 'success');
        setPasswordOld('');
        setPasswordNew('');
        setPasswordConfirm('');
      } else {
        showAction(data.error || 'Error al cambiar contraseña', 'error');
      }
    } catch (e) {
      showAction('Error: ' + e.message, 'error');
    }
    setPasswordChanging(false);
  }

  async function handleVerifySecurity() {
    try {
      const res = await fetch(getBase() + '/admin/verify-security-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ answer: secAnswer }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecVerified(true);
        showAction('Respuesta correcta. Puedes cambiar la contraseña.', 'success');
      } else {
        showAction('Respuesta incorrecta', 'error');
      }
    } catch (e) {
      showAction('Error: ' + e.message, 'error');
    }
  }

  async function resetScript(key) {
    setScripts(s => ({ ...s, [key]: DEFAULT_SCRIPTS[key] }));
  }

  async function resetAllScripts() {
    if (!confirm('¿Restaurar todos los mensajes a sus valores por defecto?')) return;
    setScripts({ ...DEFAULT_SCRIPTS });
  }

  function fillPlaceholders(text) {
    return text.replace(/\{apto\}/g, '203').replace(/\{nombre\}/g, 'Juan Pérez').replace(/\{content\}/g, 'Hola, tengo una consulta...').replace(/\{cedula\}/g, '1002163701').replace(/\{name\}/g, 'Juan').replace(/\{rent\}/g, '600000').replace(/\{rooms\}/g, '3').replace(/\{bathrooms\}/g, '2').replace(/\{area\}/g, '72').replace(/\{description\}/g, 'Excelente apartamento en segundo piso');
  }

  const tabs = [
    { id: 'general', label: 'General', icon: MessageCircle },
    { id: 'chat', label: 'Chat WA', icon: MessageCircle },
    { id: 'features', label: 'Funciones', icon: Menu },
    { id: 'messages', label: 'Mensajes', icon: Edit3 },
    { id: 'leads', label: 'Leads', icon: FileText },
    { id: 'advanced', label: 'Avanzado', icon: Shield },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageCircle className="w-6 h-6" /> WhatsApp BOT
          </h1>
          <p className="text-gray-500 mt-1">Proyecto Sabanilla — Panel de administración</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
          <Save className="w-4 h-4" /> {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar Todo'}
        </button>
      </div>

      {actionMsg && (
        <div className={`px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${actionMsg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {actionMsg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {actionMsg.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-white dark:bg-gray-800 text-blue-600 border border-b-0 border-gray-200 dark:border-gray-700' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ─── TAB GENERAL ─── */}
      {activeTab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Estado del Bot</h3>
            {statusLoading ? (
              <p className="text-sm text-gray-400">Verificando...</p>
            ) : (
              <div className="space-y-3">
                <div className={`p-3 rounded-lg flex items-center gap-3 ${botStatus.running ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-gray-50 dark:bg-gray-700'}`}>
                  {botStatus.running ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <XCircle className="w-5 h-5 text-red-400" />}
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{botStatus.running ? 'En ejecución' : 'Detenido'}</p>
                    <p className="text-xs text-gray-500">{botStatus.running ? 'PID: ' + botStatus.pid : 'El bot no está corriendo'}</p>
                  </div>
                </div>

                {botStatus.authenticated && botInfo.number && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300 flex items-center gap-2">
                      <Smartphone className="w-4 h-4" /> Bot activo: <strong>{botInfo.number}</strong>
                    </p>
                    <div className="mt-2 flex gap-4 text-xs text-blue-600 dark:text-blue-400">
                      <span>Grupos: <strong>{botInfo.groups?.length || 0}</strong></span>
                      <span>Sesiones: <strong>{botInfo.activeSessions || 0}</strong></span>
                    </div>
                    <div className="mt-2 text-xs text-blue-500 dark:text-blue-500">
                      {botInfo.groups?.length > 0 && <span>Grupos: {botInfo.groups.join(', ')}</span>}
                    </div>
                  </div>
                )}

                {botStatus.running && (
                  <>
                    <div className={`p-3 rounded-lg flex items-center gap-3 ${botStatus.authenticated ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-amber-50 dark:bg-amber-900/30'}`}>
                      {botStatus.authenticated ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{botStatus.authenticated ? 'Autenticado' : 'Esperando vinculación'}</p>
                        <p className="text-xs text-gray-500">{botStatus.authenticated ? 'Número: ' + (botInfo.number || botStatus.number) : 'Usa QR o código de vinculación'}</p>
                      </div>
                    </div>

                    {botStatus.lastError && (
                      <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg">
                        <p className="text-xs font-medium text-red-700 dark:text-red-400">Error de conexión:</p>
                        <p className="text-xs text-red-600 dark:text-red-300 mt-1 break-words">{botStatus.lastError}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="flex gap-2">
                  {!botStatus.running ? (
                    <button onClick={() => handleBotAction('start')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm">
                      <Play className="w-4 h-4" /> Iniciar Bot
                    </button>
                  ) : (
                    <button onClick={() => handleBotAction('stop')} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm">
                      <Square className="w-4 h-4" /> Detener Bot
                    </button>
                  )}
                  <button onClick={fetchStatus} className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" title="Refrescar">
                    <RefreshCw className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> Configuración</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Activar bot</p>
                  <p className="text-xs text-gray-500">Reenvía mensajes entre inquilinos y grupos</p>
                </div>
                <button onClick={() => setBotEnabled(!botEnabled)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${botEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${botEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Número del admin (dueño de grupos)</label>
                <input type="text" value={adminPhone} onChange={e => setAdminPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="3107203822" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre del administrador</label>
                <input type="text" value={adminName} onChange={e => setAdminName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="Administrador" />
              </div>

              <button onClick={async () => {
                if (!confirm('¿Resetear sesión? Se eliminará la sesión actual y el bot se reiniciará.')) return;
                showAction('Eliminando sesión y reiniciando...', 'success');
                const res = await fetch(getBase() + '/whatsapp-bot/reset-session', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN } });
                const data = await res.json();
                showAction(data.message || 'Ok', res.ok ? 'success' : 'error');
                if (res.ok) { setTimeout(fetchStatus, 5000); }
              }} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors text-sm font-medium">
                <RefreshCw className="w-4 h-4" /> Cambiar número del bot
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Key className="w-4 h-4" /> Vincular Bot</h3>
            {botStatus.authenticated ? (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg text-center">
                <CheckCircle className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Bot vinculado correctamente</p>
                <p className="text-xs text-emerald-500 mt-1">{botInfo.number || botStatus.number}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(qrImage || botStatus.qr) && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                    <img src={`data:image/png;base64,${botStatus.qr || qrImage}`} alt="QR" className="mx-auto w-40 h-40" />
                    <p className="text-xs text-gray-500 mt-2">Escanea con WhatsApp → Vincular dispositivo</p>
                    {qrAge && <p className="text-xs text-gray-400 mt-1">QR hace {qrAge}</p>}
                  </div>
                )}

                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-300 dark:border-gray-600"></div></div>
                  <div className="relative flex justify-center text-xs"><span className="bg-white dark:bg-gray-800 px-2 text-gray-400">o usa código</span></div>
                </div>

                <div className="flex gap-2">
                  <input type="text" value={pairingPhone} onChange={e => setPairingPhone(e.target.value)}
                    placeholder="573001234567"
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    disabled={pairingCodeLoading || !botStatus.running} />
                  <button onClick={handleRequestCode}
                    disabled={pairingCodeLoading || !botStatus.running}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm whitespace-nowrap">
                    {pairingCodeLoading ? '...' : 'Obtener código'}
                  </button>
                </div>

                {pairingCode && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-center">
                    <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">Código de vinculación</p>
                    <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 tracking-widest">{pairingCode}</p>
                    <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                      <p>WhatsApp → Vincular dispositivo → Vincular con número</p>
                      <p>Ingresa el código en tu teléfono</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Proxy</h3>
            {proxyStatus ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <span className="text-gray-500">BOT_PROXY</span>
                  <span className={proxyStatus.botProxySet ? 'text-emerald-600 font-medium' : 'text-red-500'}>{proxyStatus.botProxySet ? '✓ Configurado' : '✗ No configurado'}</span>
                </div>
                {proxyStatus.activeProxyUrl && (
                  <div className="flex justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                    <span className="text-gray-500">Proxy activo</span>
                    <span className="text-gray-900 dark:text-white font-mono text-xs">{proxyStatus.activeProxyUrl}</span>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">Si no ves "Configurado", agrega BOT_PROXY en las variables de entorno de Render.</p>
              </div>
            ) : (<p className="text-sm text-gray-400">Consultando...</p>)}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><ExternalLink className="w-4 h-4" /> Panel Externo</h3>
            <p className="text-sm text-gray-500 mb-4">Panel dedicado del bot con monitoreo en tiempo real.</p>
            <a href="https://laujim-whatsapp-bot.onrender.com" target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all text-sm font-medium">
              <ExternalLink className="w-4 h-4" /> Ir al panel del Bot
            </a>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Terminal className="w-4 h-4" /> Logs del Bot</h3>
              <button onClick={() => setShowLogs(!showLogs)} className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${showLogs ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                <Terminal className="w-3 h-3" /> {showLogs ? 'Ocultar' : 'Ver'}
              </button>
            </div>
            {showLogs && (
              <>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => { const t = botLogs.map(e => '[' + new Date(e.ts).toLocaleTimeString() + '] ' + e.msg).join('\n'); navigator.clipboard.writeText(t); }}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Copy</button>
                  <button onClick={async () => { await fetch(getBase() + '/whatsapp-bot/clear-logs', { headers: { 'x-auth-token': AUTH_TOKEN } }); setBotLogs([]); }}
                    className="flex-1 px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 rounded-lg text-xs hover:bg-red-50 transition-colors">Clear</button>
                  <button onClick={async () => { if (!confirm('¿Resetear sesión de WhatsApp?')) return; await fetch(getBase() + '/whatsapp-bot/reset-session', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN } }); setShowLogs(false); setBotLogs([]); setTimeout(fetchStatus, 3000); }}
                    className="flex-1 px-3 py-1.5 border border-red-500 text-red-700 rounded-lg text-xs hover:bg-red-50 transition-colors font-semibold"><RefreshCw className="w-3 h-3 inline mr-1" /> Reset</button>
                </div>
                <div className="max-h-60 overflow-y-auto bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-lg" ref={logsRef}>
                  {botLogs.length === 0 ? (<p className="text-gray-500">No hay logs</p>) : (
                    botLogs.map((entry, i) => (<div key={i} className="py-0.5"><span className="text-gray-500">[{new Date(entry.ts).toLocaleTimeString()}]</span> {entry.msg}</div>))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB FUNCIONES ─── */}
      {activeTab === 'features' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Menu className="w-4 h-4" /> Funciones del Bot</h3>
            <p className="text-sm text-gray-500 mb-4">Estas funciones son parte del Proyecto Sabanilla. Se activan automáticamente al guardar la configuración.</p>
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-blue-600" />
                  <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Auto-autenticación por número</p>
                </div>
                <p className="text-xs text-blue-500 mt-1">Usuarios registrados se autentican automáticamente al escribir. Sin necesidad de apto/cédula.</p>
              </div>
              <div className="p-3 bg-purple-50 dark:bg-purple-900/30 border border-purple-200 dark:border-purple-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <Image className="w-4 h-4 text-purple-600" />
                  <Video className="w-4 h-4 text-purple-600" />
                  <FilePlus className="w-4 h-4 text-purple-600" />
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Reenvío de fotos, videos y PDFs</p>
                </div>
                <p className="text-xs text-purple-500 mt-1">El bot descarga y reenvía imágenes, videos y documentos entre inquilino y grupo.</p>
              </div>
              <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <Menu className="w-4 h-4 text-emerald-600" />
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Menú interactivo de consulta</p>
                </div>
                <p className="text-xs text-emerald-500 mt-1">Usuarios no registrados pueden consultar apartamentos disponibles, info detallada y registrar interés.</p>
              </div>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-amber-600" />
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Captura de leads con formulario</p>
                </div>
                <p className="text-xs text-amber-500 mt-1">Usuarios interesados llenan nombre, teléfono y email. Leads guardados en la base de datos.</p>
              </div>

            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Search className="w-4 h-4" /> Monitoreo en vivo</h3>
            <div className="space-y-4">
              <button onClick={() => { setShowSessions(!showSessions); if (!showSessions) fetchSessions(); }}
                className="w-full p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-between text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <span className="font-medium text-gray-900 dark:text-white">Sesiones activas ({sessions.count || sessions.length || 0})</span>
                <RefreshCw className="w-4 h-4 text-gray-400" />
              </button>
              {showSessions && (
                <div className="max-h-60 overflow-y-auto space-y-2">
                  {sessions.sessions && sessions.sessions.length > 0 ? sessions.sessions.map((s, i) => (
                    <div key={i} className="p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs">
                      <span className="font-medium text-gray-900 dark:text-white">Apto {s.apto}</span>
                      <span className="text-gray-500 ml-2">{s.tenantName}</span>
                      <span className="text-gray-400 ml-2">{new Date(s.lastActivity).toLocaleString()}</span>
                    </div>
                  )) : (<p className="text-xs text-gray-400">No hay sesiones activas</p>)}
                </div>
              )}

              <button onClick={() => handleBotAction('discover')} className="w-full p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <p className="font-medium text-gray-900 dark:text-white">Rediscover Groups</p>
                <p className="text-xs text-gray-500 mt-1">Busca grupos nuevos que contengan número de apto en el nombre</p>
              </button>

              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Grupos descubiertos: <strong>{botInfo.groups?.length || 0}</strong></p>
                <div className="text-xs text-gray-500 mt-1">
                  {botInfo.groups?.length > 0 ? botInfo.groups.join(', ') : 'Ninguno'}
                </div>
              </div>

              <button onClick={async () => {
                showAction('Verifica el panel externo para el ladder de entrega', 'success');
              }} className="w-full p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <p className="font-medium text-gray-900 dark:text-white">Delivery Ladder</p>
                <p className="text-xs text-gray-500 mt-1">GET {window.location.origin}/whatsapp-bot/ladder en el panel externo</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB MENSAJES ─── */}
      {activeTab === 'messages' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Edit3 className="w-4 h-4" /> Mensajes del Bot</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setScriptPreview(!scriptPreview)} className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${scriptPreview ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                <Eye className="w-3 h-3" /> {scriptPreview ? 'Editar' : 'Vista previa'}
              </button>
              <button onClick={resetAllScripts} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">
                <RotateCcw className="w-3 h-3" /> Restaurar todo
              </button>
            </div>
          </div>

          {editingScript && !scriptPreview ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white">{SCRIPT_LABELS[editingScript] || editingScript}</h4>
                <div className="flex gap-2">
                  <button onClick={() => resetScript(editingScript)} className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1">
                    <RotateCcw className="w-3 h-3" /> Restaurar
                  </button>
                  <button onClick={() => setEditingScript(null)} className="text-xs text-gray-500 hover:text-gray-700">Cerrar</button>
                </div>
              </div>
              <textarea value={scripts[editingScript] || ''} onChange={e => setScripts(s => ({ ...s, [editingScript]: e.target.value }))}
                rows={6} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
              <div className="text-xs text-gray-400 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="font-medium mb-1">Vista previa:</p>
                <p className="whitespace-pre-wrap">{fillPlaceholders(scripts[editingScript] || '')}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto">
              {Object.keys(SCRIPT_LABELS).map(key => (
                <button key={key} onClick={() => { setEditingScript(key); setScriptPreview(false); }}
                  className={`text-left p-3 rounded-lg border text-sm transition-colors ${editingScript === key ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  <p className="font-medium text-gray-900 dark:text-white text-xs">{SCRIPT_LABELS[key]}</p>
                  <p className="text-xs text-gray-500 mt-1 truncate">{scripts[key]?.replace(/\n/g, ' ').slice(0, 80)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB LEADS ─── */}
      {activeTab === 'leads' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><FileText className="w-4 h-4" /> Leads Capturados</h3>
            <button onClick={() => { fetchLeads(); setShowLeads(!showLeads); }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <RefreshCw className="w-4 h-4" /> {showLeads ? 'Ocultar' : 'Cargar leads'}
            </button>
          </div>
          {showLeads && (
            leads.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No hay leads capturados aún</p>
                <p className="text-xs mt-1">Los leads aparecen aquí cuando usuarios interesados llenan el formulario desde WhatsApp</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="text-left p-2 text-xs font-medium text-gray-500">Fecha</th>
                      <th className="text-left p-2 text-xs font-medium text-gray-500">Nombre</th>
                      <th className="text-left p-2 text-xs font-medium text-gray-500">Teléfono</th>
                      <th className="text-left p-2 text-xs font-medium text-gray-500">Email</th>
                      <th className="text-left p-2 text-xs font-medium text-gray-500">Fuente</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {leads.map((lead, i) => (
                      <tr key={lead.id || i} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="p-2 text-xs text-gray-500">{new Date(lead.createdAt || lead.ts).toLocaleDateString()}</td>
                        <td className="p-2 font-medium text-gray-900 dark:text-white">{lead.name}</td>
                        <td className="p-2 text-gray-600">{lead.phone}</td>
                        <td className="p-2 text-gray-600">{lead.email}</td>
                        <td className="p-2 text-gray-400 text-xs">{lead.source || 'whatsapp'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* ─── TAB CHAT WA ─── */}
      {activeTab === 'chat' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden" style={{ height: '560px' }}>
          <div className="flex h-full">
            {/* Sidebar */}
            <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900">
              <div className="p-3 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Conversaciones
                  {chatConversations.filter(c => c.unread > 0).length > 0 && (
                    <span className="ml-auto text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">
                      {chatConversations.filter(c => c.unread > 0).length} nuevas
                    </span>
                  )}
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto">
                {chatConversations.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">
                    <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>Sin conversaciones</p>
                    <p className="text-xs mt-1">Los mensajes relayeados aparecerán aquí</p>
                  </div>
                ) : chatConversations.map(c => (
                  <div key={c.jid}
                    onClick={() => setActiveChatJid(c.jid)}
                    className={`flex items-center gap-2 p-3 cursor-pointer border-b border-gray-200 dark:border-gray-700 transition-colors ${activeChatJid === c.jid ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {c.apto || c.jid.slice(2, 5)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Apto {c.apto || '?'}</span>
                        <span className="text-xs text-gray-400">{c.lastMessage ? new Date(c.lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {c.unread > 0 && <span className="w-2 h-2 rounded-full bg-blue-600 flex-shrink-0"></span>}
                        <span className="text-xs text-gray-500 truncate">
                          {c.lastMessage ? (c.lastMessage.direction === 'in' ? '→ ' : '← ') + c.lastMessage.text : 'Sin mensajes'}
                        </span>
                      </div>
                    </div>
                    {c.unread > 0 && (
                      <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{c.unread}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat panel */}
            <div className="flex-1 flex flex-col">
              {activeChatJid ? (
                <>
                  <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                      {chatConversations.find(c => c.jid === activeChatJid)?.apto || activeChatJid.slice(2, 5)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Apto {chatConversations.find(c => c.jid === activeChatJid)?.apto || '?'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {chatMessages.length} mensajes · {botStatus.authenticated ? 'Bot activo' : 'Bot desconectado'}
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900" ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
                    {chatMessages.length === 0 ? (
                      <div className="text-center text-gray-400 text-sm pt-10">
                        <p>No hay mensajes en esta conversación</p>
                        <p className="text-xs mt-1">Los mensajes aparecen cuando el inquilino escribe</p>
                      </div>
                    ) : chatMessages.map(m => (
                      <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${m.direction === 'out' ? 'bg-blue-600 text-white rounded-br-md' : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-md'}`}>
                          {m.direction === 'out' && m.sender && (
                            <p className="text-xs font-semibold text-blue-500 dark:text-blue-400 mb-0.5">{m.sender}</p>
                          )}
                          <p className="whitespace-pre-wrap break-words">{m.text}</p>
                          <p className={`text-xs mt-1 ${m.direction === 'out' ? 'text-blue-200' : 'text-gray-400'}`}>
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                    <div className="flex gap-2 items-center">
                      <input type="text" value={replyText} onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
                        placeholder="Escribe para responder al inquilino..."
                        disabled={sendingReply || !botStatus.authenticated}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50" />
                      <button onClick={handleSendReply} disabled={!replyText.trim() || sendingReply || !botStatus.authenticated}
                        className="w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m22 2-7 20-4-9-9-4Z"/></svg>
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5 text-center">
                      {botStatus.authenticated ? 'Los mensajes se envían vía WhatsApp al inquilino' : 'Espera a que el bot esté conectado'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Selecciona una conversación</p>
                    <p className="text-xs mt-1">Los mensajes relayeados entre inquilinos y grupos aparecen aquí</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB AVANZADO ─── */}
      {activeTab === 'advanced' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Shield className="w-4 h-4" /> Seguridad</h3>
            <div className="space-y-4">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Verificar pregunta de seguridad</p>
                <p className="text-xs text-gray-500 mb-2">Responde la pregunta de seguridad para habilitar el cambio de contraseña</p>
                <div className="flex gap-2">
                  <input type="text" value={secAnswer} onChange={e => setSecAnswer(e.target.value)}
                    placeholder="Respuesta..." className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                  <button onClick={handleVerifySecurity} disabled={!secAnswer}
                    className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 transition-colors text-sm font-medium">
                    Verificar
                  </button>
                </div>
              </div>

              {secVerified && (
                <div className="p-3 border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-3">✅ Verificado — Cambiar contraseña de administrador</p>
                  <div className="space-y-2">
                    <input type="password" value={passwordOld} onChange={e => setPasswordOld(e.target.value)}
                      placeholder="Contraseña actual" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    <input type="password" value={passwordNew} onChange={e => setPasswordNew(e.target.value)}
                      placeholder="Nueva contraseña (mín 6 caracteres)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                      placeholder="Confirmar nueva contraseña" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
                    <button onClick={handleChangePassword} disabled={passwordChanging || !passwordNew || !passwordConfirm}
                      className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium">
                      {passwordChanging ? 'Cambiando...' : 'Cambiar contraseña'}
                    </button>
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-400 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="font-medium text-gray-900 dark:text-white mb-1">Pistas:</p>
                <p>Pregunta de seguridad: ¿Apellidos de tu esposa?</p>
                <p>Respuesta: Quessep Martelo</p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Herramientas de Admin</h3>
            <div className="space-y-3">
              <button onClick={() => handleBotAction('reset-session')} className="w-full p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-left hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Resetear sesión WhatsApp</p>
                <p className="text-xs text-red-500 mt-1">Borra la sesión actual. El bot se reinicia y pide nuevo QR/código.</p>
              </button>

              <button onClick={async () => {
                if (!confirm('¿Resetear base de datos? Se perderán todos los cambios.')) return;
                try {
                  const res = await fetch(getBase() + '/reset-db', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN } });
                  const data = await res.json();
                  showAction(data.message || 'Reset completado', res.ok ? 'success' : 'error');
                } catch (e) { showAction('Error: ' + e.message, 'error'); }
              }} className="w-full p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-left hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Resetear base de datos</p>
                <p className="text-xs text-red-500 mt-1">Restaura la base de datos a los valores iniciales.</p>
              </button>

              <div className="p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Configuración guardada en servidor</p>
                <p className="text-xs text-amber-500 mt-1">Bot Admin Token: {import.meta.env.VITE_BOT_ADMIN_TOKEN ? import.meta.env.VITE_BOT_ADMIN_TOKEN.slice(0, 4) + '...' : 'Configurado en servidor'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400 text-center">
        Proyecto Sabanilla v2.8.0 — {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}
