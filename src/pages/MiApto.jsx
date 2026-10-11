import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Hls from 'hls.js';
import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Building2, Calendar, Camera, Check, CheckCircle, ChevronDown, ChevronUp,
  Compass, Copy, Download, Droplets, ExternalLink, Eye, FileText, Flame, HardDrive, Info, Key, LayoutGrid, Loader2,
  LockKeyhole, LogOut, MapPin, Maximize2, Move, Play, QrCode, Radio, RefreshCw, ShieldCheck, Video, Volume2, VolumeX, Wifi, X, Zap,
  ChevronLeft, ChevronRight, ZoomIn, Mic, MicOff, PhoneCall,
} from 'lucide-react';
import QRCode from 'qrcode';
import { clearAuth, isTenant, isAdmin, getAuth, watchAuthRevoked, revalidateSession } from '../utils/auth';
import { AUTH_TOKEN, getBase, getRawBase } from '../utils/config';
import { formatCurrency, formatShortDate, formatRelativeDueDate, getCurrentPeriod, openEzvizApp, getSuspensionAlert, resolveSuspensionDate, resolveDueDate, cleanFinancingConcept } from '../utils/helpers';
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
  const [copiedRef, setCopiedRef] = useState(false);
  const classes = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[meta.theme];

  const handleCopyReference = async (e) => {
    e?.stopPropagation?.();
    if (service?.reference) {
      try {
        await navigator.clipboard.writeText(service.reference);
        setCopiedRef(true);
        setTimeout(() => setCopiedRef(false), 2500);
      } catch {}
    }
  };

  const handleOpenPayment = async () => {
    if (service?.reference) {
      try {
        await navigator.clipboard.writeText(service.reference);
        setCopiedRef(true);
        setTimeout(() => setCopiedRef(false), 3000);
      } catch {}
    }
  };

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
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-xs">
            <span className="text-slate-500 font-medium">Deuda del mes:</span>
            <strong className="text-sm font-bold text-slate-900">{known ? formatCurrency(debt) : '—'}</strong>

            {(service?.facturasPendientes > 1 || (Number(service?.deudaTotal) > 0 && Number(service?.deudaTotal) > (debt || 0))) && (
              <>
                <span className="text-rose-600 font-medium">Facturas sin pagar:</span>
                <strong className="text-rose-600 font-bold">{service.facturasPendientes || 2}</strong>
                <span className="text-amber-600 font-medium">Saldo anterior pendiente:</span>
                <strong className="text-amber-600 font-semibold">{formatCurrency((Number(service.deudaTotal) || 0) - (debt || 0))}</strong>
              </>
            )}

            {service?.deudaConveniosCOP !== undefined && service?.deudaConveniosCOP !== null && (
              <>
                <span className="text-slate-500 font-medium">Saldo financiado:</span>
                <strong className="font-semibold text-slate-800">{formatCurrency(service.deudaConveniosCOP || 0)}</strong>
              </>
            )}

            {service?.deudaTotal !== undefined && service?.deudaTotal !== null && (
              <>
                <span className="text-slate-500 font-medium">Deuda total:</span>
                <strong className={`font-bold ${Number(service.deudaTotal) > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatCurrency(service.deudaTotal)}</strong>
              </>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">Sincronizado: {colombiaDate(service?.checkedAt)}</p>
          {service?.error && !known && <p className="mt-2 line-clamp-2 text-xs text-amber-700">{service.error}</p>}

          {/* Financiaciones activas desglosadas (con concepto, cuota mensual, avance y saldos) */}
          {Array.isArray(service?.financiacion) && service.financiacion.length > 0 && (
            <details className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 text-xs">
              <summary className="cursor-pointer font-bold text-blue-600 hover:text-blue-700">
                Ver financiaciones ({service.financiacion.length})
              </summary>
              <div className="mt-2 space-y-2">
                {service.financiacion.map((item, index) => {
                  const totalCuotas = Number(item.cuotasTotales) || 0;
                  const actCuota = Number(item.cuotaActual) || 0;
                  const pendientes = item.cuotasPendientes != null ? item.cuotasPendientes : (totalCuotas > actCuota ? totalCuotas - actCuota : 0);
                  return (
                    <div key={index} className="rounded-lg bg-white p-2 border border-slate-200/80 shadow-xs text-[11px]">
                      <p className="font-bold text-slate-900">{cleanFinancingConcept(item.concepto) || cleanFinancingConcept(item.producto) || `Financiación ${index + 1}`}</p>
                      {item.producto && item.concepto && item.producto !== item.concepto && (
                        <p className="text-[10px] text-slate-500">{/^\d+$/.test(item.producto) ? `Ref./Producto: ${item.producto}` : cleanFinancingConcept(item.producto)}</p>
                      )}
                      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-slate-600">
                        {Number(item.cuotaCOP) > 0 && (
                          <>
                            <dt className="text-slate-500">Cuota mensual:</dt>
                            <dd className="font-bold text-slate-900">{formatCurrency(item.cuotaCOP)}</dd>
                          </>
                        )}
                        {totalCuotas > 0 && (
                          <>
                            <dt className="text-slate-500">Avance:</dt>
                            <dd className="font-medium text-slate-800">
                              Cuota {actCuota} de {totalCuotas} {pendientes > 0 ? `· Faltan ${pendientes}` : ''}
                            </dd>
                          </>
                        )}
                        <dt className="text-slate-500">Saldo pendiente:</dt>
                        <dd className="font-semibold text-rose-700">{formatCurrency(item.saldoCOP || 0)}</dd>
                        {Number(item.saldoInicialCOP) > 0 && (
                          <>
                            <dt className="text-slate-500">Saldo inicial:</dt>
                            <dd className="text-slate-600">{formatCurrency(item.saldoInicialCOP)}</dd>
                          </>
                        )}
                      </dl>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {/* Alerta de Suspensión / Corte en ROJO si está vencido o cerca del corte */}
          {(() => {
            const suspAlert = getSuspensionAlert(service, serviceKey);
            if (!suspAlert) return null;
            return (
              <div className={`mt-2.5 rounded-xl p-2.5 text-xs font-bold flex items-center gap-2 border ${
                suspAlert.level === 'critical'
                  ? 'bg-rose-100 text-rose-800 border-rose-300 animate-pulse'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}>
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{suspAlert.text}</span>
              </div>
            );
          })()}

          {/* Información oficial de la empresa (Corte/Suspensión, Vencimiento, Lectura y Consumo) */}
          {(() => {
            const fechaCorte = service?.fechaSuspension || resolveSuspensionDate(service, serviceKey) || service?.recentInvoices?.[0]?.fechaSuspension;
            const vencimiento = service?.vencimiento || resolveDueDate(service) || service?.recentInvoices?.[0]?.vencimiento;
            const lectura = service?.fechaLectura;
            const hasData = fechaCorte || vencimiento || lectura || (service?.consumoKwh !== null && service?.consumoKwh !== undefined) || (service?.consumoM3 !== null && service?.consumoM3 !== undefined);
            if (!hasData) return null;
            return (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-700 border border-slate-200/80">
                {fechaCorte && (
                  <span className="inline-flex items-center gap-1 text-rose-700">
                    ✂️ <span className="text-slate-500">Fecha de corte:</span> <strong className="font-bold text-rose-700">{formatShortDate(fechaCorte)}</strong>
                  </span>
                )}
                {vencimiento && (
                  <span className="inline-flex items-center gap-1">
                    ⏰ <span className="text-slate-500">Pagar antes de:</span> <strong className="font-semibold text-slate-800">{formatShortDate(vencimiento)}</strong>
                  </span>
                )}
                {lectura && (
                  <span className="inline-flex items-center gap-1">
                    📅 <span className="text-slate-500">Última lectura:</span> <strong className="font-semibold text-slate-800">{formatShortDate(lectura)}</strong>
                  </span>
                )}
                {service?.consumoKwh !== null && service?.consumoKwh !== undefined && (
                  <span className="inline-flex items-center gap-1">
                    ⚡ <span className="text-slate-500">Consumo:</span> <strong className="font-semibold text-slate-800">{service.consumoKwh} kWh</strong>
                  </span>
                )}
                {service?.consumoM3 !== null && service?.consumoM3 !== undefined && (
                  <span className="inline-flex items-center gap-1">
                    🔥 <span className="text-slate-500">Consumo:</span> <strong className="font-semibold text-slate-800">{service.consumoM3} m³</strong>
                  </span>
                )}
              </div>
            );
          })()}

          {/* Cuadradito de Historial de las Últimas 3 Facturas */}
          <div className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Calendar className="h-3.5 w-3.5 text-slate-500" /> Historial de Facturas
              </span>
              <span className="text-[10px] font-medium text-slate-400">Últimos 3 ciclos</span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(service?.recentInvoices || []).map((inv, idx) => {
                const isPaid = inv.estado === 'paid';
                return (
                  <div
                    key={idx}
                    className={`flex flex-col justify-between rounded-lg border p-2.5 transition ${
                      isPaid
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-rose-200 bg-rose-50/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-bold text-slate-800">{inv.label}</span>
                        <span
                          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            isPaid
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {isPaid ? (
                            <>
                              <CheckCircle className="h-2.5 w-2.5" /> Pagada
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="h-2.5 w-2.5" /> Debe saldo
                            </>
                          )}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-500">{inv.periodo}</p>
                    </div>

                    <div className="mt-2 border-t border-slate-200/60 pt-1.5">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-[10px] text-slate-500">Llegó en:</span>
                        <strong className="font-semibold text-slate-900">
                          {Number.isFinite(Number(inv.valorCOP)) && Number(inv.valorCOP) > 0
                            ? formatCurrency(inv.valorCOP)
                            : isPaid ? 'Al día' : '—'}
                        </strong>
                      </div>
                      {!isPaid && Number(inv.saldoCOP) > 0 && (
                        <div className="mt-0.5 flex items-baseline justify-between text-xs text-rose-700">
                          <span className="text-[10px] font-medium">Saldo:</span>
                          <strong className="font-bold">{formatCurrency(inv.saldoCOP)}</strong>
                        </div>
                      )}
                      {inv.vencimiento && (
                        <p className="mt-1 text-[9px] text-slate-500">
                          Vence: <strong className="font-semibold text-slate-700">{formatShortDate(inv.vencimiento)}</strong>
                        </p>
                      )}
                      {inv.fechaSuspension && (
                        <p className="text-[9px] text-rose-600 font-medium">
                          Corte: <strong className="font-bold">{formatShortDate(inv.fechaSuspension)}</strong>
                        </p>
                      )}
                      {inv.factura && (
                        <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">
                          N° {inv.factura}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {service?.paymentUrl && serviceKey === 'water' && (
              <a
                href={service.paymentUrl}
                target="_blank"
                rel="noreferrer"
                onClick={handleOpenPayment}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition"
              >
                <ExternalLink className="h-4 w-4" /> Pagar Triple A
              </a>
            )}
            {service?.paymentUrl && serviceKey === 'electricity' && (
              <a
                href={service.paymentUrl}
                target="_blank"
                rel="noreferrer"
                onClick={handleOpenPayment}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-600 active:scale-95 transition"
              >
                <ExternalLink className="h-4 w-4" /> Pagar Air-e
              </a>
            )}
            {service?.paymentUrl && serviceKey === 'gas' && (
              <a
                href={service.paymentUrl}
                target="_blank"
                rel="noreferrer"
                onClick={handleOpenPayment}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-rose-700 active:scale-95 transition"
              >
                <ExternalLink className="h-4 w-4" /> Pagar Gas
              </a>
            )}
            {service?.paymentUrl && service?.paymentMode === 'qr' && serviceKey !== 'water' && serviceKey !== 'gas' && serviceKey !== 'electricity' && (
              <button onClick={() => onToggleQr(serviceKey)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 active:scale-95 transition">
                <QrCode className="h-4 w-4" /> Mostrar QR
              </button>
            )}
            {service?.reference && (
              <button
                type="button"
                onClick={handleCopyReference}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition"
                title={`Copiar ${service.referenceLabel || 'código'}`}
              >
                {copiedRef ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                <span>{copiedRef ? `¡${service.referenceLabel || 'Código'} Copiado!` : `Copiar ${service.referenceLabel || 'Código'}`}</span>
              </button>
            )}
            {!service?.paymentUrl && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Pago aún no configurado</span>}
          </div>
          {copiedRef && (
            <p className="mt-1.5 text-[11px] font-medium text-emerald-600">
              ✓ {service?.referenceLabel || 'Código'} {service?.reference} copiado en el portapapeles. Pégalo en el portal de pago.
            </p>
          )}
          {qrUrl && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
              <img src={qrUrl} alt={`QR de pago ${meta.title}`} className="mx-auto h-44 w-44" />
              <a href={service.paymentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">Abrir pago <ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

const APTO_CAMERAS = [
  { id: 'gate', name: 'Portón Principal', serial: 'BG6994814', location: 'Entrada Principal', isGate: true },
  { id: 'izq', name: 'Cámara Izquierda', serial: 'BG6994872', location: 'Fachada Izquierda', isGate: false },
  { id: 'der', name: 'Cámara Derecha', serial: 'BG6994741', location: 'Fachada Derecha', isGate: false },
];

// ─── Video HLS autónomo: un Hls + watchdog propios por cada cámara ──────────
// Negro honesto: sin frames en 8s reporta error (el tile muestra negro +
// "Sincronizando"), nunca foto vieja.
function LiveVideo({ streamUrl, active, onState, className, isMuted = true }) {
  const ref = useRef(null);
  const watchRef = useRef({ setAt: Date.now() });
  const repRef = useRef(''); // deja pasar solo transiciones (sin re-render 4x/s)
  const [blocked, setBlocked] = useState(false);
  const stateRef = useRef(onState);
  stateRef.current = onState;

  useEffect(() => {
    const video = ref.current;
    if (video) {
      video.muted = isMuted;
      if (!isMuted) {
        video.volume = 1.0;
        video.play().catch(() => {});
      }
    }
  }, [isMuted]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !streamUrl || !active) {
      if (stateRef.current) stateRef.current({ playing: false, error: !streamUrl });
      return;
    }
    setBlocked(false);
    watchRef.current = { setAt: Date.now() };
    let hls = null;
    let cancelled = false;
    const report = (s) => {
      const k = (s.playing ? 'p' : 's') + (s.error ? 'e' : '');
      if (cancelled || repRef.current === k) return;
      repRef.current = k;
      if (stateRef.current) stateRef.current(s);
    };
    const attemptPlay = () => {
      try { video.muted = isMuted; } catch {}
      video.play().then(() => setBlocked(false)).catch(() => {
        try { video.muted = true; } catch {}
        video.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
      });
    };
    let onMeta = null;
    if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 2,
        maxLiveSyncPlaybackRate: 1.15,
        maxBufferLength: 3,
        maxMaxBufferLength: 6,
        backBufferLength: 1,
        manifestLoadingTimeOut: 3000,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 300,
        levelLoadingTimeOut: 3000,
        levelLoadingMaxRetry: 6,
        fragLoadingTimeOut: 3000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 300,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay);
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch {} return; }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); } catch {} return; }
        report({ playing: false, error: true });
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      onMeta = attemptPlay;
      video.addEventListener('loadedmetadata', onMeta);
    }
    const onPlaying = () => { watchRef.current.setAt = Date.now(); report({ playing: true, error: false }); };
    const onStall = () => report({ playing: false, error: false });
    const onTick = () => {
      if ((video.currentTime || 0) > 0) { watchRef.current.setAt = Date.now(); report({ playing: true, error: false }); }
    };
    const onVideoError = () => report({ playing: false, error: true });
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onStall);
    video.addEventListener('pause', onStall);
    video.addEventListener('timeupdate', onTick);
    video.addEventListener('error', onVideoError);
    const timer = setInterval(() => {
      if (Date.now() - watchRef.current.setAt > 8000) report({ playing: false, error: true });
      // Sincronización activa contra desfases entre cámaras (pegado al borde vivo en cableado):
      if (hls && video && !video.paused && typeof hls.liveSyncPosition === 'number' && hls.liveSyncPosition > 0) {
        const drift = hls.liveSyncPosition - video.currentTime;
        if (drift > 2.0) {
          video.currentTime = hls.liveSyncPosition;
        }
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onStall);
      video.removeEventListener('pause', onStall);
      video.removeEventListener('timeupdate', onTick);
      video.removeEventListener('error', onVideoError);
      if (onMeta) video.removeEventListener('loadedmetadata', onMeta);
      if (hls) { try { hls.destroy(); } catch {} }
    };
  }, [streamUrl, active]);

  return (
    <div className="relative h-full w-full bg-slate-950">
      <video ref={ref} autoPlay playsInline muted={isMuted} className={className || 'h-full w-full object-cover'} />
      {blocked && (
        <button
          onClick={(e) => { e.stopPropagation(); const v = ref.current; if (v) { v.muted = isMuted; v.play().then(() => setBlocked(false)).catch(() => {}); } }}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
        >
          <span className="rounded-full border border-white/30 bg-white/20 p-4"><Play className="h-8 w-8 text-white" /></span>
        </button>
      )}
    </div>
  );
}

const ZOOM_LEVELS = [1, 2, 4, 6, 8];

// ─── Modal horizontal: zoom digital por botones + pan con dedos ─────────────
// Los streams ya están activos (la lista los mantiene vivos): atrás/adelante
// no recarga nada. X arriba-derecha para salir.
function CameraZoomModal({
  cams, index, streamUrls, fallbackUrls, tileState, onClose, onIndex, showPtz, onPtz, ptzMoving,
  activeAudioSerial, onToggleAudio
}) {
  const cam = cams[index];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);
  const playing = tileState[cam.serial]?.playing;

  const startDrag = (e) => {
    if (zoom <= 1) return;
    const el = boxRef.current;
    const r = el ? el.getBoundingClientRect() : { width: 320, height: 200 };
    dragRef.current = {
      sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y,
      mx: ((zoom - 1) * r.width) / 2, my: ((zoom - 1) * r.height) / 2,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };
  const moveDrag = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({
      x: Math.max(-d.mx, Math.min(d.mx, d.px + (e.clientX - d.sx))),
      y: Math.max(-d.my, Math.min(d.my, d.py + (e.clientY - d.sy))),
    });
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${playing ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`} />
          <p className="text-sm font-bold text-white">{cam.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${playing ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {playing ? 'En vivo' : 'Sincronizando…'}
          </span>
        </div>
        <button onClick={onClose} title="Salir" className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={boxRef}
        className="relative flex-1 overflow-hidden"
        style={{ touchAction: zoom > 1 ? 'none' : 'auto' }}
        onClick={e => e.stopPropagation()}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <div className="h-full w-full" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}>
            <LiveVideo
              streamUrl={streamUrls[cam.serial] || (fallbackUrls || {})[cam.serial]}
              active
              isMuted={activeAudioSerial !== cam.serial}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onIndex((index + cams.length - 1) % cams.length); }}
          title="Cámara anterior"
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button
          onClick={e => { e.stopPropagation(); onIndex((index + 1) % cams.length); }}
          title="Siguiente cámara"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Controles de Audio exterior en pantalla completa */}
      {(cam.serial === 'BG6994814' || cam.serial === 'BG6994872') && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 bg-slate-950/80 border-t border-white/10" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onToggleAudio(cam.serial)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95 ${
              activeAudioSerial === cam.serial
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-white/10 text-slate-300 hover:bg-white/20 border border-white/10'
            }`}
          >
            {activeAudioSerial === cam.serial ? <Volume2 className="h-4 w-4 text-amber-400" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
            <span>{activeAudioSerial === cam.serial ? 'Silenciar audio exterior' : 'Escuchar audio exterior'}</span>
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-2 px-4 py-3" onClick={e => e.stopPropagation()}>
        <ZoomIn className="h-4 w-4 text-slate-400" />
        {ZOOM_LEVELS.map(z => (
          <button
            key={z}
            onClick={() => { setZoom(z); setPan({ x: 0, y: 0 }); }}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${zoom === z ? 'bg-blue-600 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}
          >
            x{z}
          </button>
        ))}
      </div>

      {showPtz && (
        <div className="flex items-center justify-center gap-2 px-4 pb-4" onClick={e => e.stopPropagation()}>
          {['left', 'up', 'down', 'right'].map(dir => (
            <button
              key={dir}
              onClick={() => onPtz(dir, cam.serial)}
              disabled={Boolean(ptzMoving)}
              className="rounded-lg bg-white/10 px-4 py-1.5 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-50"
            >
              {dir === 'left' ? '◀' : dir === 'right' ? '▶' : dir === 'up' ? '▲' : '▼'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  // 24/7 sin auto-corte: el motor Always-On mantiene el vivo tibio; la pausa es manual.
  // Lista vertical: las 3 cámaras reproducen video HLS a la vez, mismo tamaño.
  const [tileState, setTileState] = useState({}); // serial -> { playing, error }
  const [zoomIdx, setZoomIdx] = useState(null); // índice APTO_CAMERAS en modal, null = cerrado
  const [streamUrls, setStreamUrls] = useState({});
  const [modalUrls, setModalUrls] = useState({}); // main para zoom (se pide al abrir el modal)
  const [streamErrors, setStreamErrors] = useState({});
  const [streamingActive, setStreamingActive] = useState(true);
  const [ptzMoving, setPtzMoving] = useState(''); // 'up' | 'down' | 'left' | 'right' | ''
  const [ptzFeedback, setPtzFeedback] = useState('');
  const [showEzvizGuide, setShowEzvizGuide] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');

  // Estado de audio desmuteado para cámaras
  const [activeAudioSerial, setActiveAudioSerial] = useState(null);

  function toggleAudio(serial) {
    setActiveAudioSerial(prev => (prev === serial ? null : serial));
  }


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

    // En paralelo: el loop secuencial hacía que l/r arrancaran segundos
    // después del portón (cada /stream puede tardar hasta ~2.5s).
    await Promise.allSettled(APTO_CAMERAS.map(async (cam) => {
      try {
        const res = await fetch(`${getRawBase()}/api/cameras/${cam.serial}/stream`);
        const data = await res.json().catch(() => ({}));
        if (data.ok && data.streamUrl) {
          const rawBase = getRawBase();
          const fullUrl = data.streamUrl.startsWith('http')
            ? data.streamUrl
            : `${rawBase}${data.streamUrl.startsWith('/') ? '' : '/'}${data.streamUrl}`;
          setStreamUrls(prev => ({ ...prev, [cam.serial]: fullUrl }));
          setModalUrls(prev => ({ ...prev, [cam.serial]: fullUrl }));
          setStreamErrors(prev => ({ ...prev, [cam.serial]: false }));
        }
      } catch {}
    }));
  }

  useEffect(() => {
    loadStreams();
  }, []);

  // loadStreams() ya precalienta las 3 al montar: no duplicar requests aquí.

  // Cargar o reactivar stream para una cámara específica a máxima resolución nativa (main)
  async function requestCameraStream(serial, quality = 'main') {
    if (!serial) return;
    try {
      const q = quality === 'sub' ? '?quality=sub' : '';
      const res = await fetch(`${getRawBase()}/api/cameras/${serial}/stream${q}`);
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.streamUrl) {
        const rawBase = getRawBase();
        const fullUrl = data.streamUrl.startsWith('http')
          ? data.streamUrl
          : `${rawBase}${data.streamUrl.startsWith('/') ? '' : '/'}${data.streamUrl}`;
        setStreamUrls(prev => ({ ...prev, [serial]: fullUrl }));
        setModalUrls(prev => ({ ...prev, [serial]: fullUrl }));
        setStreamErrors(prev => ({ ...prev, [serial]: false }));
      }
    } catch {}
  }

  // Al abrir el modal se pide el main (calidad para zoom); al cerrar se conserva en caché.
  useEffect(() => {
    if (zoomIdx == null) return;
    requestCameraStream(APTO_CAMERAS[zoomIdx].serial, 'main');
  }, [zoomIdx]);

  // Latido de permanencia (cada 7s) para las 3 cámaras activas a máxima calidad.
  useEffect(() => {
    if (!cameraLive) return;
    APTO_CAMERAS.forEach(cam => requestCameraStream(cam.serial, 'main'));

    const ping = () => {
      // Sin latido en pestaña oculta: evita mantener el motor caliente en vano.
      if (document.visibilityState === 'hidden') return;
      APTO_CAMERAS.forEach(cam => {
        fetch(`${getRawBase()}/api/cameras/${cam.serial}/ping`, { method: 'POST' }).catch(() => {});
      });
    };
    ping();
    const interval = setInterval(ping, 7000);
    return () => clearInterval(interval);
  }, [cameraLive]);

  // El video lo maneja <LiveVideo> por cámara (Hls + watchdog propios).

  // Al volver a la pestaña (incl. bfcache): revalidar sesión y reactivar
  // los 3 streams (los <LiveVideo> se re-suscriben solos al cambiar la URL).
  useEffect(() => {
    const resume = () => {
      // Al volver, revalidar primero: detecta inquilino eliminado o sesión
      // revocada mientras la pestaña estaba oculta (sale limpio a login).
      revalidateSession().then(result => {
        if (!result.ok) navigate('/login', { replace: true });
      }).catch(() => {});
      if (!cameraLive) return;
      APTO_CAMERAS.forEach(cam => {
        requestCameraStream(cam.serial, 'sub');
        fetch(`${getRawBase()}/api/cameras/${cam.serial}/ping`, { method: 'POST' }).catch(() => {});
      });
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') resume(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', resume);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', resume);
    };
  }, [cameraLive]);



  // Sin miniaturas JPEG: las 3 cámaras son video HLS permanente.

  function toggleCameraLive() {
    setCameraLive(prev => !prev);
  }

  async function handleMovePtz(direction, serial) {
    if (ptzMoving) return;
    const target = serial || (zoomIdx != null ? APTO_CAMERAS[zoomIdx].serial : APTO_CAMERAS[0].serial);
    setPtzMoving(direction);
    const dirNames = { up: 'ARRIBA', down: 'ABAJO', left: 'IZQUIERDA', right: 'DERECHA' };
    setPtzFeedback(`Moviendo ${dirNames[direction] || direction}...`);
    try {
      const res = await fetch(`${getRawBase()}/api/cameras/${target}/ptz`, {
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
    // Re-solicita los 3 streams (sub) y limpia errores (los <LiveVideo> reanexan solos).
    APTO_CAMERAS.forEach(cam => {
      setStreamErrors(prev => ({ ...prev, [cam.serial]: false }));
      requestCameraStream(cam.serial, 'sub');
    });
  }

  useEffect(() => {
    if (!isTenant() && !isAdmin()) { navigate('/login', { replace: true }); return; }
    if (isTenant()) loadData();
    // Si otra pestaña cierra sesión, limpiar TODO (incluido el
    // sessionStorage propio, que si no resucita el token) y salir.
    return watchAuthRevoked(async () => {
      await clearAuth({}, 'cross_tab_logout');
      navigate('/login', { replace: true });
    });
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

  async function handleLogout() {
    await clearAuth({ permanent: true }, 'tenant_user_logout');
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

              {streamingActive && (() => {
                const liveCount = APTO_CAMERAS.filter(c => tileState[c.serial]?.playing).length;
                const allLive = liveCount === APTO_CAMERAS.length;
                return (
                  <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border ${allLive ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${allLive ? 'bg-emerald-600 animate-ping' : 'bg-amber-500 animate-pulse'}`} />
                    <span>{allLive ? '3/3 EN VIVO' : `${liveCount}/3 SINCRONIZANDO…`}</span>
                  </span>
                );
              })()}



              <button
                onClick={toggleCameraLive}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition shadow-sm ${
                  cameraLive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${cameraLive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                {cameraLive ? 'EN VIVO 24/7' : 'PAUSADO'}
              </button>
            </div>
          </div>


          {/* Lista vertical: toca una cámara para verla en grande con zoom */}
          <div className="mt-3.5 border-b border-slate-100 pb-3">
            <span className="text-[11px] text-slate-400 font-medium">
              Las 3 cámaras transmiten en vivo — tócalas para zoom y moverlas
            </span>
          </div>

          {/* Lista vertical: las 3 cámaras en video, mismo tamaño, siempre activas */}
          <div className="mt-3.5 space-y-4">
            {APTO_CAMERAS.map((cam, idx) => {
              const st = tileState[cam.serial] || {};
              const url = streamUrls[cam.serial] || '';
              return (
                <div key={cam.serial} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${st.playing ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${st.playing ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900 leading-none">{cam.name}</h3>
                          <span className={`rounded-full text-[10px] font-bold px-2 py-0.5 ${st.playing ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {st.playing ? 'En vivo' : 'Sincronizando…'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{cam.location}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setTileState(prev => ({ ...prev, [cam.serial]: { playing: false, error: false } }));
                        setStreamUrls(prev => { const n = { ...prev }; delete n[cam.serial]; return n; });
                        requestCameraStream(cam.serial, 'main');
                      }}
                      title="Reconectar cámara"
                      className="rounded-xl bg-slate-100 p-2 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div
                    onClick={() => setZoomIdx(idx)}
                    className="group relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-950 shadow-lg border border-slate-800 cursor-pointer"
                  >
                    {url && cameraLive ? (
                      <LiveVideo
                        streamUrl={url}
                        active={cameraLive}
                        isMuted={activeAudioSerial !== cam.serial}
                        onState={(s) => setTileState(prev => ({ ...prev, [cam.serial]: s }))}
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
                        <Camera className="h-6 w-6 text-blue-400 animate-pulse mb-1" />
                        <p className="text-[11px] text-slate-400">Sincronizando señal en vivo...</p>
                      </div>
                    )}
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/50 p-1.5 text-white opacity-80 group-hover:opacity-100">
                      <Maximize2 className="h-4 w-4" />
                    </span>
                  </div>

                  {/* Control de Audio exterior de la cámara */}
                  {(cam.serial === 'BG6994814' || cam.serial === 'BG6994872') && (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-2 border border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => toggleAudio(cam.serial)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition active:scale-95 ${
                          activeAudioSerial === cam.serial
                            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                            : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-sm'
                        }`}
                      >
                        {activeAudioSerial === cam.serial ? (
                          <Volume2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <VolumeX className="h-4 w-4 text-slate-500" />
                        )}
                        <span>{activeAudioSerial === cam.serial ? 'Escuchando audio exterior' : 'Escuchar audio'}</span>
                      </button>

                      <span className="text-[11px] text-slate-500 font-medium">
                        {cam.serial === 'BG6994814' ? 'Micrófono en portón' : 'Micrófono en terraza'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {zoomIdx != null && (
            <CameraZoomModal
              cams={APTO_CAMERAS}
              index={zoomIdx}
              streamUrls={modalUrls}
              fallbackUrls={streamUrls}
              tileState={tileState}
              onClose={() => setZoomIdx(null)}
              onIndex={setZoomIdx}
              showPtz={isAdmin()}
              onPtz={handleMovePtz}
              ptzMoving={ptzMoving}
              activeAudioSerial={activeAudioSerial}
              onToggleAudio={toggleAudio}
            />
          )}

          {/* Barra de Acciones y Acceso a la App Ezviz */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
            <button
              onClick={refreshAllCameras}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
              Reconectar cámaras
            </button>

            <button
              onClick={openEzvizApp}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 active:scale-95 transition"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Ver en App Ezviz (3K a 25fps + Joystick 360°)
            </button>
          </div>

          {/* Acceso a App Ezviz para grabaciones */}
          <div className="mt-3 rounded-xl bg-slate-50 p-3 border border-slate-100">
            <div className="flex items-center justify-between">
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

        {contract && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><FileText className="h-4 w-4" /> Contrato</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Inicio</p><strong>{formatShortDate(contract.startDate)}</strong></div><div><p className="text-xs text-slate-500">Finaliza</p><strong>{contract.endDate ? formatShortDate(contract.endDate) : 'Indefinido'}</strong></div></div>{contract.contractFile && <a href={contract.contractFile} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Download className="h-4 w-4" /> Ver contrato</a>}</section>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Calendar className="h-4 w-4" /> Historial de pagos</h2>{payments.length ? <div className="mt-2 divide-y divide-slate-100">{payments.slice(0, 12).map(payment => <div key={payment.id} className="flex items-center justify-between py-2.5 text-sm"><span className="text-slate-500">{formatShortDate(payment.date)}</span><strong className={payment.status === 'pending_validation' ? 'text-amber-600' : payment.status === 'rejected' ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(payment.amount)}</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-400">Sin pagos registrados.</p>}</section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-4 w-4" /> Tu apartamento</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm">{apt.area > 0 && <div><p className="text-xs text-slate-500">Área</p><strong>{apt.area} m²</strong></div>}{apt.floor > 0 && <div><p className="text-xs text-slate-500">Piso</p><strong>{apt.floor}</strong></div>}{apt.rooms > 0 && <div><p className="text-xs text-slate-500">Habitaciones</p><strong>{apt.rooms}</strong></div>}{apt.bathrooms > 0 && <div><p className="text-xs text-slate-500">Baños</p><strong>{apt.bathrooms}</strong></div>}</div></section>
      </main>
      {activeCall?.active && activeCall.call && (
        <IntercomCallModal
          call={activeCall.call}
          onClose={() => setActiveCall(null)}
          onAction={() => setActiveCall(null)}
        />
      )}




    </div>
  );
}
