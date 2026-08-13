import { useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, Clock3, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import { AUTH_TOKEN, getBase } from '../utils/config';

async function securityRequest(route, options = {}) {
  const response = await fetch(getBase() + route, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la solicitud.');
  return payload;
}

function colombiaTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

export default function SecurityCenter() {
  const [overview, setOverview] = useState({ cameras: [], doors: [], accessEvents: [], gatewayConnected: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cameraBusy, setCameraBusy] = useState('');
  const [doorBusy, setDoorBusy] = useState('');
  const [streams, setStreams] = useState({});
  const [message, setMessage] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try { setOverview(await securityRequest('/security/overview')); }
    catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  async function viewCamera(camera) {
    setCameraBusy(camera.id);
    setMessage(null);
    try {
      const ticket = await securityRequest(`/security/cameras/${encodeURIComponent(camera.id)}/ticket`, { method: 'POST', body: '{}' });
      setStreams(current => ({ ...current, [camera.id]: ticket }));
    } catch (requestError) { setMessage({ type: 'error', text: requestError.message }); }
    finally { setCameraBusy(''); }
  }

  async function unlock(door) {
    if (!window.confirm(`¿Confirmas abrir ${door.name}? Esta acción quedará auditada.`)) return;
    setDoorBusy(door.id);
    setMessage(null);
    try {
      const result = await securityRequest(`/security/doors/${encodeURIComponent(door.id)}/unlock`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
      setMessage({ type: 'success', text: result.message || `${door.name} abierto.` });
      await load();
    } catch (requestError) { setMessage({ type: 'error', text: requestError.message }); }
    finally { setDoorBusy(''); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900 dark:text-white">Seguridad y portería</h1><p className="text-sm text-gray-500">Cámaras por rol, apertura auditada y estado de la pasarela local.</p></div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:text-gray-200"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar</button>
      </div>

      <div className={`flex items-start gap-3 rounded-xl border p-4 ${overview.gatewayConnected ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>
        {overview.gatewayConnected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
        <div><p className="font-semibold">Pasarela local {overview.gatewayConnected ? 'conectada' : 'pendiente'}</p><p className="text-xs">Render gestiona usuarios y permisos; el mini PC local transforma RTSP a video web y acciona el relé.</p></div>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div className={`rounded-xl p-4 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-3"><div className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"><Camera className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900 dark:text-white">Todas las cámaras</h2><p className="text-xs text-gray-500">Los inquilinos solo reciben las marcadas como visibles para inquilinos.</p></div></div>
        {overview.cameras.length ? <div className="grid gap-4 md:grid-cols-2">{overview.cameras.map(camera => <article key={camera.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"><div className="flex items-center justify-between gap-3 p-3"><div><p className="font-semibold text-gray-900 dark:text-white">{camera.name}</p><p className="text-xs text-gray-500">{camera.location || camera.id} · {camera.tenantVisible ? 'Visible a inquilinos' : 'Solo administrador'}</p></div><button onClick={() => viewCamera(camera)} disabled={!overview.gatewayConnected || cameraBusy === camera.id} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-gray-300">{cameraBusy === camera.id ? 'Conectando…' : 'Ver'}</button></div>{streams[camera.id]?.playbackUrl && <iframe src={streams[camera.id].playbackUrl} title={camera.name} allow="autoplay; fullscreen" className="aspect-video w-full border-0 bg-black" />}</article>)}</div> : <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-900/40">Configura <code>CAMERA_STREAMS_JSON</code> para listar las cámaras.</p>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-3"><div className="rounded-lg bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><LockKeyhole className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900 dark:text-white">Cerraduras y rejas</h2><p className="text-xs text-gray-500">Toda apertura requiere confirmación, tiene límite de frecuencia y queda registrada.</p></div></div>
        {overview.doors.length ? <div className="grid gap-3 sm:grid-cols-2">{overview.doors.map(door => <div key={door.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700"><p className="font-semibold text-gray-900 dark:text-white">{door.name}</p><p className="text-xs text-gray-500">{door.location || door.id}</p><button onClick={() => unlock(door)} disabled={!overview.gatewayConnected || doorBusy === door.id} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-gray-300"><LockKeyhole className="h-4 w-4" />{doorBusy === door.id ? 'Solicitando…' : 'Abrir'}</button></div>)}</div> : <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-900/40">Configura <code>ACCESS_DOORS_JSON</code> después de instalar la cerradura y el relé.</p>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h2 className="font-semibold text-gray-900 dark:text-white">Auditoría de accesos</h2></div>
        {overview.accessEvents.length ? <div className="max-h-80 divide-y divide-gray-100 overflow-auto dark:divide-gray-700">{overview.accessEvents.map(event => <div key={event.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div><p className="font-medium text-gray-900 dark:text-white">{event.doorId} · {event.status}</p><p className="text-xs text-gray-500">{event.actorRole}{event.apartmentId ? ` · apto ${event.apartmentId}` : ''} · {event.message || 'Sin detalle'}</p></div><span className="flex shrink-0 items-center gap-1 text-xs text-gray-400"><Clock3 className="h-3.5 w-3.5" /> {colombiaTime(event.createdAt)}</span></div>)}</div> : <p className="text-sm text-gray-500">Aún no hay aperturas registradas.</p>}
      </section>
    </div>
  );
}
