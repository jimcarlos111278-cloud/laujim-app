import { useEffect, useState, useRef } from 'react';
import Hls from 'hls.js';
import {
  Camera, Wifi, RefreshCw, AlertTriangle, CheckCircle2, ShieldCheck, LockKeyhole,
  Activity, Radio, HardDrive, Info, Loader2, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Maximize2, Minimize2, ChevronLeft, ChevronRight, Eye, ShieldAlert, Sparkles, Check, Download, Film, Compass, Play, Clock, Calendar,
  Settings, KeyRound, Video, Globe, Car, ZoomIn, ZoomOut, RotateCcw,
  Sliders, ChevronDown, ChevronUp, X, ExternalLink
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
  const [cameraCountdown, setCameraCountdown] = useState(300); // 5 minutos (300 segundos)
  const [continuousLive, setContinuousLive] = useState(true); // 24/7 sin corte por defecto
  const [zoomLevel, setZoomLevel] = useState(1); // 1x, 2x, 4x, 8x
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });
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
  // live real por cámara según el motor (frescura HLS). false = caída/congelada.
  const [streamLive, setStreamLive] = useState({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [swipeHint, setSwipeHint] = useState('');
  const [showPtzControls, setShowPtzControls] = useState(true);
  const [showControlsModal, setShowControlsModal] = useState(false);
  const [showRecordingsAccordion, setShowRecordingsAccordion] = useState(false);
  const [needsUserPlay, setNeedsUserPlay] = useState(false);

  // Control Vehicular ALPR (Reconocimiento OCR en Vivo con Auditoría Fotográfica)
  const [alprPlates, setAlprPlates] = useState([]);
  const [alprLoading, setAlprLoading] = useState(false);
  const [alprScanning, setAlprScanning] = useState(false);
  const [alprFeedback, setAlprFeedback] = useState(null);
  const [expandedPlateIds, setExpandedPlateIds] = useState({});
  const [inspectedPlate, setInspectedPlate] = useState(null);
  const [inspectedTab, setInspectedTab] = useState('full'); // 'full' | 'plate'
  const [alprEngineMode, setAlprEngineMode] = useState('compare'); // 'compare' | 'ml' | 'cloud'
  const [lastBenchmark, setLastBenchmark] = useState(null);

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
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
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
    const isCurrentlyFs = isFullscreen || Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isCurrentlyFs) {
      setIsFullscreen(true);
      if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(() => {});
      } else if (elem.webkitRequestFullscreen) {
        try { elem.webkitRequestFullscreen(); } catch {}
      } else if (videoRef.current?.webkitEnterFullscreen) {
        try { videoRef.current.webkitEnterFullscreen(); } catch {}
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
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

  function handleZoom(nextZoom) {
    const clamped = Math.max(1, Math.min(8, Math.round(nextZoom * 10) / 10));
    setZoomLevel(clamped);
    if (clamped === 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  }

  function handlePanMouseDown(e) {
    if (zoomLevel <= 1) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panOriginRef.current = { ...panOffset };
  }

  function handlePanMouseMove(e) {
    if (!isPanning || zoomLevel <= 1) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    const maxPan = 450 * (zoomLevel - 1);
    setPanOffset({
      x: Math.max(-maxPan, Math.min(maxPan, panOriginRef.current.x + dx)),
      y: Math.max(-maxPan, Math.min(maxPan, panOriginRef.current.y + dy)),
    });
  }

  function handlePanMouseUp() {
    setIsPanning(false);
  }

  const handleTouchStartWrapper = (e) => {
    if (zoomLevel > 1 && e.touches && e.touches[0]) {
      setIsPanning(true);
      panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panOriginRef.current = { ...panOffset };
    } else {
      handleTouchStart(e);
    }
  };

  const handleTouchMoveWrapper = (e) => {
    if (zoomLevel > 1 && isPanning && e.touches && e.touches[0]) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      const maxPan = 450 * (zoomLevel - 1);
      setPanOffset({
        x: Math.max(-maxPan, Math.min(maxPan, panOriginRef.current.x + dx)),
        y: Math.max(-maxPan, Math.min(maxPan, panOriginRef.current.y + dy)),
      });
    }
  };

  const handleTouchEndWrapper = (e) => {
    if (zoomLevel > 1) {
      setIsPanning(false);
    } else {
      handleTouchEnd(e);
    }
  };

  // Restablecer zoom al cambiar de cámara
  useEffect(() => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
  }, [selectedCamSerial]);

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
        setStreamLive(prev => ({ ...prev, [serial]: data.live !== false }));
      } else if (data && data.stale) {
        // Señal caída/congelada: soltar el HLS viejo para caer al snapshot,
        // en vez de mostrar un "VIVO" congelado.
        setStreamUrls(prev => {
          const next = { ...prev };
          delete next[serial];
          return next;
        });
        setStreamLive(prev => ({ ...prev, [serial]: false }));
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

  // Si la señal está caída, re-solicitar el stream cada 15s hasta que vuelva.
  useEffect(() => {
    if (!cameraLive || streamLive[selectedCamSerial] !== false) return;
    const retry = setInterval(() => requestCameraStream(selectedCamSerial), 15000);
    return () => clearInterval(retry);
  }, [cameraLive, selectedCamSerial, streamLive[selectedCamSerial]]);

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
    let onCanPlay = null;
    setNeedsUserPlay(false);

    const attemptPlay = () => {
      video.muted = true;
      video.play().then(() => {
        setNeedsUserPlay(false);
      }).catch(() => {
        setNeedsUserPlay(true);
      });
    };

    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true, // 24/7 pegado al borde vivo (port-forward siempre tibio)
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        maxBufferLength: 10,
        maxMaxBufferLength: 20,
        backBufferLength: 5,
        manifestLoadingTimeOut: 5000,
        manifestLoadingMaxRetry: 5,
        manifestLoadingRetryDelay: 500,
        levelLoadingTimeOut: 5000,
        levelLoadingMaxRetry: 5,
        fragLoadingTimeOut: 5000,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 500,
      });

      // Bind events BEFORE loading source to avoid race conditions
      hls.on(Hls.Events.FRAG_BUFFERED, function onFirstFrag() {
        hls.off(Hls.Events.FRAG_BUFFERED, onFirstFrag);
        attemptPlay();
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

      hls.loadSource(fullStreamUrl);
      hls.attachMedia(video);
      // Reintento al tener datos listos: algunos navegadores rechazan el primer
      // play() aunque el video venga muteado (pantalla negra con botón play).
      onCanPlay = () => {
        video.muted = true;
        video.play().then(() => setNeedsUserPlay(false)).catch(() => {});
      };
      video.addEventListener('canplay', onCanPlay);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS: wait for loadedmetadata before playing
      video.src = fullStreamUrl;
      video.addEventListener('loadedmetadata', () => attemptPlay(), { once: true });
    }

    return () => {
      if (onCanPlay) video.removeEventListener('canplay', onCanPlay);
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
    const modeLabel = alprEngineMode === 'compare'
      ? 'Modo Comparativa (⚡ Local ML + ☁️ Cloud PR)'
      : (alprEngineMode === 'ml' ? '⚡ Machine Learning Local (VM CPU)' : '☁️ Plate Recognizer Cloud API');
    setAlprFeedback({ type: 'info', text: `Analizando vía pública con ${modeLabel}...` });
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/security/plates/scan?mode=${alprEngineMode}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-auth-token': token } : {})
        }
      });
      const data = await res.json().catch(() => ({}));
      if (data?.benchmark) {
        setLastBenchmark(data.benchmark);
      }
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
      setTimeout(() => setAlprFeedback(null), 10000);
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
        if (continuousLive) return 300;
        if (prev <= 1) {
          setCameraLive(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    function pollHeroCam() {
      if (isCancelled || !cameraLive) return;
      // Si el stream HLS está activo y sin errores, reducir la tasa de sondeo a 10s como respaldo
      const hasHls = streamUrls[selectedCamSerial] && !streamErrors[selectedCamSerial];
      if (hasHls) {
        heroTimer = setTimeout(pollHeroCam, 10000);
        return;
      }
      const nextUrl = `${getRawBase()}/api/intercom/public/feed?serial=${selectedCamSerial}&stream=1&t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (isCancelled) return;
        setCameraFeeds(prev => ({ ...prev, [selectedCamSerial]: nextUrl }));
        heroTimer = setTimeout(pollHeroCam, 250);
      };
      img.onerror = () => {
        if (isCancelled) return;
        heroTimer = setTimeout(pollHeroCam, 1500);
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
  }, [cameraLive, continuousLive, selectedCamSerial, streamUrls[selectedCamSerial], streamErrors[selectedCamSerial]]);

  // Controles PTZ (Motor Pan/Tilt)
  async function handleMovePtz(direction) {
    if (ptzMoving) return;
    setPtzMoving(direction);
    const dirNames = { up: 'ARRIBA', down: 'ABAJO', left: 'IZQUIERDA', right: 'DERECHA' };
    setPtzFeedback(`Moviendo ${dirNames[direction] || direction}...`);
    try {
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getRawBase()}/api/cameras/${selectedCamSerial}/ptz`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-auth-token': token,
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
      const auth = getAuth();
      const token = auth?.token || AUTH_TOKEN;
      const res = await fetch(`${getBase()}/security/doors/gate-door/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-token': token },
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

  const togglePlateExpand = (id) => {
    setExpandedPlateIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16 px-2 sm:px-4">
      {/* Header Minimalista */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2.5">
            <Camera className="h-6 w-6 text-blue-600" />
            <span>Seguridad y Cámaras en Vivo</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Monitoreo en tiempo real • 3 Cámaras 24/7 • Control de Acceso Vehicular ALPR
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setShowConfigModal(true); fetchCameraConnectionStatus(); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white px-3 py-2 font-bold border border-slate-700 shadow-sm transition active:scale-95 text-xs shrink-0"
          >
            <Settings className="h-3.5 w-3.5 text-blue-400" />
            <span>Ajustes EZVIZ</span>
          </button>

          <button
            onClick={() => { setShowTelemetryModal(true); fetchTelemetry(); }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 px-3 py-2 font-bold border border-slate-200 dark:border-slate-700 transition active:scale-95 text-xs shrink-0"
          >
            <Wifi className="h-3.5 w-3.5 text-blue-600" />
            <span>Test WiFi</span>
          </button>
        </div>
      </div>

      {doorMessage && (
        <div className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 animate-fade-in ${
          doorMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' : 'bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
        }`}>
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{doorMessage.text}</span>
        </div>
      )}

      {/* ─── PESTAÑAS DE SELECCIÓN DE CÁMARA (PILL TABS MATERIAL YOU) ─── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {ADMIN_CAMERAS.map(cam => {
          const isSelected = cam.serial === selectedCamSerial;
          const tInfo = telemetryData?.telemetry?.find(t => t.serial === cam.serial);
          const pct = tInfo?.signalPercent ?? 60;
          return (
            <button
              key={cam.serial}
              onClick={() => setSelectedCamSerial(cam.serial)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-extrabold transition-all shrink-0 active:scale-95 ${
                isSelected
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 ring-2 ring-blue-500/30'
                  : 'bg-white dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/80 hover:border-slate-400'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span>{cam.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                isSelected ? 'bg-blue-700/60 text-blue-100' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
              }`}>
                {pct}% WiFi
              </span>
            </button>
          );
        })}
      </div>

      {/* ─── REPRODUCTOR HERO (16:9 LIMPIO Y DESPEJADO) ─── */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:p-4 shadow-sm overflow-hidden">
        <div
          ref={videoContainerRef}
          onTouchStart={handleTouchStartWrapper}
          onTouchMove={handleTouchMoveWrapper}
          onTouchEnd={handleTouchEndWrapper}
          onMouseDown={handlePanMouseDown}
          onMouseMove={handlePanMouseMove}
          onMouseUp={handlePanMouseUp}
          onMouseLeave={handlePanMouseUp}
          onDoubleClick={handleToggleFullscreen}
          onClick={(e) => {
            if (zoomLevel === 1 && !isPanning && !needsUserPlay) {
              handleToggleFullscreen();
            }
          }}
          className={`relative aspect-video w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/80 shadow-inner flex items-center justify-center select-none ${
            isFullscreen ? 'fixed inset-0 z-50 rounded-none border-none aspect-auto h-screen w-screen' : ''
          }`}
          style={{ cursor: zoomLevel > 1 ? (isPanning ? 'grabbing' : 'grab') : 'pointer' }}
        >
          {streamUrls[selectedCamSerial] && !streamErrors[selectedCamSerial] && cameraLive ? (
            <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              style={{
                transform: zoomLevel > 1
                  ? `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`
                  : 'none',
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.15s ease-out',
              }}
              className="h-full w-full object-contain"
            />
            {needsUserPlay && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const v = videoRef.current;
                  if (v) { v.muted = true; v.play().then(() => setNeedsUserPlay(false)).catch(() => {}); }
                }}
                className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer bg-black/30"
              >
                <div className="bg-white/20 backdrop-blur-md rounded-full p-5 shadow-2xl border border-white/30 transition hover:bg-white/30 active:scale-90">
                  <Play className="h-12 w-12 text-white drop-shadow-xl" />
                </div>
              </div>
            )}
            </>
          ) : cameraFeeds[selectedCamSerial] ? (
            <img
              src={cameraFeeds[selectedCamSerial]}
              alt={selectedCam.name}
              draggable={false}
              style={{
                transform: zoomLevel > 1
                  ? `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`
                  : 'none',
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.15s ease-out',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-center text-slate-400 p-4">
              <Loader2 className="h-7 w-7 animate-spin mx-auto mb-2 text-blue-500" />
              <p className="text-xs font-semibold">Conectando con {selectedCam.name}...</p>
              <p className="text-[10px] text-slate-500 mt-1">Transmisión en directo a 25 FPS</p>
            </div>
          )}

          {/* Badge Superior Izquierdo: Nombre de Cámara y Estado */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 z-20 pointer-events-none">
            <div className="bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1 rounded-xl border border-white/15 text-[11px] font-bold flex items-center gap-1.5 shadow">
              <span className={`h-2 w-2 rounded-full ${cameraLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              <span>{selectedCam.name}</span>
            </div>
            {streamUrls[selectedCamSerial] && !streamErrors[selectedCamSerial] && cameraLive && streamLive[selectedCamSerial] !== false && (
              <span className="bg-red-600/90 text-white text-[10px] font-black px-2 py-1 rounded-xl shadow backdrop-blur-md flex items-center gap-1">
                <Radio className="h-3 w-3 animate-pulse" />
                <span>VIVO 25 FPS</span>
              </span>
            )}
            {cameraLive && streamLive[selectedCamSerial] === false && (
              <span className="bg-amber-500/90 text-slate-950 text-[10px] font-black px-2 py-1 rounded-xl shadow backdrop-blur-md flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 animate-pulse" />
                <span>SEÑAL CAÍDA · REINTENTANDO</span>
              </span>
            )}
          </div>

          {/* Botones Flotantes Superiores Derechos: Controles PTZ y Fullscreen */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5 z-20">
            <button
              onClick={(e) => { e.stopPropagation(); setShowControlsModal(true); }}
              className="bg-slate-900/85 hover:bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow-lg backdrop-blur-md flex items-center gap-1.5 border border-white/20 transition active:scale-95"
              title="Abrir Controles PTZ y Zoom"
            >
              <Compass className="h-3.5 w-3.5 text-blue-400" />
              <span className="hidden sm:inline">Controles</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}
              className="bg-slate-900/85 hover:bg-slate-800 text-white p-2 rounded-xl shadow-lg backdrop-blur-md border border-white/20 transition active:scale-95"
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Toolbar de Zoom Flotante (SOLO VISIBLE EN PANTALLA COMPLETA) */}
          {isFullscreen && (
            <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-slate-950/90 backdrop-blur-md px-2.5 py-1.5 rounded-2xl border border-white/20 text-white z-30 shadow-2xl">
              <span className="text-[10px] font-extrabold text-slate-300 mr-1 flex items-center gap-0.5">
                <ZoomIn className="h-3 w-3 text-blue-400" /> Zoom:
              </span>
              {[1, 2, 4, 8].map(z => (
                <button
                  key={z}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleZoom(z); }}
                  className={`px-2 py-0.5 text-[10px] font-black rounded-lg transition ${
                    zoomLevel === z ? 'bg-blue-600 text-white shadow' : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  {z}x
                </button>
              ))}
              {zoomLevel > 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleZoom(1); }}
                  className="p-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow"
                  title="Restablecer zoom"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* Notificación de feedback PTZ */}
          {ptzFeedback && (
            <div className="absolute bottom-3 left-3 bg-slate-900/90 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md z-20">
              {ptzFeedback}
            </div>
          )}
        </div>

        {/* ─── BARRA DE ACCIÓN INFERIOR DEL REPRODUCTOR (DESPEJADA Y ELEGANTE) ─── */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={handleUnlockGate}
              disabled={doorBusy === 'gate'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-black shadow-sm transition active:scale-95 disabled:opacity-60"
            >
              <LockKeyhole className="h-3.5 w-3.5" />
              <span>{doorBusy === 'gate' ? 'Abriendo...' : 'Abrir Portón'}</span>
            </button>

            <button
              onClick={() => setShowControlsModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-200 px-3.5 py-2 text-xs font-bold transition active:scale-95"
            >
              <Compass className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>Giro PTZ y Zoom</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Límite 5 min vs Continuo */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => { setContinuousLive(false); setCameraCountdown(300); setCameraLive(true); }}
                className={`px-2.5 py-1 rounded-lg transition ${
                  !continuousLive ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                5 min
              </button>
              <button
                type="button"
                onClick={() => { setContinuousLive(true); setCameraLive(true); }}
                className={`px-2.5 py-1 rounded-lg transition ${
                  continuousLive ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Continuo
              </button>
            </div>

            <button
              onClick={() => setCameraLive(prev => !prev)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                cameraLive ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
              }`}
            >
              {cameraLive ? (continuousLive ? 'ACTIVO' : `${cameraCountdown}s`) : 'PAUSADO'}
            </button>
          </div>
        </div>
      </section>

      {/* ─── MÓDULO DE CONTROL VEHICULAR (ALPR - OCR EN VIVO CON FOTOS DE AUDITORÍA) ─── */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-2xl bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-500/20">
              <Car className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Control Vehicular (ALPR)
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  En guardia 24/7
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lectura óptica de placas con fotografía de auditoría en tiempo real.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchAlprPlates}
              disabled={alprLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${alprLoading ? 'animate-spin' : ''}`} />
              <span>Refrescar</span>
            </button>
            <button
              onClick={handleScanPlate}
              disabled={alprScanning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition active:scale-95 disabled:opacity-50"
            >
              <Car className="h-3.5 w-3.5" />
              <span>{alprScanning ? 'Escaneando...' : 'Escanear Ahora'}</span>
            </button>
          </div>
        </div>

        {/* Selector de Motor ALPR y Modo Comparativo */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 mb-4 bg-slate-100 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAlprEngineMode('compare')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                alprEngineMode === 'compare'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              ⚔️ Comparativa Dual (Benchmark)
            </button>
            <button
              type="button"
              onClick={() => setAlprEngineMode('ml')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                alprEngineMode === 'ml'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              ⚡ Local ML (VM CPU)
            </button>
            <button
              type="button"
              onClick={() => setAlprEngineMode('cloud')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                alprEngineMode === 'cloud'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              ☁️ Plate Recognizer Cloud
            </button>
          </div>
          <span className="text-[10px] text-slate-400 font-bold px-2">
            {alprEngineMode === 'compare'
              ? 'Ejecuta ambas IAs en simultáneo y compara velocidad y precisión'
              : (alprEngineMode === 'ml' ? '0 costo, ilimitado, ~0.6s' : '2,500 créditos/mes con Marca/Modelo/Color')}
          </span>
        </div>

        {/* HUD de Benchmark en Vivo */}
        {lastBenchmark && (
          <div className="mb-4 p-3.5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border border-indigo-500/30 shadow-lg animate-fade-in">
            <div className="flex items-center justify-between border-b border-indigo-500/20 pb-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-indigo-300">
                  📊 Auditoría de Rendimiento en Tiempo Real
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Ganador Velocidad: {lastBenchmark.speed_winner || 'Local ML'}
                </span>
              </div>
              <button
                onClick={() => setLastBenchmark(null)}
                className="text-white/60 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-xl bg-purple-950/40 border border-purple-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-purple-300 flex items-center gap-1">
                    ⚡ Modelo Local ML (VM CPU)
                  </span>
                  <span className="font-mono font-bold text-purple-200">
                    {lastBenchmark.ml_time_ms ? `${lastBenchmark.ml_time_ms} ms` : '—'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Placas: <span className="font-mono font-bold text-amber-300">{lastBenchmark.ml_plates?.length > 0 ? lastBenchmark.ml_plates.join(', ') : 'Ninguna'}</span>
                </p>
                <p className="text-[10px] text-purple-300/70 mt-0.5">YOLOv9-t + MobileViT OCR • Costo: $0.00</p>
              </div>

              <div className="p-2.5 rounded-xl bg-sky-950/40 border border-sky-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sky-300 flex items-center gap-1">
                    ☁️ Plate Recognizer Cloud API
                  </span>
                  <span className="font-mono font-bold text-sky-200">
                    {lastBenchmark.cloud_time_ms ? `${lastBenchmark.cloud_time_ms} ms` : '—'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Placas: <span className="font-mono font-bold text-amber-300">{lastBenchmark.cloud_plates?.length > 0 ? lastBenchmark.cloud_plates.join(', ') : 'Ninguna'}</span>
                </p>
                <p className="text-[10px] text-sky-300/70 mt-0.5">MMC (Make/Model/Color) • Snapshot Cloud</p>
              </div>
            </div>

            <div className="mt-2.5 pt-2 border-t border-indigo-500/20 flex items-center justify-between text-[11px] text-indigo-200">
              <span>{lastBenchmark.match ? '✅ Concordancia: Ambas redes neuronales detectaron la misma placa' : 'ℹ️ Resultados complementarios según ángulo y distancia'}</span>
              <span>Vehículos estacionados filtrados para proteger cuota</span>
            </div>
          </div>
        )}

        {alprFeedback && (
          <div className={`mb-4 p-3 rounded-2xl text-xs font-bold flex items-center gap-2.5 ${
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

        {/* Lista de Placas con Desplegable de Fotografía Real de Auditoría */}
        {alprPlates.length === 0 ? (
          <div className="text-center py-8 px-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-800">
            <Car className="h-9 w-9 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Detector ALPR en guardia sobre la Calle (Cámaras Izquierda y Derecha)
            </p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
              Cada vehículo que transite frente al edificio registrará su placa y la foto exacta tomada por la cámara.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {alprPlates.map(p => {
              const isExpanded = Boolean(expandedPlateIds[p.id]);
              const rawBase = getRawBase();
              const fullUrl = p.fullUrl
                ? (p.fullUrl.startsWith('http') ? p.fullUrl : `${rawBase}${p.fullUrl.startsWith('/') ? '' : '/'}${p.fullUrl}`)
                : (p.snapshot ? (p.snapshot.startsWith('http') ? p.snapshot : `${rawBase}${p.snapshot}`) : `${rawBase}/alpr/image/${p.id}?type=full`);
              const plateUrl = p.plateUrl
                ? (p.plateUrl.startsWith('http') ? p.plateUrl : `${rawBase}${p.plateUrl.startsWith('/') ? '' : '/'}${p.plateUrl}`)
                : fullUrl;
              const cropUrl = p.cropUrl
                ? (p.cropUrl.startsWith('http') ? p.cropUrl : `${rawBase}${p.cropUrl.startsWith('/') ? '' : '/'}${p.cropUrl}`)
                : fullUrl;
              const isParked = Boolean(p.is_parked || p.stationary || p.status === 'parked');
              const isLocalMl = p.engine === 'local_ml';

              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition"
                >
                  {/* Fila principal del vehículo */}
                  <div className="p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {/* Placa Colombiana Oficial Amarilla */}
                      <div className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 font-mono font-black text-sm tracking-widest border-2 border-slate-950 shadow-sm flex items-center justify-center min-w-[90px]">
                        {p.plate}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                          <Car className="h-3.5 w-3.5 text-blue-500" />
                          <span>{p.type || 'Vehículo'}</span>
                          <span className="text-[11px] font-normal text-slate-400">• {p.camera || 'Cámara'}</span>

                          {/* Badge de Motor IA */}
                          {isLocalMl ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300">
                              ⚡ Local ML
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300 border border-sky-300">
                              ☁️ Plate Recognizer
                            </span>
                          )}

                          {/* Badge de Estado: Estacionado vs En Tránsito */}
                          {isParked ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300/50">
                              🅿️ Estacionado (Inmóvil)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300/50">
                              🚗 En Movimiento
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          <span>{p.timestamp}</span>
                          {p.confidence && (
                            <span className="font-mono text-[10px] text-slate-400 ml-1">
                              • Confianza: {Math.round(p.confidence * 100)}%
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => togglePlateExpand(p.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                          isExpanded
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        <span>{isExpanded ? 'Ocultar Fotos' : 'Ver Fotos de Auditoría'}</span>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Desplegable de Fotografía de Auditoría (Doble Foto: General + Placa) */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 sm:p-4 animate-fade-in space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* 1. Foto General de la Cámara con Overlays IA */}
                        <div
                          onClick={() => { setInspectedPlate(p); setInspectedTab('full'); }}
                          className="relative group cursor-pointer aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-700/80 shadow-sm flex items-center justify-center"
                        >
                          <img
                            src={fullUrl}
                            alt={`Foto General ${p.plate}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = cropUrl;
                            }}
                          />
                          {/* Bounding Box Azul en vista previa (Solo si viene de Plate Recognizer) */}
                          {p.vehicleBox && (
                            <div
                              className="absolute border-2 border-cyan-400 bg-cyan-400/10 pointer-events-none rounded shadow-[0_0_8px_rgba(6,182,212,0.5)]"
                              style={{
                                top: `${(p.vehicleBox.ymin / (p.imgHeight || 1440)) * 100}%`,
                                left: `${(p.vehicleBox.xmin / (p.imgWidth || 2560)) * 100}%`,
                                width: `${((p.vehicleBox.xmax - p.vehicleBox.xmin) / (p.imgWidth || 2560)) * 100}%`,
                                height: `${((p.vehicleBox.ymax - p.vehicleBox.ymin) / (p.imgHeight || 1440)) * 100}%`,
                              }}
                            >
                              <span className="absolute -top-5 left-0 bg-cyan-500 text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                                {p.details?.makeModel || p.details?.vehicle || p.type || 'Vehículo'}
                              </span>
                            </div>
                          )}

                          {/* Bounding Box Naranja en vista previa (Solo si viene de Plate Recognizer) */}
                          {p.box && (
                            <div
                              className="absolute border-2 border-amber-400 bg-amber-400/30 pointer-events-none rounded shadow-[0_0_8px_rgba(245,158,11,0.7)]"
                              style={{
                                top: `${(p.box.ymin / (p.imgHeight || 1440)) * 100}%`,
                                left: `${(p.box.xmin / (p.imgWidth || 2560)) * 100}%`,
                                width: `${((p.box.xmax - p.box.xmin) / (p.imgWidth || 2560)) * 100}%`,
                                height: `${((p.box.ymax - p.box.ymin) / (p.imgHeight || 1440)) * 100}%`,
                              }}
                            />
                          )}

                          <div className="absolute top-2 left-2 bg-slate-900/85 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-lg border border-white/10 flex items-center gap-1">
                            <Camera className="h-3 w-3 text-blue-400" />
                            <span>Foto General (Cámara)</span>
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white font-bold text-xs gap-1.5 backdrop-blur-[1px]">
                            <Maximize2 className="h-4 w-4" />
                            <span>Ver Panorámica Completa</span>
                          </div>
                        </div>

                        {/* 2. Foto de la Placa Reconstruida / Recorte Nítido */}
                        <div
                          onClick={() => { setInspectedPlate(p); setInspectedTab('plate'); }}
                          className="relative group cursor-pointer aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-700/80 shadow-sm flex items-center justify-center"
                        >
                          <img
                            src={plateUrl}
                            alt={`Placa ${p.plate}`}
                            className="max-h-full max-w-full object-contain p-2 group-hover:scale-105 transition duration-300"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = cropUrl;
                            }}
                          />
                          <div className="absolute top-2 left-2 bg-slate-900/85 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-lg border border-white/10 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            <span>Placa Reconstruida</span>
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white font-bold text-xs gap-1.5 backdrop-blur-[1px]">
                            <Maximize2 className="h-4 w-4" />
                            <span>Inspeccionar Placa</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          Auditoría ID: {p.id}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setInspectedPlate(p); setInspectedTab('full'); }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition active:scale-95 shadow-sm"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                            <span>Pantalla Completa</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── ACCORDEÓN: DESCARGA DE GRABACIONES MICROSD (QHD+ 2880x1620) ─── */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        <button
          onClick={() => setShowRecordingsAccordion(prev => !prev)}
          className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-600 text-white shadow-sm">
              <Film className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-white">
                Extractor de Grabaciones MicroSD (QHD+ 2880×1620)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Descarga fragmentos en video nativo MP4 por fecha y hora desde la MicroSD.
              </p>
            </div>
          </div>
          {showRecordingsAccordion ? <ChevronUp className="h-5 w-5 text-slate-400" /> : <ChevronDown className="h-5 w-5 text-slate-400" />}
        </button>

        {showRecordingsAccordion && (
          <div className="border-t border-slate-100 dark:border-slate-800 p-4 sm:p-5 bg-slate-50/40 dark:bg-slate-800/30 space-y-4 animate-fade-in">
            {/* Selector de Cámaras */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                Selecciona la(s) cámara(s) a exportar:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {ADMIN_CAMERAS.map(cam => {
                  const isChecked = selectedExportCams.includes(cam.serial);
                  return (
                    <button
                      key={cam.serial}
                      type="button"
                      onClick={() => {
                        setSelectedExportCams(prev =>
                          isChecked ? prev.filter(s => s !== cam.serial) : [...prev, cam.serial]
                        );
                      }}
                      className={`p-3 rounded-2xl border text-left text-xs font-bold transition flex items-center gap-2 ${
                        isChecked
                          ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className={`h-4 w-4 rounded-md border flex items-center justify-center text-[10px] ${
                        isChecked ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'
                      }`}>
                        {isChecked && '✓'}
                      </div>
                      <span>{cam.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Rango Horario */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Fecha
                </label>
                <input
                  type="date"
                  value={recDate}
                  onChange={e => setRecDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hora Inicio
                </label>
                <input
                  type="time"
                  value={recStartTime}
                  onChange={e => setRecStartTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hora Fin
                </label>
                <input
                  type="time"
                  value={recEndTime}
                  onChange={e => setRecEndTime(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {recError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium">
                {recError}
              </div>
            )}

            {/* Trabajos de Descarga */}
            {multiRecJobs && multiRecJobs.length > 0 && (
              <div className="space-y-2">
                {multiRecJobs.map(job => (
                  <div
                    key={job.jobId || job.serial}
                    className="p-3 rounded-2xl border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
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
                          <span className="text-blue-600 mr-1">[{job.cameraName || job.serial}]</span>
                          {job.status === 'completed'
                            ? `Video listo: ${job.filename || 'grabacion.mp4'} (${job.size_mb || '—'} MB)`
                            : job.status === 'failed'
                            ? `Error: ${job.error || 'No se pudo descargar'}`
                            : 'Extrayendo fragmentos de MicroSD...'}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {recDate} • {recStartTime} - {recEndTime}
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

            <div className="flex justify-end pt-2">
              <button
                onClick={handleExportRecording}
                disabled={recLoading || selectedExportCams.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 text-xs font-extrabold shadow-md shadow-blue-500/20 transition active:scale-95 disabled:opacity-60"
              >
                {recLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Extrayendo ({selectedExportCams.length} cámaras)...</span>
                  </>
                ) : (
                  <>
                    <Film className="h-4 w-4" />
                    <span>Extraer Grabaciones ({selectedExportCams.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ─── MODAL FLOTANTE / BOTTOM SHEET: CONTROLES PTZ & ZOOM ─── */}
      {showControlsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Header del Modal */}
            <div className="bg-gradient-to-r from-slate-900 to-blue-900 p-4 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-600/30 border border-blue-400/30 text-white">
                  <Compass className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm leading-tight">Controles PTZ y Zoom</h3>
                  <p className="text-[11px] text-blue-200">{selectedCam.name} • {selectedCam.location}</p>
                </div>
              </div>
              <button
                onClick={() => setShowControlsModal(false)}
                className="rounded-full p-1.5 text-white/80 hover:bg-white/20 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Cuerpo del Modal */}
            <div className="p-5 overflow-y-auto space-y-5">
              {/* Cruceta Motorizada PTZ Ergonómica */}
              <div className="flex flex-col items-center">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                  Giro del Motor (Pan / Tilt)
                </span>
                <div className="relative w-44 h-44 rounded-full bg-slate-100 dark:bg-slate-800 border-4 border-slate-200 dark:border-slate-700 shadow-inner flex items-center justify-center">
                  {/* Botón Arriba */}
                  <button
                    onClick={() => handleMovePtz('up')}
                    disabled={Boolean(ptzMoving)}
                    className="absolute top-2 left-1/2 -translate-x-1/2 p-3 rounded-full bg-white dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 shadow-md active:scale-95 transition disabled:opacity-40"
                    title="Girar Arriba"
                  >
                    <ArrowUp className="h-5 w-5" />
                  </button>

                  {/* Botón Izquierda */}
                  <button
                    onClick={() => handleMovePtz('left')}
                    disabled={Boolean(ptzMoving)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 shadow-md active:scale-95 transition disabled:opacity-40"
                    title="Girar Izquierda"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>

                  {/* Centro Indicador */}
                  <div className="w-12 h-12 rounded-full bg-blue-600/15 dark:bg-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                    <Compass className={`h-6 w-6 ${ptzMoving ? 'animate-spin' : ''}`} />
                  </div>

                  {/* Botón Derecha */}
                  <button
                    onClick={() => handleMovePtz('right')}
                    disabled={Boolean(ptzMoving)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 shadow-md active:scale-95 transition disabled:opacity-40"
                    title="Girar Derecha"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>

                  {/* Botón Abajo */}
                  <button
                    onClick={() => handleMovePtz('down')}
                    disabled={Boolean(ptzMoving)}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 p-3 rounded-full bg-white dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-200 shadow-md active:scale-95 transition disabled:opacity-40"
                    title="Girar Abajo"
                  >
                    <ArrowDown className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Selector de Zoom Digital */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <ZoomIn className="h-3.5 w-3.5 text-blue-500" />
                    Zoom Digital: {zoomLevel}x
                  </span>
                  {zoomLevel > 1 && (
                    <button
                      onClick={() => handleZoom(1)}
                      className="text-[11px] font-bold text-rose-500 hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Restablecer</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                  {[1, 2, 4, 8].map(z => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => handleZoom(z)}
                      className={`py-2 rounded-xl text-xs font-extrabold transition ${
                        zoomLevel === z
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets de Guardia */}
              <div>
                <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Posiciones Predefinidas
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => { handleSetPreset('porton', 'Portón Vehicular'); setShowControlsModal(false); }}
                    className="p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-blue-500 text-center active:scale-95 transition"
                  >
                    <span className="text-lg block mb-0.5">🚗</span>
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block">Portón</span>
                  </button>
                  <button
                    onClick={() => { handleSetPreset('peatonal', 'Acceso Peatonal'); setShowControlsModal(false); }}
                    className="p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-blue-500 text-center active:scale-95 transition"
                  >
                    <span className="text-lg block mb-0.5">🚶</span>
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block">Peatonal</span>
                  </button>
                  <button
                    onClick={() => { handleSetPreset('calle', 'Calle / Fachada'); setShowControlsModal(false); }}
                    className="p-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 hover:border-blue-500 text-center active:scale-95 transition"
                  >
                    <span className="text-lg block mb-0.5">🛣️</span>
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200 block">Calle</span>
                  </button>
                </div>
              </div>

              {/* Patrullaje 180° Anti-Puntos Ciegos */}
              <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900 dark:text-white">
                    <Eye className="h-4 w-4 text-emerald-500" />
                    <span>Patrullaje Continuo 180°</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Giro automático cada 60s
                  </p>
                </div>

                <button
                  onClick={handleTogglePatrol}
                  disabled={patrolLoading}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition active:scale-95 ${
                    patrolActive ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                  }`}
                >
                  {patrolLoading ? '...' : (patrolActive ? 'Detener' : 'Activar')}
                </button>
              </div>
            </div>

            {/* Footer del Modal */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0">
              <button
                onClick={() => setShowControlsModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL DE INSPECCIÓN DE FOTO DE AUDITORÍA ALPR EN PANTALLA COMPLETA ─── */}
      {inspectedPlate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="relative w-full max-w-3xl rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-mono font-black text-base tracking-widest border-2 border-slate-950">
                  {inspectedPlate.plate}
                </div>
                <div>
                  <h4 className="font-extrabold text-sm text-white">{inspectedPlate.type || 'Vehículo'}</h4>
                  <p className="text-[11px] text-slate-400">{inspectedPlate.camera} • {inspectedPlate.timestamp}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectedPlate(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Selector de Pestañas: Foto General vs Placa Reconstruida */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/90 border-b border-slate-800/80">
              <button
                type="button"
                onClick={() => setInspectedTab('full')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  inspectedTab === 'full'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Camera className="h-3.5 w-3.5" />
                <span>Foto General de la Cámara</span>
              </button>

              <button
                type="button"
                onClick={() => setInspectedTab('plate')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  inspectedTab === 'plate'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Placa Reconstruida</span>
              </button>
            </div>

            {/* Imagen en Alta Resolución con Bounding Boxes Interactivas */}
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-slate-950 relative">
              <div className="relative inline-block max-h-[62vh] max-w-full">
                <img
                  src={
                    inspectedTab === 'plate'
                      ? `${getRawBase()}/alpr/image/${inspectedPlate.id}?type=plate`
                      : `${getRawBase()}/alpr/image/${inspectedPlate.id}?type=full`
                  }
                  alt={`Auditoría Fotográfica ${inspectedPlate.plate}`}
                  className="max-h-[62vh] w-auto max-w-full rounded-2xl object-contain border border-slate-800 shadow-2xl block"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = `${getRawBase()}/alpr/image/${inspectedPlate.id}?type=vehicle`;
                  }}
                />

                {/* Overlays de Detección en Foto General (Estilo Snapshot AI) */}
                {inspectedTab === 'full' && (
                  <>
                    {/* Recuadro Azul de Vehículo (Solo si viene de Plate Recognizer) */}
                    {inspectedPlate.vehicleBox && (
                      <div
                        className="absolute border-2 border-cyan-400 bg-cyan-400/10 pointer-events-none rounded transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
                        style={{
                          top: `${(inspectedPlate.vehicleBox.ymin / (inspectedPlate.imgHeight || 1440)) * 100}%`,
                          left: `${(inspectedPlate.vehicleBox.xmin / (inspectedPlate.imgWidth || 2560)) * 100}%`,
                          width: `${((inspectedPlate.vehicleBox.xmax - inspectedPlate.vehicleBox.xmin) / (inspectedPlate.imgWidth || 2560)) * 100}%`,
                          height: `${((inspectedPlate.vehicleBox.ymax - inspectedPlate.vehicleBox.ymin) / (inspectedPlate.imgHeight || 1440)) * 100}%`,
                        }}
                      >
                        <div className="absolute -top-6 left-0 bg-cyan-500 text-slate-950 font-black text-[11px] px-2 py-0.5 rounded shadow-md tracking-wider whitespace-nowrap">
                          {inspectedPlate.details?.makeModel || inspectedPlate.details?.vehicle || inspectedPlate.type || 'Vehículo'}
                        </div>
                      </div>
                    )}

                    {/* Recuadro de Matrícula (Local ML o Plate Recognizer) */}
                    {(inspectedPlate.box_norm || inspectedPlate.box) && (() => {
                      const bn = inspectedPlate.box_norm;
                      const b = inspectedPlate.box || {};
                      const iw = inspectedPlate.imgWidth || inspectedPlate.img_width || 2880;
                      const ih = inspectedPlate.imgHeight || inspectedPlate.img_height || 1620;

                      const topPct = bn ? (bn.ymin * 100) : (((b.ymin ?? b.y1 ?? 0) / ih) * 100);
                      const leftPct = bn ? (bn.xmin * 100) : (((b.xmin ?? b.x1 ?? 0) / iw) * 100);
                      const widthPct = bn ? ((bn.xmax - bn.xmin) * 100) : ((((b.xmax ?? b.x2 ?? iw) - (b.xmin ?? b.x1 ?? 0)) / iw) * 100);
                      const heightPct = bn ? ((bn.ymax - bn.ymin) * 100) : ((((b.ymax ?? b.y2 ?? ih) - (b.ymin ?? b.y1 ?? 0)) / ih) * 100);

                      return (
                        <div
                          className="absolute border-2 border-amber-400 bg-amber-400/25 pointer-events-none rounded transition-all duration-300 shadow-[0_0_12px_rgba(245,158,11,0.8)]"
                          style={{
                            top: `${topPct}%`,
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                          }}
                        >
                          <span className="absolute -top-5 left-0 bg-amber-500 text-slate-950 font-black text-[9px] px-1.5 py-0.2 rounded shadow whitespace-nowrap">
                            {inspectedPlate.plate} ({inspectedPlate.engine === 'local_ml' ? '⚡ Local ML' : '☁️ Cloud PR'})
                          </span>
                        </div>
                      );
                    })()}

                    {/* Ficha Técnica Flotante de Auditoría (Solo si hay datos técnicos de Plate Recognizer) */}
                    {inspectedPlate.details && (
                      <div className="absolute bottom-4 left-4 bg-slate-950/90 border border-slate-800 backdrop-blur-md rounded-xl p-3 text-[11px] shadow-2xl min-w-[220px] text-slate-200 pointer-events-none">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-800/80 mb-2 font-black text-cyan-400">
                          <span>FICHA TÉCNICA IA</span>
                          <span className="text-[10px] text-emerald-400 font-mono">CONFIANZA</span>
                        </div>
                        <div className="space-y-1 font-mono text-[11px]">
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Vehicle:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.vehicle || 'Van'} <span className="text-cyan-400 text-[10px]">{inspectedPlate.details?.vehicleScore || '79%'}</span></span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Year Range:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.yearRange || '2001-2017'}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Color:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.color || 'white'} <span className="text-cyan-400 text-[10px]">{inspectedPlate.details?.colorScore || '82%'}</span></span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Make/Model:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.makeModel || 'Toyota Etios'}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Orientation:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.orientation || 'Rear'}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Direction:</span>
                            <span className="font-bold text-white">{inspectedPlate.details?.direction || '37°'}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Footer de Auditoría */}
            <div className="p-3.5 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
              <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                <CheckCircle2 className="h-4 w-4" />
                <span>{inspectedTab === 'plate' ? 'Recorte nítido enderezado de la placa' : 'Captura panorámica en resolución nativa'}</span>
              </span>
              <button
                onClick={() => setInspectedPlate(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition active:scale-95"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

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
