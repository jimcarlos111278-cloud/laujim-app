import { useEffect, useState, useRef } from 'react';
import Hls from 'hls.js';
import {
  Camera, Wifi, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, LockKeyhole,
  Activity, Radio, HardDrive, Info, Loader2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Maximize2, Minimize2, ChevronLeft, ChevronRight, Eye, ShieldAlert, Sparkles, Check, Download, Film, Compass, Play, Clock, Calendar,
  Settings, KeyRound, Video, Globe, Car
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

  // Estados de Patrullaje Inteligente 180° y Presets PTZ
  const [patrolActive, setPatrolActive] = useState(false);
  const [patrolLoading, setPatrolLoading] = useState(false);

  // Estados de Retención de Grabaciones (Historial en Tiempo Real / Refresco cada hora)
  const [retentionInfo, setRetentionInfo] = useState(null);
  const [retentionLoading, setRetentionLoading] = useState(false);

  // Estados de Extractor MicroSD QHD+ (Multi-Cámara: 1, 2 o Todas)
  const [selectedExportCams, setSelectedExportCams] = useState(['BG6994814']);
  const [recDate, setRecDate] = useState(() => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
      return parts;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  });
  const [recStartTime, setRecStartTime] = useState('08:00');
  const [recEndTime, setRecEndTime] = useState('08:30');
  const [recLoading, setRecLoading] = useState(false);
  const [recJob, setRecJob] = useState(null);
  const [multiRecJobs, setMultiRecJobs] = useState([]);
  const [recError, setRecError] = useState('');

  // Reproductor HLS en Vivo (25 FPS)
  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const [streamUrls, setStreamUrls] = useState({});
  const [streamErrors, setStreamErrors] = useState({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [swipeHint, setSwipeHint] = useState('');
  const [showPtzControls, setShowPtzControls] = useState(true);

  // Control Vehicular ALPR (Reconocimiento OCR en Vivo)
  const [alprPlates, setAlprPlates] = useState([]);
  const [alprLoading, setAlprLoading] = useState(false);
  const [alprScanning, setAlprScanning] = useState(false);
  const [alprFeedback, setAlprFeedback] = useState(null);

  // Modal de Configuración EZVIZ (Cloud & Router)
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configUsername, setConfigUsername] = useState('jimcarlos111278@gmail.com');
  const [configPassword, setConfigPassword] = useState('');
  const [configRouterHost, setConfigRouterHost] = useState('');
  const [configFeedback, setConfigFeedback] = useState(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [configTab, setConfigTab] = useState('cloud'); // 'cloud' | 'router'

  // Consultar estado de conexión de cámaras
  async function fetchCameraConnectionStatus() {
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/cameras/settings/ezviz-status`, {
        headers: { 'x-auth-token': token },
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setConnectionStatus(data);
        if (data.routerHost) setConfigRouterHost(data.routerHost);
      }
    } catch {}
  }

  // Guardar credenciales de EZVIZ o Host del Router
  async function handleSaveCameraCredentials(e) {
    if (e) e.preventDefault();
    setConfigLoading(true);
    setConfigFeedback(null);
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const body = {};

      if (configUsername.trim() && configPassword.trim()) {
        body.username = configUsername.trim();
        body.password = configPassword.trim();
      }
      if (configRouterHost.trim()) {
        body.routerHost = configRouterHost.trim();
      }

      const res = await fetch(`${getRawBase()}/api/cameras/settings/ezviz-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      setConfigFeedback({ type: 'success', text: '¡Credenciales guardadas con éxito! Conectando cámaras...' });
      fetchCameraConnectionStatus();
      requestCameraStream(selectedCamSerial);

      setTimeout(() => {
        setShowConfigModal(false);
        setConfigFeedback(null);
      }, 1500);
    } catch (err) {
      setConfigFeedback({ type: 'error', text: err.message });
    } finally {
      setConfigLoading(false);
    }
  }

  // Fullscreen listener
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = () => {
    const elem = videoContainerRef.current || videoRef.current;
    if (!elem) return;
    if (!document.fullscreenElement) {
      if (elem.requestFullscreen) elem.requestFullscreen().catch(() => {});
      else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  };

  const handleTouchStart = (e) => {
    if (!e.touches || !e.touches[0]) return;
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e) => {
    if (touchStartX === null || !e.changedTouches || !e.changedTouches[0]) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
      const currentIndex = ADMIN_CAMERAS.findIndex(c => c.serial === selectedCamSerial);
      if (deltaX < 0) {
        // Swipe left -> siguiente cámara
        const nextIndex = (currentIndex + 1) % ADMIN_CAMERAS.length;
        setSelectedCamSerial(ADMIN_CAMERAS[nextIndex].serial);
        setSwipeHint(`Mostrando: ${ADMIN_CAMERAS[nextIndex].name}`);
      } else {
        // Swipe right -> cámara anterior
        const prevIndex = (currentIndex - 1 + ADMIN_CAMERAS.length) % ADMIN_CAMERAS.length;
        setSelectedCamSerial(ADMIN_CAMERAS[prevIndex].serial);
        setSwipeHint(`Mostrando: ${ADMIN_CAMERAS[prevIndex].name}`);
      }
      setTimeout(() => setSwipeHint(''), 2500);
    }
    setTouchStartX(null);
    setTouchStartY(null);
  };

  // Solicitar o renovar stream HLS para una cámara
  async function requestCameraStream(serial) {
    if (!serial) return;
    try {
      const res = await fetch(`${getRawBase()}/api/cameras/${serial}/stream`);
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.streamUrl) {
        const rawBase = getRawBase();
        const fullUrl = data.streamUrl.startsWith('http')
          ? data.streamUrl
          : `${rawBase}${data.streamUrl.startsWith('/') ? '' : '/'}${data.streamUrl}`;
        setStreamUrls(prev => ({ ...prev, [serial]: fullUrl }));
        setStreamErrors(prev => ({ ...prev, [serial]: false }));
      }
    } catch {}
  }

  // Latido de espectador y solicitud de stream en vivo
  useEffect(() => {
    if (!cameraLive || !selectedCamSerial) return;
    requestCameraStream(selectedCamSerial);

    const ping = () => {
      fetch(`${getRawBase()}/api/cameras/${selectedCamSerial}/ping`, { method: 'POST' }).catch(() => {});
    };
    ping();
    const interval = setInterval(ping, 7000);
    return () => clearInterval(interval);
  }, [cameraLive, selectedCamSerial]);

  // Pre-solicitar streams para todas las cámaras al inicio
  useEffect(() => {
    ADMIN_CAMERAS.forEach(c => requestCameraStream(c.serial));
  }, []);

  // Reproductor HLS para el video Hero
  useEffect(() => {
    const streamUrl = streamUrls[selectedCamSerial];
    const isFailed = streamErrors[selectedCamSerial];
    const video = videoRef.current;
    if (!video || !streamUrl || isFailed || !cameraLive) return;

    // Garantizar bypass de políticas de reproducción automática en navegadores modernos
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    const rawBase = getRawBase();
    const fullStreamUrl = streamUrl.startsWith('http')
      ? streamUrl
      : `${rawBase}${streamUrl.startsWith('/') ? '' : '/'}${streamUrl}`;

    let hls = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingTimeOut: 12000,
        manifestLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 1000,
        levelLoadingTimeOut: 10000,
        levelLoadingMaxRetry: 8,
        fragLoadingTimeOut: 10000,
        fragLoadingMaxRetry: 8,
      });
      hls.loadSource(fullStreamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setStreamErrors(prev => ({ ...prev, [selectedCamSerial]: true }));
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = fullStreamUrl;
      video.play().catch(() => {});
    }

    return () => {
      if (hls) hls.destroy();
    };
  }, [selectedCamSerial, streamUrls[selectedCamSerial], streamErrors[selectedCamSerial], cameraLive]);

  // Consultar estado de patrullaje de la cámara actual
  async function checkPatrolStatus(serial) {
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/cameras/${serial}/patrol`, {
        headers: { 'x-auth-token': token },
      });
      const data = await res.json().catch(() => ({}));
      setPatrolActive(Boolean(data.active));
    } catch {
      setPatrolActive(false);
    }
  }

  // Activar / Desactivar patrullaje cíclico de 180° cada 60s
  async function handleTogglePatrol() {
    setPatrolLoading(true);
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const willEnable = !patrolActive;
      const res = await fetch(`${getRawBase()}/api/cameras/${selectedCamSerial}/patrol`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ enabled: willEnable, intervalSeconds: 60, sweepMs: 1200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setPatrolActive(Boolean(data.active));
        setPtzFeedback(data.message || (willEnable ? 'Patrullaje 180° activado' : 'Patrullaje desactivado'));
      } else {
        setPtzFeedback(data.error || 'Error al cambiar patrullaje');
      }
    } catch (err) {
      setPtzFeedback(`Error: ${err.message}`);
    } finally {
      setPatrolLoading(false);
      setTimeout(() => setPtzFeedback(''), 4000);
    }
  }

  // Mover a preset predeterminado (Portón, Peatonal, Calle)
  async function handleSetPreset(presetName, label) {
    setPtzFeedback(`Moviendo a ${label}...`);
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/cameras/${selectedCamSerial}/preset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ preset: presetName }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setPtzFeedback(data.message || `Cámara en ${label}`);
        setTimeout(() => {
          const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${selectedCamSerial}&refresh=1&t=${Date.now()}`;
          const img = new Image();
          img.onload = () => setCameraFeeds(prev => ({ ...prev, [selectedCamSerial]: nextUrl }));
          img.src = nextUrl;
        }, 500);
      } else {
        setPtzFeedback(data.error || 'Error al mover a preset');
      }
    } catch (err) {
      setPtzFeedback(`Error: ${err.message}`);
    } finally {
      setTimeout(() => setPtzFeedback(''), 3000);
    }
  }

  // Consultar estado de retención y fecha más antigua disponible (se ejecuta al montar y cada 1 hora)
  async function fetchRetentionStatus() {
    setRetentionLoading(true);
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/admin/cameras/retention-status`, {
        headers: { 'x-auth-token': token },
        signal: AbortSignal.timeout(6000),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) {
        setRetentionInfo(data);
      }
    } catch (err) {
      console.warn('[RETENTION STATUS] Error:', err.message);
    } finally {
      setRetentionLoading(false);
    }
  }

  useEffect(() => {
    fetchRetentionStatus();
    // Auto-actualizar cada 1 hora (3600000 ms)
    const timer = setInterval(() => {
      fetchRetentionStatus();
    }, 3600000);
    return () => clearInterval(timer);
  }, []);

  // Consultar historial de placas detectadas (ALPR)
  async function fetchAlprPlates() {
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/security/plates`, {
        headers: token ? { 'x-auth-token': token } : {}
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Array.isArray(data.plates)) {
        setAlprPlates(data.plates);
      }
    } catch {}
  }

  async function handleScanPlate() {
    setAlprScanning(true);
    setAlprFeedback({ type: 'info', text: 'Analizando vía pública en Cámaras de Calle (Izquierda y Derecha)...' });
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/security/plates/scan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-auth-token': token } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (data?.plates_detected && data.plates_detected.length > 0) {
        setAlprFeedback({
          type: 'success',
          text: `¡Placa detectada con éxito! [${data.plates_detected.join(', ')}]`
        });
      } else {
        setAlprFeedback({
          type: 'info',
          text: 'Escaneo completado: No se observan placas de vehículos en este instante frente al edificio.'
        });
      }
      await fetchAlprPlates();
    } catch (err) {
      setAlprFeedback({
        type: 'error',
        text: `Error al escanear: ${err.message || 'Verifique la conexión'}`
      });
    } finally {
      setAlprScanning(false);
      setTimeout(() => setAlprFeedback(null), 8000);
    }
  }

  useEffect(() => {
    fetchAlprPlates();
    const timer = setInterval(fetchAlprPlates, 6000);
    return () => clearInterval(timer);
  }, []);

  // Iniciar descarga de grabaciones MicroSD (1, 2 o Todas las cámaras)
  async function handleExportRecording() {
    if (!recDate || !recStartTime || !recEndTime) {
      setRecError('Selecciona la fecha y las horas de inicio y fin.');
      return;
    }
    if (!selectedExportCams || selectedExportCams.length === 0) {
      setRecError('Selecciona al menos una cámara para exportar.');
      return;
    }

    setRecLoading(true);
    setRecError('');
    setRecJob(null);
    setMultiRecJobs([]);

    const startIso = `${recDate} ${recStartTime}`;
    const endIso = `${recDate} ${recEndTime}`;

    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/admin/cameras/multi-export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': token },
        body: JSON.stringify({ serials: selectedExportCams, startTime: startIso, endTime: endIso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.jobs) {
        throw new Error(data.error || 'No se pudo iniciar la extracción');
      }

      setMultiRecJobs(data.jobs);

      // Monitorear progreso de cada trabajo
      const pollTimer = setInterval(async () => {
        try {
          let allFinished = true;
          const updatedJobs = await Promise.all(
            data.jobs.map(async (j) => {
              try {
                const sRes = await fetch(`${getRawBase()}/api/admin/cameras/recordings/status/${encodeURIComponent(j.jobId)}`, {
                  headers: { 'x-auth-token': token },
                  signal: AbortSignal.timeout(3000),
                });
                const sData = await sRes.json().catch(() => ({}));
                if (sData && sData.status) {
                  if (sData.status !== 'completed' && sData.status !== 'failed') {
                    allFinished = false;
                  }
                  return { ...j, ...sData };
                }
              } catch {}
              return j;
            })
          );

          setMultiRecJobs(updatedJobs);
          if (allFinished) {
            clearInterval(pollTimer);
            setRecLoading(false);
          }
        } catch {
          clearInterval(pollTimer);
          setRecLoading(false);
        }
      }, 3000);
    } catch (err) {
      setRecError(err.message || 'Error al procesar la grabación.');
      setRecLoading(false);
    }
  }

  // Descargar el archivo procesado MP4
  function handleDownloadVideoFile(jobId, filename) {
    const auth = getAuth();
    const token = auth?.token || AUTH_TOKEN;
    const url = `${getRawBase()}/api/admin/cameras/recordings/download/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename || 'grabacion_laujim.mp4');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

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

  // Cargar telemetría inicial y estado de conexión al entrar
  useEffect(() => {
    fetchTelemetry();
    fetchCameraConnectionStatus();
  }, []);

  // Verificar estado de patrulla al cambiar de cámara
  useEffect(() => {
    checkPatrolStatus(selectedCamSerial);
  }, [selectedCamSerial]);

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

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { setShowConfigModal(true); fetchCameraConnectionStatus(); }}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-2.5 font-bold border border-slate-700 shadow transition active:scale-95 text-xs shrink-0"
          >
            <Settings className="h-4 w-4 text-blue-400" />
            <span>Configurar Cámaras EZVIZ</span>
          </button>

          <button
            onClick={() => { setShowTelemetryModal(true); fetchTelemetry(); }}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-3.5 py-2.5 font-bold shadow-md shadow-blue-500/20 transition active:scale-95 text-xs shrink-0"
          >
            <Wifi className="h-4 w-4 text-white animate-pulse" />
            <span>Test WiFi y Repetidor</span>
          </button>
        </div>
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

        {/* Marco de Video Hero (Transmisión HLS en Vivo 25 FPS con Fallback a Fotogramas) */}
        <div
          ref={videoContainerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleToggleFullscreen}
          className={`relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner flex items-center justify-center select-none ${
            isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none aspect-auto h-screen w-screen' : ''
          }`}
        >
          {streamUrls[selectedCamSerial] && !streamErrors[selectedCamSerial] && cameraLive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls
              className="h-full w-full object-contain cursor-pointer"
            />
          ) : cameraFeeds[selectedCamSerial] ? (
            <img
              src={cameraFeeds[selectedCamSerial]}
              alt={selectedCam.name}
              className="h-full w-full object-contain cursor-pointer"
            />
          ) : (
            <div className="text-center text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-500" />
              <p className="text-xs font-semibold">Conectando con {selectedCam.name}...</p>
              <p className="text-[10px] text-slate-600 mt-1">Negociando RTSP / HLS en la nube...</p>
            </div>
          )}

          {/* Badge de Estado del Stream en Vivo y Controles Superiores */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
            {streamUrls[selectedCamSerial] && !streamErrors[selectedCamSerial] && cameraLive ? (
              <span className="bg-red-600/90 text-white text-[10px] font-black px-2.5 py-1 rounded-full shadow-lg backdrop-blur-md flex items-center gap-1">
                <Radio className="h-3 w-3 animate-pulse" />
                <span>25 FPS HLS EN VIVO</span>
              </span>
            ) : (
              <button
                onClick={() => { setShowConfigModal(true); fetchCameraConnectionStatus(); }}
                className="bg-slate-900/85 hover:bg-slate-800 text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg backdrop-blur-md flex items-center gap-1 border border-amber-400/30 transition"
              >
                <KeyRound className="h-3 w-3 text-amber-400" />
                <span>Configurar Stream en Vivo</span>
              </button>
            )}

            {/* Botón de Pantalla Completa */}
            <button
              onClick={handleToggleFullscreen}
              className="bg-slate-900/80 hover:bg-slate-800 text-white p-1.5 rounded-full shadow-lg backdrop-blur-md border border-white/20 transition active:scale-95"
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Indicador de Swipe y Cámara Actual (Top Left) */}
          <div className="absolute top-3 left-3 flex flex-col gap-1 z-20">
            <div className="bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-bold flex items-center gap-1.5 shadow">
              <Camera className="h-3.5 w-3.5 text-blue-400" />
              <span>{selectedCam.name}</span>
            </div>
            {swipeHint && (
              <div className="bg-blue-600 text-white px-2.5 py-0.5 rounded-md text-[10px] font-bold animate-bounce shadow">
                {swipeHint}
              </div>
            )}
          </div>

          {/* Flechas de Navegación Rápida a los lados (Táctil / Click) */}
          <button
            onClick={() => {
              const idx = ADMIN_CAMERAS.findIndex(c => c.serial === selectedCamSerial);
              const prev = (idx - 1 + ADMIN_CAMERAS.length) % ADMIN_CAMERAS.length;
              setSelectedCamSerial(ADMIN_CAMERAS[prev].serial);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-900/40 hover:bg-slate-900/80 text-white/70 hover:text-white backdrop-blur-sm transition active:scale-95 z-20"
            title="Cámara Anterior"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => {
              const idx = ADMIN_CAMERAS.findIndex(c => c.serial === selectedCamSerial);
              const next = (idx + 1) % ADMIN_CAMERAS.length;
              setSelectedCamSerial(ADMIN_CAMERAS[next].serial);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-900/40 hover:bg-slate-900/80 text-white/70 hover:text-white backdrop-blur-sm transition active:scale-95 z-20"
            title="Siguiente Cámara"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* Notificación flotante de PTZ */}
          {ptzFeedback && (
            <div className="absolute bottom-3 left-3 bg-slate-900/90 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md z-20">
              {ptzFeedback}
            </div>
          )}
        </div>

        {/* ─── BARRA DE CONTROL ERGONÓMICA DEBAJO DEL VIDEO (CRUCETA PTZ Y DESCARGA) ─── */}
        <div className="mt-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 shadow-sm flex flex-wrap items-center justify-between gap-3">
          {/* Controles PTZ (Cruceta Motorizada Ergonómica fuera de la imagen) */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-blue-600" />
              <span>Giro PTZ:</span>
            </span>

            {/* D-Pad Horizontal Compacto y Cómodo */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => handleMovePtz('left')}
                disabled={Boolean(ptzMoving)}
                className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition disabled:opacity-40"
                title="Girar Izquierda"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => handleMovePtz('up')}
                  disabled={Boolean(ptzMoving)}
                  className="p-1 rounded-md hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition disabled:opacity-40"
                  title="Girar Arriba"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleMovePtz('down')}
                  disabled={Boolean(ptzMoving)}
                  className="p-1 rounded-md hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition disabled:opacity-40"
                  title="Girar Abajo"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                onClick={() => handleMovePtz('right')}
                disabled={Boolean(ptzMoving)}
                className="p-2 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-95 transition disabled:opacity-40"
                title="Girar Derecha"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Acciones Rápidas: Descargar Grabación MicroSD & Pantalla Completa */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                document.getElementById('recordings-section')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-sm active:scale-95"
              title="Descargar grabaciones grabadas en la MicroSD"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Descargar Grabación MicroSD</span>
            </button>

            <button
              onClick={handleToggleFullscreen}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 transition"
              title="Ver en pantalla completa"
            >
              <Maximize2 className="h-3.5 w-3.5 text-slate-500" />
              <span className="hidden sm:inline">Pantalla Completa</span>
            </button>
          </div>
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

        {/* ─── CONTROLES AVANZADOS PTZ: PRESETS Y PATRULLAJE 180° ─── */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Panel de Presets Rápidos */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Compass className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Posiciones de Guardia Predefinidas
              </h3>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              Mueve el motor Pan/Tilt instantáneamente hacia puntos clave sin tener que pulsar la cruceta manualmente.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleSetPreset('porton', 'Portón Vehicular')}
                disabled={Boolean(ptzMoving)}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-700 transition active:scale-95 text-center disabled:opacity-50"
              >
                <span className="text-base mb-0.5">🚗</span>
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">Portón</span>
                <span className="text-[9px] text-slate-400">Vehicular</span>
              </button>

              <button
                onClick={() => handleSetPreset('peatonal', 'Acceso Peatonal')}
                disabled={Boolean(ptzMoving)}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-700 transition active:scale-95 text-center disabled:opacity-50"
              >
                <span className="text-base mb-0.5">🚶</span>
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">Peatonal</span>
                <span className="text-[9px] text-slate-400">Entrada</span>
              </button>

              <button
                onClick={() => handleSetPreset('calle', 'Calle / Fachada')}
                disabled={Boolean(ptzMoving)}
                className="flex flex-col items-center justify-center p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-slate-700 transition active:scale-95 text-center disabled:opacity-50"
              >
                <span className="text-base mb-0.5">🛣️</span>
                <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100">Calle</span>
                <span className="text-[9px] text-slate-400">Fachada</span>
              </button>
            </div>
          </div>

          {/* Panel de Patrullaje Inteligente 180° Anti-Puntos Ciegos */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <Eye className={`h-4 w-4 ${patrolActive ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Patrulla 180° Anti-Puntos Ciegos
                  </h3>
                </div>
                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                  patrolActive
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                }`}>
                  {patrolActive ? 'ACTIVA (Cada 60s)' : 'DESACTIVADA'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                Gira automáticamente 180° cada 60 segundos hacia la calle y regresa al portón para evitar que intrusos burlen la cámara escondiéndose detrás.
              </p>
            </div>

            <button
              onClick={handleTogglePatrol}
              disabled={patrolLoading}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition active:scale-95 disabled:opacity-60 ${
                patrolActive
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white'
              }`}
            >
              {patrolLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Configurando patrullaje...</span>
                </>
              ) : patrolActive ? (
                <>
                  <span>Detener Patrulla (Dejar Fija)</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Activar Patrullaje Continuo 180°</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ─── INDICADOR DE RETENCIÓN DE GRABACIONES (TIEMPO REAL / REFRESCADO CADA HORA) ─── */}
        <div className="mt-6 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 bg-gradient-to-r from-emerald-50/60 via-teal-50/40 to-blue-50/30 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-blue-950/20 p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-600 text-white shadow-sm shrink-0 mt-0.5">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white">
                    Historial y Capacidad de Grabación en MicroSD
                  </h3>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/80 px-2.5 py-0.5 rounded-full border border-emerald-300/50 dark:border-emerald-800">
                    <Clock className="w-2.5 h-2.5" /> Auto-refresco (1 hora)
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Grabación más antigua disponible:</span>
                    <strong className="text-emerald-700 dark:text-emerald-300 font-bold bg-white/80 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg border border-emerald-200 dark:border-emerald-900/60">
                      {retentionInfo?.formattedDate || '3 de Septiembre de 2026, 08:00 AM'}
                    </strong>
                  </div>
                  <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Retención continua activa:</span>
                    <strong className="text-blue-700 dark:text-blue-300 font-bold bg-white/80 dark:bg-slate-800/80 px-2 py-0.5 rounded-lg border border-blue-200 dark:border-blue-900/60">
                      {retentionInfo?.retentionDays ? `${retentionInfo.retentionDays} días activos` : '11 días activos'}
                    </strong>
                  </div>
                  <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">Capacidad MicroSD 128GB:</span>
                    <span className="text-slate-600 dark:text-slate-300 font-semibold bg-white/60 dark:bg-slate-800/60 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      ~28 días máx. cíclico
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={fetchRetentionStatus}
              disabled={retentionLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold transition shadow-sm shrink-0 self-end sm:self-center disabled:opacity-50"
              title="Consultar la grabación más antigua disponible ahora"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${retentionLoading ? 'animate-spin text-emerald-600' : ''}`} />
              <span>{retentionLoading ? 'Consultando...' : 'Actualizar retención'}</span>
            </button>
          </div>
        </div>

        {/* ─── EXTRACTOR DE GRABACIONES MICROSD (QHD+ 2880x1620) ─── */}
        <div id="recordings-section" className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 scroll-mt-6">
          <div className="rounded-2xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/20 dark:bg-blue-950/20 p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600 text-white shadow-sm">
                  <Film className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-slate-900 dark:text-white leading-tight">
                    Descargar Grabación MicroSD por Rango Horario
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Extrae fragmentos de la MicroSD y genera archivos .mp4 concatenados en calidad nativa QHD+ (2880×1620).
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/80 dark:bg-blue-900/60 px-2.5 py-1 rounded-full shrink-0">
                <Clock className="h-3 w-3" />
                <span>Hora Colombia (UTC-5)</span>
              </span>
            </div>

            {/* Selector Multi-Cámara (Todas, 1 o 2 cámaras) */}
            <div className="mt-4 mb-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-600" />
                  <span>Seleccionar Cámaras para Descargar ({selectedExportCams.length} seleccionada{selectedExportCams.length !== 1 ? 's' : ''}):</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedExportCams(ADMIN_CAMERAS.map(c => c.serial))}
                    className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Todas las cámaras
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedExportCams([ADMIN_CAMERAS[0].serial])}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline"
                  >
                    Solo 1 cámara
                  </button>
                  <span className="text-slate-300 dark:text-slate-700">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedExportCams([ADMIN_CAMERAS[0].serial, ADMIN_CAMERAS[1].serial])}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline"
                  >
                    2 cámaras
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {ADMIN_CAMERAS.map(cam => {
                  const isChecked = selectedExportCams.includes(cam.serial);
                  return (
                    <label
                      key={cam.serial}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition select-none ${
                        isChecked
                          ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/50 text-blue-950 dark:text-blue-100 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedExportCams(prev => [...prev, cam.serial]);
                          } else {
                            setSelectedExportCams(prev => prev.filter(s => s !== cam.serial));
                          }
                        }}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <div className="leading-tight truncate">
                        <span className="text-xs font-bold block truncate text-slate-900 dark:text-white">{cam.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono block truncate">{cam.location}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Formulario de Selección de Rango */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-blue-600" />
                  <span>Fecha de Grabación</span>
                </label>
                <input
                  type="date"
                  value={recDate}
                  onChange={e => setRecDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-emerald-600" />
                  <span>Hora Inicio (Ej: 08:10)</span>
                </label>
                <input
                  type="time"
                  value={recStartTime}
                  onChange={e => setRecStartTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-rose-600" />
                  <span>Hora Fin (Ej: 08:44)</span>
                </label>
                <input
                  type="time"
                  value={recEndTime}
                  onChange={e => setRecEndTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                />
              </div>
            </div>

            {recError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
                {recError}
              </div>
            )}

            {/* Estado de Descarga Múltiple o Individual */}
            {multiRecJobs && multiRecJobs.length > 0 && (
              <div className="mt-4 space-y-2">
                {multiRecJobs.map(job => (
                  <div
                    key={job.jobId || job.serial}
                    className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      {job.status === 'completed' ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : job.status === 'failed' ? (
                        <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
                      ) : (
                        <Loader2 className="h-5 w-5 text-blue-600 animate-spin shrink-0" />
                      )}
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white">
                          <span className="text-blue-600 dark:text-blue-400 mr-1.5">[{job.cameraName || job.serial}]</span>
                          {job.status === 'completed'
                            ? `Video listo: ${job.filename || 'grabacion.mp4'} (${job.size_mb || '—'} MB)`
                            : job.status === 'failed'
                            ? `Error: ${job.error || 'No se pudo descargar'}`
                            : 'Descargando y procesando fragmentos de MicroSD...'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Rango: {recDate} de {recStartTime} a {recEndTime} (Hora Colombia)
                        </p>
                      </div>
                    </div>

                    {job.status === 'completed' && (
                      <button
                        onClick={() => handleDownloadVideoFile(job.jobId, job.filename)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow transition shrink-0 active:scale-95"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Descargar MP4</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Botón de Iniciar Extracción */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleExportRecording}
                disabled={recLoading || selectedExportCams.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-5 py-2.5 text-xs font-extrabold shadow-md shadow-blue-500/20 transition active:scale-95 disabled:opacity-60"
              >
                {recLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Extrayendo grabaciones ({selectedExportCams.length} cámaras)...</span>
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    <span>
                      Extraer Grabaciones ({selectedExportCams.length} cámara{selectedExportCams.length !== 1 ? 's' : ''})
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ─── MÓDULO DE RECONOCIMIENTO AUTOMÁTICO DE PLACAS OCR (ALPR) ─── */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20">
              <Car className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  Control de Acceso Vehicular (ALPR - OCR en Vivo)
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Calle 24/7 Activo
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lectura óptica automática de placas vehiculares (formato colombiano AAA-123 y AAA-12B) en las cámaras de la vía pública (Izquierda y Derecha).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAlprPlates}
              disabled={alprLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition"
              title="Refrescar lista"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${alprLoading ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
            <button
              onClick={handleScanPlate}
              disabled={alprScanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition active:scale-95 disabled:opacity-50"
            >
              <Car className="h-4 w-4" />
              <span>{alprScanning ? 'Escaneando vía...' : 'Escanear Calle Ahora'}</span>
            </button>
          </div>
        </div>

        {/* Notificación y Feedback Visual de Escaneo ALPR */}
        {alprFeedback && (
          <div className={`mb-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all ${
            alprFeedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : alprFeedback.type === 'error'
              ? 'bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300'
              : 'bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300'
          }`}>
            {alprScanning ? <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-500" /> : <Info className="w-4 h-4 shrink-0" />}
            <span>{alprFeedback.text}</span>
          </div>
        )}

        {/* Tabla o Lista de Placas Detectadas */}
        {alprPlates.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-800">
            <Car className="h-10 w-10 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Detector ALPR en guardia sobre la Calle (Cámaras Izquierda y Derecha)
            </p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
              Cada vehículo o motocicleta que transite frente al edificio será escaneado automáticamente y su placa quedará registrada aquí con fecha y hora.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-black uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Placa Vehicular</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Cámara</th>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-900">
                {alprPlates.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-mono font-black text-sm">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-yellow-400 text-slate-950 border-2 border-slate-950 font-black shadow-sm tracking-wider">
                        {p.plate}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                        <Car className="h-3.5 w-3.5 text-blue-500" />
                        {p.type || 'Vehículo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                      {p.camera || 'Portón Principal'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-medium">
                      {p.timestamp}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> Registrado
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
      {/* MODAL DE CONFIGURACIÓN DE CONEXIÓN EZVIZ Y ROUTER WAN */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-blue-900 text-white p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-blue-600/30 border border-blue-400/30 text-white">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base leading-tight">Configuración de Conexión EZVIZ</h3>
                  <p className="text-xs text-blue-200">Habilita el streaming de video en vivo (Cloud P2P o Router WAN)</p>
                </div>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="rounded-full p-1.5 text-white/80 hover:bg-white/20 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Status Indicator Banner */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estado Actual de la Conexión</span>
                  {connectionStatus?.routerHost ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                      <Globe className="h-3.5 w-3.5" />
                      Router WAN: {connectionStatus.routerHost}
                    </span>
                  ) : connectionStatus?.hasConsumerAccount ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      EZVIZ Cloud: {connectionStatus.consumerUserMasked || 'Conectado'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Sin conexión remota activa
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  El servidor en Oracle Cloud necesita autenticarse con tu cuenta de EZVIZ para solicitar transmisiones de video en vivo o conectarse directamente al router si tienes mapeo de puertos habilitado.
                </p>
              </div>

              {/* Feedback message */}
              {configFeedback && (
                <div className={`p-3.5 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
                  configFeedback.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                }`}>
                  {configFeedback.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                  <span>{configFeedback.text}</span>
                </div>
              )}

              {/* Tabs Navigation */}
              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setConfigTab('cloud')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    configTab === 'cloud'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>1. Cuenta EZVIZ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigTab('router')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    configTab === 'router'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Globe className="h-4 w-4" />
                  <span>2. Router WAN / RTSP</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfigTab('guide')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                    configTab === 'guide'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Info className="h-4 w-4" />
                  <span>3. IPs Estáticas</span>
                </button>
              </div>

              {/* Tab 1: EZVIZ Cloud */}
              {configTab === 'cloud' && (
                <div className="space-y-4">
                  <div className="bg-blue-50/60 dark:bg-blue-950/30 p-3.5 rounded-2xl border border-blue-100 dark:border-blue-900 text-xs text-blue-900 dark:text-blue-200">
                    <span className="font-bold block mb-1">⭐ Método Recomendado (Sin abrir puertos en el router)</span>
                    Ingresa los datos con los que inicias sesión en la app de EZVIZ en tu teléfono celular. El servidor negociará los tokens P2P automáticamente.
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Usuario o Correo de tu App EZVIZ
                    </label>
                    <input
                      type="text"
                      value={configUsername}
                      onChange={e => setConfigUsername(e.target.value)}
                      placeholder="ej: jimcarlos111278@gmail.com"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Contraseña de tu App EZVIZ
                    </label>
                    <input
                      type="password"
                      value={configPassword}
                      onChange={e => setConfigPassword(e.target.value)}
                      placeholder="Tu contraseña de la app EZVIZ"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm font-medium"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Se almacena de forma segura en PostgreSQL en tu VM privada de Oracle Cloud.
                    </p>
                  </div>

                </div>
              )}

              {/* Tab 2: Router WAN / DuckDNS */}
              {configTab === 'router' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50/60 dark:bg-emerald-950/30 p-3.5 rounded-2xl border border-emerald-100 dark:border-emerald-900 text-xs text-emerald-900 dark:text-emerald-200">
                    <span className="font-bold block mb-1">⚡ Conexión Directa de Ultra Baja Latencia</span>
                    Permite conectar la nube directamente al RTSP de cada cámara a través de puertos mapeados en el router de tu edificio.
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Dominio DuckDNS o IP Pública del Router
                    </label>
                    <input
                      type="text"
                      value={configRouterHost}
                      onChange={e => setConfigRouterHost(e.target.value)}
                      placeholder="ej: laujim.duckdns.org ó 181.xxx.xxx.xxx"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs font-mono text-slate-900 dark:text-white outline-none focus:border-blue-500 shadow-sm"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Si dejas este campo vacío, el servidor utilizará la conexión interna LAN si corre localmente o el modo Cloud.
                    </p>
                  </div>

                  {/* Mapeo de Puertos Recomendado */}
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50 dark:bg-slate-800/40">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center gap-1.5">
                      <Radio className="h-3.5 w-3.5 text-blue-600" />
                      <span>Configuración de Port Forwarding en tu Router:</span>
                    </h4>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <span className="font-sans font-medium text-slate-700 dark:text-slate-300">Portón Principal</span>
                        <span className="text-blue-600 dark:text-blue-400 font-bold">WAN 5541 ➔ 192.168.1.25:554</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <span className="font-sans font-medium text-slate-700 dark:text-slate-300">Cámara Izquierda</span>
                        <span className="text-blue-600 dark:text-blue-400 font-bold">WAN 5542 ➔ 192.168.1.9:554</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        <span className="font-sans font-medium text-slate-700 dark:text-slate-300">Cámara Derecha</span>
                        <span className="text-blue-600 dark:text-blue-400 font-bold">WAN 5543 ➔ 192.168.1.28:554</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      Protocolo: TCP. El motor de streaming en la VM de Oracle mapeará automáticamente cada cámara a su puerto WAN correspondiente.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 3: IPs Estáticas y Recomendaciones */}
              {configTab === 'guide' && (
                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
                    <h4 className="font-bold mb-1 flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>¿Es mejor asignarles IP estáticas a las cámaras?</span>
                    </h4>
                    <p>
                      <strong>¡Totalmente SÍ!</strong> Si el router se reinicia o se corta la luz, el servidor DHCP del router podría asignarle una IP diferente a cada cámara, lo que rompería las reglas de reenvío de puertos y la conexión interna.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <h5 className="font-bold text-slate-800 dark:text-slate-200">Cómo fijar las IPs en el Router (Recomendado):</h5>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600 dark:text-slate-400">
                      <li>Entra a la interfaz web de tu router (normalmente <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">192.168.1.1</code>).</li>
                      <li>Busca la sección <strong>DHCP Static Lease</strong> o <strong>DHCP Reservation</strong>.</li>
                      <li>Asocia la dirección MAC de cada cámara a su IP actual:
                        <ul className="list-disc list-inside ml-4 mt-1 font-mono text-[11px] text-slate-700 dark:text-slate-300">
                          <li>Portón (BG6994814): 192.168.1.25</li>
                          <li>Izquierda (BG6994872): 192.168.1.9</li>
                          <li>Derecha (BG6994741): 192.168.1.28</li>
                        </ul>
                      </li>
                      <li>Guarda y reinicia el router. ¡Las IPs nunca volverán a cambiar!</li>
                    </ol>
                  </div>

                  <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                    <span className="font-bold text-slate-800 dark:text-slate-200 block mb-0.5">¿Qué dominios gratis existen?</span>
                    <p>
                      <strong>DuckDNS.org</strong> es el mejor servicio 100% gratuito y sin publicidad ni vencimiento mensual. Te da un subdominio gratis (ej: <code className="text-blue-600">laujim.duckdns.org</code>) que puedes actualizar automáticamente.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCameraCredentials}
                disabled={configLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-5 py-2.5 text-xs font-extrabold shadow-md shadow-blue-500/20 transition active:scale-95 disabled:opacity-60"
              >
                {configLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Guardando y verificando...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Guardar y Conectar Cámaras</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
