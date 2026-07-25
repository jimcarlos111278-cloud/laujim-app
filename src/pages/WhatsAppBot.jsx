import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Save, Play, Square, RefreshCw, Edit3, Eye, RotateCcw, Smartphone, ToggleLeft, ToggleRight, AlertCircle, CheckCircle, XCircle, Key } from 'lucide-react';
import { getAuth } from '../utils/auth';
import { getBase, AUTH_TOKEN } from '../utils/config';

const DEFAULT_SCRIPTS = {
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

const SCRIPT_LABELS = {
  auth_welcome: 'Bienvenida',
  auth_invalid_apto: 'Apto inválido',
  auth_apto_not_found: 'Apto no encontrado',
  auth_prompt_cedula: 'Solicitar cédula',
  auth_invalid_cedula: 'Cédula inválida',
  auth_success: 'Autenticación exitosa',
  auth_failed: 'Autenticación fallida',
  auth_timeout: 'Tiempo agotado',
  auth_blocked: 'Usuario bloqueado',
  relay_admin_prefix: 'Prefijo mensaje admin → inquilino',
  notif_admin_new: 'Notificación al admin',
  confirmation_sent: 'Confirmación de envío',
  cmd_not_found: 'Comando no reconocido',
  cmd_listar_empty: 'Listar: sin sesiones',
  cmd_cortar_usage: 'Cortar: uso',
  cmd_cortar_done: 'Cortar: confirmación',
  cmd_bloquear_usage: 'Bloquear: uso',
  cmd_bloquear_done: 'Bloquear: confirmación',
  cmd_mensajes_usage: 'Mensajes: uso',
  cmd_mensajes_empty: 'Mensajes: sin datos',
  session_closed: 'Sesión cerrada (notif)',
  session_blocked: 'Sesión bloqueada (notif)',
  cmd_help: 'Comando !ayuda',
};

export default function WhatsAppBot() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [botStatus, setBotStatus] = useState({ running: false, authenticated: false, number: null, pid: null });
  const [botEnabled, setBotEnabled] = useState(false);
  const [botPhone, setBotPhone] = useState('');
  const [adminNumbers, setAdminNumbers] = useState('');
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
  const qrTimestampRef = useRef(0);
  const pollRef = useState(null);

  useEffect(() => {
    if (!auth || auth.role !== 'admin') { navigate('/login', { replace: true }); return; }
    loadConfig();
    fetchStatus();
    const iv = setInterval(fetchStatus, 5000);
    const ageIv = setInterval(() => {
      const ts = qrTimestampRef.current;
      if (ts > 0) {
        const secs = Math.floor((Date.now() - ts) / 1000);
        setQrAge(secs < 60 ? secs + 's' : Math.floor(secs / 60) + 'min');
      }
    }, 1000);
    return () => { clearInterval(iv); clearInterval(ageIv); };
  }, []);

  async function loadConfig() {
    try {
      const s = await fetch(getBase() + '/settings', { headers: { 'x-auth-token': AUTH_TOKEN } }).then(r => r.json()).catch(() => []);
      const getVal = (k, def) => s.find(x => x.key === k)?.value || def;
      setBotEnabled(getVal('whatsapp_bot_enabled', 'false') === 'true');
      setBotPhone(getVal('whatsapp_bot_phone', ''));
      setAdminNumbers(getVal('whatsapp_admin_numbers', ''));
      const loaded = {};
      for (const key of Object.keys(DEFAULT_SCRIPTS)) {
        loaded[key] = getVal('whatsapp_bot_msg_' + key, DEFAULT_SCRIPTS[key]);
      }
      setScripts(loaded);
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
      await upsertSetting('whatsapp_bot_phone', botPhone);
      await upsertSetting('whatsapp_admin_numbers', adminNumbers);
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

              {botStatus.running && (
                <>
                  <div className={`p-3 rounded-lg flex items-center gap-3 ${botStatus.authenticated ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-amber-50 dark:bg-amber-900/30'}`}>
                    {botStatus.authenticated ? <CheckCircle className="w-5 h-5 text-emerald-600" /> : <AlertCircle className="w-5 h-5 text-amber-500" />}
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{botStatus.authenticated ? 'Autenticado' : 'Esperando QR'}</p>
                      <p className="text-xs text-gray-500">{botStatus.authenticated ? 'Número: ' + botStatus.number : 'Escanea el QR con WhatsApp'}</p>
                    </div>
                  </div>

                  {!botStatus.authenticated && (qrImage || botStatus.qr) && (
                    <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg text-center">
                      <img src={`data:image/png;base64,${botStatus.qr || qrImage}`} alt="QR Code" className="mx-auto w-48 h-48" />
                      <p className="text-xs text-gray-500 mt-2">Escanea con WhatsApp → Vincular dispositivo</p>
                      {qrAge && <p className="text-xs text-gray-400 mt-1">QR generado hace {qrAge}</p>}
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
                <p className="text-xs text-gray-500">Reenviar mensajes entre WhatsApp y el chat web</p>
              </div>
              <button onClick={() => setBotEnabled(!botEnabled)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${botEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${botEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Número del bot (WhatsApp)</label>
              <input type="text" value={botPhone} onChange={e => setBotPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="573005185668" />
              <p className="text-xs text-gray-400 mt-1">Este es el número que los inquilinos ven para escribir al bot.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Notificar a (números admin)</label>
              <input type="text" value={adminNumbers} onChange={e => setAdminNumbers(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="573001234567, 573001234568" />
              <p className="text-xs text-gray-400 mt-1">Separados por coma. A estos números llegarán notificaciones de nuevos mensajes de inquilinos. También pueden usar comandos como <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">!listar</code>.</p>
            </div>

            <button onClick={async () => {
              if (!confirm('¿Cambiar el número del bot?\n\nSe eliminará la sesión actual y el bot se reiniciará. Tendrás que escanear el QR con el nuevo número.')) return;
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

        {/* Pairing Code Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Key className="w-4 h-4" /> Vinculación por código</h3>
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Alternativa al QR. Ingresa tu número y WhatsApp te dará un código para vincular.</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={pairingPhone}
                onChange={e => setPairingPhone(e.target.value)}
                placeholder="573001234567"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                disabled={pairingCodeLoading}
              />
              <button
                onClick={handleRequestCode}
                disabled={pairingCodeLoading || !botStatus.running || botStatus.authenticated}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm whitespace-nowrap"
              >
                {pairingCodeLoading ? 'Solicitando...' : 'Solicitar código'}
              </button>
            </div>
            {pairingCode && (
              <div className="p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-center">
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">Código de vinculación</p>
                <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 tracking-widest">{pairingCode}</p>
                <div className="mt-3 text-xs text-blue-600 dark:text-blue-400 space-y-1">
                  <p>1. Abre WhatsApp en tu teléfono</p>
                  <p>2. Ve a <strong>Dispositivos vinculados</strong></p>
                  <p>3. Toca <strong>Vincular un dispositivo</strong></p>
                  <p>4. Selecciona <strong>Vincular con número de teléfono</strong></p>
                  <p>5. Ingresa el código de arriba</p>
                </div>
              </div>
            )}
          </div>
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
