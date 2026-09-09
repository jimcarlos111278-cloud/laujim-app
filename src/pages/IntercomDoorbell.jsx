import { useEffect, useState, useRef } from 'react';
import { Building2, Phone, CheckCircle2, Loader2, Mic, MicOff, Video, VideoOff, PhoneOff, DoorOpen, Volume2, ShieldCheck, Hash, Delete, X } from 'lucide-react';
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
  const [selectedApt, setSelectedApt] = useState(null);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dialValue, setDialValue] = useState('');

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

  async function callApartment(name, withVideo = true) {
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
          enableVideo: withVideo,
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

  function handleDigitPress(digit) {
    if (dialValue.length < 5) {
      setDialValue(prev => prev + digit);
      playTone(700 + digit.charCodeAt(0) * 15, 0.08);
    }
  }

  function handleKeypadCall() {
    if (!dialValue.trim()) return;
    const targetApt = dialValue.trim();
    setShowKeypad(false);
    setSelectedApt(targetApt);
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
    <div className="min-h-screen bg-[#07090E] text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-x-hidden selection:bg-amber-500 selection:text-black font-sans">
      {/* Ambient Lighting Orbs */}
      <div className="fixed top-[-120px] left-1/2 -translate-x-1/2 w-[480px] h-[480px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-100px] right-5 w-80 h-80 bg-blue-600/15 rounded-full blur-[130px] pointer-events-none" />

      <div className="w-full max-w-sm flex flex-col gap-4 relative z-10">

        {/* Brand Header — Obsidian Glass Style */}
        <div className="text-center pt-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0D1117]/90 border border-amber-400/30 text-amber-300 text-xs font-bold shadow-lg shadow-amber-500/5 mb-3 backdrop-blur-xl">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="tracking-widest uppercase text-[10px]">Videoportero Digital • 3 Cámaras en Vivo</span>
          </div>
          <h1 className="text-3xl font-black tracking-wider uppercase text-white font-serif">
            EDIFICIO <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-500 bg-clip-text text-transparent">LAUJIM</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">Control de Acceso y Comunicación Inteligente</p>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-3 text-center text-xs font-semibold text-red-300 backdrop-blur-md">
            {error}
          </div>
        )}

        {/* MAIN LUXURY OBSIDIAN CARD */}
        <div className="bg-[#0D1117]/85 backdrop-blur-2xl border border-amber-400/20 rounded-3xl p-5 sm:p-6 shadow-2xl shadow-black relative overflow-hidden transition-all duration-500">
          
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
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Directorio de Residentes</span>
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Seguro
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
                    <div className="flex gap-1.5 p-1.5 bg-black/50 rounded-2xl border border-white/5 overflow-x-auto">
                      {sortedFloors.map(floor => (
                        <button
                          key={floor}
                          onClick={() => setActiveFloor(floor)}
                          className={`flex-1 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
                            activeFloor === floor
                              ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-lg shadow-amber-500/20'
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
                        onClick={() => setSelectedApt(apt.name)}
                        disabled={calling !== null}
                        className="group p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-amber-400/70 hover:bg-amber-500/10 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 shadow-lg shadow-black/40 disabled:opacity-50"
                      >
                        {calling === apt.name ? (
                          <Loader2 className="h-5 w-5 animate-spin text-amber-400 my-1.5" />
                        ) : (
                          <>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-amber-300">Apto</span>
                            <span className="text-xl font-black text-white group-hover:text-amber-300 transition-colors">{apt.name}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Keypad Quick Toggle Banner */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-3 flex items-center justify-between text-xs mt-2">
                    <div className="flex items-center gap-2.5 text-slate-300">
                      <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
                        <Hash className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-bold text-white leading-tight">¿Marcación Directa?</p>
                        <p className="text-[10px] text-slate-400">Digita el número en el teclado</p>
                      </div>
                    </div>
                    <button
                      onClick={() => { setDialValue(''); setShowKeypad(true); }}
                      className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[11px] border border-amber-400/30 active:scale-95 transition"
                    >
                      Teclado
                    </button>
                  </div>

                  <p className="pt-1 text-center text-[11px] text-slate-500">
                    Toca un apartamento para iniciar comunicación con el residente
                  </p>
                </>
              )}
            </div>
          )}

        </div>

        {/* Security & Multi-Camera Footer */}
        <div className="flex items-center justify-between px-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            3 Cámaras Ezviz Protegidas
          </span>
          <span>Laujim Security OS</span>
        </div>

      </div>

      {/* MODAL 1: SELECCIÓN DE LLAMADA (VIDEO Y VOZ O SOLO VOZ) */}
      {selectedApt && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-[#0D1117] border border-amber-400/40 p-6 text-center shadow-2xl shadow-black space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center mx-auto text-amber-400 shadow-lg shadow-amber-500/10">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Timbre Videoportero</span>
              <h3 className="text-2xl font-black text-white mt-0.5 font-serif">Apartamento {selectedApt}</h3>
              <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                Para que el residente te reconozca rápidamente y te abra el portón, ¿cómo deseas comunicarte?
              </p>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                onClick={() => {
                  const apt = selectedApt;
                  setSelectedApt(null);
                  callApartment(apt, true);
                }}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition-all"
              >
                <Video className="w-4 h-4" />
                <span>Llamar con Video y Voz</span>
                <span className="text-[9px] bg-slate-950/25 px-1.5 py-0.5 rounded font-bold ml-1">Recomendado</span>
              </button>

              <button
                onClick={() => {
                  const apt = selectedApt;
                  setSelectedApt(null);
                  callApartment(apt, false);
                }}
                className="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 border border-white/10 text-slate-300 font-bold text-xs flex items-center justify-center gap-2 transition-all"
              >
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>Llamar solo con Voz</span>
              </button>

              <button
                onClick={() => setSelectedApt(null)}
                className="w-full py-2 text-slate-500 hover:text-slate-400 font-semibold text-xs transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: NUMERIC KEYPAD MODAL (MARCACIÓN RÁPIDA) */}
      {showKeypad && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-3xl bg-[#0D1117] border border-amber-400/30 p-5 text-center shadow-2xl shadow-black space-y-3 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-1 border-b border-white/10">
              <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">Teclado Numérico</span>
              <button
                onClick={() => setShowKeypad(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Display Screen */}
            <div className="bg-black/70 border border-white/10 rounded-2xl p-3 shadow-inner">
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Apartamento a marcar</p>
              <div className="text-3xl font-mono font-black text-white tracking-widest min-h-[38px] flex items-center justify-center">
                {dialValue || <span className="text-slate-600">___</span>}
              </div>
            </div>

            {/* Dialpad 3x4 */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button
                  key={d}
                  onClick={() => handleDigitPress(d)}
                  className="py-3.5 rounded-xl bg-white/[0.06] border border-white/10 text-lg font-mono font-bold text-white hover:bg-amber-500/20 active:bg-amber-500 active:text-black transition-colors"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={() => setDialValue(prev => prev.slice(0, -1))}
                className="py-3 rounded-xl bg-red-950/30 border border-red-500/20 text-red-400 flex items-center justify-center active:scale-95 transition-all"
                title="Borrar dígito"
              >
                <Delete className="h-5 w-5" />
              </button>
              <button
                onClick={() => handleDigitPress('0')}
                className="py-3.5 rounded-xl bg-white/[0.06] border border-white/10 text-lg font-mono font-bold text-white hover:bg-amber-500/20 active:bg-amber-500 active:text-black transition-colors"
              >
                0
              </button>
              <button
                onClick={handleKeypadCall}
                disabled={!dialValue}
                className="py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider disabled:opacity-30 active:scale-95 transition-all shadow-lg shadow-amber-500/20"
              >
                Llamar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
