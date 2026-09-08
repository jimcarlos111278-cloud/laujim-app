import { useEffect, useState, useRef } from 'react';
import { Building2, Phone, CheckCircle2, Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, DoorOpen, Volume2 } from 'lucide-react';
import { startIntercomCall } from '../utils/intercomAudio';

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

function playDoorChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch {}
}

export default function IntercomDoorbell() {
  const [apartments, setApartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [calling, setCalling] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [callStatus, setCallStatus] = useState('ringing'); // 'ringing' | 'connected' | 'opened' | 'missed'
  const [mediaStatus, setMediaStatus] = useState('idle');
  const [hasVideo, setHasVideo] = useState(false);
  const [error, setError] = useState('');

  const localVideoRef = useRef(null);
  const stopCallRef = useRef(null);

  // Load apartment directory
  useEffect(() => {
    publicRequest('/intercom/public/apartments')
      .then(data => setApartments(data.apartments || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Poll call state (opened, missed, etc.)
  useEffect(() => {
    if (!activeCall?.callId || callStatus === 'opened' || callStatus === 'missed') return;

    const timer = setInterval(async () => {
      try {
        const info = await publicRequest(`/intercom/public/call/${activeCall.callId}`);
        if (info.status === 'opened') {
          setCallStatus('opened');
          playDoorChime();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        } else if (info.status === 'missed' || info.status === 'ignored') {
          setCallStatus('missed');
        }
      } catch {}
    }, 2000);

    return () => clearInterval(timer);
  }, [activeCall?.callId, callStatus]);

  // Clean up media call when unmounting
  useEffect(() => {
    return () => {
      if (stopCallRef.current) stopCallRef.current();
    };
  }, []);

  async function callApartment(name) {
    setCalling(name);
    setError('');
    try {
      const result = await publicRequest('/intercom/public/call', {
        method: 'POST',
        body: JSON.stringify({ apartmentCode: name }),
      });

      const callInfo = { name, message: result.message, callId: result.callId, token: result.token };
      setActiveCall(callInfo);
      setCallStatus('ringing');

      // Start WebRTC audio + video call as visitor
      try {
        const stop = await startIntercomCall(result.callId, 'visitor', {
          enableVideo: true,
          onStatusChange: (status) => {
            setMediaStatus(status);
            if (status === 'connected') setCallStatus('connected');
          },
          onLocalStream: (stream) => {
            const hasVid = stream.getVideoTracks().length > 0;
            setHasVideo(hasVid);
            if (localVideoRef.current && hasVid) {
              localVideoRef.current.srcObject = stream;
            }
          },
        });
        stopCallRef.current = stop;
      } catch (mediaErr) {
        console.warn('[Intercom] Media setup warning:', mediaErr.message);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCalling(null);
    }
  }

  function handleEndCall() {
    if (stopCallRef.current) {
      stopCallRef.current();
      stopCallRef.current = null;
    }
    setActiveCall(null);
    setCallStatus('ringing');
    setMediaStatus('idle');
    setHasVideo(false);
  }

  // Group apartments by floor
  const floors = {};
  apartments.forEach(a => {
    const floor = a.floor || String(a.name).charAt(0);
    if (!floors[floor]) floors[floor] = [];
    floors[floor].push(a);
  });
  const sortedFloors = Object.keys(floors).sort((a, b) => Number(a) - Number(b));

  // Active call screen
  if (activeCall) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl bg-white/95 backdrop-blur-md p-6 text-center shadow-2xl border border-white/20">
          {/* Header Status */}
          {callStatus === 'opened' ? (
            <div className="animate-in zoom-in-90 duration-300">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
                <DoorOpen className="h-10 w-10 animate-pulse" />
              </div>
              <h2 className="text-2xl font-black text-slate-900">¡Puerta Abierta!</h2>
              <p className="mt-2 text-sm font-medium text-emerald-700 bg-emerald-50 rounded-xl py-2 px-3 border border-emerald-200">
                El residente del Apto {activeCall.name} ha abierto el portón. Puedes ingresar.
              </p>
            </div>
          ) : callStatus === 'missed' ? (
            <div>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <PhoneOff className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">Sin respuesta</h2>
              <p className="mt-2 text-sm text-slate-600">El residente no está disponible en este momento.</p>
            </div>
          ) : (
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 mb-3">
                <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
                {mediaStatus === 'connected' ? 'En llamada con residente' : 'Llamando...'}
              </div>
              <h2 className="text-xl font-black text-slate-900">Apartamento {activeCall.name}</h2>
              <p className="mt-1 text-xs text-slate-500">Por favor espera frente al portón</p>
            </div>
          )}

          {/* Visitor Camera Preview (Selfie video transmitted to tenant) */}
          {callStatus !== 'opened' && callStatus !== 'missed' && (
            <div className="mt-4 relative aspect-video rounded-2xl overflow-hidden bg-slate-900 border border-slate-700 shadow-md">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full object-cover transform -scale-x-100 ${!hasVideo ? 'hidden' : ''}`}
              />
              {!hasVideo && (
                <div className="flex flex-col h-full items-center justify-center text-slate-400 p-4">
                  <VideoOff className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-xs">Cámara no disponible</p>
                  <p className="text-[11px] text-slate-500 mt-1">El audio bidireccional sigue activo</p>
                </div>
              )}
              <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-sm px-2 py-1 text-[11px] font-medium text-white">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                Tu cámara en vivo
              </div>
              <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] text-emerald-400">
                <Mic className="h-3 w-3" />
                Micrófono activo
              </div>
            </div>
          )}

          {/* Audio volume badge for visitor */}
          {callStatus !== 'opened' && callStatus !== 'missed' && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-2 px-3 text-xs text-slate-600">
              <Volume2 className="h-4 w-4 text-blue-600" />
              <span>Sube el volumen de tu teléfono para escuchar al residente</span>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={handleEndCall}
              className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
                callStatus === 'opened'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/30'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {callStatus === 'opened' ? 'Listo / Finalizar' : 'Llamar a otro apartamento'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-800 p-4 pb-12">
      <div className="mx-auto max-w-sm">
        <div className="mb-6 pt-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Edificio Laujim</h1>
          <p className="mt-1 text-sm text-slate-300">Videoportero Inteligente</p>
          <p className="text-xs text-slate-400 mt-0.5">Toca tu apartamento para timbrar</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-center text-sm text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {sortedFloors.map(floor => (
              <div key={floor}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Piso {floor}</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {floors[floor].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(apt => (
                    <button
                      key={apt.name}
                      onClick={() => callApartment(apt.name)}
                      disabled={calling !== null}
                      className="group relative flex flex-col items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15 px-4 py-5 text-white transition-all hover:bg-blue-600 hover:border-blue-500 hover:scale-105 active:scale-95 disabled:opacity-50 shadow-md"
                    >
                      {calling === apt.name ? (
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      ) : (
                        <>
                          <Phone className="mb-1.5 h-6 w-6 text-slate-300 group-hover:text-white transition-colors" />
                          <span className="text-lg font-black">{apt.name}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-xs text-slate-500">
          Edificio Laujim • Sistema de Videoportero y Control de Acceso
        </p>
      </div>
    </div>
  );
}
