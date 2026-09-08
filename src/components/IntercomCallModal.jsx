import { useState, useEffect, useRef } from 'react';
import { Phone, DoorOpen, X, Camera, Loader2, Mic, MicOff, Volume2, Video, RefreshCw, Radio, ExternalLink, Play, Plus } from 'lucide-react';
import { AUTH_TOKEN, getBase, getRawBase } from '../utils/config';
import { startIntercomCall } from '../utils/intercomAudio';
import { openEzvizApp } from '../utils/helpers';

async function intercomRequest(route, options = {}) {
  const response = await fetch(getBase() + route, {
    ...options,
    headers: { 'content-type': 'application/json', 'x-auth-token': AUTH_TOKEN, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Error');
  return payload;
}

export default function IntercomCallModal({ call, onClose, onAction }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [viewMode, setViewMode] = useState('visitor'); // 'visitor' | 'ezviz'
  const [imgKey, setImgKey] = useState(Date.now());
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [isLiveActive, setIsLiveActive] = useState(true);

  // Audio / WebRTC state
  const [audioStatus, setAudioStatus] = useState('connecting'); // 'connecting' | 'connected' | 'disconnected' | 'error'
  const [isMuted, setIsMuted] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const remoteVideoRef = useRef(null);
  const stopCallRef = useRef(null);
  const localStreamRef = useRef(null);

  // 30-second live countdown timer
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

  // Connect WebRTC audio/video intercom as tenant
  useEffect(() => {
    let cancelled = false;

    async function initCall() {
      try {
        setAudioStatus('connecting');
        const stop = await startIntercomCall(call.id, 'tenant', {
          enableVideo: false, // Tenant only sends audio for privacy
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
      } catch (err) {
        if (!cancelled) {
          console.warn('[Intercom] Tenant audio connect error:', err.message);
          setAudioStatus('error');
        }
      }
    }

    initCall();

    return () => {
      cancelled = true;
      if (stopCallRef.current) {
        stopCallRef.current();
        stopCallRef.current = null;
      }
    };
  }, [call.id]);

  // Refresh Ezviz snapshot rapidly (pseudo-stream ~1 fps) when in Ezviz tab
  useEffect(() => {
    if (viewMode !== 'ezviz' || !isLiveActive) return;
    const interval = setInterval(() => {
      setImgKey(Date.now());
    }, 1200);
    return () => clearInterval(interval);
  }, [viewMode, isLiveActive]);

  function toggleMute() {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      const nextMuted = !isMuted;
      audioTracks.forEach(t => { t.enabled = !nextMuted; });
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
    setMessage(null);
    try {
      const result = await intercomRequest('/intercom/unlock', {
        method: 'POST',
        body: JSON.stringify({ callId: call.id }),
      });
      setMessage({ type: 'success', text: result.message || '¡Puerta abierta exitosamente!' });
      if (onAction) onAction('opened');
      setTimeout(onClose, 3000);
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function handleIgnore() {
    setBusy('ignore');
    try {
      if (stopCallRef.current) stopCallRef.current();
      await intercomRequest('/intercom/ignore', {
        method: 'POST',
        body: JSON.stringify({ callId: call.id }),
      });
      if (onAction) onAction('ignored');
      onClose();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  const feedUrl = call.feedUrl
    ? `${getRawBase()}${call.feedUrl}?t=${imgKey}&refresh=1`
    : call.snapshotUrl
      ? `${getRawBase()}${call.snapshotUrl}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200 flex flex-col max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <div>
              <h3 className="text-sm font-bold leading-tight">Llamada del Portón</h3>
              <p className="text-[11px] text-slate-400">Apto {call.apartmentName} • {call.sourceDevice === 'whatsapp' ? 'WhatsApp' : 'Timbre QR'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* View Switcher Tabs */}
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
            <span>Cámara Portón (Ezviz)</span>
          </button>
        </div>

        {/* Video / Snapshot Display */}
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
                    El visitante no tiene cámara habilitada o puedes cambiar a la pestaña "Cámara Portón".
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {feedUrl ? (
                <img
                  key={imgKey}
                  src={feedUrl}
                  alt="Vista del portón"
                  className="h-full w-full object-cover"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400">
                  <Camera className="h-10 w-10 mb-2 opacity-50" />
                  <p className="text-sm">Sin imagen de Ezviz</p>
                </div>
              )}
            </>
          )}

          {/* 30s Live Countdown Timer Overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white border border-white/10">
            {isLiveActive ? (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span>En vivo: {secondsLeft}s</span>
              </>
            ) : (
              <span className="text-amber-300">Pausado (Ahorro datos)</span>
            )}
          </div>

          {/* Extend timer button */}
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {isLiveActive ? (
              <button
                onClick={extendLiveTime}
                className="flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-md px-2 py-1 text-[11px] font-semibold text-white border border-white/10 hover:bg-black/80"
                title="Extender 30 segundos más"
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

          {/* Live countdown progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div
              className="h-full bg-emerald-500 transition-all duration-1000"
              style={{ width: `${(secondsLeft / 30) * 100}%` }}
            />
          </div>
        </div>

        {/* Audio Enhancement Status Banner */}
        <div className="bg-slate-50 border-b border-slate-100 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-medium">
            <Volume2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="truncate">
              {audioStatus === 'connected' ? 'Audio 2-vías activo • Filtro de voz + Booster' : 'Conectando audio bidireccional...'}
            </span>
          </div>
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            +6.8dB DSP
          </span>
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`mx-4 mt-3 rounded-xl p-3 text-center text-xs font-semibold ${
            message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* Action Controls */}
        <div className="p-4 space-y-3">
          {/* Audio Controls Bar */}
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
              <span>{isMuted ? 'Micrófono silenciado' : 'Micrófono encendido'}</span>
            </button>

            {/* Direct button to open Ezviz native app speaker */}
            <button
              onClick={openEzvizApp}
              type="button"
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 active:scale-95 transition-all"
              title="Hablar por el altavoz exterior de la cámara física Ezviz"
            >
              <Radio className="h-4 w-4 text-indigo-600" />
              <span>Altavoz Ezviz</span>
            </button>
          </div>

          {/* Main Actions: Ignore & Unlock */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleIgnore}
              disabled={busy !== ''}
              className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3.5 text-sm font-bold text-slate-600 hover:bg-slate-50 active:scale-98 transition-all disabled:opacity-50"
            >
              {busy === 'ignore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Ignorar
            </button>
            <button
              onClick={handleUnlock}
              disabled={busy !== ''}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-sm font-black text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/30 active:scale-98 transition-all disabled:opacity-50"
            >
              {busy === 'unlock' ? <Loader2 className="h-5 w-5 animate-spin" /> : <DoorOpen className="h-5 w-5" />}
              Abrir Puerta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
