import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Save, Play, Square, RefreshCw, Edit3, Eye, RotateCcw, Smartphone, AlertCircle, CheckCircle, XCircle, Key, Terminal, Globe } from 'lucide-react';
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
  relay_from_tenant: '📩 *Inquilino Apto {apto}*\n{content}',
  relay_from_group: '📩 *Grupo {apto}*\n{content}',
  cmd_help: '📚 *Comandos:*\n\n/help — Ayuda\n/status — Tu sesión\n/endsession — Cerrar sesión\n/relogin — Reiniciar autenticación\n/cancel — Cancelar autenticación',
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
  group_session_info: 'Info sesión (grupo)',
  group_session_none: 'Sin sesión (grupo)',
  group_who: 'Quién es',
  group_close_done: 'Cierre por admin',
  group_ping: 'Ping',
  group_not_authorized: 'No autorizado',
};

export default function WhatsAppBot() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [botStatus, setBotStatus] = useState({ running: false, authenticated: false, number: null, pid: null });
  const [botInfo, setBotInfo] = useState({ number: null, groups: [], activeSessions: 0 });
  const [botEnabled, setBotEnabled] = useState(false);
  const [adminPhone, setAdminPhone] = useState('');
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
  const pollRef = useState(null);

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
    const iv = setInterval(fetchStatus, 5000);
    const infoIv = setInterval(fetchBotInfo, 15000);
    const ageIv = setInterval(() => {
      const ts = qrTimestampRef.current;
      if (ts > 0) {
        const secs = Math.floor((Date.now() - ts) / 1000);
        setQrAge(secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'min');
      }
    }, 1000);
    return () => { clearInterval(iv); clearInterval(infoIv); clearInterval(ageIv); };
  }, []);

  async function loadConfig() {
    try {
      const s = await fetch(getBase() + '/settings', { headers: { 'x-auth-token': AUTH_TOKEN } }).then(r => r.json()).catch(() => []);
      const getVal = (k, def) => s.find(x => x.key === k)?.value || def;
      setBotEnabled(getVal('whatsapp_bot_enabled', 'false') === 'true');
      setAdminPhone(getVal('whatsapp_admin_phone', '3107203822'));
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

  async function resetScript(key) {
    setScripts(s => ({ ...s, [key]: DEFAULT_SCRIPTS[key] }));
  }

  async function resetAllScripts() {
    if (!confirm('¿Restaurar todos los mensajes a sus valores por defecto?')) return;
    setScripts({ ...DEFAULT_SCRIPTS });
  }

  function fillPlaceholders(text) {
    return text.replace(/\{apto\}/g, '203').replace(/\{nombre\}/g, 'Juan Pérez').replace(/\{content\}/g, 'Hola, tengo una consulta...').replace(/\{cedula\}/g, '1002163701');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <MessageCircle className="w-6 h-6" /> WhatsApp BOT
          </h1>
          <p className="text-gray-500 mt-1">Administra el bot de WhatsApp para la comunicación con inquilinos</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Status Card */}
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

        {/* Config Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> Configuración</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Activar bot</p>
                <p className="text-xs text-gray-500">Reenvía mensajes entre inquilinos y grupos de WhatsApp</p>
              </div>
              <button onClick={() => setBotEnabled(!botEnabled)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${botEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${botEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Número del admin (dueño de los grupos)</label>
              <input type="text" value={adminPhone} onChange={e => setAdminPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="3107203822" />
              <p className="text-xs text-gray-400 mt-1">Este número crea los grupos. El bot reenvía mensajes del inquilino al grupo y viceversa.</p>
            </div>

            <button onClick={async () => {
              if (!confirm('¿Resetear sesión?\n\nSe eliminará la sesión actual y el bot se reiniciará. Tendrás que vincularlo de nuevo.')) return;
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

        {/* QR + Pairing Unified Card */}
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
              {/* QR */}
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

              {/* Pairing code */}
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

        {/* Proxy Status Card */}
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
              {proxyStatus.proxyType && (
                <div className="flex justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <span className="text-gray-500">Tipo</span>
                  <span className="text-gray-900 dark:text-white">{proxyStatus.proxyType === 'socks' ? 'SOCKS' : 'HTTP/HTTPS'}</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">Si no ves "Configurado", agrega BOT_PROXY en las variables de entorno de Render.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Consultando...</p>
          )}
        </div>

        {/* Logs Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Terminal className="w-4 h-4" /> Logs del Bot</h3>
          <button
            onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchLogs(); }}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors mb-2"
          >
            {showLogs ? 'Ocultar logs' : 'Ver logs'}
          </button>
          {showLogs && (
            <>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => {
                    const text = botLogs.map(e => '[' + new Date(e.ts).toLocaleTimeString() + '] ' + e.msg).join('\n');
                    navigator.clipboard.writeText(text).then(() => {
                      const btn = document.getElementById('copy-logs-btn');
                      if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = 'Copy logs'; }, 2000); }
                    });
                  }}
                  id="copy-logs-btn"
                  className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Copy logs
                </button>
                <button
                  onClick={async () => {
                    try {
                      await fetch(getBase() + '/whatsapp-bot/clear-logs', { headers: { 'x-auth-token': AUTH_TOKEN } });
                      setBotLogs([]);
                    } catch {}
                  }}
                  className="flex-1 px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg text-xs hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Clear logs
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('¿Resetear sesión de WhatsApp? Se borrarán las credenciales y necesitarás escanear QR de nuevo.')) return;
                    try {
                      await fetch(getBase() + '/whatsapp-bot/reset-session', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN } });
                      setShowLogs(false);
                      setBotLogs([]);
                      setTimeout(fetchStatus, 3000);
                    } catch (e) { console.error(e); }
                  }}
                  className="flex-1 px-3 py-1.5 border border-red-500 dark:border-red-600 text-red-700 dark:text-red-300 rounded-lg text-xs hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-semibold"
                >
                  <RefreshCw className="w-3 h-3 inline mr-1" /> Reset Session
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-lg">
                {botLogs.length === 0 ? (
                  <p className="text-gray-500">No hay logs disponibles</p>
                ) : (
                  botLogs.map((entry, i) => (
                    <div key={i} className="py-0.5">
                      <span className="text-gray-500">[{new Date(entry.ts).toLocaleTimeString()}]</span> {entry.msg}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

      </div>

      {/* Scripts Editor */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Edit3 className="w-4 h-4" /> Mensajes del Bot</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setScriptPreview(!scriptPreview)} className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${scriptPreview ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
              <Eye className="w-3 h-3" /> {scriptPreview ? 'Editar' : 'Vista previa'}
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
            <textarea
              value={scripts[editingScript] || ''}
              onChange={e => setScripts(s => ({ ...s, [editingScript]: e.target.value }))}
              rows={6}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs"
            />
            <div className="text-xs text-gray-400 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="font-medium mb-1">Vista previa:</p>
              <p className="whitespace-pre-wrap">{fillPlaceholders(scripts[editingScript] || '')}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
            {Object.keys(SCRIPT_LABELS).map(key => (
              <button
                key={key}
                onClick={() => { setEditingScript(key); setScriptPreview(false); }}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${editingScript === key ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/30' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
              >
                <p className="font-medium text-gray-900 dark:text-white text-xs">{SCRIPT_LABELS[key]}</p>
                <p className="text-xs text-gray-500 mt-1 truncate">{scripts[key]?.replace(/\n/g, ' ').slice(0, 80)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 text-center">
        Los cambios se guardan en el servidor. El bot los aplica automáticamente.
      </div>
    </div>
  );
}
