import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Building2, Calendar, Camera, Check, CheckCircle, ChevronDown, ChevronUp,
  Compass, Copy, Download, Droplets, ExternalLink, Eye, FileText, Flame, Info, Key, LayoutGrid, Loader2,
  LockKeyhole, LogOut, MapPin, Maximize2, Move, QrCode, Radio, RefreshCw, ShieldCheck, Video, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import QRCode from 'qrcode';
import { clearAuth, isTenant } from '../utils/auth';
import { AUTH_TOKEN, getBase, getRawBase } from '../utils/config';
import { formatCurrency, formatShortDate, formatRelativeDueDate, getCurrentPeriod, openEzvizApp } from '../utils/helpers';
import IntercomCallModal from '../components/IntercomCallModal';

const PROVIDERS = {
  electricity: { title: 'Air-e', icon: Zap, theme: 'amber', reference: 'NIC' },
  water: { title: 'Triple A', icon: Droplets, theme: 'sky', reference: 'Póliza' },
  gas: { title: 'Gases del Caribe', icon: Flame, theme: 'rose', reference: 'Contrato' },
};

function colombiaDate(value) {
  if (!value) return 'Sin sincronización';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin sincronización';
  return date.toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

async function tenantRequest(route, options = {}) {
  const response = await fetch(getBase() + route, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la solicitud.');
  return payload;
}

function ServiceCard({ serviceKey, service, qrUrl, onToggleQr }) {
  const meta = PROVIDERS[serviceKey];
  const Icon = meta.icon;
  const known = Number.isFinite(Number(service?.debt));
  const debt = known ? Number(service.debt) : null;
  const paid = debt === 0 || service?.status === 'paid';
  const classes = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[meta.theme];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`rounded-xl border p-2.5 ${classes}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900">{meta.title}</h3>
              <p className="text-xs text-slate-500">{service?.referenceLabel || meta.reference}: <strong className="text-slate-700">{service?.reference || 'Sin configurar'}</strong></p>
            </div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${paid ? 'bg-emerald-100 text-emerald-700' : known ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
              {paid ? 'Al día' : known ? 'Pendiente' : 'Sin confirmar'}
            </span>
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Deuda del mes</p>
          <p className="text-2xl font-bold text-slate-900">{known ? formatCurrency(debt) : '—'}</p>
          <p className="mt-1 text-[11px] text-slate-500">Sincronizado: {colombiaDate(service?.checkedAt)}</p>
          {service?.error && !known && <p className="mt-2 line-clamp-2 text-xs text-amber-700">{service.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {service?.paymentUrl && service?.paymentMode === 'qr' && (
              <button onClick={() => onToggleQr(serviceKey)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                <QrCode className="h-4 w-4" /> Mostrar QR
              </button>
            )}
            {service?.paymentUrl && service?.paymentMode === 'nic' && (
              <a href={service.paymentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">
                <ExternalLink className="h-4 w-4" /> Pagar con NIC
              </a>
            )}
            {!service?.paymentUrl && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Pago aún no configurado</span>}
          </div>
          {qrUrl && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
              <img src={qrUrl} alt={`QR de pago ${meta.title}`} className="mx-auto h-44 w-44" />
              <a href={service.paymentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">Abrir pago <ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

const APTO_CAMERAS = [
  { id: 'gate', name: 'Portón Principal', serial: 'BG6994814', location: 'Entrada Principal', badge: 'ACCESO PRINCIPAL', isGate: true },
  { id: 'lat', name: 'Fachada Lateral (L)', serial: 'BG6994872', location: 'Costado Derecho', badge: 'CALLE DERECHA', isGate: false },
  { id: 'izq', name: 'Fachada Izquierda (IZQ)', serial: 'BG6994741', location: 'Costado Izquierdo', badge: 'CALLE IZQUIERDA', isGate: false },
];

export default function MiApto() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openQr, setOpenQr] = useState('');
  const [qrUrls, setQrUrls] = useState({});
  const [cameraView, setCameraView] = useState(null);
  const [cameraBusy, setCameraBusy] = useState('');
  const [doorBusy, setDoorBusy] = useState('');
  const [actionMessage, setActionMessage] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [cameraLive, setCameraLive] = useState(true);
  const [cameraCountdown, setCameraCountdown] = useState(60); // 60s auto-pause de seguridad
  const [selectedCamSerial, setSelectedCamSerial] = useState('BG6994814');
  const [camViewMode, setCamViewMode] = useState('mosaic'); // 'mosaic' (1 hero + 2 secundarios) | 'grid' (3 iguales)
  const [cameraFeeds, setCameraFeeds] = useState({
    BG6994814: `${getRawBase()}/api/intercom/public/feed?serial=BG6994814&t=${Date.now()}`,
    BG6994872: `${getRawBase()}/api/intercom/public/feed?serial=BG6994872&t=${Date.now()}`,
    BG6994741: `${getRawBase()}/api/intercom/public/feed?serial=BG6994741&t=${Date.now()}`,
  });
  const [cameraErrors, setCameraErrors] = useState({});
  const [streamUrls, setStreamUrls] = useState({});
  const [streamErrors, setStreamErrors] = useState({});
  const [streamingActive, setStreamingActive] = useState(false);
  const [showStreamSetup, setShowStreamSetup] = useState(false);
  const [appKeyInput, setAppKeyInput] = useState('');
  const [appSecretInput, setAppSecretInput] = useState('');
  const [savingKeys, setSavingKeys] = useState(false);
  const [keysFeedback, setKeysFeedback] = useState(null);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef(null);
  const [ptzMoving, setPtzMoving] = useState(''); // 'up' | 'down' | 'left' | 'right' | ''
  const [ptzFeedback, setPtzFeedback] = useState('');
  const [showEzvizGuide, setShowEzvizGuide] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  function copyText(text, key) {
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(''), 2000);
      }
    } catch {}
  }

  // Consultar streams HLS de Ezviz para cada cámara
  async function loadStreams() {
    try {
      const statusRes = await fetch(`${getRawBase()}/api/cameras/settings/ezviz-status`);
      const statusData = await statusRes.json().catch(() => ({}));
      if (statusData.ok && statusData.hasOpenPlatform) {
        setStreamingActive(true);
      }
    } catch {}

    for (const cam of APTO_CAMERAS) {
      try {
        const res = await fetch(`${getRawBase()}/api/cameras/${cam.serial}/stream`);
        const data = await res.json().catch(() => ({}));
        if (data.ok && data.streamUrl) {
          setStreamUrls(prev => ({ ...prev, [cam.serial]: data.streamUrl }));
          setStreamErrors(prev => ({ ...prev, [cam.serial]: false }));
        }
      } catch {}
    }
  }

  useEffect(() => {
    loadStreams();
  }, []);

  // Precarga escalonada inicial para garantizar que las 3 cámaras respondan de inmediato
  useEffect(() => {
    APTO_CAMERAS.forEach((cam, idx) => {
      setTimeout(() => {
        const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&t=${Date.now()}`;
        const img = new Image();
        img.onload = () => {
          setCameraFeeds(prev => ({ ...prev, [cam.serial]: nextUrl }));
          setCameraErrors(prev => ({ ...prev, [cam.serial]: false }));
        };
        img.src = nextUrl;
      }, idx * 400);
    });
  }, []);

  // Reproductor HLS para la cámara Hero seleccionada
  useEffect(() => {
    const streamUrl = streamUrls[selectedCamSerial];
    const isFailed = streamErrors[selectedCamSerial];
    const video = videoRef.current;
    if (!video || !streamUrl || isFailed) return;

    let hls = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[HLS] Error en stream HLS:', data);
          setStreamErrors(prev => ({ ...prev, [selectedCamSerial]: true }));
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
      });
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [selectedCamSerial, streamUrls[selectedCamSerial], streamErrors[selectedCamSerial]]);

  // Guardar llaves de Ezviz Open Platform
  async function handleSaveOpenPlatformKeys(e) {
    if (e) e.preventDefault();
    if (!appKeyInput.trim() || !appSecretInput.trim()) {
      setKeysFeedback({ type: 'error', text: 'Por favor ingresa tanto el AppKey como el AppSecret.' });
      return;
    }
    setSavingKeys(true);
    setKeysFeedback(null);
    try {
      const res = await fetch(`${getRawBase()}/api/cameras/settings/ezviz-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appKey: appKeyInput.trim(), appSecret: appSecretInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al guardar credenciales');
      setKeysFeedback({ type: 'success', text: '¡Conectado! Verificando transmisión en vivo a 25 FPS...' });
      await loadStreams();
      setTimeout(() => {
        setShowStreamSetup(false);
        setKeysFeedback(null);
      }, 1500);
    } catch (err) {
      setKeysFeedback({ type: 'error', text: err.message });
    } finally {
      setSavingKeys(false);
    }
  }

  // Motor de ráfaga concurrente con doble búfer: actualiza las 3 cámaras simultáneamente de forma escalonada
  useEffect(() => {
    if (!cameraLive) return;
    let step = 0;
    const interval = setInterval(() => {
      setCameraCountdown(prev => {
        if (prev <= 1) {
          setCameraLive(false);
          return 0;
        }
        return prev - 1;
      });

      // Refresca una cámara cada 750ms, completando el ciclo de las 3 en ~2.2s
      const targetCam = APTO_CAMERAS[step % APTO_CAMERAS.length];
      step++;
      const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${targetCam.serial}&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        setCameraFeeds(prev => ({ ...prev, [targetCam.serial]: nextUrl }));
        setCameraErrors(prev => ({ ...prev, [targetCam.serial]: false }));
      };
      img.onerror = () => {
        // Si hay error momentáneo, conserva la imagen anterior
      };
      img.src = nextUrl;
    }, 750);

    return () => clearInterval(interval);
  }, [cameraLive]);

  function toggleCameraLive() {
    setCameraLive(prev => {
      const next = !prev;
      if (next) setCameraCountdown(60);
      return next;
    });
  }

  async function handleMovePtz(direction) {
    if (ptzMoving) return;
    setPtzMoving(direction);
    const dirNames = { up: 'ARRIBA', down: 'ABAJO', left: 'IZQUIERDA', right: 'DERECHA' };
    setPtzFeedback(`Moviendo ${dirNames[direction] || direction}...`);
    try {
      const res = await fetch(`${getRawBase()}/api/cameras/${selectedCamSerial}/ptz`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-auth-token': AUTH_TOKEN,
        },
        body: JSON.stringify({ direction, pulseMs: 700 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al mover');
      setPtzFeedback(`Giro hacia ${dirNames[direction] || direction} ejecutado`);
      // Refresco inmediato de la cámara activa
      setTimeout(() => {
        const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${selectedCamSerial}&refresh=1&t=${Date.now()}`;
        const img = new Image();
        img.onload = () => {
          setCameraFeeds(prev => ({ ...prev, [selectedCamSerial]: nextUrl }));
        };
        img.src = nextUrl;
      }, 350);
    } catch (err) {
      setPtzFeedback(`Error: ${err.message}`);
    } finally {
      setTimeout(() => {
        setPtzMoving('');
        setPtzFeedback('');
      }, 2200);
    }
  }

  function refreshAllCameras() {
    APTO_CAMERAS.forEach(cam => {
      fetch(`${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&refresh=1`).catch(() => {});
      const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        setCameraFeeds(prev => ({ ...prev, [cam.serial]: nextUrl }));
      };
      img.src = nextUrl;
    });
  }

  useEffect(() => {
    if (!isTenant()) { navigate('/login', { replace: true }); return; }
    loadData();
  }, []);

  // Poll for active intercom calls every 3 seconds for instant response
  useEffect(() => {
    if (!isTenant()) return;
    let cancelled = false;
    let lastSeenCallId = null;

    async function checkIntercom() {
      try {
        const result = await tenantRequest('/intercom/active');
        if (cancelled) return;
        if (result.active && result.call) {
          setActiveCall(result);
          // Play ring alert and vibrate if new incoming call
          if (lastSeenCallId !== result.call.id) {
            lastSeenCallId = result.call.id;
            try {
              if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 500]);
              const AudioCtx = window.AudioContext || window.webkitAudioContext;
              if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
                osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2); // G5
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
                osc.start();
                osc.stop(ctx.currentTime + 0.6);
              }
            } catch {}
          }
        } else {
          setActiveCall(null);
        }
      } catch { /* ignore polling errors */ }
    }
    checkIntercom();
    const timer = setInterval(checkIntercom, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const overview = await tenantRequest('/tenant/overview');
      setData(overview);
      const generated = {};
      for (const [key, service] of Object.entries(overview.services || {})) {
        if (service?.paymentMode === 'qr' && service?.paymentUrl) {
          generated[key] = await QRCode.toDataURL(service.paymentUrl, { width: 320, margin: 2 });
        }
      }
      setQrUrls(generated);
    } catch (requestError) {
      if (/autoriz|sesión|sesion/i.test(requestError.message)) {
        clearAuth({}, 'tenant_fetch_auth_error');
        navigate('/login', { replace: true });
        return;
      }
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAuth({ permanent: true }, 'tenant_user_logout');
    navigate('/login', { replace: true });
  }

  async function openCamera(camera) {
    setCameraBusy(camera.id);
    setActionMessage(null);
    try {
      const ticket = await tenantRequest(`/tenant/cameras/${encodeURIComponent(camera.id)}/ticket`, { method: 'POST', body: '{}' });
      setCameraView(ticket);
    } catch (requestError) {
      setActionMessage({ type: 'error', text: requestError.message });
    } finally {
      setCameraBusy('');
    }
  }

  async function unlockDoor(door) {
    if (!window.confirm(`¿Abrir ${door.name}? La solicitud quedará registrada con tu apartamento.`)) return;
    setDoorBusy(door.id);
    setActionMessage(null);
    try {
      const result = await tenantRequest(`/tenant/access/doors/${encodeURIComponent(door.id)}/unlock`, {
        method: 'POST', body: JSON.stringify({ confirm: true }),
      });
      setActionMessage({ type: 'success', text: result.message || `${door.name} abierto.` });
    } catch (requestError) {
      setActionMessage({ type: 'error', text: requestError.message });
    } finally {
      setDoorBusy('');
    }
  }

  const payments = useMemo(() => [...(data?.payments || [])].sort((left, right) => new Date(right.date) - new Date(left.date)), [data?.payments]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><RefreshCw className="mr-2 h-5 w-5 animate-spin" /> Cargando tu apartamento…</div>;
  if (!data?.apartment) return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-5"><div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow"><AlertTriangle className="mx-auto h-8 w-8 text-amber-500" /><p className="mt-3 text-sm text-slate-700">{error || 'No pudimos cargar tu apartamento.'}</p><button onClick={loadData} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></div></div>;

  const { apartment: apt, tenant, contract, services = {}, cameras = [], doors = [] } = data;
  const currentPeriod = getCurrentPeriod();
  const paidThisPeriod = payments.some(payment => payment.type === 'rent' && !['pending_validation', 'rejected'].includes(payment.status) && (payment.period === currentPeriod || payment.date?.startsWith(currentPeriod)));
  const proofPending = payments.some(payment => payment.type === 'rent' && payment.status === 'pending_validation' && (payment.period === currentPeriod || payment.date?.startsWith(currentPeriod)));

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-700 px-4 pb-16 pt-5 text-white">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/15 p-2.5 backdrop-blur"><Building2 className="h-6 w-6" /></div>
            <div><p className="text-xs text-blue-200">Portal de inquilinos</p><h1 className="text-xl font-bold">Apartamento {apt.name}</h1></div>
          </div>
          <button onClick={handleLogout} className="rounded-xl bg-white/10 p-2.5" aria-label="Cerrar sesión"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>

      <main className="mx-auto -mt-11 max-w-lg space-y-4 px-4">
        <section className="rounded-3xl bg-white p-5 shadow-xl shadow-slate-300/40">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Hola</p><h2 className="text-lg font-bold text-slate-900">{tenant?.name || 'Inquilino'}</h2></div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${paidThisPeriod ? 'bg-emerald-100 text-emerald-700' : proofPending ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
              {paidThisPeriod ? 'Canon al día' : proofPending ? 'Pago en revisión' : formatRelativeDueDate(apt.paymentDueDay)}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Canon mensual</p><p className="mt-1 font-bold text-slate-900">{formatCurrency(contract?.monthlyRent || apt.monthlyRent)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Fecha límite</p><p className="mt-1 font-bold text-slate-900">Día {apt.paymentDueDay}</p></div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Servicios públicos</h2><p className="text-xs text-slate-500">Todos los valores son Deuda Total</p></div><button onClick={loadData} className="rounded-lg bg-white p-2 text-slate-600 shadow-sm"><RefreshCw className="h-4 w-4" /></button></div>
          <div className="space-y-3">
            {Object.keys(PROVIDERS).map(key => <ServiceCard key={key} serviceKey={key} service={services[key]} qrUrl={openQr === key ? qrUrls[key] : ''} onToggleQr={keyValue => setOpenQr(current => current === keyValue ? '' : keyValue)} />)}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          {/* Cabecera del Centro de Monitoreo */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-600 p-2.5 text-white shadow-md shadow-blue-500/20">
                <Camera className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  Cámaras de Seguridad Laujim
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                    3 ACTIVAS
                  </span>
                </h2>
                <p className="text-xs text-slate-500">Mosaico simultáneo • Control motorizado PTZ</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={refreshAllCameras}
                title="Refrescar las 3 cámaras ahora"
                className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition active:scale-95"
              >
                <RefreshCw className="h-4 w-4" />
              </button>

              {streamingActive ? (
                <span className="flex items-center gap-1 rounded-full bg-red-100 text-red-700 px-2.5 py-1 text-[11px] font-extrabold border border-red-200">
                  <Radio className="h-3 w-3 animate-pulse text-red-600" />
                  <span>25 FPS ACTIVO</span>
                </span>
              ) : (
                <button
                  onClick={() => setShowStreamSetup(true)}
                  className="flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white px-2.5 py-1 text-[11px] font-bold border border-blue-200 transition shadow-sm"
                  title="Conectar Ezviz Open Platform para 25 FPS continuo sin costo"
                >
                  <Video className="h-3 w-3 text-blue-600" />
                  <span>Activar 25 FPS</span>
                </button>
              )}

              <button
                onClick={toggleCameraLive}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition shadow-sm ${
                  cameraLive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${cameraLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {cameraLive ? `EN VIVO (${cameraCountdown}s)` : 'PAUSADO'}
              </button>
            </div>
          </div>

          {/* Barra de modos de visualización (Mosaico 3-en-1 vs Cuadrícula) */}
          <div className="mt-3.5 flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setCamViewMode('mosaic')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  camViewMode === 'mosaic' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>Mosaico 3-en-1</span>
              </button>
              <button
                onClick={() => setCamViewMode('grid')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  camViewMode === 'grid' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Move className="h-3.5 w-3.5" />
                <span>Cuadrícula</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
              Toca cualquier cámara para enfocarla y moverla
            </span>
          </div>

          {/* VISTA 1: MODO MOSAICO (1 Hero Grande con PTZ + 2 Sub-monitores en vivo abajo) */}
          {camViewMode === 'mosaic' && (
            <div className="mt-3.5 space-y-3">
              {/* Monitor Principal (Hero) */}
              {(() => {
                const heroCam = APTO_CAMERAS.find(c => c.serial === selectedCamSerial) || APTO_CAMERAS[0];
                const heroFeed = cameraFeeds[heroCam.serial] || `${getRawBase()}/api/intercom/public/feed?serial=${heroCam.serial}`;
                const hasStream = streamUrls[heroCam.serial] && !streamErrors[heroCam.serial];
                const hasHeroError = cameraErrors[heroCam.serial];

                return (
                  <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 shadow-lg border border-slate-800">
                    {hasStream ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted={isMuted}
                        className="h-full w-full object-cover"
                      />
                    ) : hasHeroError ? (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 p-4 text-center">
                        <div className="relative mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20">
                          <Camera className="h-6 w-6 text-blue-400 animate-pulse" />
                        </div>
                        <p className="text-xs font-bold text-white">{heroCam.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Sincronizando señal en vivo...</p>
                        <button
                          onClick={() => {
                            setCameraErrors(prev => ({ ...prev, [heroCam.serial]: false }));
                            setCameraFeeds(prev => ({ ...prev, [heroCam.serial]: `${getRawBase()}/api/intercom/public/feed?serial=${heroCam.serial}&refresh=1&t=${Date.now()}` }));
                          }}
                          className="mt-3 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-700 active:scale-95 transition"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Reintentar ahora
                        </button>
                      </div>
                    ) : (
                      <img
                        src={heroFeed}
                        alt={heroCam.name}
                        onError={() => {
                          setCameraErrors(prev => ({ ...prev, [heroCam.serial]: true }));
                          setTimeout(() => {
                            setCameraFeeds(prev => ({ ...prev, [heroCam.serial]: `${getRawBase()}/api/intercom/public/feed?serial=${heroCam.serial}&refresh=1&t=${Date.now()}` }));
                          }, 2000);
                        }}
                        onLoad={() => {
                          setCameraErrors(prev => ({ ...prev, [heroCam.serial]: false }));
                        }}
                        className="h-full w-full object-cover transition-opacity duration-200"
                      />
                    )}

                    {/* Top Overlay: Info de la cámara principal */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 rounded-xl bg-black/75 px-3 py-1.5 backdrop-blur-md border border-white/10 z-10">
                      <span className={`h-2 w-2 rounded-full ${hasStream ? 'bg-red-500' : 'bg-emerald-400'} animate-ping`} />
                      <div>
                        <p className="text-xs font-bold text-white leading-tight">{heroCam.name}</p>
                        <p className="text-[10px] text-slate-300">{heroCam.location} • {heroCam.badge}</p>
                      </div>
                    </div>

                    {/* Top Right: Controles y badges */}
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                      {hasStream && (
                        <button
                          onClick={() => setIsMuted(!isMuted)}
                          className="rounded-xl bg-black/70 p-2 text-white hover:bg-black/90 backdrop-blur-md border border-white/10 transition"
                          title={isMuted ? 'Activar audio' : 'Silenciar'}
                        >
                          {isMuted ? <VolumeX className="h-3.5 w-3.5 text-slate-300" /> : <Volume2 className="h-3.5 w-3.5 text-emerald-400" />}
                        </button>
                      )}

                      <button
                        onClick={() => {
                          fetch(`${getRawBase()}/api/intercom/public/feed?serial=${heroCam.serial}&refresh=1`).catch(() => {});
                          const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${heroCam.serial}&t=${Date.now()}`;
                          const img = new Image();
                          img.onload = () => setCameraFeeds(prev => ({ ...prev, [heroCam.serial]: nextUrl }));
                          img.src = nextUrl;
                        }}
                        title="Refrescar fotograma"
                        className="rounded-xl bg-black/60 p-2 text-white hover:bg-black/80 backdrop-blur-md transition border border-white/10"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Cruceta Táctil Flotante PTZ Glassmorphic */}
                    <div className="absolute bottom-3 right-3 flex flex-col items-center bg-slate-950/80 backdrop-blur-md p-2 rounded-2xl border border-white/15 shadow-2xl z-10 select-none">
                      <div className="flex items-center justify-between w-full mb-1 px-1">
                        <span className="text-[9px] font-extrabold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                          <Compass className="h-3 w-3 animate-spin-slow" /> Mover
                        </span>
                        {ptzMoving && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                        )}
                      </div>

                      {/* D-Pad Cruceta */}
                      <div className="grid grid-cols-3 gap-1 w-24 h-24 place-items-center">
                        <div />
                        <button
                          onClick={() => handleMovePtz('up')}
                          disabled={Boolean(ptzMoving)}
                          title="Girar hacia Arriba"
                          className="w-7 h-7 rounded-lg bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition border border-white/20 disabled:opacity-50"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <div />

                        <button
                          onClick={() => handleMovePtz('left')}
                          disabled={Boolean(ptzMoving)}
                          title="Girar hacia Izquierda"
                          className="w-7 h-7 rounded-lg bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition border border-white/20 disabled:opacity-50"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[8px] font-bold text-amber-400 border border-white/10">
                          {ptzMoving ? <Loader2 className="h-3 w-3 animate-spin text-amber-400" /> : 'PTZ'}
                        </div>
                        <button
                          onClick={() => handleMovePtz('right')}
                          disabled={Boolean(ptzMoving)}
                          title="Girar hacia Derecha"
                          className="w-7 h-7 rounded-lg bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition border border-white/20 disabled:opacity-50"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>

                        <div />
                        <button
                          onClick={() => handleMovePtz('down')}
                          disabled={Boolean(ptzMoving)}
                          title="Girar hacia Abajo"
                          className="w-7 h-7 rounded-lg bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition border border-white/20 disabled:opacity-50"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <div />
                      </div>

                      {ptzFeedback && (
                        <p className="mt-1 text-[8px] text-amber-300 text-center font-medium max-w-[100px] truncate animate-pulse">
                          {ptzFeedback}
                        </p>
                      )}
                    </div>

                    {/* Bottom Left: Tag de resolución en vivo y botón 25 FPS */}
                    <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 z-10">
                      {hasStream ? (
                        <div className="flex items-center gap-1.5 rounded-lg bg-red-600/90 px-2.5 py-1 text-[10px] font-extrabold text-white shadow backdrop-blur-md">
                          <Radio className="h-3 w-3 animate-pulse text-white" />
                          <span>25 FPS CONTINUO EN VIVO</span>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-md border border-white/10">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            <span>HD • ~0.8s Ráfaga</span>
                          </div>
                          <button
                            onClick={() => setShowStreamSetup(true)}
                            className="flex items-center gap-1 rounded-lg bg-blue-600/90 hover:bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white shadow backdrop-blur-md transition active:scale-95"
                          >
                            <Video className="h-3 w-3" />
                            <span>Activar 25 FPS</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Sub-Monitores Simultáneos en Vivo (Las otras 2 cámaras transmitiendo a la vez) */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Eye className="h-3.5 w-3.5 text-blue-600" />
                  <span>Cámaras Secundarias en Vivo (Toca para intercambiar foco)</span>
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {APTO_CAMERAS.filter(c => c.serial !== selectedCamSerial).map(cam => {
                    const subFeed = cameraFeeds[cam.serial] || `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}`;
                    const hasSubError = cameraErrors[cam.serial];
                    return (
                      <button
                        key={cam.serial}
                        onClick={() => setSelectedCamSerial(cam.serial)}
                        className="group relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 shadow border-2 border-transparent hover:border-blue-500 transition text-left focus:outline-none"
                      >
                        {hasSubError ? (
                          <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 p-2 text-center">
                            <Camera className="h-5 w-5 text-blue-400 animate-pulse mb-1" />
                            <span className="text-[10px] font-bold text-white truncate max-w-[90%]">{cam.name}</span>
                            <span className="text-[9px] text-slate-400">Sincronizando señal...</span>
                          </div>
                        ) : (
                          <img
                            src={subFeed}
                            alt={cam.name}
                            onError={() => {
                              setCameraErrors(prev => ({ ...prev, [cam.serial]: true }));
                              setTimeout(() => {
                                setCameraFeeds(prev => ({ ...prev, [cam.serial]: `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&refresh=1&t=${Date.now()}` }));
                              }, 2000);
                            }}
                            onLoad={() => {
                              setCameraErrors(prev => ({ ...prev, [cam.serial]: false }));
                            }}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />

                        {/* Top Badge */}
                        <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{cam.badge}</span>
                        </div>

                        {/* Bottom Name & Action */}
                        <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between pointer-events-none">
                          <span className="text-[11px] font-bold text-white truncate drop-shadow">{cam.name}</span>
                          <span className="rounded bg-blue-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow group-hover:bg-blue-500">
                            Enfocar
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* VISTA 2: MODO CUADRÍCULA (3 Cámaras Iguales Simultáneas) */}
          {camViewMode === 'grid' && (
            <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {APTO_CAMERAS.map(cam => {
                const isSelected = selectedCamSerial === cam.serial;
                const camFeed = cameraFeeds[cam.serial] || `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}`;
                const hasGridError = cameraErrors[cam.serial];
                return (
                  <div
                    key={cam.serial}
                    className={`relative overflow-hidden rounded-2xl bg-slate-950 shadow border-2 transition ${
                      isSelected ? 'border-blue-500 shadow-blue-500/20' : 'border-slate-800'
                    }`}
                  >
                    <div className="relative aspect-video w-full">
                      {hasGridError ? (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 p-3 text-center">
                          <Camera className="h-6 w-6 text-blue-400 animate-pulse mb-1" />
                          <span className="text-xs font-bold text-white">{cam.name}</span>
                          <span className="text-[10px] text-slate-400">Sincronizando señal...</span>
                        </div>
                      ) : (
                        <img
                          src={camFeed}
                          alt={cam.name}
                          onError={() => {
                            setCameraErrors(prev => ({ ...prev, [cam.serial]: true }));
                            setTimeout(() => {
                              setCameraFeeds(prev => ({ ...prev, [cam.serial]: `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&refresh=1&t=${Date.now()}` }));
                            }, 2000);
                          }}
                          onLoad={() => {
                            setCameraErrors(prev => ({ ...prev, [cam.serial]: false }));
                          }}
                          className="h-full w-full object-cover"
                        />
                      )}
                      <div className="absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur pointer-events-none">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{cam.badge}</span>
                      </div>
                      <button
                        onClick={() => setSelectedCamSerial(cam.serial)}
                        className={`absolute top-2 right-2 rounded-lg px-2 py-1 text-[10px] font-bold transition z-10 ${
                          isSelected ? 'bg-blue-600 text-white shadow' : 'bg-black/60 text-slate-300 hover:text-white'
                        }`}
                      >
                        {isSelected ? 'Activa' : 'Seleccionar'}
                      </button>
                    </div>

                    <div className="p-2.5 bg-slate-900 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-bold text-white">{cam.name}</p>
                        <p className="text-[10px] text-slate-400">{cam.location}</p>
                      </div>

                      {/* Botones PTZ rápidos */}
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setSelectedCamSerial(cam.serial); handleMovePtz('left'); }}
                          title="Girar izquierda"
                          className="p-1 rounded bg-white/10 hover:bg-blue-600 text-white transition text-xs"
                        >
                          <ArrowLeft className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => { setSelectedCamSerial(cam.serial); handleMovePtz('right'); }}
                          title="Girar derecha"
                          className="p-1 rounded bg-white/10 hover:bg-blue-600 text-white transition text-xs"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Barra de Acciones y Acceso a la App Ezviz */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
            <button
              onClick={refreshAllCameras}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              Actualizar las 3 fotos
            </button>

            <button
              onClick={openEzvizApp}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 active:scale-95 transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver en App Ezviz (3K a 25fps + Joystick 360°)
            </button>
          </div>

          {/* Banner Híbrido: Videoportero Web vs App Ezviz */}
          <div className="mt-3 rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-2">
            <div className="flex items-start gap-2 text-xs text-slate-600">
              <Video className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-900">Videoportero Web (Sin instalar nada):</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Cuando alguien timbra en el portón, te llamará a tu WhatsApp o en esta web con video y audio en vivo a 25fps del visitante para que puedas abrirle con 1 toque.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
              <button
                onClick={() => setShowEzvizGuide(!showEzvizGuide)}
                className="flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:text-blue-800 transition"
              >
                <Key className="h-3.5 w-3.5 text-blue-600" />
                <span>{showEzvizGuide ? 'Ocultar cuenta para grabaciones' : '¿Quieres ver grabaciones 24/7? Toca aquí'}</span>
                {showEzvizGuide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {showEzvizGuide && (
              <div className="mt-2 rounded-xl bg-white p-3.5 border border-blue-100 text-xs space-y-3 animate-in fade-in duration-200 shadow-sm">
                <div className="flex items-center gap-1.5 text-blue-900 font-bold">
                  <ShieldCheck className="h-4 w-4 text-blue-600" />
                  <span>Acceso de Residentes a la Cámara Oficial</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Para monitorear la calle en resolución 3K nativa, mover la cámara en 360° y consultar las grabaciones de seguridad pasadas:
                </p>

                <div className="space-y-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Usuario Ezviz</span>
                      <span className="text-slate-800 font-semibold">residentes.laujim@gmail.com</span>
                    </div>
                    <button
                      onClick={() => copyText('residentes.laujim@gmail.com', 'user')}
                      className="p-1 rounded text-slate-500 hover:text-blue-600 hover:bg-white transition"
                      title="Copiar usuario"
                    >
                      {copiedKey === 'user' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <div>
                      <span className="text-slate-400 block text-[9px] uppercase font-sans font-bold">Contraseña</span>
                      <span className="text-slate-800 font-semibold">Laujim2026*</span>
                    </div>
                    <button
                      onClick={() => copyText('Laujim2026*', 'pass')}
                      className="p-1 rounded text-slate-500 hover:text-blue-600 hover:bg-white transition"
                      title="Copiar contraseña"
                    >
                      {copiedKey === 'pass' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href="https://play.google.com/store/apps/details?id=com.ezviz"
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-center text-[10px] font-bold text-slate-700 transition"
                  >
                    Google Play (Android)
                  </a>
                  <a
                    href="https://apps.apple.com/app/ezviz/id886948564"
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-center text-[10px] font-bold text-slate-700 transition"
                  >
                    App Store (iPhone)
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700"><LockKeyhole className="h-5 w-5" /></div>
            <div>
              <h2 className="font-bold text-slate-900">Acceso principal</h2>
              <p className="text-xs text-slate-500">Cerradura eléctrica del portón • Apertura auditada</p>
            </div>
          </div>
          <div className="mt-3">
            <button
              onClick={() => unlockDoor(doors[0] || { id: 'gate-door', name: 'Portón principal' })}
              disabled={doorBusy !== ''}
              className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 active:scale-[0.98] transition disabled:opacity-60"
            >
              {doorBusy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              {doorBusy ? 'Abriendo portón…' : 'Abrir portón de entrada'}
            </button>
          </div>
          {actionMessage && (
            <p className={`mt-3 rounded-xl p-3 text-xs font-medium ${
              actionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
            }`}>
              {actionMessage.text}
            </p>
          )}
        </section>

        {contract && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><FileText className="h-4 w-4" /> Contrato</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Inicio</p><strong>{formatShortDate(contract.startDate)}</strong></div><div><p className="text-xs text-slate-500">Finaliza</p><strong>{contract.endDate ? formatShortDate(contract.endDate) : 'Indefinido'}</strong></div></div>{contract.contractFile && <a href={contract.contractFile} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Download className="h-4 w-4" /> Ver contrato</a>}</section>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Calendar className="h-4 w-4" /> Historial de pagos</h2>{payments.length ? <div className="mt-2 divide-y divide-slate-100">{payments.slice(0, 12).map(payment => <div key={payment.id} className="flex items-center justify-between py-2.5 text-sm"><span className="text-slate-500">{formatShortDate(payment.date)}</span><strong className={payment.status === 'pending_validation' ? 'text-amber-600' : payment.status === 'rejected' ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(payment.amount)}</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-400">Sin pagos registrados.</p>}</section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-4 w-4" /> Tu apartamento</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm">{apt.area > 0 && <div><p className="text-xs text-slate-500">Área</p><strong>{apt.area} m²</strong></div>}{apt.floor > 0 && <div><p className="text-xs text-slate-500">Piso</p><strong>{apt.floor}</strong></div>}{apt.rooms > 0 && <div><p className="text-xs text-slate-500">Habitaciones</p><strong>{apt.rooms}</strong></div>}{apt.bathrooms > 0 && <div><p className="text-xs text-slate-500">Baños</p><strong>{apt.bathrooms}</strong></div>}</div></section>

        <div className="flex items-start gap-2 rounded-2xl bg-blue-50 p-4 text-xs text-blue-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>La cámara y la cerradura se autorizan desde Render, pero el video y la orden física pasan por la pasarela local. Tus credenciales del NVR nunca se muestran aquí.</p></div>
      </main>
      {activeCall?.active && activeCall.call && (
        <IntercomCallModal
          call={activeCall.call}
          onClose={() => setActiveCall(null)}
          onAction={() => setActiveCall(null)}
        />
      )}

      {/* Modal para activar video continuo 25 FPS sin costo en Render */}
      {showStreamSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-indigo-700 px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-white/20">
                  <Video className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Estado de Cámaras • Ezviz Cloud</h3>
                  <p className="text-[11px] text-blue-100">100% en la Nube • 0 Hardware Local Requerido</p>
                </div>
              </div>
              <button
                onClick={() => { setShowStreamSetup(false); setKeysFeedback(null); }}
                className="rounded-lg p-1 text-white/80 hover:text-white hover:bg-white/10 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200 p-3.5 space-y-2 text-xs text-emerald-950">
                <p className="font-bold flex items-center gap-1.5 text-emerald-900">
                  <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>Conexión Cloud Activa y Sincronizada</span>
                </p>
                <p className="text-[11px] leading-relaxed text-emerald-800">
                  Tus 3 cámaras Ezviz H8c transmiten en tiempo real directamente desde los servidores de Ezviz hacia la nube de Render. No requieres dejar ningún computador, laptop o servidor encendido en el edificio.
                </p>
                <div className="pt-2 border-t border-emerald-200/50 space-y-1 text-[11px] text-emerald-900 font-medium">
                  <p>• <strong>Portón Principal</strong>: Sincronizado en tiempo real</p>
                  <p>• <strong>Fachada Lateral (L)</strong>: Sincronizado en tiempo real</p>
                  <p>• <strong>Fachada Izquierda (IZQ)</strong>: Sincronizado en tiempo real</p>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5">
                <p className="text-xs font-bold text-slate-800">Ajustes Avanzados de Proveedor (Opcional)</p>
                <p className="text-[11px] text-slate-500">Si posees credenciales de desarrollador de Ezviz Open Platform, puedes ingresarlas a continuación de forma opcional:</p>
                
                <form onSubmit={handleSaveOpenPlatformKeys} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      AppKey (Opcional)
                    </label>
                    <input
                      type="text"
                      value={appKeyInput}
                      onChange={e => setAppKeyInput(e.target.value)}
                      placeholder="Ej: 9f3c7e42d8a1..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      AppSecret (Opcional)
                    </label>
                    <input
                      type="password"
                      value={appSecretInput}
                      onChange={e => setAppSecretInput(e.target.value)}
                      placeholder="••••••••••••••••••••••••"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  {keysFeedback && (
                    <div className={`rounded-xl p-3 text-xs font-semibold ${
                      keysFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {keysFeedback.text}
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowStreamSetup(false); setKeysFeedback(null); }}
                      className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-xl"
                    >
                      Cerrar
                    </button>
                    <button
                      type="submit"
                      disabled={savingKeys}
                      className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 transition disabled:opacity-60 shadow-sm"
                    >
                      {savingKeys ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                      <span>{savingKeys ? 'Guardando...' : 'Guardar Llaves'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
