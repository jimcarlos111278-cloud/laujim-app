import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cloud,
  Copy,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react';
import {
  fetchPortableWorkerConfig,
  getPortableWorkerSettings,
  heartbeatPortableWorker,
  maskWorkerToken,
  registerPortableWorker,
  savePortableWorkerSettings,
} from '../utils/portableWorker';
import { AUTH_TOKEN, getBase } from '../utils/config';

const DEFAULT_SCHEDULE = {
  intervalHours: 12,
  startAt: '07:00',
  timezone: 'America/Bogota',
  providers: ['air-e', 'water', 'gas'],
};

function formatSchedule(schedule) {
  if (!schedule) return 'Sin configurar';
  const providers = Array.isArray(schedule.providers) && schedule.providers.length
    ? schedule.providers.join(', ')
    : 'sin servicios';
  return `Cada ${schedule.intervalHours} h desde las ${schedule.startAt} (${schedule.timezone}) · ${providers}`;
}

export default function ScraperWorker() {
  const [settings, setSettings] = useState(() => getPortableWorkerSettings());
  const [config, setConfig] = useState(null);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [scheduleForm, setScheduleForm] = useState(DEFAULT_SCHEDULE);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState(null);

  const deviceIcon = useMemo(() => settings.platform.includes('android') ? Smartphone : Laptop, [settings.platform]);

  useEffect(() => {
    const current = getPortableWorkerSettings();
    if (!current.token) return undefined;
    let cancelled = false;
    setBusy(true);
    fetchPortableWorkerConfig(current)
      .then(result => { if (!cancelled) setConfig(result); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setBusy(false); });
    const interval = setInterval(() => heartbeatPortableWorker(current).catch(() => {}), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [settings.deviceId, settings.serverUrl, settings.token]);

  useEffect(() => {
    let cancelled = false;
    fetch(getBase() + '/scraper/schedule', { headers: { 'x-auth-token': AUTH_TOKEN } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('No se pudo leer la programación.')))
      .then(payload => {
        if (!cancelled && payload.schedule) setScheduleForm({ ...DEFAULT_SCHEDULE, ...payload.schedule });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function updateField(field, value) {
    setSettings(current => {
      const next = { ...current, [field]: value };
      savePortableWorkerSettings(next);
      return next;
    });
  }

  function toggleProvider(provider) {
    setScheduleForm(current => {
      const providers = current.providers.includes(provider)
        ? current.providers.filter(value => value !== provider)
        : [...current.providers, provider];
      return { ...current, providers };
    });
  }

  async function saveSchedule() {
    setScheduleBusy(true); setScheduleMessage(null);
    try {
      const response = await fetch(getBase() + '/scraper/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({
          ...scheduleForm,
          intervalHours: Number(scheduleForm.intervalHours),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo guardar la programación.');
      setScheduleForm({ ...DEFAULT_SCHEDULE, ...payload.schedule });
      setScheduleMessage({ type: 'success', text: 'Frecuencia guardada. El worker la tomará en su próxima configuración.' });
    } catch (error) {
      setScheduleMessage({ type: 'error', text: error.message });
    } finally {
      setScheduleBusy(false);
    }
  }

  async function handleCheck(showMessage = true) {
    if (!settings.token) {
      if (showMessage) setMessage({ type: 'error', text: 'Pega el token del worker antes de probar la conexión.' });
      return;
    }
    setBusy(true);
    if (showMessage) setMessage(null);
    try {
      const current = savePortableWorkerSettings(settings);
      const result = await fetchPortableWorkerConfig(current);
      setConfig(result);
      if (showMessage) setMessage({ type: 'success', text: 'Conexión correcta. El servidor respondió con la configuración.' });
    } catch (error) {
      if (showMessage) setMessage({ type: 'error', text: error.message || 'No se pudo conectar con Render.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    if (!settings.token) {
      setMessage({ type: 'error', text: 'Falta el token del worker.' });
      return;
    }
    setBusy(true); setMessage(null);
    try {
      const current = savePortableWorkerSettings(settings);
      await registerPortableWorker(current, replaceExisting);
      const result = await fetchPortableWorkerConfig(current);
      setConfig(result);
      setMessage({
        type: 'success',
        text: replaceExisting
          ? 'Este dispositivo quedó activo. Los workers anteriores quedaron inactivos.'
          : 'Este dispositivo quedó registrado como worker.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'No se pudo registrar el dispositivo.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    const text = [
      `Dispositivo: ${settings.deviceId}`,
      `Plataforma: ${settings.platform}`,
      `Servidor: ${settings.serverUrl}`,
      `Token: ${maskWorkerToken(settings.token)}`,
      `Programación: ${formatSchedule(config?.schedule)}`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }

  const DeviceIcon = deviceIcon;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Worker scraper</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Conecta un celular, un PC o el siguiente dispositivo sin cambiar el bot.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          <Cloud className="h-4 w-4" /> Controlado por Render
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <Smartphone className="mb-2 h-5 w-5 text-blue-600" />
          <p className="font-semibold text-gray-900 dark:text-white">Celular</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">APK, Wi-Fi, cargador y notificaciones activas.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <Laptop className="mb-2 h-5 w-5 text-violet-600" />
          <p className="font-semibold text-gray-900 dark:text-white">PC</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Mismo servidor, token y contrato; cambia solo el worker.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <ShieldCheck className="mb-2 h-5 w-5 text-green-600" />
          <p className="font-semibold text-gray-900 dark:text-white">Datos protegidos</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Las contraseñas y sesiones de los portales no se envían a Render.</p>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"><DeviceIcon className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Dispositivo activo</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Estos datos quedan guardados solo en este dispositivo.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            URL del servidor
            <input value={settings.serverUrl} onChange={e => updateField('serverUrl', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white" placeholder="https://laujim-app.onrender.com" />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Identificador del dispositivo
            <input value={settings.deviceId} onChange={e => updateField('deviceId', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300 md:col-span-2">
            Token privado del worker
            <input type="password" value={settings.token} onChange={e => updateField('token', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white" placeholder="Se configura como SCRAPER_WORKER_TOKEN en Render" autoComplete="off" />
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} className="mt-0.5" />
            <span><strong>Reemplazar el worker anterior.</strong> Déjalo marcado al pasar de celular a PC para evitar dos scrapeos simultáneos.</span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => handleCheck(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Probar conexión
          </button>
          <button onClick={handleRegister} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Activar este dispositivo
          </button>
          <button onClick={handleCopy} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">
            <Copy className="h-4 w-4" /> {copied ? 'Copiado' : 'Copiar diagnóstico'}
          </button>
        </div>
        {message && (
          <div className={`mt-4 flex items-start gap-2 rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
            {message.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><Clock3 className="h-5 w-5" /></div>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Frecuencia de actualización</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Se guarda en la base de Laujim; no tendrás que cambiar Render cada vez.</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Cada cuántas horas
            <input type="number" min="1" max="168" value={scheduleForm.intervalHours} onChange={e => setScheduleForm(current => ({ ...current, intervalHours: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
            <span className="mt-1 block text-xs text-gray-500">Entre 1 y 168 horas.</span>
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Primera ejecución del día
            <input type="time" value={scheduleForm.startAt} onChange={e => setScheduleForm(current => ({ ...current, startAt: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white" />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            Zona horaria
            <select value={scheduleForm.timezone} onChange={e => setScheduleForm(current => ({ ...current, timezone: e.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white">
              <option value="America/Bogota">America/Bogota</option>
              <option value="America/New_York">America/New_York</option>
              <option value="UTC">UTC</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[['air-e', '⚡ Air-e'], ['water', '💧 Triple A'], ['gas', '🔥 Gases del Caribe']].map(([provider, label]) => (
            <label key={provider} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${scheduleForm.providers.includes(provider) ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'border-gray-300 text-gray-500 dark:border-gray-600'}`}>
              <input type="checkbox" checked={scheduleForm.providers.includes(provider)} onChange={() => toggleProvider(provider)} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={saveSchedule} disabled={scheduleBusy} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
            {scheduleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />} Guardar frecuencia
          </button>
          <span className="text-xs text-gray-500">Actual: {formatSchedule(scheduleForm)}</span>
        </div>
        {scheduleMessage && <div className={`mt-3 rounded-lg p-3 text-sm ${scheduleMessage.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>{scheduleMessage.text}</div>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Configuración recibida</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">Render envía el horario y los apartamentos; nunca las contraseñas.</p>
          </div>
          <button onClick={() => handleCheck(true)} disabled={busy || !settings.token} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700" title="Actualizar configuración"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {config ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50"><Clock3 className="mb-1 h-4 w-4 text-blue-600" /><p className="text-xs text-gray-500">Horario</p><p className="text-sm font-medium text-gray-900 dark:text-white">{formatSchedule(config.schedule)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50"><RefreshCw className="mb-1 h-4 w-4 text-violet-600" /><p className="text-xs text-gray-500">Apartamentos configurados</p><p className="text-sm font-medium text-gray-900 dark:text-white">{Array.isArray(config.apartments) ? config.apartments.length : 0}</p></div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50 sm:col-span-2"><p className="text-xs text-gray-500">Portales</p><div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-700 dark:text-gray-300">{Object.keys(config.portals || {}).map(provider => <span key={provider} className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-gray-800">{provider}</span>)}</div></div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">Aún no hay una conexión validada en este dispositivo.</div>
        )}
      </section>

      <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <p><strong>Qué necesitarás en el celular:</strong> APK instalada, internet estable, notificaciones permitidas, batería sin optimización para Laujim y cargador durante la ventana de consulta. El inicio de sesión de cada portal se hace una vez en ese dispositivo. El runner ejecutor listo actualmente es el de Windows; esta pantalla deja preparado el cambio de equipo mientras se termina el ejecutor Android nativo.</p>
      </div>
    </div>
  );
}
