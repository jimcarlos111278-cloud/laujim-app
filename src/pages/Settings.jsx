import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, FileText, Download, Smartphone, Bell, RefreshCw, Database, LogOut, Upload, AlertTriangle, Palette, ClipboardList, Zap, MessageCircle, Save, Server, Cpu, Cloud } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { generateBookmarkletCode } from '../utils/marketplaceBookmarklet';
import { AUTH_TOKEN, getBase } from '../utils/config';
import { requestNotificationPermission } from '../utils/notifications';
import { isServerAvailable } from '../utils/sync';
import { refreshAllFromServer } from '../api';
import { getNotifConfig, saveNotifConfig, schedulePaymentReminders, cancelAllNotifications } from '../utils/localNotifications';
import ThemeSelector from '../components/ThemeSelector';
import { clearAuth, getAuth } from '../utils/auth';

export default function Settings() {
  const navigate = useNavigate();
  const auth = getAuth();
  const [notifStatus, setNotifStatus] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const [syncStatus, setSyncStatus] = useState({ syncing: false, error: null, serverAvailable: null });
  const [notifConfig, setNotifConfig] = useState(getNotifConfig());
  const [backupInfo, setBackupInfo] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [settingsList, setSettingsList] = useState([]);
  const [waConfig, setWaConfig] = useState({ apiToken: '', phoneNumberId: '', verifyToken: '' });
  const [waTemplates, setWaTemplates] = useState({ services: '', reminder: '' });
  const [waSaving, setWaSaving] = useState(false);
  const [waSaved, setWaSaved] = useState(false);
  const [botConfig, setBotConfig] = useState({ enabled: false, phone: '' });
  const [botSaving, setBotSaving] = useState(false);
  const [botSaved, setBotSaved] = useState(false);
  const [waTemplateNames, setWaTemplateNames] = useState({ name1: 'Servicios públicos', name2: 'Recordatorio de pago' });
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [menuOptions, setMenuOptions] = useState([]);
  const [relayTemplates, setRelayTemplates] = useState({ relay_from_tenant: '', relay_from_group: '' });
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuSaved, setMenuSaved] = useState(false);
  const [relaySaving, setRelaySaving] = useState(false);
  const [relaySaved, setRelaySaved] = useState(false);
  const [legacyMenuOptions, setLegacyMenuOptions] = useState([
    { num: '1', label: 'Ver aptos disponibles', action: 'vacants', enabled: true },
    { num: '2', label: 'Consultar información de un apto', action: 'info', enabled: true },
    { num: '3', label: 'Registrar mi interés', action: 'lead', enabled: true },
    { num: '4', label: 'Soy residente (iniciar sesión)', action: 'login', enabled: true },
  ]);

  async function handleResetDb() {
    setResetting(true);
    try {
      const base = getBase().replace('/api', '');
      const res = await fetch(base + '/api/reset-db', { method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN } });
      if (!res.ok) throw new Error(await res.text());
      await refreshAllFromServer();
      setConfirmReset(false);
      setBackupInfo('Base de datos restablecida. Recargando...');
      setTimeout(() => { setBackupInfo(null); window.location.reload(); }, 2000);
    } catch (e) { setBackupInfo('Error al restablecer: ' + e.message); setTimeout(() => setBackupInfo(null), 5000); }
    setResetting(false);
  }

  function handleLogout() { clearAuth(); navigate('/login', { replace: true }); }

  async function handleNotifToggle() {
    const next = { ...notifConfig, enabled: !notifConfig.enabled };
    setNotifConfig(next); saveNotifConfig(next);
    if (next.enabled) { const a = await api.apartments.toArray(); await schedulePaymentReminders(a); }
    else { await cancelAllNotifications(); }
  }

  async function handleDaysChange(days) {
    const next = { ...notifConfig, daysBefore: Number(days) };
    setNotifConfig(next); saveNotifConfig(next);
    if (next.enabled) { await cancelAllNotifications(); const a = await api.apartments.toArray(); await schedulePaymentReminders(a); }
  }

  useEffect(() => { load(); checkServerAvailability(); }, []);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(getBase() + '/system/stats', { headers: { 'x-auth-token': AUTH_TOKEN }, signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('Not ok');
        setStats(await res.json());
        setStatsError(false);
      } catch { setStatsError(true); }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  async function checkServerAvailability() {
    const status = await isServerAvailable();
    setSyncStatus(s => ({ ...s, serverAvailable: status.ok, error: status.ok ? null : status.reason }));
    return status.ok;
  }

  async function handleRefreshFromServer() {
    setSyncStatus(s => ({ ...s, syncing: true, error: null }));
    const ok = await refreshAllFromServer();
    setSyncStatus(s => ({ ...s, syncing: false, error: ok ? null : 'Error al conectar con el servidor' }));
    await load(); checkServerAvailability();
  }

  async function handleBackup() {
    try {
      const res = await fetch(getBase() + '/data/all', { headers: { 'x-auth-token': AUTH_TOKEN } });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `backup-${new Date().toISOString().split('T')[0]}.json`; a.click();
      URL.revokeObjectURL(url);
      setBackupInfo('Backup descargado correctamente'); setTimeout(() => setBackupInfo(null), 3000);
    } catch { setBackupInfo('Error al descargar backup'); setTimeout(() => setBackupInfo(null), 3000); }
  }

  const fileInputRef = useRef(null);
  const [restoring, setRestoring] = useState(false);
  const [bmCopied, setBmCopied] = useState(false);
  const bulkInputRef = useRef(null);
  const [bulkStatus, setBulkStatus] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  async function handleRestore(file) {
    if (!file) return;
    if (!confirm('¿Restaurar este backup? Se reemplazarán TODOS los datos del servidor. Los datos actuales se perderán.')) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch(getBase() + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN }, body: JSON.stringify(data) });
      if (res.status === 401) {
        clearAuth();
        navigate('/login', { replace: true });
        throw new Error('La sesión venció. Inicia sesión con la nueva contraseña y vuelve a restaurar el mismo backup.');
      }
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      setBackupInfo(`Backup restaurado: ${result.saved} registros`);
      await refreshAllFromServer(); await load();
    } catch (e) { setBackupInfo('Error al restaurar: ' + e.message); }
    setRestoring(false); setTimeout(() => setBackupInfo(null), 5000);
  }

  async function handleDownloadTemplate() {
    const [a, t, c] = await Promise.all([api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray()]);
    const activeContracts = c.filter(ct => !ct.endDate || new Date(ct.endDate) > new Date());
    const template = a.map(apt => {
      const contract = activeContracts.find(ct => ct.apartmentId === apt.id);
      const tenant = contract ? t.find(ten => ten.id === contract.tenantId) : null;
      return { apto: apt.name, estado: apt.status || 'vacant', canon: apt.monthlyRent || 0, deposito: apt.depositAmount || 0, diaVencimiento: apt.paymentDueDay || 5, inquilino: tenant ? tenant.name : '', cedula: tenant ? tenant.documentId : '', telefono: tenant ? tenant.phone : '', fechaInicio: contract ? contract.startDate : '', fechaFin: contract ? contract.endDate || '' : '', lecturaAgua: apt.waterReadingDay || 7, codigoAgua: apt.waterPaymentCode || '', lecturaGas: apt.gasReadingDay || 7, codigoGas: apt.gasPaymentCode || '', lecturaLuz: apt.electricityReadingDay || 21, observaciones: apt.notes || '' };
    });
    const blob = new Blob([JSON.stringify({ version: '1.0', plantilla: template }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a'); aEl.href = url; aEl.download = `plantilla-bulk-${new Date().toISOString().split('T')[0]}.json`; aEl.click();
    URL.revokeObjectURL(url);
    setBulkStatus('Plantilla descargada. Llénala y súbela.'); setTimeout(() => setBulkStatus(null), 5000);
  }

  async function handleUploadTemplate(file) {
    if (!file) return;
    setBulkLoading(true); setBulkStatus(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.plantilla || !Array.isArray(data.plantilla)) throw new Error('Formato inválido: falta "plantilla"');
      const [localApts, localTenants, localContracts] = await Promise.all([api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray()]);
      let created = 0;
      for (const row of data.plantilla) {
        if (!row.apto) continue;
        let apt = localApts.find(a => a.name === row.apto);
        if (!apt) {
          apt = await api.apartments.add({ name: row.apto, status: row.estado || 'vacant', monthlyRent: Number(row.canon) || 0, depositAmount: Number(row.deposito) || 0, paymentDueDay: Number(row.diaVencimiento) || 5, waterReadingDay: Number(row.lecturaAgua) || 7, waterPaymentCode: row.codigoAgua || '', gasReadingDay: Number(row.lecturaGas) || 7, gasPaymentCode: row.codigoGas || '', electricityReadingDay: Number(row.lecturaLuz) || 21, notes: row.observaciones || '', floor: 1, area: 0, rooms: 1, bathrooms: 1, description: '', nic: '', electricityPaymentCode: '', createdAt: new Date().toISOString() });
          localApts.push(apt);
        } else {
          await api.apartments.update(apt.id, { status: row.estado || apt.status, monthlyRent: Number(row.canon) || apt.monthlyRent, paymentDueDay: Number(row.diaVencimiento) || apt.paymentDueDay, notes: row.observaciones || apt.notes });
        }
        if (row.inquilino && row.cedula) {
          let tenant = localTenants.find(t => t.documentId === row.cedula);
          if (!tenant) {
            tenant = await api.tenants.add({ name: row.inquilino, documentId: row.cedula, phone: row.telefono || '', notes: '', linkedAptId: apt.id, createdAt: new Date().toISOString() });
            localTenants.push(tenant);
          } else { await api.tenants.update(tenant.id, { name: row.inquilino, phone: row.telefono || tenant.phone }); }
          if (row.fechaInicio && apt.id) {
            const existingContract = localContracts.find(ct => ct.apartmentId === apt.id && (!ct.endDate || new Date(ct.endDate) > new Date()));
            if (!existingContract) { await api.contracts.add({ apartmentId: apt.id, tenantId: tenant.id, monthlyRent: Number(row.canon) || 0, startDate: row.fechaInicio, endDate: row.fechaFin || null, createdAt: new Date().toISOString() }); }
          }
        }
        created++;
      }
      await refreshAllFromServer(); await load();
      setBulkStatus(`Plantilla procesada: ${created} aptos creados/actualizados`);
    } catch (e) { setBulkStatus('Error: ' + e.message); }
    setBulkLoading(false); setTimeout(() => setBulkStatus(null), 8000);
  }

  async function load() {
    const s = await fetch(getBase() + '/settings', { headers: { 'x-auth-token': AUTH_TOKEN } }).then(r => r.json()).catch(() => []);
    setSettingsList(s);
    const getVal = (k, def) => s.find(x => x.key === k)?.value || def;
    setWaConfig({ apiToken: getVal('whatsapp_api_token', ''), phoneNumberId: getVal('whatsapp_phone_number_id', ''), verifyToken: getVal('whatsapp_verify_token', 'laujim_whatsapp_verify') });
    const svc = getVal('whatsapp_template_services', '👋 ¡Hola {nombre}!\n\nTe habla la administración de la inmobiliaria. Sabemos que es fácil perder la información de pago de los servicios, por eso te compartimos los enlaces directos:\n\n🌬️ Aire: {link_aire}\n💧 Triple A: {link_triplea}\n🔥 Gases: {link_gases}\n\n📌 También puedes ingresar a nuestro sistema con tu apartamento {apto} y tu cédula para consultar esta información y contactarnos por el chat directo.\n👉 https://laujim-app.onrender.com/login\n\n¡Gracias!');
    const rem = getVal('whatsapp_template_reminder', '👋 ¡Hola {nombre}!\n\nTe habla la administración de la inmobiliaria. Te recordamos que el canon de {valor_canon} vence el {dia_vencimiento}.\n\n📌 Sabemos que es fácil perder la información de pago. Puedes ingresar a nuestro sistema con tu apartamento {apto} y tu cédula para consultar tus pagos y contactarnos por el chat directo.\n👉 https://laujim-app.onrender.com/login\n\n¡Gracias!');
    setWaTemplates({ services: svc, reminder: rem });
    localStorage.setItem('wa_template_services', svc);
    localStorage.setItem('wa_template_reminder', rem);
    const n1 = getVal('whatsapp_template_name1', 'Servicios públicos');
    const n2 = getVal('whatsapp_template_name2', 'Recordatorio de pago');
    setWaTemplateNames({ name1: n1, name2: n2 });
    localStorage.setItem('wa_template_name1', n1);
    localStorage.setItem('wa_template_name2', n2);
    setBotConfig({ enabled: getVal('whatsapp_bot_enabled', 'false') === 'true', phone: getVal('whatsapp_bot_phone', '') });
    const savedMenu = getVal('whatsapp_bot_menu_config', '');
    if (savedMenu) { try { setMenuOptions(JSON.parse(savedMenu)); } catch {} }
    setRelayTemplates({
      relay_from_tenant: getVal('whatsapp_bot_msg_relay_from_tenant', '*Inquilino Apto {apto}*'),
      relay_from_group: getVal('whatsapp_bot_msg_relay_from_group', '*Mensaje del grupo {apto}*'),
    });
  }

  async function upsertSetting(key, value) {
    const existing = settingsList.find(s => s.key === key);
    const headers = { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN };
    if (existing) {
      await fetch(getBase() + '/settings/' + existing.id, { method: 'PUT', headers, body: JSON.stringify({ ...existing, value }) });
    } else {
      await fetch(getBase() + '/settings', { method: 'POST', headers, body: JSON.stringify({ key, value }) });
    }
  }

  async function handleSaveWaConfig() {
    setWaSaving(true);
    try {
      await upsertSetting('whatsapp_api_token', waConfig.apiToken);
      await upsertSetting('whatsapp_phone_number_id', waConfig.phoneNumberId);
      await upsertSetting('whatsapp_verify_token', waConfig.verifyToken);
      setWaSaved(true); setTimeout(() => setWaSaved(false), 3000);
    } catch (e) { alert('Error al guardar: ' + e.message); }
    setWaSaving(false);
  }

  async function handleSaveBotConfig() {
    setBotSaving(true);
    try {
      await upsertSetting('whatsapp_bot_enabled', botConfig.enabled ? 'true' : 'false');
      await upsertSetting('whatsapp_bot_phone', botConfig.phone);
      setBotSaved(true); setTimeout(() => setBotSaved(false), 3000);
    } catch (e) { alert('Error al guardar: ' + e.message); }
    setBotSaving(false);
  }

  async function handleSaveTemplates() {
    setWaSaving(true);
    try {
      await upsertSetting('whatsapp_template_services', waTemplates.services);
      await upsertSetting('whatsapp_template_reminder', waTemplates.reminder);
      await upsertSetting('whatsapp_template_name1', waTemplateNames.name1);
      await upsertSetting('whatsapp_template_name2', waTemplateNames.name2);
      localStorage.setItem('wa_template_services', waTemplates.services);
      localStorage.setItem('wa_template_reminder', waTemplates.reminder);
      localStorage.setItem('wa_template_name1', waTemplateNames.name1);
      localStorage.setItem('wa_template_name2', waTemplateNames.name2);
      setWaSaved(true); setTimeout(() => setWaSaved(false), 3000);
    } catch (e) { alert('Error al guardar: ' + e.message); }
    setWaSaving(false);
  }

  async function handleNotificationRequest() {
    const ok = await requestNotificationPermission();
    setNotifStatus(ok ? 'granted' : 'denied');
  }

  function updateMenuOption(idx, field, value) {
    setMenuOptions(prev => prev.map((o, i) => i === idx ? { ...o, [field]: value } : o));
  }

  function toggleMenuOption(idx) {
    setMenuOptions(prev => prev.map((o, i) => i === idx ? { ...o, enabled: !o.enabled } : o));
  }

  async function handleSaveMenuConfig() {
    setMenuSaving(true);
    try {
      await upsertSetting('whatsapp_bot_menu_config', JSON.stringify(menuOptions));
      setMenuSaved(true); setTimeout(() => setMenuSaved(false), 3000);
    } catch (e) { alert('Error al guardar menú: ' + e.message); }
    setMenuSaving(false);
  }

  async function handleSaveRelayTemplates() {
    setRelaySaving(true);
    try {
      await upsertSetting('whatsapp_bot_msg_relay_from_tenant', relayTemplates.relay_from_tenant);
      await upsertSetting('whatsapp_bot_msg_relay_from_group', relayTemplates.relay_from_group);
      setRelaySaved(true); setTimeout(() => setRelaySaved(false), 3000);
    } catch (e) { alert('Error al guardar templates: ' + e.message); }
    setRelaySaving(false);
  }

  function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    if (m > 0) return m + 'm ' + s + 's';
    return s + 's';
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              <p className="text-xs text-gray-500 dark:text-gray-400">{notifStatus === 'granted' ? 'Activadas' : notifStatus === 'denied' ? 'Bloqueadas' : 'Pendiente'}</p>
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Todos los datos se guardan automáticamente en la nube en tiempo real.</p>
          <div className="space-y-2 text-sm mb-3">
            <div className="flex justify-between py-1.5">
              <span className="text-gray-500 dark:text-gray-400">Servidor:</span>
              <strong>{syncStatus.serverAvailable === true ? <span className="text-emerald-600">Conectado</span> : syncStatus.serverAvailable === false ? <span className="text-red-500">Desconectado</span> : <span className="text-gray-400">Verificando...</span>}</strong>
            </div>
            {syncStatus.error && <p className="text-xs text-red-500">{syncStatus.error}</p>}
          </div>
          <button onClick={handleRefreshFromServer} disabled={syncStatus.syncing} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium mb-2">
            <RefreshCw className={`w-4 h-4 ${syncStatus.syncing ? 'animate-spin' : ''}`} /> {syncStatus.syncing ? 'Refrescando...' : 'Refrescar datos del servidor'}
          </button>
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
                <p className="text-sm text-gray-500">Esta acción borrará TODOS los datos del servidor.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmReset(false)} disabled={resetting} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={handleResetDb} disabled={resetting} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">{resetting ? 'Restableciendo...' : 'Sí, restablecer'}</button>
            </div>
          </div>
        </Modal>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><ClipboardList className="w-4 h-4" /> Carga Masiva (BULK)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Descarga una plantilla, complétala y súbela para crear/actualizar múltiples aptos, inquilinos y contratos.</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={handleDownloadTemplate} className="flex items-center justify-center gap-2 px-4 py-2 border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors text-sm">
              <Download className="w-4 h-4" /> Descargar Plantilla
            </button>
            <input ref={bulkInputRef} type="file" accept=".json" onChange={e => { handleUploadTemplate(e.target.files[0]); e.target.value = ''; }} className="hidden" />
            <button onClick={() => bulkInputRef.current?.click()} disabled={bulkLoading} className="flex items-center justify-center gap-2 px-4 py-2 border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 transition-colors text-sm">
              <Upload className="w-4 h-4" /> {bulkLoading ? 'Procesando...' : 'Subir Plantilla'}
            </button>
            {bulkStatus && <p className="w-full text-xs text-emerald-600">{bulkStatus}</p>}
          </div>
        </div>

        {/* WhatsApp API Config */}
        <div className="hidden" aria-hidden="true">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> WhatsApp API</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Configuración para el bot de auto-respuesta y envío de mensajes.</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Token de API (WhatsApp Cloud API)</label>
              <input type="password" value={waConfig.apiToken} onChange={e => setWaConfig({...waConfig, apiToken: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="EAAx..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number ID</label>
              <input type="text" value={waConfig.phoneNumberId} onChange={e => setWaConfig({...waConfig, phoneNumberId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="123456789" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Verify Token (webhook)</label>
              <input type="text" value={waConfig.verifyToken} onChange={e => setWaConfig({...waConfig, verifyToken: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="laujim_whatsapp_verify" />
            </div>
            <div className="text-xs text-gray-400 space-y-1">
              <p>URL del webhook: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{window.location.origin}/api/whatsapp/webhook</code></p>
              <p>Pega esta URL en la configuración de Meta WhatsApp Cloud API.</p>
            </div>
            <button onClick={handleSaveWaConfig} disabled={waSaving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <Save className="w-4 h-4" /> {waSaving ? 'Guardando...' : waSaved ? '✓ Guardado' : 'Guardar Configuración WhatsApp'}
            </button>
          </div>
        </div>

        {/* WhatsApp Templates */}
        <div className="hidden" aria-hidden="true">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Plantillas WhatsApp</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Personaliza los mensajes que se envían desde los botones de WhatsApp.</p>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre de la plantilla</label>
              <input type="text" value={waTemplateNames.name1} onChange={e => setWaTemplateNames({...waTemplateNames, name1: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3" placeholder="Ej: Servicios públicos" />
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Mensaje</label>
              <p className="text-xs text-gray-400 mb-1">Placeholders: {'{nombre}'}, {'{apto}'}, {'{link_aire}'}, {'{link_triplea}'}, {'{link_gases}'}</p>
              <textarea value={waTemplates.services} onChange={e => setWaTemplates({...waTemplates, services: e.target.value})} rows={5} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre de la plantilla</label>
              <input type="text" value={waTemplateNames.name2} onChange={e => setWaTemplateNames({...waTemplateNames, name2: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3" placeholder="Ej: Recordatorio de pago" />
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Mensaje</label>
              <p className="text-xs text-gray-400 mb-1">Placeholders: {'{nombre}'}, {'{apto}'}, {'{valor_canon}'}, {'{dia_vencimiento}'}</p>
              <textarea value={waTemplates.reminder} onChange={e => setWaTemplates({...waTemplates, reminder: e.target.value})} rows={5} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
            </div>
            <button onClick={handleSaveTemplates} disabled={waSaving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <Save className="w-4 h-4" /> {waSaving ? 'Guardando...' : waSaved ? '✓ Guardado' : 'Guardar Plantillas'}
            </button>
          </div>
        </div>

        {/* WhatsApp Proxy Bot */}
        <div className="hidden" aria-hidden="true">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Bot WhatsApp Proxy</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Puente entre WhatsApp y el chat web. Los inquilinos escriben al bot y los mensajes llegan al chat del admin, y viceversa.</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Activar bot</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{botConfig.enabled ? 'El bot reenviará mensajes entre WhatsApp y el chat web' : 'Los mensajes del chat web no se reenviarán a WhatsApp'}</p>
              </div>
              <button onClick={() => setBotConfig({...botConfig, enabled: !botConfig.enabled})} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${botConfig.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${botConfig.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Número del bot (WhatsApp)</label>
              <input type="text" value={botConfig.phone} onChange={e => setBotConfig({...botConfig, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="573005185668" />
            </div>
            <div className="text-xs text-gray-400 space-y-1 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p><strong>Para iniciar el bot:</strong> ejecuta <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">iniciar-whatsapp-bot.bat</code> en el servidor.</p>
              <p><strong>Para cambiar de número:</strong> elimina la carpeta <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">whatsapp-bot/sessions/</code> y reinicia el bot para escanear un nuevo QR.</p>
            </div>
            <button onClick={handleSaveBotConfig} disabled={botSaving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <Save className="w-4 h-4" /> {botSaving ? 'Guardando...' : botSaved ? '✓ Guardado' : 'Guardar Configuración del Bot'}
            </button>
          </div>
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
            <Download className="w-4 h-4" /> Descargar APK
          </a>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Zap className="w-4 h-4" /> Auto-llenar Facebook Marketplace</h3>
          <div className="p-4 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl mb-4">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-2">Extensión de Chrome (recomendado)</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">Auto-llena todos los campos <strong>incluyendo fotos</strong> automáticamente.</p>
            <ol className="text-xs text-emerald-700 dark:text-emerald-400 space-y-1 ml-4 list-decimal">
              <li>Abre <strong>chrome://extensions</strong> en Chrome</li>
              <li>Activa <strong>Modo desarrollador</strong></li>
              <li>Arrastra la carpeta <strong>extension/</strong> de Laujim a la ventana</li>
              <li>Haz clic en <strong>"Auto-llenar"</strong> en el detalle del apto</li>
            </ol>
          </div>
          <details className="group">
            <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
              Bookmarklet (alternativa, sin fotos automáticas)
            </summary>
            <div className="space-y-3 mt-3">
              <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Paso 1: Instala el bookmarklet (una sola vez):</p>
                <a href={generateBookmarkletCode()} onClick={e => { e.preventDefault(); navigator.clipboard.writeText(generateBookmarkletCode()).then(() => { setBmCopied(true); setTimeout(() => setBmCopied(false), 2000); }); }} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium">
                  <Zap className="w-4 h-4" /> {bmCopied ? 'Copiado' : 'Copiar Bookmarklet'}
                </a>
              </div>
            </div>
          </details>
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

        {/* ─── Server Monitor Dashboard ─── */}
        <div className="bg-[#0f172a] rounded-xl border border-[#1e293b] p-4 sm:p-5 col-span-1 lg:col-span-2">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-white flex items-center gap-2"><Server className="w-4 h-4 text-blue-400" /> Estado de tus servicios</h3>
              <p className="text-xs text-slate-400 mt-1">Render, Aiven y Cloudflare R2. Actualizado cada 10 segundos.</p>
            </div>
            <span className={`inline-flex w-fit items-center gap-1 text-xs ${statsError ? 'text-red-400' : 'text-emerald-400'}`}><span className={`h-2 w-2 rounded-full ${statsError ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />{statsError ? 'Sin conexión' : 'En tiempo real'}</span>
          </div>
          {statsError && <p className="text-xs text-red-400 mb-2">No se puede conectar al servidor</p>}
          {stats ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
              <div className="bg-[#1e293b] rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-slate-400 mb-1"><Server className="w-3 h-3" /> Web app · Render</div>
                <div className="text-lg font-bold text-blue-400">{stats.app?.status === 'online' ? 'En línea' : 'Verificando'}</div>
                <div className="text-xs text-slate-500">{formatUptime(stats.app?.uptime ?? stats.uptime)} · {stats.requests || 0} solicitudes</div>
                <div className="mt-1 h-1.5 bg-[#0f172a] rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full" style={{ width: '100%' }}></div></div>
              </div>
              <div className="bg-[#1e293b] rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-slate-400 mb-1"><Cpu className="w-3 h-3" /> RAM de la web app</div>
                <div className="text-lg font-bold text-emerald-400">{stats.app?.memory?.percent ?? '—'}{stats.app?.memory?.percent !== null && stats.app?.memory?.percent !== undefined ? '%' : ''}</div>
                <div className="text-xs text-slate-500">{formatBytes(stats.app?.memory?.usedBytes ?? stats.rss)} / {formatBytes(stats.app?.memory?.limitBytes ?? stats.totalmem)}</div>
                <div className="mt-1 h-1.5 bg-[#0f172a] rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: Math.min(100, stats.app?.memory?.percent ?? 0) + '%' }}></div></div>
              </div>
              <div className="bg-[#1e293b] rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-slate-400 mb-1"><Database className="w-3 h-3" /> Base de datos · Aiven</div>
                <div className="text-lg font-bold text-violet-400">{stats.database?.percent ?? '—'}{stats.database?.percent !== null && stats.database?.percent !== undefined ? '%' : ''}</div>
                <div className="mt-1 h-1.5 bg-[#0f172a] rounded-full overflow-hidden"><div className="h-full bg-violet-500 rounded-full" style={{ width: Math.min(100, stats.database?.percent ?? 0) + '%' }}></div></div>
                <div className="text-lg font-bold text-violet-400">{stats.dbSize > 0 ? formatBytes(stats.dbSize) : '—'}</div>
                <div className="text-xs text-slate-500">{stats.collections ? Object.keys(stats.collections).length + ' colecciones' : '—'}</div>
              </div>
              <div className="bg-[#1e293b] rounded-lg p-3">
                <div className="flex items-center gap-1 text-xs text-slate-400 mb-1"><Cloud className="w-3 h-3" /> Archivos · Cloudflare R2</div>
                <div className="text-lg font-bold text-amber-400 text-sm leading-tight">{stats.storage?.percent ?? '—'}{stats.storage?.percent !== null && stats.storage?.percent !== undefined ? '%' : ''}</div>
                <div className="text-xs text-slate-500">{formatBytes(stats.storage?.bytes ?? 0)} / {formatBytes(stats.storage?.limitBytes ?? 0)}</div>
                <div className="mt-1 h-1.5 bg-[#0f172a] rounded-full overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{ width: Math.min(100, stats.storage?.percent ?? 0) + '%' }}></div></div>
              </div>
            </div>
          ) : <p className="text-xs text-slate-500">Cargando estadísticas...</p>}
          {stats && stats.collections && <details className="group">
            <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300">Ver colecciones ({Object.keys(stats.collections).length})</summary>
            <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1">
              {Object.entries(stats.collections).map(([k, v]) => (
                <div key={k} className="bg-[#1e293b] rounded px-2 py-1 text-xs flex justify-between"><span className="text-slate-400">{k}</span><span className="text-white font-mono">{v}</span></div>
              ))}
            </div>
          </details>}
        </div>

        {/* ─── Bot Menu Editor ─── */}
        <div className="hidden" aria-hidden="true">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Menú del Bot WhatsApp</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Personaliza las opciones del menú que ven los inquilinos al escribir al bot.</p>
          <div className="space-y-2 mb-4">
            {menuOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <span className="text-sm font-mono text-gray-400 w-6 shrink-0">{opt.num}.</span>
                <input value={opt.label} onChange={e => updateMenuOption(i, 'label', e.target.value)}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white min-w-0" placeholder="Etiqueta" />
                <select value={opt.action} onChange={e => updateMenuOption(i, 'action', e.target.value)}
                  className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                  <option value="vacants">Listar vacantes</option>
                  <option value="info">Consultar apto</option>
                  <option value="lead">Registrar interés</option>
                  <option value="login">Iniciar sesión</option>
                  <option value="payment_info">Info de pago</option>
                  <option value="services">Servicios públicos</option>
                  <option value="contact_admin">Contactar admin</option>
                  <option value="status">Estado sesión</option>
                  <option value="help">Ayuda</option>
                </select>
                <button onClick={() => toggleMenuOption(i)} className={`px-2 py-1 text-xs rounded shrink-0 ${opt.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-gray-200 text-gray-500 dark:bg-gray-600 dark:text-gray-400'}`}>
                  {opt.enabled ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
          </div>
          <button onClick={handleSaveMenuConfig} disabled={menuSaving} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
            <Save className="w-4 h-4" /> {menuSaving ? 'Guardando...' : menuSaved ? '✓ Guardado' : 'Guardar Menú'}
          </button>
        </div>

        {/* ─── Relay Templates Editor ─── */}
        <div className="hidden" aria-hidden="true">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Formato de Reenvío (Relay)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Personaliza cómo se muestran los mensajes reenviados. Placeholders: {'{apto}'}, {'{name}'}, {'{adminName}'}</p>
          <div className="space-y-4 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Inquilino → Grupo ({'{apto}'}, {'{name}'}, {'{adminName}'})</label>
              <input type="text" value={relayTemplates.relay_from_tenant} onChange={e => setRelayTemplates(prev => ({ ...prev, relay_from_tenant: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Grupo → Inquilino ({'{apto}'}, {'{adminName}'})</label>
              <input type="text" value={relayTemplates.relay_from_group} onChange={e => setRelayTemplates(prev => ({ ...prev, relay_from_group: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono" />
            </div>
          </div>
          <button onClick={handleSaveRelayTemplates} disabled={relaySaving} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium">
            <Save className="w-4 h-4" /> {relaySaving ? 'Guardando...' : relaySaved ? '✓ Guardado' : 'Guardar Formato'}
          </button>
        </div>

      </div>
    </div>
  );
}
