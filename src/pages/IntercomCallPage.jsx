import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Camera, DoorOpen, Clock3, CheckCircle2, XCircle, Loader2, RefreshCw, Mic, MicOff, Volume2, Video,
  Plus, Play, Radio, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Compass, Eye, LayoutGrid,
} from 'lucide-react';
import { startIntercomCall } from '../utils/intercomAudio';
import { openEzvizApp } from '../utils/helpers';

const API_BASE = window.location.origin;

async function publicRequest(route, options = {}) {
  const response = await fetch(API_BASE + '/api' + route, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error de conexión');
  return payload;
}

function colombiaTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

const BUILDING_CAMERAS = [
  { id: 'gate', name: 'Portón', serial: 'BG6994814' },
  { id: 'lat', name: 'Lateral (L)', serial: 'BG6994872' },
  { id: 'izq', name: 'Izquierda (IZQ)', serial: 'BG6994741' },
];

export default function IntercomCallPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const queryToken = searchParams.get('token') || '';

  const [call, setCall] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [unlockMessage, setUnlockMessage] = useState('');

  // Video & Stream State
  const [viewMode, setViewMode] = useState('visitor'); // 'visitor' | 'ezviz'
  const [selectedCameraSerial, setSelectedCameraSerial] = useState('BG6994814');
  const [camFeeds, setCamFeeds] = useState({
    BG6994814: `${API_BASE}/api/intercom/public/feed?serial=BG6994814&t=${Date.now()}`,
    BG6994872: `${API_BASE}/api/intercom/public/feed?serial=BG6994872&t=${Date.now()}`,
    BG6994741: `${API_BASE}/api/intercom/public/feed?serial=BG6994741&t=${Date.now()}`,
  });
  const [ptzMoving, setPtzMoving] = useState('');
  const [ptzNotice, setPtzNotice] = useState('');
  const [imgKey, setImgKey] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [isLiveActive, setIsLiveActive] = useState(true);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  // Audio / WebRTC State
  const [audioStatus, setAudioStatus] = useState('connecting');
  const [isMuted, setIsMuted] = useState(false);

  const remoteVideoRef = useRef(null);
  const stopCallRef = useRef(null);
  const localStreamRef = useRef(null);

  // Load call details
  async function load() {
    setError('');
    try {
      const data = await publicRequest(`/intercom/public/call/${id}`);
      setCall(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  // 30-second live timer
  useEffect(() => {
    if (!isLiveActive || secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          setIsLiveActive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isLiveActive, secondsLeft]);

  // Connect WebRTC audio/video as tenant
  useEffect(() => {
    if (!call?.id || call.status === 'opened' || call.status === 'missed') return;
    let cancelled = false;

    async function connect() {
      try {
        setAudioStatus('connecting');
        const stop = await startIntercomCall(call.id, 'tenant', {
          enableVideo: false,
          onStatusChange: (st) => {
            if (!cancelled) setAudioStatus(st);
          },
          onLocalStream: (stream) => {
            localStreamRef.current = stream;
          },
          onRemoteStream: (stream) => {
            if (cancelled) return;
            const hasVid = stream.getVideoTracks().length > 0;
            setHasRemoteVideo(hasVid);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              remoteVideoRef.current.play().catch(() => {});
            }
          },
        });
        if (!cancelled) {
          stopCallRef.current = stop;
        } else {
          stop();
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[CallPage] Audio connection warning:', e.message);
          setAudioStatus('error');
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (stopCallRef.current) {
        stopCallRef.current();
        stopCallRef.current = null;
      }
    };
  }, [call?.id, call?.status]);

  // Poll call status while ringing
  useEffect(() => {
    if (call?.status !== 'ringing') return;
    const timer = setInterval(async () => {
      try {
        const updated = await publicRequest(`/intercom/public/call/${id}`);
        setCall(prev => ({ ...prev, ...updated }));
        setImgKey(k => k + 1);
      } catch {}
    }, 4000);
    return () => clearInterval(timer);
  }, [call?.status, id]);

  // Refresh Ezviz snapshots across all 3 cameras concurrently (~750ms staggered)
  useEffect(() => {
    if (viewMode !== 'ezviz' || !isLiveActive) return;
    let step = 0;
    const interval = setInterval(() => {
      const targetCam = BUILDING_CAMERAS[step % BUILDING_CAMERAS.length];
      step++;
      const nextUrl = `${API_BASE}/api/intercom/public/feed?serial=${targetCam.serial}&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        setCamFeeds(prev => ({ ...prev, [targetCam.serial]: nextUrl }));
      };
      img.src = nextUrl;
    }, 750);
    return () => clearInterval(interval);
  }, [viewMode, isLiveActive]);

  async function handleMovePtz(direction) {
    if (ptzMoving) return;
    setPtzMoving(direction);
    const dirNames = { up: 'ARRIBA', down: 'ABAJO', left: 'IZQ', right: 'DER' };
    setPtzNotice(`Moviendo ${dirNames[direction] || direction}...`);
    try {
      await fetch(`${API_BASE}/api/cameras/${selectedCameraSerial}/ptz`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ direction, pulseMs: 700 }),
      });
      setPtzNotice(`Giro OK`);
      setTimeout(() => {
        const nextUrl = `${API_BASE}/api/intercom/public/feed?serial=${selectedCameraSerial}&refresh=1&t=${Date.now()}`;
        const img = new Image();
        img.onload = () => setCamFeeds(prev => ({ ...prev, [selectedCameraSerial]: nextUrl }));
        img.src = nextUrl;
      }, 350);
    } catch {
      setPtzNotice('Error al mover');
    } finally {
      setTimeout(() => {
        setPtzMoving('');
        setPtzNotice('');
      }, 2000);
    }
  }

  function toggleMute() {
    if (localStreamRef.current) {
      const tracks = localStreamRef.current.getAudioTracks();
      const nextMuted = !isMuted;
      tracks.forEach(t => { t.enabled = !nextMuted; });
      setIsMuted(nextMuted);
    }
  }

  function extendLiveTime() {
    setSecondsLeft(prev => prev + 30);
    setIsLiveActive(true);
  }

  function resumeLive() {
    setSecondsLeft(30);
    setIsLiveActive(true);
  }

  async function handleUnlock() {
    setBusy('unlock');
    setUnlockMessage('');
    try {
      const tokenToUse = queryToken || call?.token;
      const res = await publicRequest(`/intercom/public/call/${id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ token: tokenToUse }),
      });
      setUnlockMessage(res.message || '¡Puerta abierta exitosamente!');
      setCall(prev => ({ ...prev, status: 'opened' }));
    } catch (e) {
      setUnlockMessage(e.message || 'Error al abrir la puerta');
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
          <XCircle className="mx-auto mb-3 h-12 w-12 text-red-500" />
          <h2 className="text-lg font-bold text-slate-900">Llamada no disponible</h2>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            onClick={load}
            className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const statusConfig = {
    ringing: { icon: Clock3, color: 'text-amber-500', bg: 'bg-amber-100', label: 'Esperando tu respuesta...' },
    opened: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-100', label: 'Puerta abierta' },
    ignored: { icon: XCircle, color: 'text-slate-400', bg: 'bg-slate-100', label: 'Llamada ignorada' },
    missed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-100', label: 'Sin respuesta' },
  };
  const st = statusConfig[call?.status] || statusConfig.missed;
  const StatusIcon = st.icon;

  const feedUrl = `${API_BASE}/api/intercom/public/feed?serial=${selectedCameraSerial}&t=${Date.now()}&refresh=1`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-4 pb-10">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-white/20 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900 px-5 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <div className={`rounded-full p-1.5 ${st.bg}`}>
              <StatusIcon className={`h-4 w-4 ${st.color}`} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-none">Apartamento {call?.apartmentName}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{st.label}</p>
            </div>
          </div>
          <span className="text-[11px] text-slate-400">{colombiaTime(call?.startedAt).split(' ')[1] || ''}</span>
        </div>

        {/* View Switcher */}
        <div className="flex bg-slate-800 p-1 text-xs">
          <button
            onClick={() => setViewMode('visitor')}
            className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all ${
              viewMode === 'visitor' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Video className="h-3.5 w-3.5" />
            <span>Visitante (En vivo)</span>
          </button>
          <button
            onClick={() => setViewMode('ezviz')}
            className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all ${
              viewMode === 'ezviz' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            <span>Cámaras Ezviz (3)</span>
          </button>
        </div>

        {/* Ezviz Multi-Camera Sub-Tabs */}
        {viewMode === 'ezviz' && (
          <div className="flex bg-slate-900 px-2 py-1.5 gap-1.5 border-t border-slate-800">
            {BUILDING_CAMERAS.map(cam => (
              <button
                key={cam.serial}
                onClick={() => setSelectedCameraSerial(cam.serial)}
                className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-bold truncate transition-all ${
                  selectedCameraSerial === cam.serial
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {cam.name}
              </button>
            ))}
          </div>
        )}

        {/* Video / Camera View */}
        <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
          {viewMode === 'visitor' ? (
            <>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`h-full w-full object-cover ${!hasRemoteVideo ? 'hidden' : ''}`}
              />
              {!hasRemoteVideo && (
                <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
                  <Video className="h-10 w-10 mb-2 opacity-40 text-blue-400" />
                  <p className="text-sm font-semibold text-slate-200">Audio bidireccional activo</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-[220px]">
                    El visitante te está escuchando. Puedes cambiar a la pestaña "Cámaras Ezviz" para ver el exterior.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <img
                src={camFeeds[selectedCameraSerial] || `${API_BASE}/api/intercom/public/feed?serial=${selectedCameraSerial}`}
                alt="Vista de cámara Ezviz"
                className="h-full w-full object-cover"
                onError={e => { e.target.style.display = 'none'; }}
              />

              {/* PTZ Mini D-Pad Flotante para mover la cámara */}
              <div className="absolute bottom-2 right-2 flex flex-col items-center bg-black/75 backdrop-blur-md p-1.5 rounded-xl border border-white/20 z-10 select-none">
                <div className="grid grid-cols-3 gap-0.5 w-20 h-20 place-items-center">
                  <div />
                  <button
                    onClick={() => handleMovePtz('up')}
                    disabled={Boolean(ptzMoving)}
                    className="w-6 h-6 rounded bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition disabled:opacity-40"
                    title="Mover arriba"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <div />

                  <button
                    onClick={() => handleMovePtz('left')}
                    disabled={Boolean(ptzMoving)}
                    className="w-6 h-6 rounded bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition disabled:opacity-40"
                    title="Mover izquierda"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <div className="text-[8px] font-bold text-amber-400">
                    {ptzMoving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'PTZ'}
                  </div>
                  <button
                    onClick={() => handleMovePtz('right')}
                    disabled={Boolean(ptzMoving)}
                    className="w-6 h-6 rounded bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition disabled:opacity-40"
                    title="Mover derecha"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>

                  <div />
                  <button
                    onClick={() => handleMovePtz('down')}
                    disabled={Boolean(ptzMoving)}
                    className="w-6 h-6 rounded bg-white/20 hover:bg-blue-600 active:scale-90 text-white flex items-center justify-center transition disabled:opacity-40"
                    title="Mover abajo"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <div />
                </div>
                {ptzNotice && (
                  <p className="text-[8px] text-amber-300 text-center font-medium max-w-[80px] truncate animate-pulse">
                    {ptzNotice}
                  </p>
                )}
              </div>
            </>
          )}

          {/* 30s Live Countdown Overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white border border-white/10">
            {isLiveActive ? (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span>En vivo: {secondsLeft}s</span>
              </>
            ) : (
              <span className="text-amber-300">Pausado</span>
            )}
          </div>

          {/* Extend/Resume timer */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {isLiveActive ? (
              <button
                onClick={extendLiveTime}
                className="flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-md px-2 py-1 text-[11px] font-semibold text-white border border-white/10 hover:bg-black/80"
              >
                <Plus className="h-3 w-3" />
                30s
              </button>
            ) : (
              <button
                onClick={resumeLive}
                className="flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white shadow hover:bg-blue-700"
              >
                <Play className="h-3 w-3 fill-current" />
                Reanudar
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div
              className="h-full bg-emerald-500 transition-all duration-1000"
              style={{ width: `${(secondsLeft / 30) * 100}%` }}
            />
          </div>
        </div>

        {/* 2-Camera Live Strip below active feed when in Ezviz mode */}
        {viewMode === 'ezviz' && (
          <div className="bg-slate-900 px-3 py-2 border-b border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                <Eye className="h-3 w-3 text-blue-400" /> Otras Cámaras en Vivo (Toca para cambiar)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BUILDING_CAMERAS.filter(c => c.serial !== selectedCameraSerial).map(cam => (
                <button
                  key={cam.serial}
                  onClick={() => setSelectedCameraSerial(cam.serial)}
                  className="relative aspect-video rounded-lg overflow-hidden border border-slate-700 hover:border-amber-400 transition text-left group"
                >
                  <img
                    src={camFeeds[cam.serial] || `${API_BASE}/api/intercom/public/feed?serial=${cam.serial}`}
                    alt={cam.name}
                    className="h-full w-full object-cover group-hover:scale-105 transition"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />
                  <div className="absolute top-1 left-1 flex items-center gap-1 bg-black/60 px-1 py-0.5 rounded text-[8px] text-white">
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-ping" />
                    <span>{cam.name}</span>
                  </div>
                  <span className="absolute bottom-1 right-1 bg-blue-600 px-1 py-0.5 rounded text-[8px] font-bold text-white">
                    Ver
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Audio Enhancement Banner */}
        <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <Volume2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="truncate">
              {audioStatus === 'connected' ? 'Audio 2-vías activo • Volumen máximo DSP' : 'Conectando audio bidireccional...'}
            </span>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            +6.8dB EQ
          </span>
        </div>

        {/* Unlock Message */}
        {unlockMessage && (
          <div className="mx-4 mt-3 rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center text-xs font-semibold text-emerald-800">
            {unlockMessage}
          </div>
        )}

        {/* Action Controls */}
        <div className="p-4 space-y-3">
          {/* Audio Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
                isMuted
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              {isMuted ? <MicOff className="h-4 w-4 text-amber-600" /> : <Mic className="h-4 w-4 text-slate-700" />}
              <span>{isMuted ? 'Micrófono silenciado' : 'Hablar con visitante'}</span>
            </button>

            <button
              onClick={openEzvizApp}
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 active:scale-95 transition-all"
              title="Abrir altavoz exterior de la cámara física Ezviz"
            >
              <Radio className="h-4 w-4 text-indigo-600" />
              <span>Altavoz Ezviz</span>
            </button>
          </div>

          {/* Unlock Gate Button */}
          {call?.status === 'opened' ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-100 p-4 text-emerald-800 font-bold text-sm">
              <DoorOpen className="h-5 w-5 text-emerald-600" />
              <span>¡La puerta ha sido abierta!</span>
            </div>
          ) : (
            <button
              onClick={handleUnlock}
              disabled={busy !== ''}
              className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-emerald-600 py-4 text-base font-black text-white hover:bg-emerald-700 shadow-xl shadow-emerald-600/30 active:scale-98 transition-all disabled:opacity-50"
            >
              {busy === 'unlock' ? <Loader2 className="h-5 w-5 animate-spin" /> : <DoorOpen className="h-5 w-5" />}
              Abrir Puerta del Edificio
            </button>
          )}

          <p className="text-center text-[11px] text-slate-400 pt-1">
            Llamada iniciada el {colombiaTime(call?.startedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}
