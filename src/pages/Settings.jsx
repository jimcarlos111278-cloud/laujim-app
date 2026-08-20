import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, FileText, Download, Smartphone, Bell, RefreshCw, Database, LogOut, Upload, AlertTriangle, Palette, ClipboardList, Zap, MessageCircle, Save, Server, Cpu, Cloud, Plus, CalendarCheck, KeyRound } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { AUTH_TOKEN, getBase } from '../utils/config';
import { requestNotificationPermission } from '../utils/notifications';
import { isServerAvailable } from '../utils/sync';
import { refreshAllFromServer } from '../api';
import { getNotifConfig, saveNotifConfig, schedulePaymentReminders, cancelAllNotifications } from '../utils/localNotifications';
import { syncAndGenerateReminders } from '../utils/calendar';
import ThemeSelector from '../components/ThemeSelector';
import { clearAuth, getAuth } from '../utils/auth';
import { getAuthorizedSmsMessages, getCallScreeningStatus, requestCallScreeningRole, requestProtectedSmsRole, setCallScreeningEnabled, setAllowCallsFromContacts, syncAuthorizedCallerNumbers } from '../utils/callScreening';

const DEFAULT_WA_SERVICES_TEMPLATE = `Hola {nombre} 👋

Te saluda la administración de apartamentos Laujim.

🏠 Apartamento: {apto}

⚡ Air-e — Deuda Total: {deuda_aire}
NIC: {nic_aire}
💳 Pago Air-e: {link_aire}

💧 Triple A — Deuda Total: {deuda_agua}
Póliza: {poliza_agua}
💳 Pago Triple A: {link_triplea}

🔥 Gases del Caribe — Deuda Total: {deuda_gas}
Contrato: {contrato_gas}
💳 Pago Gases: {link_gases}

Puedes responder por este mismo medio si necesitas ayuda. ¡Gracias!`;

const DEFAULT_WA_REMINDER_TEMPLATE = `Hola {nombre} 👋

Te saluda la administración de apartamentos Laujim.

🏠 Apartamento: {apto}
📊 Canon de {periodo}: {valor_canon}
📅 Vencimiento: {fecha_vencimiento}
📌 Estado: {estado_canon}

⚡ Air-e — Deuda Total: {deuda_aire}
💧 Triple A — Deuda Total: {deuda_agua}
🔥 Gases del Caribe — Deuda Total: {deuda_gas}

💳 Enlaces de pago:
⚡ Air-e: {link_aire}
💧 Triple A: {link_triplea}
🔥 Gases del Caribe: {link_gases}

Cuando realices el pago del canon, responde adjuntando el comprobante para validarlo. ¡Gracias!`;

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
  const [waTemplateNames, setWaTemplateNames] = useState({ name1: 'Servicios y deudas', name2: 'Cobro de canon y servicios' });
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [callScreening, setCallScreening] = useState(null);
  const [callScreeningBusy, setCallScreeningBusy] = useState(false);
  const [callScreeningError, setCallScreeningError] = useState('');
  const [authorizedSms, setAuthorizedSms] = useState([]);
  const [portalCreds, setPortalCreds] = useState({
    'air-e': { username: '', password: '' },
    'triple-a': { username: '', password: '' },
    'gascaribe': { username: '', password: '' },
    'gascaribe-2': { username: '', password: '' },
  });
  const [portalCredsSaving, setPortalCredsSaving] = useState(false);
  const [portalCredsMsg, setPortalCredsMsg] = useState('');
  const [adminPhones, setAdminPhones] = useState([]);
  const [adminPhoneInput, setAdminPhoneInput] = useState('');
  const [adminPhonesSaving, setAdminPhonesSaving] = useState(false);
  const [adminPhonesMsg, setAdminPhonesMsg] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

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

  async function handleSyncCalendarReminders() {
    setAdminPhonesMsg('');
    try {
      const apartments = await api.apartments.toArray();
      const count = syncAndGenerateReminders(apartments);
      setAdminPhonesMsg(count > 0 ? `✓ Se descargó el archivo con ${count} recordatorios` : '✓ Archivo descargado (sin recordatorios nuevos)');
    } catch (e) { setAdminPhonesMsg('Error: ' + e.message); }
    setTimeout(() => setAdminPhonesMsg(''), 6000);
  }

  useEffect(() => { load(); checkServerAvailability(); refreshCallScreeningStatus(); }, []);

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

  async function refreshCallScreeningStatus() {
    const status = await getCallScreeningStatus();
    setCallScreening(status);
    if (status.smsRoleGranted) {
      const result = await getAuthorizedSmsMessages();
      setAuthorizedSms(result.messages || []);
    } else {
      setAuthorizedSms([]);
    }
  }

  async function setupCallScreening() {
    setCallScreeningBusy(true);
    setCallScreeningError('');
    try {
      await refreshAllFromServer();
      const tenants = await api.tenants.toArray();
      const synced = await syncAuthorizedCallerNumbers(tenants);
      setCallScreening(synced);
      if (synced.native && synced.supported && !synced.roleGranted) {
        const role = await requestCallScreeningRole();
        setCallScreening({ ...synced, ...role });
      }
      const latest = await getCallScreeningStatus();
      setCallScreening(latest.roleGranted ? await setCallScreeningEnabled(true) : latest);
    } catch (error) {
      setCallScreeningError(error.message || 'No fue posible configurar el filtro de llamadas.');
    } finally {
      setCallScreeningBusy(false);
    }
  }

  async function toggleCallScreening() {
    if (!callScreening?.native) return;
    setCallScreeningBusy(true);
    setCallScreeningError('');
    try { setCallScreening(await setCallScreeningEnabled(!callScreening.enabled)); }
    catch (error) { setCallScreeningError(error.message || 'No fue posible cambiar el filtro de llamadas.'); }
    finally { setCallScreeningBusy(false); }
  }

  async function toggleContactCallers() {
    if (!callScreening?.native) return;
    setCallScreeningBusy(true);
    setCallScreeningError('');
    try { setCallScreening(await setAllowCallsFromContacts(!callScreening.allowContacts)); }
    catch (error) { setCallScreeningError(error.message || 'No fue posible actualizar los contactos permitidos.'); }
    finally { setCallScreeningBusy(false); }
  }

  async function setupProtectedSms() {
    if (!callScreening?.native) return;
    const accepted = window.confirm('Android cambiará la aplicación predeterminada de SMS a Laujim. Solo se conservarán aquí los mensajes de inquilinos autorizados o contactos permitidos; los demás se descartarán sin notificación. ¿Continuar?');
    if (!accepted) return;
    setCallScreeningBusy(true);
    setCallScreeningError('');
    try {
      await refreshAllFromServer();
      const tenants = await api.tenants.toArray();
      const synced = await syncAuthorizedCallerNumbers(tenants);
      setCallScreening(synced);
      const role = await requestProtectedSmsRole();
      setCallScreening({ ...synced, ...role });
      await refreshCallScreeningStatus();
    } catch (error) {
      setCallScreeningError(error.message || 'No fue posible activar el filtro de mensajes SMS.');
    } finally {
      setCallScreeningBusy(false);
    }
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
    fetch(getBase() + '/portal-credentials', { headers: { 'x-auth-token': AUTH_TOKEN } })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(res => {
        if (res && Array.isArray(res.data)) {
          const records = {};
          res.data.forEach(rec => { records[rec.provider] = { username: rec.username || '', password: rec.password || '' }; });
          if (Object.keys(records).length) setPortalCreds(prev => ({ ...prev, ...records }));
        }
      })
      .catch(() => {});
    const getVal = (k, def) => {
      const saved = s.find(x => x.key === k)?.value;
      if (saved) return saved;
      if (k === 'whatsapp_template_services') return DEFAULT_WA_SERVICES_TEMPLATE;
      if (k === 'whatsapp_template_reminder') return DEFAULT_WA_REMINDER_TEMPLATE;
      return def;
    };
    setWaConfig({ apiToken: getVal('whatsapp_api_token', ''), phoneNumberId: getVal('whatsapp_phone_number_id', ''), verifyToken: getVal('whatsapp_verify_token', 'laujim_whatsapp_verify') });
    try {
      const parsed = JSON.parse(getVal('whatsapp_admin_phones', '[]'));
      setAdminPhones(Array.isArray(parsed) ? parsed : []);
    } catch { setAdminPhones([]); }
    const svc = getVal('whatsapp_template_services', '👋 ¡Hola {nombre}!\n\nTe habla la administración de la inmobiliaria. Sabemos que es fácil perder la información de pago de los servicios, por eso te compartimos los enlaces directos:\n\n🌬️ Aire: {link_aire}\n💧 Triple A: {link_triplea}\n🔥 Gases: {link_gases}\n\n📌 También puedes ingresar a nuestro sistema con tu apartamento {apto} y tu cédula para consultar esta información y contactarnos por el chat directo.\n👉 https://laujim-app.onrender.com/login\n\n¡Gracias!');
    const rem = getVal('whatsapp_template_reminder', 'Hola {nombre} 👋\n\nTe saluda la administración de Laujim.\n\n🏠 Apartamento: {apto}\n📊 Canon de {periodo}: {valor_canon}\n📅 Vencimiento: {fecha_vencimiento}\n📌 Estado: {estado_canon}\n\n⚡ Air-e — Deuda Total: {deuda_aire}\n💧 Triple A — Deuda Total: {deuda_agua}\n🔥 Gases del Caribe — Deuda Total: {deuda_gas}\n\n💳 Enlaces de pago:\n⚡ {link_aire}\n💧 {link_triplea}\n🔥 {link_gases}\n\nCuando realices el pago del canon, responde adjuntando el comprobante para validarlo. ¡Gracias!');
    setWaTemplates({ services: svc, reminder: rem });
    localStorage.setItem('wa_template_services', svc);
    localStorage.setItem('wa_template_reminder', rem);
    const n1 = getVal('whatsapp_template_name1', 'Servicios y deudas');
    const n2 = getVal('whatsapp_template_name2', 'Cobro de canon y servicios');
    setWaTemplateNames({ name1: n1, name2: n2 });
    localStorage.setItem('wa_template_name1', n1);
    localStorage.setItem('wa_template_name2', n2);
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

  async function persistAdminPhones(next) {
    setAdminPhonesSaving(true); setAdminPhonesMsg('');
    try {
      await upsertSetting('whatsapp_admin_phones', JSON.stringify(next));
      setAdminPhones(next);
      setAdminPhonesMsg('✓ Guardado');
      setTimeout(() => setAdminPhonesMsg(''), 3000);
    } catch (e) { setAdminPhonesMsg('Error: ' + e.message); }
    setAdminPhonesSaving(false);
  }

  function handleAddAdminPhone() {
    const digits = adminPhoneInput.replace(/\D/g, '');
    if (digits.length < 10) { setAdminPhonesMsg('Ingresa un número válido (ej: 573248279293)'); setTimeout(() => setAdminPhonesMsg(''), 4000); return; }
    const normalized = digits.length === 10 ? '57' + digits : digits;
    if (adminPhones.some(p => p === normalized)) { setAdminPhonesMsg('Ese número ya está en la lista'); setTimeout(() => setAdminPhonesMsg(''), 4000); return; }
    persistAdminPhones([...adminPhones, normalized]);
    setAdminPhoneInput('');
  }

  function handleRemoveAdminPhone(phone) {
    persistAdminPhones(adminPhones.filter(p => p !== phone));
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

  async function handleSavePortalCreds() {
    setPortalCredsSaving(true); setPortalCredsMsg('');
    try {
      const headers = { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN };
      for (const [provider, creds] of Object.entries(portalCreds)) {
        if (!String(creds.username).trim() || !String(creds.password)) continue;
        const res = await fetch(getBase() + '/portal-credentials/' + provider, { method: 'PUT', headers, body: JSON.stringify({ username: creds.username, password: creds.password }) });
        if (!res.ok) throw new Error(await res.text());
      }
      setPortalCredsMsg('Credenciales guardadas. El worker local recuperará automáticamente las sesiones vencidas.');
    } catch (e) { setPortalCredsMsg('Error al guardar: ' + e.message); }
    setPortalCredsSaving(false);
    setTimeout(() => setPortalCredsMsg(''), 6000);
  }

  async function handleChangeAdminPassword(event) {
    event.preventDefault();
    setPasswordMessage('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMessage('Error: las contraseñas nuevas no coinciden.');
      return;
    }
    setPasswordBusy(true);
    try {
      const response = await fetch(getBase() + '/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'No se pudo cambiar la contraseña.');
      setPasswordMessage(result.message || 'Contraseña actualizada.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => { clearAuth(); navigate('/login', { replace: true }); }, 1400);
    } catch (error) {
      setPasswordMessage('Error: ' + (error.message || 'No se pudo cambiar la contraseña.'));
    }
    setPasswordBusy(false);
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

        {auth?.role === 'admin' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-600" /> Seguridad del administrador</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Cambia la contraseña de administración. Se cerrarán las demás sesiones y deberás entrar nuevamente.</p>
            <form onSubmit={handleChangeAdminPassword} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input type="password" value={passwordForm.currentPassword} onChange={event => setPasswordForm(current => ({ ...current, currentPassword: event.target.value }))} placeholder="Contraseña actual" autoComplete="current-password" className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
              <input type="password" value={passwordForm.newPassword} onChange={event => setPasswordForm(current => ({ ...current, newPassword: event.target.value }))} placeholder="Nueva contraseña (mín. 10)" minLength={10} autoComplete="new-password" className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
              <input type="password" value={passwordForm.confirmPassword} onChange={event => setPasswordForm(current => ({ ...current, confirmPassword: event.target.value }))} placeholder="Confirmar contraseña" minLength={10} autoComplete="new-password" className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" required />
              <button type="submit" disabled={passwordBusy} className="md:col-span-3 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
                <KeyRound className="w-4 h-4" /> {passwordBusy ? 'Actualizando…' : 'Cambiar contraseña'}
              </button>
            </form>
            {passwordMessage && <p className={`mt-3 text-sm ${passwordMessage.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>{passwordMessage}</p>}
          </div>
        )}

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
            <button onClick={handleSyncCalendarReminders} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
              <CalendarCheck className="w-4 h-4" /> Sincronizar notificaciones de pago (.ics)
            </button>
            <p className="text-xs text-gray-400">Descarga el archivo de calendario con todos los recordatorios de pago. Impórtalo en Google Calendar u Outlook; los eventos antiguos se reemplazan automáticamente.</p>
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
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
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
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Edita los mensajes manuales que se abren en WhatsApp. Las plantillas Cloud aprobadas se envían desde la bandeja y desde el bot.</p>
          <p className="mb-4 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:bg-violet-950/30 dark:text-violet-200">Plantillas Cloud pendientes en Meta: <code>saludo_inquilino</code> y <code>cobro_canon_servicios</code>. Deben existir y estar aprobadas con el mismo nombre y variables.</p>
          <div className="space-y-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre de la plantilla</label>
              <input type="text" value={waTemplateNames.name1} onChange={e => setWaTemplateNames({...waTemplateNames, name1: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3" placeholder="Ej: Servicios públicos" />
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Mensaje</label>
              <p className="text-xs text-gray-400 mb-1">Variables: {'{nombre}'}, {'{apto}'}, {'{deuda_aire}'}, {'{deuda_agua}'}, {'{deuda_gas}'}, {'{nic_aire}'}, {'{poliza_agua}'}, {'{contrato_gas}'}, {'{link_aire}'}, {'{link_triplea}'}, {'{link_gases}'}</p>
              <textarea value={waTemplates.services} onChange={e => setWaTemplates({...waTemplates, services: e.target.value})} rows={5} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre de la plantilla</label>
              <input type="text" value={waTemplateNames.name2} onChange={e => setWaTemplateNames({...waTemplateNames, name2: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-3" placeholder="Ej: Recordatorio de pago" />
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Mensaje</label>
              <p className="text-xs text-gray-400 mb-1">Variables: {'{nombre}'}, {'{apto}'}, {'{periodo}'}, {'{valor_canon}'}, {'{fecha_vencimiento}'}, {'{estado_canon}'}, {'{deuda_aire}'}, {'{deuda_agua}'}, {'{deuda_gas}'}, {'{link_aire}'}, {'{link_triplea}'}, {'{link_gases}'}</p>
              <textarea value={waTemplates.reminder} onChange={e => setWaTemplates({...waTemplates, reminder: e.target.value})} rows={5} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-xs" />
            </div>
            <button onClick={handleSaveTemplates} disabled={waSaving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <Save className="w-4 h-4" /> {waSaving ? 'Guardando...' : waSaved ? '✓ Guardado' : 'Guardar Plantillas'}
            </button>
          </div>
        </div>

        {/* WhatsApp Proxy Bot */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Globe className="w-4 h-4" /> Link Público</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Comparte aptos disponibles con posibles inquilinos.</p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input type="text" readOnly value={window.location.origin + '/publico'} className="flex-1 text-sm text-gray-700 dark:text-gray-200 bg-transparent outline-none" onClick={e => e.target.select()} />
            <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/publico'); }} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shrink-0">Copiar</button>
          </div>
        </div>

        {/* WhatsApp Admins */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Administradores WhatsApp</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Números que pueden consultar el reporte de cobros y validar pagos desde el chat del bot. Formato: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">57XXXXXXXXXX</code> (código de país + número, sin + ni espacios).</p>
          <div className="flex gap-2 mb-3">
            <input type="tel" value={adminPhoneInput} onChange={e => setAdminPhoneInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddAdminPhone(); }} className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="573248279293" />
            <button onClick={handleAddAdminPhone} disabled={adminPhonesSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium shrink-0">
              <Plus className="w-4 h-4 inline mr-1" />Agregar
            </button>
          </div>
          {adminPhones.length === 0 ? (
            <p className="text-xs text-gray-400">Aún no hay administradores configurados.</p>
          ) : (
            <ul className="space-y-2">
              {adminPhones.map(phone => (
                <li key={phone} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-sm text-gray-700 dark:text-gray-200 font-mono">{phone}</span>
                  <button onClick={() => handleRemoveAdminPhone(phone)} disabled={adminPhonesSaving} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">Eliminar</button>
                </li>
              ))}
            </ul>
          )}
          {adminPhonesMsg && <p className="text-xs text-emerald-600 mt-2">{adminPhonesMsg}</p>}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> App Móvil (APK)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Descarga la app Android.</p>
          <a href="/app-debug.apk" download className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium mb-2">
            <Download className="w-4 h-4" /> Descargar APK
          </a>
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
            <a href="https://portal.gascaribe.com/login" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <span className="text-gray-900 dark:text-white">Gases del Caribe</span><span className="text-blue-600 text-xs">Abrir →</span>
            </a>
            <a href="https://portal.air-e.com/Pagar#/List" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
              <span className="text-gray-900 dark:text-white">Air-e — Pagar recibo</span><span className="text-blue-600 text-xs">Abrir →</span>
            </a>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Zap className="w-4 h-4" /> Credenciales de Servicios (Autollenado)</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">El worker del teléfono usa estas credenciales únicamente cuando una sesión vence. Espera la verificación normal del portal, inicia sesión y continúa el scraper sin mostrar contraseñas en los logs.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
            {[
              { key: 'air-e', name: 'Air-e (Energía)', portal: 'portal.air-e.com' },
              { key: 'triple-a', name: 'Triple A (Agua)', portal: 'portal.aaa.com.co' },
              { key: 'gascaribe', name: 'Gases · Cuenta 1', portal: 'Hasta 10 contratos' },
              { key: 'gascaribe-2', name: 'Gases · Cuenta 2', portal: 'Contratos adicionales' },
            ].map(svc => (
              <div key={svc.key} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{svc.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{svc.portal}</p>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Usuario</label>
                    <input
                      type="text"
                      value={portalCreds[svc.key]?.username || ''}
                      onChange={e => setPortalCreds(prev => ({ ...prev, [svc.key]: { ...prev[svc.key], username: e.target.value } }))}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="Correo o documento"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña</label>
                    <input
                      type="password"
                      value={portalCreds[svc.key]?.password || ''}
                      onChange={e => setPortalCreds(prev => ({ ...prev, [svc.key]: { ...prev[svc.key], password: e.target.value } }))}
                      autoComplete="off"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={handleSavePortalCreds} disabled={portalCredsSaving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
            <Save className="w-4 h-4" /> {portalCredsSaving ? 'Guardando...' : 'Guardar Credenciales'}
          </button>
          {portalCredsMsg && <p className={`mt-2 text-xs ${portalCredsMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>{portalCredsMsg}</p>}
        </div>

        {/* ─── Server Monitor Dashboard ─── */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Smartphone className="w-4 h-4 text-emerald-600" /> Filtro de llamadas (Android)</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">En la APK instalada en el teléfono con la SIM, solo timbran los números de inquilinos registrados.</p>
            </div>
            {callScreening?.native && callScreening.supported && callScreening.roleGranted && <span className={`text-xs font-medium ${callScreening.enabled ? 'text-emerald-600' : 'text-amber-600'}`}>{callScreening.enabled ? 'Filtro activo' : 'Filtro pausado'}</span>}
          </div>
          {!callScreening?.native ? <p className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">Instala y abre la APK Laujim en un Android 10 o superior que tenga la SIM Movistar.</p> : !callScreening.supported ? <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Este teléfono no admite el filtro. Se requiere Android 10 o superior y que el fabricante permita el rol de filtro de llamadas.</p> : <>
            <p className="mt-4 text-sm text-gray-700 dark:text-gray-200">{callScreening.roleGranted ? `${callScreening.authorizedCount || 0} números autorizados sincronizados.` : 'Falta permitir a Laujim filtrar llamadas en Android.'}</p>
            {callScreening.lastSyncedAt > 0 && <p className="mt-1 text-xs text-gray-500">Última sincronización: {new Date(callScreening.lastSyncedAt).toLocaleString('es-CO')}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={setupCallScreening} disabled={callScreeningBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"><RefreshCw className="w-4 h-4" /> {callScreeningBusy ? 'Configurando…' : callScreening.roleGranted ? 'Sincronizar autorizados' : 'Configurar filtro'}</button>
              {callScreening.roleGranted && <button onClick={toggleCallScreening} disabled={callScreeningBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50">{callScreening.enabled ? 'Pausar filtro' : 'Activar filtro'}</button>}
              {callScreening.roleGranted && <button onClick={toggleContactCallers} disabled={callScreeningBusy} className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm disabled:opacity-50 ${callScreening.allowContacts ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'}`}>{callScreening.allowContacts ? 'Contactos: permitidos' : 'Permitir contactos del celular'}</button>}
            </div>
            {callScreening?.roleGranted && <p className="mt-3 text-xs text-gray-500">Regla actual: siempre entran los inquilinos de Laujim; al activar contactos, también podrán llamar los números guardados en la agenda del teléfono. La app pedirá permiso para leer contactos una sola vez.</p>}
          </>}
          {callScreeningError && <p className="mt-3 text-sm text-red-600">{callScreeningError}</p>}
          <p className="mt-3 text-xs text-gray-500">Las llamadas no autorizadas se rechazan antes de timbrar. Android puede conservarlas como bloqueadas en el historial del sistema.</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 col-span-1 lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><MessageCircle className="w-4 h-4 text-violet-600" /> Filtro de mensajes SMS (Android)</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Protege los SMS normales usando la misma lista de inquilinos y, si la activaste arriba, los contactos del teléfono.</p>
            </div>
            {callScreening?.native && callScreening.smsRoleGranted && <span className="text-xs font-medium text-emerald-600">Modo protegido activo</span>}
          </div>
          {!callScreening?.native ? <p className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">Disponible dentro de la APK Laujim instalada en el Android que recibe los SMS.</p> : !callScreening?.smsRoleAvailable ? <p className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">Este teléfono no permite asignar a Laujim como aplicación predeterminada de SMS.</p> : <>
            <p className="mt-4 text-sm text-gray-700 dark:text-gray-200">{callScreening.smsRoleGranted ? `Laujim guarda en este teléfono solo los SMS permitidos. ${callScreening.authorizedSmsCount || 0} mensaje(s) autorizado(s) archivado(s).` : 'Al activarlo, Android mostrará su aviso de aplicación predeterminada de SMS.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {!callScreening.smsRoleGranted && <button onClick={setupProtectedSms} disabled={callScreeningBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-50"><MessageCircle className="w-4 h-4" /> {callScreeningBusy ? 'Configurando…' : 'Activar modo SMS protegido'}</button>}
              {callScreening.smsRoleGranted && <button onClick={refreshCallScreeningStatus} disabled={callScreeningBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 disabled:opacity-50"><RefreshCw className="w-4 h-4" /> Actualizar bandeja</button>}
            </div>
            {callScreening.smsRoleGranted && <p className="mt-3 text-xs text-gray-500">Para desactivarlo, selecciona otra aplicación de SMS en los ajustes de Android. Los SMS no autorizados se descartan localmente: no aparecen ni generan notificación en Laujim.</p>}
            {callScreening.smsRoleGranted && <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
              {authorizedSms.length === 0 ? <p className="px-3 py-3 text-sm text-gray-500">Aún no hay SMS autorizados recibidos.</p> : authorizedSms.slice(0, 8).map(message => <div key={message.id} className="px-3 py-3">
                <div className="flex items-center justify-between gap-3 text-xs text-gray-500"><span className="font-medium text-gray-700 dark:text-gray-200">{message.phone}</span><span>{new Date(message.receivedAt).toLocaleString('es-CO')}</span></div>
                <p className="mt-1 text-sm text-gray-800 dark:text-gray-100 break-words">{message.body}</p>
              </div>)}
            </div>}
          </>}
        </div>

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

      </div>
    </div>
  );
}
