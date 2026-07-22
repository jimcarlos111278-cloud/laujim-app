import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, Globe, FileText, Download, Smartphone, Bell, RefreshCw, Cloud, Share2, Moon, Sun, User, KeyRound, Copy, Save, Database, Shield, LogOut, Upload, AlertTriangle, Palette } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { getBase } from '../utils/config';
import { requestNotificationPermission } from '../utils/notifications';
import { isServerAvailable } from '../utils/sync';
import { refreshAllFromServer } from '../api';
import { getNotifConfig, saveNotifConfig, schedulePaymentReminders, cancelAllNotifications } from '../utils/localNotifications';
import ThemeSelector from '../components/ThemeSelector';
import { clearAuth, getAuth } from '../utils/auth';

export default function Settings() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [apartments, setApartments] = useState([]);
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [syncStatus, setSyncStatus] = useState({
    syncing: false,
    error: null,
    serverAvailable: null,
  });
  const autoSyncIntervalRef = useRef(null);
  const [notifConfig, setNotifConfig] = useState(getNotifConfig());
  const [localPasswords, setLocalPasswords] = useState([]);
  const [allTenants, setAllTenants] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [backupInfo, setBackupInfo] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleResetDb() {
    setResetting(true);
    try {
      const base = getBase().replace('/api', '');
      const res = await fetch(base + '/api/reset-db', {
        method: 'POST', headers: { 'x-auth-token': 'laujim laujim' },
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshAllFromServer();
      setConfirmReset(false);
      setBackupInfo('Base de datos restablecida. Recargando...');
      setTimeout(() => { setBackupInfo(null); window.location.reload(); }, 2000);
    } catch (e) {
      setBackupInfo('Error al restablecer: ' + e.message);
      setTimeout(() => setBackupInfo(null), 5000);
    }
    setResetting(false);
  }

  function handleLogout() {
    clearAuth();
    navigate('/login', { replace: true });
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

  useEffect(() => { load(); checkServerAvailability(); }, []);

  async function checkServerAvailability() {
    const status = await isServerAvailable();
    setSyncStatus(s => ({ ...s, serverAvailable: status.ok, error: status.ok ? null : status.reason }));
    return status.ok;
  }

  async function handleRefreshFromServer() {
    setSyncStatus(s => ({ ...s, syncing: true, error: null }));
    const ok = await refreshAllFromServer();
    setSyncStatus(s => ({ ...s, syncing: false, error: ok ? null : 'Error al conectar con el servidor' }));
    await load();
    checkServerAvailability();
  }

  async function handleBackup() {
    try {
      const res = await fetch(getBase() + '/data/all', {
        headers: { 'x-auth-token': 'laujim laujim' },
      });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupInfo('Backup descargado correctamente');
      setTimeout(() => setBackupInfo(null), 3000);
    } catch {
      setBackupInfo('Error al descargar backup');
      setTimeout(() => setBackupInfo(null), 3000);
    }
  }

  const fileInputRef = useRef(null);
  const [restoring, setRestoring] = useState(false);

  async function handleRestore(file) {
    if (!file) return;
    if (!confirm('¿Restaurar este backup? Se reemplazarán TODOS los datos del servidor. Los datos actuales se perderán.')) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch(getBase() + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': 'laujim laujim' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setBackupInfo(`Backup restaurado: ${result.saved} registros`);
      await refreshAllFromServer();
      await load();
    } catch (e) {
      setBackupInfo('Error al restaurar: ' + e.message);
    }
    setRestoring(false);
    setTimeout(() => setBackupInfo(null), 5000);
  }

  async function load() {
    const [a, p, t, c] = await Promise.all([
      api.apartments.toArray(), api.passwords.toArray(), api.tenants.toArray(), api.contracts.toArray(),
    ]);
    setApartments(a); setLocalPasswords(p); setAllTenants(t); setContracts(c);
  }

  function generateRandomPwd(existing) {
    const used = new Set(existing);
    let pwd;
    do { pwd = String(Math.floor(1000 + Math.random() * 9000)); } while (used.has(pwd));
    return pwd;
  }

  async function generatePassword(apartmentId) {
    const apt = apartments.find(a => a.id === apartmentId);
    if (!apt) return;
    const existing = (localPasswords || []).filter(p => p.apartmentId !== apartmentId).map(p => p.password);
    const pwd = generateRandomPwd(existing);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Configuración</h1>
          <p className="text-gray-500 mt-1">Administra la app, accesos y datos</p>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-xl hover:bg-red-100 transition-colors text-sm font-medium border border-red-200">
          <LogOut className="w-4 h-4" /> Cerrar Sesión
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Palette className="w-4 h-4" /> Modo de visualización</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Elige el estilo visual completo de la aplicación.</p>
          <div className="flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <ThemeSelector variant="swatches" />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Bell className="w-4 h-4" /> Recordatorios Móviles</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Programa recordatorios automáticos de cobro en el teléfono.</p>
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
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Bell className="w-4 h-4" /> Notificaciones del Navegador</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Recibe recordatorios incluso con el navegador en segundo plano.</p>
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Notificaciones</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {notifStatus === 'granted' ? 'Activadas' : notifStatus === 'denied' ? 'Bloqueadas' : 'Pendiente'}
              </p>
            </div>
            {notifStatus !== 'granted' && (
              <button onClick={handleNotificationRequest} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                {notifStatus === 'denied' ? 'Bloqueado' : 'Activar'}
              </button>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Database className="w-4 h-4" /> Base de Datos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Todos los datos se guardan automáticamente en la nube en tiempo real. No necesitas hacer nada manual.</p>
          <div className="space-y-2 text-sm mb-3">
            <div className="flex justify-between py-1.5">
              <span className="text-gray-500 dark:text-gray-400">Servidor:</span>
              <strong>{syncStatus.serverAvailable === true ? <span className="text-emerald-600">Conectado</span> : syncStatus.serverAvailable === false ? <span className="text-red-500">Desconectado</span> : <span className="text-gray-400">Verificando...</span>}</strong>
            </div>
            {syncStatus.error && <p className="text-xs text-red-500">{syncStatus.error}</p>}
          </div>
          <div className="flex gap-2 mb-2">
            <button onClick={handleRefreshFromServer} disabled={syncStatus.syncing} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <RefreshCw className={`w-4 h-4 ${syncStatus.syncing ? 'animate-spin' : ''}`} /> {syncStatus.syncing ? 'Refrescando...' : 'Refrescar datos del servidor'}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Los cambios se sincronizan automáticamente cada 15 segundos entre todos tus dispositivos.</p>
          <button onClick={handleBackup} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors text-sm">
            <Download className="w-4 h-4" /> Descargar Backup (JSON)
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={e => { handleRestore(e.target.files[0]); e.target.value = ''; }} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={restoring} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 transition-colors text-sm mt-2">
            <Upload className="w-4 h-4" /> {restoring ? 'Restaurando...' : 'Restaurar Backup (JSON)'}
          </button>
          {backupInfo && <p className="text-xs text-emerald-600 mt-1">{backupInfo}</p>}
          <hr className="my-3 border-gray-200 dark:border-gray-600" />
          <button onClick={() => setConfirmReset(true)} disabled={resetting} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors text-sm">
            <AlertTriangle className="w-4 h-4" /> {resetting ? 'Restableciendo...' : 'Restablecer DB a valores iniciales'}
          </button>
        </div>

        <Modal open={confirmReset} onClose={() => !resetting && setConfirmReset(false)}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">¿Restablecer base de datos?</h3>
                <p className="text-sm text-gray-500">Esta acción borrará TODOS los datos del servidor y los reemplazará con los valores iniciales. Los datos locales se recargarán automáticamente.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmReset(false)} disabled={resetting} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleResetDb} disabled={resetting} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">{resetting ? 'Restableciendo...' : 'Sí, restablecer'}</button>
            </div>
          </div>
        </Modal>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><User className="w-4 h-4" /> Acceso de Inquilinos</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Cada inquilino ingresa con el apto + su código en <strong>/mi-apto</strong></p>
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
                      <button onClick={() => generatePassword(a.id)} className="p-1 text-gray-400 hover:text-amber-600" title="Regenerar"><RefreshCw className="w-3 h-3" /></button>
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
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Link Público</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Comparte aptos disponibles con posibles inquilinos.</p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input type="text" readOnly value={window.location.origin + '/publico'} className="flex-1 text-sm text-gray-700 dark:text-gray-200 bg-transparent outline-none" onClick={e => e.target.select()} />
            <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/publico'); }} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0">Copiar</button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> App Móvil (APK)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Descarga la app Android.</p>
          <a href="/app-debug.apk" download className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium mb-2">
            <Download className="w-4 h-4" /> Descargar APK (directo)
          </a>
          <p className="text-xs text-gray-400 dark:text-gray-500">Build incluido en el servidor. También disponible en GitHub Releases.</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><FileText className="w-4 h-4" /> Acerca de</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-gray-500 dark:text-gray-400">App:</span> <span className="text-gray-900 dark:text-white">Gestión Laujim</span></p>
            <p><span className="text-gray-500 dark:text-gray-400">Versión:</span> <span className="text-gray-900 dark:text-white">2.0.0</span></p>
            <p><span className="text-gray-500 dark:text-gray-400">Servidor:</span> <span className="text-gray-900 dark:text-white">{window.location.origin}</span></p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Enlaces Servicios</h3>
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
    </div>
  );
}
