import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Volume2, VolumeX, LockKeyhole, Video, ShieldAlert, Radio, Smartphone, AlertCircle } from 'lucide-react';
import { getRawBase } from '../utils/config';
import { getAuth } from '../utils/auth';
import { startCameraTalkback } from '../utils/intercomAudio';

export default function CameraIntercom({
  activeSerial = 'BG6994814',
  onCameraSelect,
  isAudioUnmuted = false,
  onToggleAudioUnmute,
  compact = false,
}) {
  const [targetSerial, setTargetSerial] = useState(activeSerial);
  const [talkbackActive, setTalkbackActive] = useState(false);
  const [talkbackStatus, setTalkbackStatus] = useState('idle');
  const [micLevel, setMicLevel] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Estado del Candado de Canal (Un solo apartamento a la vez)
  const [channelLock, setChannelLock] = useState({ isLocked: false, lock: null });
  const [lockCountdown, setLockCountdown] = useState(60);
  const talkbackControllerRef = useRef(null);
  const lockTimerRef = useRef(null);

  // Sincronizar targetSerial si cambia desde fuera
  useEffect(() => {
    if (activeSerial && (activeSerial === 'BG6994814' || activeSerial === 'BG6994872')) {
      setTargetSerial(activeSerial);
    }
  }, [activeSerial]);

  // Consultar estado del candado de canal
  const checkChannelLock = useCallback(async () => {
    try {
      const res = await fetch(`${getRawBase()}/api/intercom/lock`);
      if (res.ok) {
        const data = await res.json();
        setChannelLock(data);
      }
    } catch {}
  }, []);

  // Polling del candado cada 3 segundos
  useEffect(() => {
    checkChannelLock();
    const interval = setInterval(checkChannelLock, 3000);
    return () => clearInterval(interval);
  }, [checkChannelLock]);

  // Manejar cambio de cámara seleccionada
  const handleSelectCamera = (serial) => {
    setTargetSerial(serial);
    if (onCameraSelect) onCameraSelect(serial);
  };

  // Reclamar candado e iniciar audio
  const handleStartTalkback = async () => {
    const auth = getAuth();
    const aptName = auth?.apartmentName || auth?.apartmentNumber || (auth?.role === 'admin' ? 'Administración' : 'Residente');
    const uName = auth?.name || 'Usuario';
    const cameraLabel = targetSerial === 'BG6994872' ? 'Terraza Exterior' : 'Reja de Entrada';

    try {
      // 1. Adquirir candado exclusivo en el servidor
      const lockRes = await fetch(`${getRawBase()}/api/intercom/lock/acquire`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': auth?.token || '',
        },
        body: JSON.stringify({
          apartmentName: aptName,
          userName: uName,
          role: auth?.role || 'tenant',
          targetCamera: targetSerial,
          cameraName: cameraLabel,
        }),
      });

      if (!lockRes.ok) {
        const lockData = await lockRes.json().catch(() => ({}));
        if (lockRes.status === 409) {
          alert(`⚠️ Canal ocupado por: ${lockData?.lock?.apartmentName || 'otro apartamento'}. Por favor espera unos segundos.`);
          checkChannelLock();
          return;
        }
        throw new Error(lockData.error || 'Error adquiriendo canal');
      }

      // 2. Iniciar captura y procesamiento de audio
      setTalkbackActive(true);
      setTalkbackStatus('connecting');
      setLockCountdown(60);

      // Desmutear audio exterior para escuchar la respuesta
      if (onToggleAudioUnmute && !isAudioUnmuted) {
        onToggleAudioUnmute(true);
      }

      const stopFn = await startCameraTalkback(targetSerial, {
        onStatusChange: (status) => setTalkbackStatus(status),
        onAudioLevel: (level) => setMicLevel(level),
      });
      talkbackControllerRef.current = stopFn;

      // Temporizador visual de 60 segundos
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      lockTimerRef.current = setInterval(() => {
        setLockCountdown((prev) => {
          if (prev <= 1) {
            handleStopTalkback();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err) {
      console.error('[Intercom] Error al iniciar:', err);
      setTalkbackActive(false);
      setTalkbackStatus('error');
      alert('No se pudo acceder al micrófono: ' + (err.message || 'Verifica permisos del navegador'));
      // Liberar candado en caso de error
      try {
        await fetch(`${getRawBase()}/api/intercom/lock/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {}
    }
  };

  // Detener comunicación y liberar candado
  const handleStopTalkback = async () => {
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
      lockTimerRef.current = null;
    }

    if (talkbackControllerRef.current) {
      try { talkbackControllerRef.current(); } catch {}
      talkbackControllerRef.current = null;
    }

    setTalkbackActive(false);
    setTalkbackStatus('idle');
    setMicLevel(0);

    // Liberar candado en servidor
    try {
      const auth = getAuth();
      await fetch(`${getRawBase()}/api/intercom/lock/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': auth?.token || '',
        },
      });
      checkChannelLock();
    } catch {}
  };

  // Limpieza al desmontar
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      if (talkbackControllerRef.current) {
        try { talkbackControllerRef.current(); } catch {}
      }
    };
  }, []);

  const isChannelBusyByOther = channelLock.isLocked && !talkbackActive;
  const busyApartment = channelLock?.lock?.apartmentName || 'Otro Apartamento';
  const busyRemaining = channelLock?.lock?.remainingSeconds || 0;

  // Acceso directo a la app EZVIZ (para Android / Celulares)
  const handleOpenEzvizApp = () => {
    const isAndroid = /android/i.test(navigator.userAgent || '');
    if (isAndroid) {
      window.location.href = 'intent:#Intent;package=com.ezviz;end';
    } else {
      window.location.href = 'ezviz://';
    }
    setTimeout(() => {
      // Si no abre, dar opción
      alert('Si tienes instalada la app EZVIZ en este teléfono, puedes hablar directamente con audio nativo pulsando el botón de micrófono en ella.');
    }, 1200);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {!talkbackActive ? (
          <button
            type="button"
            onClick={handleStartTalkback}
            disabled={isChannelBusyByOther}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-black shadow-sm transition active:scale-95 ${
              isChannelBusyByOther
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-300 dark:border-slate-700'
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white animate-pulse'
            }`}
            title={isChannelBusyByOther ? `Ocupado por ${busyApartment}` : 'Hablar por el altavoz de la cámara'}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>{isChannelBusyByOther ? `Ocupado (${busyApartment})` : 'Hable aquí'}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopTalkback}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 text-xs font-black shadow-sm transition active:scale-95 animate-pulse"
          >
            <MicOff className="h-3.5 w-3.5" />
            <span>Detener ({lockCountdown}s)</span>
          </button>
        )}

        {onToggleAudioUnmute && (
          <button
            type="button"
            onClick={() => onToggleAudioUnmute(!isAudioUnmuted)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition active:scale-95 ${
              isAudioUnmuted
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300'
            }`}
          >
            {isAudioUnmuted ? <Volume2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> : <VolumeX className="h-3.5 w-3.5 text-slate-500" />}
            <span>{isAudioUnmuted ? 'Escuchando' : 'Escuchar'}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-3xl border-2 border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 p-4 text-white shadow-xl space-y-3.5">
      {/* Cabecera del Intercomunicador */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="rounded-2xl bg-blue-600/30 p-2.5 text-blue-400 border border-blue-400/30 shadow-inner">
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
                Intercomunicador de Audio en Vivo
              </h2>
              {isChannelBusyByOther ? (
                <span className="rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 px-2 py-0.5 text-[10px] font-bold animate-pulse">
                  OCUPADO POR {busyApartment.toUpperCase()}
                </span>
              ) : talkbackActive ? (
                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 px-2 py-0.5 text-[10px] font-bold animate-pulse">
                  HABLANDO EN VIVO
                </span>
              ) : (
                <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                  CANAL LIBRE
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300">
              {isChannelBusyByOther
                ? `El canal de audio está siendo usado por ${busyApartment} (quedan ~${busyRemaining}s)`
                : 'Habla y escucha con quien esté afuera. Solo un apartamento puede hablar a la vez.'}
            </p>
          </div>
        </div>

        {/* Botón de Audio Exterior (Escuchar en tiempo real) */}
        {onToggleAudioUnmute && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleAudioUnmute(!isAudioUnmuted)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition border ${
                isAudioUnmuted
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-white/10 hover:bg-white/15 text-slate-300 border-white/10'
              }`}
            >
              {isAudioUnmuted ? <Volume2 className="h-4 w-4 text-amber-300" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
              <span>{isAudioUnmuted ? 'Audio Exterior Activo' : 'Audio Silenciado'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Selector de Destino: Reja de Entrada vs Terraza Exterior */}
      <div className="grid grid-cols-2 gap-2 bg-slate-950/70 p-1 rounded-2xl border border-white/10">
        <button
          type="button"
          onClick={() => handleSelectCamera('BG6994814')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all ${
            targetSerial === 'BG6994814'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <LockKeyhole className="h-4 w-4" />
          <span>🚪 Reja de Entrada (Portón)</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectCamera('BG6994872')}
          className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all ${
            targetSerial === 'BG6994872'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Video className="h-4 w-4" />
          <span>🌿 Terraza Exterior (Cámara Izquierda)</span>
        </button>
      </div>

      {/* Botón Principal "Hable aquí" */}
      {!talkbackActive ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleStartTalkback}
            disabled={isChannelBusyByOther}
            className={`w-full flex items-center justify-center gap-3 rounded-2xl py-3.5 px-4 text-sm font-black transition-all ${
              isChannelBusyByOther
                ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700'
                : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 text-white shadow-lg shadow-emerald-600/30 hover:shadow-emerald-600/40 active:scale-[0.99]'
            }`}
          >
            <Mic className={`h-5 w-5 ${isChannelBusyByOther ? 'text-slate-500' : 'animate-pulse text-white'}`} />
            <span className="text-base tracking-wide uppercase font-black">
              {isChannelBusyByOther ? `En uso por: ${busyApartment}` : 'Hable aquí'}
            </span>
            <span className="text-xs font-medium opacity-90 hidden sm:inline">
              {isChannelBusyByOther
                ? `(Espera ${busyRemaining}s)`
                : `(Hacia ${targetSerial === 'BG6994872' ? 'Terraza Exterior' : 'Reja de Entrada'})`}
            </span>
          </button>

          {/* Opción rápida: Abrir app EZVIZ nativa si se desea audio directo */}
          <div className="flex items-center justify-between text-[11px] px-1 text-slate-400">
            <span>Audio protegido por candado exclusivo</span>
            <button
              type="button"
              onClick={handleOpenEzvizApp}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline font-medium"
            >
              <Smartphone className="h-3 w-3" />
              <span>Abrir App EZVIZ oficial</span>
            </button>
          </div>
        </div>
      ) : (
        /* Modo Activo: Hablando */
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-4 space-y-3 animate-in fade-in duration-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                Hablando hacia {targetSerial === 'BG6994872' ? 'Terraza Exterior (Izq)' : 'Reja de Entrada'}
              </span>
            </div>

            {/* Temporizador de liberación automática */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-300">Tiempo restante:</span>
              <span className="px-2 py-0.5 rounded-lg bg-emerald-900/60 font-mono text-xs font-black text-emerald-200 border border-emerald-500/30">
                {lockCountdown}s
              </span>
            </div>
          </div>

          {/* Medidor de nivel de voz */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-300">Nivel Mic:</span>
            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500 transition-all duration-75"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>

          {/* Onda visual ecualizadora */}
          <div className="flex items-center justify-center gap-1.5 py-1">
            {[40, 75, 100, 60, 90, 45, 80, 100, 70, 50, 85, 30].map((h, i) => (
              <div
                key={i}
                className="w-1.5 rounded-full bg-emerald-400/80 transition-all duration-150"
                style={{
                  height: `${Math.max(6, (h * micLevel) / 100)}px`,
                }}
              />
            ))}
          </div>

          {/* Botón de Terminar Comunicación */}
          <div className="flex items-center justify-between pt-1 border-t border-emerald-500/20">
            <p className="text-[11px] text-emerald-200/80">
              Los demás apartamentos ven el canal ocupado hasta que finalices.
            </p>
            <button
              type="button"
              onClick={handleStopTalkback}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-500 text-white shadow-md transition active:scale-95"
            >
              <MicOff className="h-4 w-4" />
              <span>Finalizar Comunicación</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
