import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Camera, DoorOpen, Clock3, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';

const API_BASE = window.location.origin;

async function publicRequest(route) {
  const response = await fetch(API_BASE + '/api' + route, { signal: AbortSignal.timeout(12000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error');
  return payload;
}

function colombiaTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

export default function IntercomCallPage() {
  const { id } = useParams();
  const [call, setCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgKey, setImgKey] = useState(0);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await publicRequest(`/intercom/public/call/${id}`);
      setCall(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  // Auto-refresh while ringing
  useEffect(() => {
    if (call?.status !== 'ringing') return;
    const timer = setInterval(() => {
      load();
      setImgKey(k => k + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, [call?.status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="text-sm text-slate-600">{error}</p>
          <button onClick={load} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">Reintentar</button>
        </div>
      </div>
    );
  }

  const statusConfig = {
    ringing: { icon: Clock3, color: 'text-amber-500', bg: 'bg-amber-100', label: 'Esperando respuesta...' },
    opened: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-100', label: 'Puerta abierta' },
    ignored: { icon: XCircle, color: 'text-slate-400', bg: 'bg-slate-100', label: 'Llamada ignorada' },
    missed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-100', label: 'Sin respuesta' },
  };
  const st = statusConfig[call?.status] || statusConfig.missed;
  const StatusIcon = st.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Camera feed */}
        <div className="relative aspect-video bg-slate-900">
          {call?.feedAvailable ? (
            <img
              key={imgKey}
              src={`${API_BASE}/api/intercom/public/feed?t=${Date.now()}`}
              alt="Vista del portón"
              className="h-full w-full object-cover"
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : call?.snapshotUrl ? (
            <img
              src={`${API_BASE}${call.snapshotUrl}`}
              alt="Foto del portón"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Camera className="h-12 w-12 text-slate-600" />
            </div>
          )}
          <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
            Apartamento {call?.apartmentName}
          </div>
          {call?.status === 'ringing' && (
            <button
              onClick={() => { load(); setImgKey(k => k + 1); }}
              className="absolute bottom-2 right-2 rounded-lg bg-black/60 p-1.5 text-white hover:bg-black/80"
              title="Actualizar imagen"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status */}
        <div className="p-5">
          <div className="flex items-center gap-3">
            <div className={`rounded-full p-2 ${st.bg}`}>
              <StatusIcon className={`h-5 w-5 ${st.color}`} />
            </div>
            <div>
              <p className="font-semibold text-slate-900">Llamada al apartamento {call?.apartmentName}</p>
              <p className="text-xs text-slate-500">{st.label}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Iniciada: {colombiaTime(call?.startedAt)}
          </p>

          {call?.status === 'ringing' && (
            <p className="mt-3 animate-pulse text-center text-sm text-amber-600">
              El residente ha sido notificado. Por favor espere frente a la cámara.
            </p>
          )}

          {call?.status === 'opened' && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3">
              <DoorOpen className="h-5 w-5 text-emerald-600" />
              <p className="text-sm font-medium text-emerald-700">La puerta ha sido abierta. Puede ingresar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
