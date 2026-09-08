import { useEffect, useState, useRef } from 'react';
import { Building2, Phone, CheckCircle2, Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, DoorOpen, Volume2, ShieldCheck } from 'lucide-react';
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

function playTone(freq, duration = 0.4) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
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
  const [activeFloor, setActiveFloor] = useState('1');

  const localVideoRef = useRef(null);
  const stopCallRef = useRef(null);
  const ringAudioTimerRef = useRef(null);

  // Load apartment directory
  useEffect(() => {
    publicRequest('/intercom/public/apartments')
      .then(data => {
        const apts = data.apartments || [];
        setApartments(apts);
        if (apts.length > 0) {
          const firstFloor = apts[0].floor || String(apts[0].name).charAt(0);
          setActiveFloor(String(firstFloor));
        }
      })
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
          if (ringAudioTimerRef.current) clearInterval(ringAudioTimerRef.current);
          playDoorChime();
          if (navigator.vibrate) navigator.vibrate([250, 100, 250, 100, 400]);
        } else if (info.status === 'missed' || info.status === 'ignored') {
          setCallStatus('missed');
          if (ringAudioTimerRef.current) clearInterval(ringAudioTimerRef.current);
        }
      } catch {}
    }, 2000);

    return () => clearInterval(timer);
  }, [activeCall?.callId, callStatus]);

  // Clean up media call when unmounting
  useEffect(() => {
    return () => {
      if (stopCallRef.current) stopCallRef.current();
      if (ringAudioTimerRef.current) clearInterval(ringAudioTimerRef.current);
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

      // Play pleasant initial calling tone
      playTone(600, 0.3);
      ringAudioTimerRef.current = setInterval(() => {
        playTone(659.25, 0.35);
      }, 3500);

      // Start WebRTC audio + video call as visitor
      try {
        const stop = await startIntercomCall(result.callId, 'visitor', {
          enableVideo: true,
          onStatusChange: (status) => {
            setMediaStatus(status);
            if (status === 'connected') {
              setCallStatus('connected');
              if (ringAudioTimerRef.current) clearInterval(ringAudioTimerRef.current);
            }
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
    if (ringAudioTimerRef.current) clearInterval(ringAudioTimerRef.current);
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
    const floor = String(a.floor || String(a.name).charAt(0));
    if (!floors[floor]) floors[floor] = [];
    floors[floor].push(a);
  });
  const sortedFloors = Object.keys(floors).sort((a, b) => Number(a) - Number(b));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-x-hidden selection:bg-amber-500 selection:text-black font-sans">
      {/* Ambient Lighting Orbs */}
      <div className="fixed top-[-100px] left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-100px] right-10 w-96 h-96 bg-amber-500/15 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-sm flex flex-col gap-4 relative z-10">

        {/* Brand Header */}
        <div className="text-center pt-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900/80 border border-amber-500/30 text-amber-300 text-xs font-semibold shadow-lg shadow-amber-500/5 mb-3 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="tracking-widest uppercase text-[10px]">Videoportero Digital</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white">
            EDIFICIO <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500 bg-clip-text text-transparent">LAUJIM</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">Control de Acceso y Comunicación Inteligente</p>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-3 text-center text-xs font-semibold text-red-300 backdrop-blur-md">
            {error}
          </div>
        )}

        {/* MAIN LUXURY CARD */}
        <div className="bg-slate-900/75 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl shadow-black/80 relative overflow-hidden transition-all duration-500">
          
          {/* STATE A: CALLING / CONNECTED / OPENED */}
          {activeCall ? (
            <div className="flex flex-col items-center text-center space-y-4 py-2 animate-in fade-in zoom-in-95 duration-300">
              
              {callStatus === 'opened' ? (
                /* Unlocked State */
                <div className="space-y-4 py-4 animate-in zoom-in-95 duration-300">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-400 shadow-xl shadow-emerald-500/30">
                    <DoorOpen className="w-10 h-10 animate-bounce" />
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Acceso Autorizado</span>
                    <h2 className="text-3xl font-black text-white mt-1">¡PUERTA ABIERTA!</h2>
                    <p className="text-xs font-medium text-slate-300 mt-2">
                      El residente del Apto {activeCall.name} ha abierto el portón. Puedes empujar la puerta para entrar.
                    </p>
                  </div>
                  <button
                    onClick={handleEndCall}
                    className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs tracking-wider uppercase transition-all shadow-lg shadow-emerald-600/30 mt-2"
                  >
                    Finalizar
                  </button>
                </div>
              ) : callStatus === 'missed' ? (
                /* Missed / Ignored State */
                <div className="space-y-3 py-4">
                  <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-400/30 flex items-center justify-center mx-auto text-amber-400">
                    <PhoneOff className="w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Sin respuesta</h2>
                  <p className="text-xs text-slate-400">El residente no está disponible en este momento.</p>
                  <button
                    onClick={handleEndCall}
                    className="w-full py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-colors mt-2"
                  >
                    Llamar a otro apartamento
                  </button>
                </div>
              ) : (
                /* Ringing / Connected State */
                <>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-blue-300 text-xs font-bold">
                    <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></span>
                    <span>{mediaStatus === 'connected' ? 'En llamada con residente' : 'Timbrando al apartamento...'}</span>
                  </div>

                  {/* Circular Video Ring with Preview */}
                  <div className="relative w-36 h-36 mx-auto my-2 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-2 border-amber-400/40 animate-ping opacity-30"></div>
                    <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-amber-400 shadow-2xl relative bg-slate-900 flex items-center justify-center">
                      <video
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className={`h-full w-full object-cover transform -scale-x-100 ${!hasVideo ? 'hidden' : ''}`}
                      />
                      {!hasVideo && (
                        <div className="flex flex-col items-center justify-center text-slate-400 p-2">
                          <VideoOff className="h-6 w-6 mb-1 opacity-50" />
                          <span className="text-[10px]">Audio activo</span>
                        </div>
                      )}
                      <div className="absolute bottom-1 bg-black/75 px-2 py-0.5 rounded-full text-[9px] font-bold text-amber-300 backdrop-blur-sm">
                        EN VIVO
                      </div>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-2xl font-black text-white tracking-tight">Apartamento {activeCall.name}</h2>
                    <p className="text-xs text-slate-400 mt-0.5">El residente está viendo y escuchando</p>
                  </div>

                  {/* Audio Waves */}
                  <div className="flex items-center justify-center gap-1.5 h-6 my-1">
                    <span className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse"></span>
                    <span className="w-1 h-5 bg-emerald-400 rounded-full animate-pulse delay-75"></span>
                    <span className="w-1 h-6 bg-emerald-400 rounded-full animate-pulse delay-150"></span>
                    <span className="w-1 h-4 bg-emerald-400 rounded-full animate-pulse delay-100"></span>
                    <span className="w-1 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 py-1.5 px-3 rounded-xl border border-white/5 w-full">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <span>Sube el volumen para escuchar al residente</span>
                  </div>

                  <button
                    onClick={handleEndCall}
                    className="w-full py-3 px-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-colors"
                  >
                    Cancelar llamada
                  </button>
                </>
              )}
            </div>
          ) : (
            /* STATE B: APARTMENT SELECTOR */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Selecciona el Apto</span>
                <span className="text-[11px] text-amber-400/80 font-semibold flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> Acceso seguro
                </span>
              </div>

              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                </div>
              ) : (
                <>
                  {/* Floor Tabs */}
                  {sortedFloors.length > 1 && (
                    <div className="flex gap-1.5 p-1 bg-slate-900/80 rounded-xl border border-white/5 overflow-x-auto">
                      {sortedFloors.map(floor => (
                        <button
                          key={floor}
                          onClick={() => setActiveFloor(floor)}
                          className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                            activeFloor === floor
                              ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Piso {floor}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Apartment Grid for Active Floor */}
                  <div className="grid grid-cols-3 gap-2.5 pt-1">
                    {(floors[activeFloor] || []).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(apt => (
                      <button
                        key={apt.name}
                        onClick={() => callApartment(apt.name)}
                        disabled={calling !== null}
                        className="group p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-amber-400/60 hover:bg-amber-500/10 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {calling === apt.name ? (
                          <Loader2 className="h-5 w-5 animate-spin text-amber-400 my-1.5" />
                        ) : (
                          <>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 group-hover:text-amber-300">Apto</span>
                            <span className="text-xl font-black text-white group-hover:text-amber-300 transition-colors">{apt.name}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>

                  <p className="pt-2 text-center text-[11px] text-slate-500">
                    Al tocar, se conectará el video y audio con el residente
                  </p>
                </>
              )}
            </div>
          )}

        </div>

        {/* Security & Device Footer */}
        <div className="flex items-center justify-between px-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            Cámara Ezviz H8c Activa
          </span>
          <span>Laujim Security OS</span>
        </div>

      </div>
    </div>
  );
}
