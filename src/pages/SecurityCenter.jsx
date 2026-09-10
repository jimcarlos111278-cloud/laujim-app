import { useEffect, useState, useRef } from 'react';
import {
  Camera, Wifi, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, LockKeyhole,
  Activity, Radio, HardDrive, Info, Loader2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Maximize2, Eye, ShieldAlert, Sparkles, Check
} from 'lucide-react';
import { AUTH_TOKEN, getBase, getRawBase } from '../utils/config';
import { getAuth } from '../utils/auth';

const ADMIN_CAMERAS = [
  { id: 'cam-gate', name: 'Portón Principal', serial: 'BG6994814', location: 'Entrada Principal / Vehicular' },
  { id: 'cam-izq', name: 'Cámara Izquierda', serial: 'BG6994872', location: 'Fachada Izquierda' },
  { id: 'cam-der', name: 'Cámara Derecha', serial: 'BG6994741', location: 'Fachada Derecha' },
];

export default function SecurityCenter() {
  const [selectedCamSerial, setSelectedCamSerial] = useState('BG6994814');
  const [cameraFeeds, setCameraFeeds] = useState({});
  const [cameraLive, setCameraLive] = useState(true);
  const [cameraCountdown, setCameraCountdown] = useState(60);
  const [ptzMoving, setPtzMoving] = useState('');
  const [ptzFeedback, setPtzFeedback] = useState('');

  // Estados de Telemetría WiFi
  const [showTelemetryModal, setShowTelemetryModal] = useState(false);
  const [telemetryData, setTelemetryData] = useState(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [telemetryError, setTelemetryError] = useState('');

  // Estados de Cerradura
  const [doorBusy, setDoorBusy] = useState('');
  const [doorMessage, setDoorMessage] = useState(null);

  // Consultar Telemetría WiFi y estado de repetidor
  async function fetchTelemetry() {
    setTelemetryLoading(true);
    setTelemetryError('');
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getBase()}/cameras/telemetry`, {
        headers: { 'x-auth-token': token },
        signal: AbortSignal.timeout(12000),
      });
      const payload = await res.json().catch(() => ({}));
      if (payload.ok && Array.isArray(payload.telemetry)) {
        setTelemetryData(payload);
      } else {
        setTelemetryError(payload.error || 'No se pudo obtener la telemetría.');
      }
    } catch (err) {
      setTelemetryError(err.message || 'Error al conectar con el servicio de telemetría.');
    } finally {
      setTelemetryLoading(false);
    }
  }

  // Cargar telemetría inicial al entrar
  useEffect(() => {
    fetchTelemetry();
  }, []);

  // Precarga escalonada de las 3 cámaras
  useEffect(() => {
    ADMIN_CAMERAS.forEach((cam, idx) => {
      setTimeout(() => {
        const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&t=${Date.now()}`;
        const img = new Image();
        img.onload = () => {
          setCameraFeeds(prev => ({ ...prev, [cam.serial]: nextUrl }));
        };
        img.src = nextUrl;
      }, idx * 350);
    });
  }, []);

  // Temporizador y bucle en vivo
  useEffect(() => {
    if (!cameraLive) return;
    let isCancelled = false;
    let heroTimer = null;

    const countdownInterval = setInterval(() => {
      setCameraCountdown(prev => {
        if (prev <= 1) {
          setCameraLive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    function pollHeroCam() {
      if (isCancelled || !cameraLive) return;
      const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${selectedCamSerial}&stream=1&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (isCancelled) return;
        setCameraFeeds(prev => ({ ...prev, [selectedCamSerial]: nextUrl }));
        heroTimer = setTimeout(pollHeroCam, 250);
      };
      img.onerror = () => {
        if (isCancelled) return;
        heroTimer = setTimeout(pollHeroCam, 1200);
      };
      img.src = nextUrl;
    }

    pollHeroCam();

    // Cámaras secundarias cada 4s
    const secondaryInterval = setInterval(() => {
      ADMIN_CAMERAS.filter(c => c.serial !== selectedCamSerial).forEach((cam, i) => {
        setTimeout(() => {
          if (isCancelled) return;
          const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${cam.serial}&t=${Date.now()}`;
          const img = new Image();
          img.onload = () => {
            if (isCancelled) return;
            setCameraFeeds(prev => ({ ...prev, [cam.serial]: nextUrl }));
          };
          img.src = nextUrl;
        }, i * 1200);
      });
    }, 4000);

    return () => {
      isCancelled = true;
      clearInterval(countdownInterval);
      clearInterval(secondaryInterval);
      if (heroTimer) clearTimeout(heroTimer);
    };
  }, [cameraLive, selectedCamSerial]);

  // Controles PTZ (Motor Pan/Tilt)
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
      }, 2000);
    }
  }

  // Abrir Portón Principal
  async function handleUnlockGate() {
    if (!window.confirm('¿Confirmas abrir el Portón Principal? Esta acción quedará auditada.')) return;
    setDoorBusy('gate');
    setDoorMessage(null);
    try {
      const res = await fetch(`${getBase()}/api/security/doors/gate/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo accionar el portón');
      setDoorMessage({ type: 'success', text: 'Señal de apertura enviada al Portón Principal.' });
    } catch (err) {
      setDoorMessage({ type: 'error', text: err.message || 'Error al accionar el portón.' });
    } finally {
      setDoorBusy('');
      setTimeout(() => setDoorMessage(null), 5000);
    }
  }

  const selectedCam = ADMIN_CAMERAS.find(c => c.serial === selectedCamSerial) || ADMIN_CAMERAS[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Camera className="h-7 w-7 text-blue-600" />
            <span>Seguridad y Cámaras en Vivo</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Monitoreo en tiempo real de las 3 cámaras Ezviz, control motorizado PTZ y diagnóstico WiFi.
          </p>
        </div>

        {/* Botón de Diagnóstico WiFi Destacado */}
        <button
          onClick={() => { setShowTelemetryModal(true); fetchTelemetry(); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2.5 font-bold shadow-md shadow-blue-500/20 transition active:scale-95 text-xs sm:text-sm shrink-0"
        >
          <Wifi className="h-4 w-4 text-white animate-pulse" />
          <span>Test de Cobertura WiFi y Repetidor</span>
        </button>
      </div>

      {/* Resumen Rápido de Señal WiFi de las 3 Cámaras */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ADMIN_CAMERAS.map(cam => {
          const tInfo = telemetryData?.telemetry?.find(t => t.serial === cam.serial);
          const pct = tInfo?.signalPercent ?? 50;
          const isGood = pct >= 75;
          const isRegular = pct >= 40 && pct < 75;

          return (
            <div
              key={cam.serial}
              onClick={() => { setShowTelemetryModal(true); fetchTelemetry(); }}
              className="cursor-pointer group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 hover:border-blue-400 hover:shadow-md transition flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-blue-600 transition">
                  {cam.name}
                </p>
                <p className="text-[11px] text-slate-400 truncate">{cam.location}</p>
                <p className="text-[11px] font-medium mt-1 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${isGood ? 'bg-emerald-500' : isRegular ? 'bg-amber-500' : 'bg-rose-500'}`} />
                  <span>Señal: <strong>{pct}%</strong> {tInfo?.signalDbm ? `(${tInfo.signalDbm} dBm)` : ''}</span>
                </p>
              </div>
              <span className={`text-[10px] font-extrabold px-2 py-1 rounded-full shrink-0 ${
                tInfo?.needsRepeater
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
              }`}>
                {tInfo?.needsRepeater ? 'Repetidor Sugerido' : 'Señal OK'}
              </span>
            </div>
          );
        })}
      </div>

      {doorMessage && (
        <div className={`p-4 rounded-2xl text-sm font-semibold flex items-center gap-2 ${
          doorMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{doorMessage.text}</span>
        </div>
      )}

      {/* Monitor Hero de Cámara Seleccionada con PTZ */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
        {/* Barra superior de estado de la cámara */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cameraLive ? 'bg-emerald-400' : 'bg-slate-300'} opacity-75`} />
              <span className={`relative inline-flex rounded-full h-3 w-3 ${cameraLive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            </span>
            <div>
              <h2 className="font-black text-slate-900 dark:text-white text-base leading-tight">
                {selectedCam.name}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {selectedCam.location} • [{selectedCam.serial}]
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCameraLive(prev => {
                  const next = !prev;
                  if (next) setCameraCountdown(60);
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                cameraLive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${cameraLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              {cameraLive ? `EN VIVO (${cameraCountdown}s)` : 'PAUSADO'}
            </button>

            <button
              onClick={handleUnlockGate}
              disabled={doorBusy === 'gate'}
              className="flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 text-xs font-bold transition shadow-sm disabled:opacity-60"
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              <span>{doorBusy === 'gate' ? 'Abriendo…' : 'Abrir Portón'}</span>
            </button>
          </div>
        </div>

        {/* Marco de Video Hero */}
        <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center">
          {cameraFeeds[selectedCamSerial] ? (
            <img
              src={cameraFeeds[selectedCamSerial]}
              alt={selectedCam.name}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
              <p className="text-xs">Conectando con {selectedCam.name}...</p>
            </div>
          )}

          {/* D-Pad / Cruceta Motorizada PTZ Superpuesta (Solo Admin) */}
          <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md p-2 rounded-2xl border border-white/10 shadow-xl flex flex-col items-center">
            <button
              onClick={() => handleMovePtz('up')}
              disabled={Boolean(ptzMoving)}
              className="p-2 rounded-xl text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-40"
              title="Girar Arriba"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleMovePtz('left')}
                disabled={Boolean(ptzMoving)}
                className="p-2 rounded-xl text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-40"
                title="Girar Izquierda"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="w-4 h-4 rounded-full bg-blue-500/40 border border-blue-400" />
              <button
                onClick={() => handleMovePtz('right')}
                disabled={Boolean(ptzMoving)}
                className="p-2 rounded-xl text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-40"
                title="Girar Derecha"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => handleMovePtz('down')}
              disabled={Boolean(ptzMoving)}
              className="p-2 rounded-xl text-white hover:bg-white/20 active:scale-95 transition disabled:opacity-40"
              title="Girar Abajo"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>

          {ptzFeedback && (
            <div className="absolute top-3 left-3 bg-slate-900/90 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md">
              {ptzFeedback}
            </div>
          )}
        </div>

        {/* Miniaturas de Selección de las 3 Cámaras */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {ADMIN_CAMERAS.map(cam => {
            const isSelected = cam.serial === selectedCamSerial;
            return (
              <button
                key={cam.serial}
                onClick={() => setSelectedCamSerial(cam.serial)}
                className={`text-left rounded-2xl border p-2 transition overflow-hidden group ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20 dark:bg-blue-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-400'
                }`}
              >
                <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-900 mb-2 relative">
                  {cameraFeeds[cam.serial] ? (
                    <img
                      src={cameraFeeds[cam.serial]}
                      alt={cam.name}
                      className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-500 text-[10px]">
                      Cargando…
                    </div>
                  )}
                  {isSelected && (
                    <span className="absolute top-1.5 left-1.5 bg-blue-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md shadow">
                      ACTIVA
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{cam.name}</p>
                <p className="text-[10px] text-slate-400 truncate">{cam.location}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* MODAL DE DIAGNÓSTICO WIFI Y TEST DE REPETIDOR */}
      {showTelemetryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header Modal */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-white/10 backdrop-blur-md">
                  <Wifi className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base leading-tight">Diagnóstico de Cobertura WiFi</h3>
                  <p className="text-xs text-blue-100">Evaluación de señal y necesidad de repetidor para las 3 cámaras</p>
                </div>
              </div>
              <button
                onClick={() => setShowTelemetryModal(false)}
                className="rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {/* Contenido Modal */}
            <div className="p-6 overflow-y-auto space-y-4">
              {/* Barra de Latencia y Actualizar */}
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-blue-600" />
                  <span>
                    Latencia Nube ↔ Cámaras: <strong>{telemetryData?.rttMs ? `${telemetryData.rttMs} ms` : 'Midiendo...'}</strong>
                  </span>
                </div>
                <button
                  onClick={fetchTelemetry}
                  disabled={telemetryLoading}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 font-bold transition disabled:opacity-60 shadow-sm"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${telemetryLoading ? 'animate-spin' : ''}`} />
                  <span>{telemetryLoading ? 'Midiendo señal...' : 'Medir ahora'}</span>
                </button>
              </div>

              {telemetryError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {telemetryError}
                </div>
              )}

              {/* Lista de Cámaras con Telemetría */}
              <div className="space-y-3">
                {telemetryData?.telemetry ? (
                  telemetryData.telemetry.map(cam => {
                    const pct = cam.signalPercent ?? 50;
                    const isGood = pct >= 75;
                    const isRegular = pct >= 40 && pct < 75;

                    return (
                      <div
                        key={cam.serial}
                        className={`rounded-2xl border p-4 transition ${
                          cam.needsRepeater ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-slate-900 dark:text-white text-sm">{cam.name}</h4>
                              <span className="text-xs font-mono text-slate-500">[{cam.serial}]</span>
                            </div>
                            <p className="text-xs text-slate-500">{cam.location} • {cam.model}</p>
                          </div>

                          <div className="text-right">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${
                              isGood ? 'bg-emerald-100 text-emerald-800' : isRegular ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              <Wifi className="h-3 w-3" />
                              {cam.signalQualityLabel} ({pct}%)
                            </span>
                            {cam.signalDbm && (
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{cam.signalDbm} dBm</p>
                            )}
                          </div>
                        </div>

                        {/* Barra de Intensidad de Señal */}
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                            <span>Nivel de Señal WiFi:</span>
                            <span className="font-bold">{pct}%</span>
                          </div>
                          <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                            <div
                              className={`h-full transition-all duration-500 rounded-full ${
                                isGood ? 'bg-emerald-500' : isRegular ? 'bg-amber-500' : 'bg-rose-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        {/* Veredicto de Repetidor */}
                        <div className={`mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                          cam.needsRepeater ? 'bg-amber-100/70 text-amber-950 font-medium dark:bg-amber-900/40 dark:text-amber-200' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}>
                          <Info className={`h-4 w-4 shrink-0 ${cam.needsRepeater ? 'text-amber-600' : 'text-blue-600'}`} />
                          <span>{cam.repeaterRecommendation}</span>
                        </div>

                        {/* Grid de Especificaciones de Red y Almacenamiento */}
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2 border-t border-slate-100 dark:border-slate-800">
                          <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                            <span className="text-[10px] text-slate-400 block font-bold uppercase">IP Local</span>
                            <span className="font-mono text-slate-800 dark:text-slate-200 font-semibold">{cam.localIp}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                            <span className="text-[10px] text-slate-400 block font-bold uppercase">Resolución Sensor</span>
                            <span className="text-slate-800 dark:text-slate-200 font-semibold">{cam.nativeSensorResolution}</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                            <span className="text-[10px] text-slate-400 block font-bold uppercase">Stream Cloud</span>
                            <span className="text-slate-800 dark:text-slate-200 font-semibold">{cam.snapshotResolution} (~{cam.snapshotSizeKb} KB)</span>
                          </div>
                          <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg">
                            <span className="text-[10px] text-slate-400 block font-bold uppercase">MicroSD 24/7</span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              Grabando OK
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : telemetryLoading ? (
                  <div className="p-8 text-center text-slate-400">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-600" />
                    <p className="text-xs">Consultando telemetría de las 3 cámaras en Ezviz Cloud...</p>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No se pudieron cargar los datos de telemetría. Presiona &quot;Medir ahora&quot; para reintentar.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => setShowTelemetryModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition"
              >
                Cerrar Diagnóstico
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
