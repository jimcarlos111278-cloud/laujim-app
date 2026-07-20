import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Globe, FileText, Eye, Mail, Download, Smartphone, Bell, RefreshCw, Cloud, CloudOff, Share2, Moon, Sun, User, KeyRound, Copy } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { getBase } from '../utils/config';
import { generatePublicHTML } from '../utils/pdf';
import { requestNotificationPermission } from '../utils/notifications';
import { syncAll, syncPush, syncPull, hasPendingOps, getSyncStatus, isServerAvailable, startAutoSync, stopAutoSync } from '../utils/sync';
import { isDarkMode, toggleDarkMode } from '../utils/darkMode';
import { getNotifConfig, saveNotifConfig, schedulePaymentReminders, cancelAllNotifications } from '../utils/localNotifications';

export default function Settings() {
  const navigate = useNavigate();
  const [apartments, setApartments] = useState([]);
  const [showPublicView, setShowPublicView] = useState(false);
  const [publicHTML, setPublicHTML] = useState('');
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('apt_server_url') || '');
  const [connStatus, setConnStatus] = useState(null);
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [syncStatus, setSyncStatus] = useState({
    syncing: false,
    pendingCount: getSyncStatus().pendingCount,
    lastSync: localStorage.getItem('apt_last_sync') || null,
    error: null,
    serverAvailable: null,
    pushed: 0,
    failed: 0,
  });
  const autoSyncIntervalRef = useRef(null);
  const [dark, setDark] = useState(isDarkMode());
  const [notifConfig, setNotifConfig] = useState(getNotifConfig());
  const [localPasswords, setLocalPasswords] = useState([]);
  const [allTenants, setAllTenants] = useState([]);
  const [contracts, setContracts] = useState([]);

  async function handleToggleDark() {
    const next = toggleDarkMode();
    setDark(next);
  }

  async function handleNotifToggle() {
    const next = { ...notifConfig, enabled: !notifConfig.enabled };
    setNotifConfig(next);
    saveNotifConfig(next);
    if (next.enabled) {
      const a = await api.apartments.toArray();
      await schedulePaymentReminders(a);
    } else {
      await cancelAllNotifications();
    }
  }

  async function handleDaysChange(days) {
    const next = { ...notifConfig, daysBefore: Number(days) };
    setNotifConfig(next);
    saveNotifConfig(next);
    if (next.enabled) {
      await cancelAllNotifications();
      const a = await api.apartments.toArray();
      await schedulePaymentReminders(a);
    }
  }

  useEffect(() => {
    load();
    fetchVersion();
    checkServerAvailability();
  }, []);

  async function checkServerAvailability() {
    const status = await isServerAvailable();
    setSyncStatus(s => ({ ...s, serverAvailable: status.ok, error: status.ok ? null : status.reason }));
    return status.ok;
  }

  async function fetchVersion() {
    try {
      const r = await fetch('/version.json');
      const v = await r.json();
      document.getElementById('apk-version').textContent = v.version || '1.0.0';
      document.getElementById('apk-build').textContent = (v.date || '') + ' ' + (v.time || '');
      document.getElementById('about-version').textContent = 'Versión: ' + (v.version || '1.0.0');
      localStorage.setItem('apt_local_version', v.version || '1.0.0');
    } catch {}
  }

  async function checkUpdate() {
    const info = document.getElementById('update-info');
    info.innerHTML = '<p class="text-xs text-gray-500 mt-2">Buscando actualizaciones...</p>';
    try {
      const currentVer = localStorage.getItem('apt_local_version') || '1.0.0';
      const serverBase = getBase().replace('/api', '');
      const v = await api.getServerVersion();
      if (!v) throw new Error('No se pudo conectar al servidor');
      const serverVer = v.version || '1.0.0';
      const curPatch = Number(currentVer.split('.')[2] || 0);
      const srvPatch = Number(serverVer.split('.')[2] || 0);
      if (srvPatch > curPatch) {
        info.innerHTML = '<div class="flex items-center gap-2 mt-2 p-2 bg-green-50 rounded-lg"><span class="text-sm text-green-700">Nueva versión: <strong>' + serverVer + '</strong></span><button onclick="window.location.href=\'' + serverBase + '/app-debug.apk\'" class="ml-auto px-3 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Descargar</button></div>';
      } else {
        info.innerHTML = '<div class="flex items-center gap-2 mt-2 p-2 bg-gray-50 rounded-lg"><span class="text-sm text-gray-600">Tienes la última versión (' + currentVer + ')</span></div>';
      }
    } catch {
      info.innerHTML = '<div class="flex items-center gap-2 mt-2 p-2 bg-red-50 rounded-lg"><span class="text-sm text-red-600">No se pudo conectar al servidor. Verifica la conexión al PC o la URL configurada.</span></div>';
    }
  }

  async function testConnection() {
    setConnStatus('probando');
    const url = serverUrl.replace(/\/+$/, '');
    try {
      const res = await fetch(url + '/api/apartments/count', { signal: AbortSignal.timeout(5000) });
      const ct = res.headers.get('content-type') || '';
      setConnStatus(res.ok && ct.includes('application/json') ? 'ok' : 'error');
    } catch {
      setConnStatus('error');
    }
  }

  function saveServerUrl() {
    const url = serverUrl.replace(/\/+$/, '');
    if (url) {
      localStorage.setItem('apt_server_url', url);
    } else {
      localStorage.removeItem('apt_server_url');
    }
    setConnStatus(null);
    checkServerAvailability();
  }

  async function handleSync() {
    setSyncStatus(s => ({ ...s, syncing: true, error: null }));
    const result = await syncAll();
    setSyncStatus(s => ({
      ...s,
      syncing: false,
      pendingCount: getSyncStatus().pendingCount,
      lastSync: result.ok ? new Date().toLocaleString('es-CO') : s.lastSync,
      error: result.ok ? null : result.reason,
      pushed: result.pushed || 0,
      failed: result.failed || 0,
    }));
    checkServerAvailability();
  }

  async function handleSyncPull() {
    setSyncStatus(s => ({ ...s, syncing: true, error: null }));
    const result = await syncPull();
    setSyncStatus(s => ({
      ...s,
      syncing: false,
      pendingCount: getSyncStatus().pendingCount,
      lastSync: result.ok ? new Date().toLocaleString('es-CO') : s.lastSync,
      error: result.ok ? null : result.reason,
    }));
    checkServerAvailability();
  }

  async function load() {
    const [a, p, t, c] = await Promise.all([
      api.apartments.toArray(), api.passwords.toArray(), api.tenants.toArray(), api.contracts.toArray(),
    ]);
    setApartments(a);
    setLocalPasswords(p);
    setAllTenants(t);
    setContracts(c);
  }

  async function generatePassword(apartmentId) {
    const apt = apartments.find(a => a.id === apartmentId);
    if (!apt) return;
    const existing = localPasswords.map(p => p.password);
    let month = new Date().getMonth() + 1;
    const contract = contracts.find(c => c.apartmentId === apartmentId);
    if (contract) month = new Date(contract.startDate).getMonth() + 1;
    let pwd = String(month).padStart(4, '0').slice(-4);
    let tries = 0;
    while (existing.includes(pwd) && tries < 100) {
      pwd = String((Number(pwd) + 1) % 10000).padStart(4, '0');
      tries++;
    }
    const record = localPasswords.find(p => p.apartmentId === apartmentId);
    if (record) {
      await api.passwords.update(record.id, { ...record, password: pwd });
    } else {
      await api.passwords.add({ apartmentId, password: pwd });
    }
    const updated = await api.passwords.toArray();
    setLocalPasswords(updated);
  }

  async function handleNotificationRequest() {
    const ok = await requestNotificationPermission();
    setNotifStatus(ok ? 'granted' : 'denied');
  }

  function generatePublic() {
    const apts = apartments.filter(a => a.status === 'vacant').map(a => ({
      ...a,
      monthlyRent: a.monthlyRent,
      depositAmount: a.depositAmount,
    }));
    const html = generatePublicHTML(apts);
    setPublicHTML(html);
    setShowPublicView(true);
  }

  function downloadPublicHTML() {
    const blob = new Blob([publicHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'apartamentos-disponibles.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendTestEmail() {
    const mailto = '?subject=' + encodeURIComponent('Apartamentos Disponibles') + '&body=' + encodeURIComponent('Hola, te comparto la lista de apartamentos disponibles:\n\n¡Contáctame para más información!');
    window.open('mailto:' + mailto);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Configuración</h1>
        <p className="text-gray-500 mt-1">Administra usuarios, comparte información y más</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">{dark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />} Modo Oscuro</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Alterna entre tema claro y oscuro para una mejor experiencia visual.</p>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <span className="text-sm font-medium text-gray-900 dark:text-white">Tema {dark ? 'oscuro' : 'claro'}</span>
            <button onClick={handleToggleDark} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${dark ? 'bg-blue-600' : 'bg-gray-300'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${dark ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Bell className="w-4 h-4" /> Notificaciones Móviles (APK)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Programa recordatorios automáticos para cobros de canon en el teléfono.</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Recordatorios automáticos</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{notifConfig.enabled ? 'Activados' : 'Desactivados'}</p>
              </div>
              <button onClick={handleNotifToggle} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${notifConfig.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${notifConfig.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            {notifConfig.enabled && (
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <label className="text-sm text-gray-700 dark:text-gray-300">Recordar días antes</label>
                <select value={notifConfig.daysBefore} onChange={e => handleDaysChange(e.target.value)} className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                  <option value={1}>1 día</option>
                  <option value={2}>2 días</option>
                  <option value={3}>3 días</option>
                  <option value={5}>5 días</option>
                  <option value={7}>7 días</option>
                </select>
              </div>
            )}
            <p className="text-xs text-gray-400 dark:text-gray-500">Las notificaciones se programan automáticamente según la fecha de pago de cada apartamento.</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Bell className="w-4 h-4" /> Notificaciones del Navegador</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Activa las notificaciones para recibir recordatorios de pagos y eventos importantes.</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Notificaciones del navegador</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {notifStatus === 'granted' ? 'Activadas' : notifStatus === 'denied' ? 'Bloqueadas' : 'No has respondido'}
                </p>
              </div>
              {notifStatus !== 'granted' && (
                <button onClick={handleNotificationRequest} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  {notifStatus === 'denied' ? 'Bloqueado' : 'Activar'}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Al activar, la app puede mostrar recordatorios de pagos próximos incluso con el navegador en segundo plano.</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">{syncStatus.syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />} Sincronización</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Tus datos siempre se guardan localmente. Cuando el servidor PC esté disponible, sincroniza automáticamente.</p>
          <div className="space-y-2 text-sm mb-3">
            <div className="flex justify-between py-1.5"><span className="text-gray-500 dark:text-gray-400">Cambios pendientes:</span><strong>{syncStatus.pendingCount > 0 ? <span className="text-amber-600">{(syncStatus.pendingCount)} op(s)</span> : <span className="text-emerald-600">0</span>}</strong></div>
            <div className="flex justify-between py-1.5"><span className="text-gray-500 dark:text-gray-400">Última sincronización:</span><strong className="text-gray-700 dark:text-gray-200">{syncStatus.lastSync || 'Nunca'}</strong></div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSync} disabled={syncStatus.syncing} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              <RefreshCw className={`w-4 h-4 ${syncStatus.syncing ? 'animate-spin' : ''}`} /> {syncStatus.syncing ? 'Sincronizando...' : 'Sincronizar Ahora'}
            </button>
            <button onClick={handleSyncPull} disabled={syncStatus.syncing} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors" title="Traer datos del servidor">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Compartir Apartamentos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Genera una página HTML con fotos, precios y detalles para compartir por WhatsApp, Gmail o descargar.</p>
          <div className="space-y-3">
            <button onClick={() => navigate('/share')} className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium">
              <Eye className="w-5 h-5" /> Vista Previa y Generar HTML
            </button>
            <button onClick={() => navigate('/share')} className="w-full flex items-center gap-3 px-4 py-3 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors text-sm font-medium">
              <Mail className="w-5 h-5" /> Enviar por Correo (Gmail)
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><User className="w-4 h-4" /> Acceso de Inquilinos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Cada inquilino ingresa con el nombre del apto y su código de 4 dígitos en <strong>/mi-apto</strong>.</p>
          {apartments.filter(a => a.status === 'occupied').map(a => {
            const pwd = localPasswords.find(p => p.apartmentId === a.id);
            const tenant = allTenants.find(t => contracts.find(c => c.apartmentId === a.id && (!c.endDate || new Date(c.endDate) > new Date()))?.tenantId === t.id);
            return (
              <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 text-sm">
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">{a.name}</span>
                  {tenant && <span className="text-gray-400 ml-2 text-xs">({tenant.name})</span>}
                </div>
                <div className="flex items-center gap-2">
                  {pwd ? (
                    <>
                      <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-800 dark:text-gray-200">{pwd.password}</code>
                      <button onClick={() => { navigator.clipboard.writeText(pwd.password); }} className="p-1 text-gray-400 hover:text-blue-600" title="Copiar"><Copy className="w-3 h-3" /></button>
                    </>
                  ) : (
                    <button onClick={() => generatePassword(a.id)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Generar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Link Público para Inquilinos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Comparte este enlace con posibles inquilinos para que vean los apartamentos disponibles.</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <input type="text" readOnly value={window.location.origin + '/publico'} className="flex-1 text-sm text-gray-700 dark:text-gray-200 bg-transparent outline-none" onClick={e => e.target.select()} />
              <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/publico'); }} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0">Copiar</button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">Muestra solo apartamentos desocupados con fotos, precios y datos de contacto.</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> App Móvil (APK)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Descarga e instala la última versión del APK en tu teléfono Android.</p>
          <div className="space-y-2 text-sm bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-3">
            <p><span className="text-gray-500 dark:text-gray-400">Versión actual:</span> <strong id="apk-version" className="text-gray-900 dark:text-white">1.0.0</strong></p>
            <p><span className="text-gray-500 dark:text-gray-400">Build:</span> <strong id="apk-build" className="text-gray-900 dark:text-white">-</strong></p>
          </div>
          <div className="space-y-2">
            <button onClick={checkUpdate} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors text-sm font-medium">
              <RefreshCw className="w-4 h-4" /> Buscar actualizaciones
            </button>
            <div id="update-info"></div>
            <a href="/app-debug.apk" download className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <Download className="w-4 h-4" /> Descargar APK
            </a>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Después de descargar, abre el archivo .apk en tu teléfono para instalar. También puedes abrirlo desde la notificación de descarga.</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><FileText className="w-4 h-4" /> Acerca de</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-gray-500 dark:text-gray-400">App:</span> <span className="text-gray-900 dark:text-white">Gestión de Apartamentos</span></p>
            <p><span className="text-gray-500 dark:text-gray-400" id="about-version">Versión:</span> <span className="text-gray-900 dark:text-white">1.0.0</span></p>
            <p><span className="text-gray-500 dark:text-gray-400">Servidor:</span> <strong className="text-gray-900 dark:text-white">{window.location.origin}</strong></p>
            <p><span className="text-gray-500 dark:text-gray-400">Datos:</span> <span className="text-gray-900 dark:text-white">Servidor central + respaldo local</span></p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><SettingsIcon className="w-4 h-4" /> Enlaces Útiles - Barranquilla</h3>
          <div className="space-y-2 text-sm">
            <a href="https://portal.aaa.com.co/pagos" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <span className="text-gray-900 dark:text-white">Triple A — Pagar recibo</span><span className="text-blue-600 text-xs">Abrir →</span>
            </a>
            <a href="https://www.gascaribe.com/" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <span className="text-gray-900 dark:text-white">Gases del Caribe</span><span className="text-blue-600 text-xs">Abrir →</span>
            </a>
            <a href="https://portal.air-e.com/Pagar#/List" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <span className="text-gray-900 dark:text-white">Air-e — Pagar recibo</span><span className="text-blue-600 text-xs">Abrir →</span>
            </a>
          </div>
        </div>
      </div>

      <Modal open={showPublicView} onClose={() => setShowPublicView(false)} title="Vista Pública - Apartamentos" size="xl">
        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={downloadPublicHTML} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
              <Download className="w-4 h-4" /> Descargar HTML
            </button>
            <button onClick={() => { navigator.clipboard.writeText(publicHTML); alert('HTML copiado al portapapeles'); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Copiar HTML
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <iframe srcDoc={publicHTML} title="Vista previa" className="w-full h-[500px]" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
