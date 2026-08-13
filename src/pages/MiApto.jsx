import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Building2, Calendar, Camera, Download,
  Droplets, ExternalLink, FileText, Flame, LockKeyhole, LogOut,
  MapPin, QrCode, RefreshCw, ShieldCheck, Zap,
} from 'lucide-react';
import QRCode from 'qrcode';
import { clearAuth, isTenant } from '../utils/auth';
import { AUTH_TOKEN, getBase } from '../utils/config';
import { formatCurrency, formatShortDate, formatRelativeDueDate, getCurrentPeriod } from '../utils/helpers';

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
  const classes = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  }[meta.theme];
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
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">Deuda total</p>
          <p className="text-2xl font-bold text-slate-900">{known ? formatCurrency(debt) : '—'}</p>
          <p className="mt-1 text-[11px] text-slate-500">Sincronizado: {colombiaDate(service?.checkedAt)}</p>
          {service?.error && !known && <p className="mt-2 line-clamp-2 text-xs text-amber-700">{service.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {service?.paymentUrl && service?.paymentMode === 'qr' && (
              <button onClick={() => onToggleQr(serviceKey)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                <QrCode className="h-4 w-4" /> Mostrar QR
              </button>
            )}
            {service?.paymentUrl && service?.paymentMode === 'nic' && (
              <a href={service.paymentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white">
                <ExternalLink className="h-4 w-4" /> Pagar con NIC
              </a>
            )}
            {!service?.paymentUrl && <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Pago aún no configurado</span>}
          </div>
          {qrUrl && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-center">
              <img src={qrUrl} alt={`QR de pago ${meta.title}`} className="mx-auto h-44 w-44" />
              <a href={service.paymentUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700">Abrir pago <ExternalLink className="h-3.5 w-3.5" /></a>
            </div>
          )}
        </div>
      </div>
    </article>
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

  useEffect(() => {
    if (!isTenant()) { navigate('/login', { replace: true }); return; }
    loadData();
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
        clearAuth();
        navigate('/login', { replace: true });
        return;
      }
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    clearAuth();
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

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-100 p-2.5 text-blue-700"><Camera className="h-5 w-5" /></div><div><h2 className="font-bold text-slate-900">Cámara del frente</h2><p className="text-xs text-slate-500">Solo transmisiones autorizadas para inquilinos</p></div></div>
          {cameras.length ? <div className="mt-3 flex flex-wrap gap-2">{cameras.map(camera => <button key={camera.id} onClick={() => openCamera(camera)} disabled={cameraBusy === camera.id || !data.edgeGatewayConnected} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300">{cameraBusy === camera.id ? 'Conectando…' : `Ver ${camera.name}`}</button>)}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">La cámara quedará disponible cuando se conecte la pasarela local.</p>}
          {cameraView?.playbackUrl && <div className="mt-3 overflow-hidden rounded-xl bg-black"><iframe src={cameraView.playbackUrl} title={cameraView.camera?.name || 'Cámara'} allow="autoplay; fullscreen" className="aspect-video w-full border-0" /></div>}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700"><LockKeyhole className="h-5 w-5" /></div><div><h2 className="font-bold text-slate-900">Acceso principal</h2><p className="text-xs text-slate-500">Cada apertura requiere confirmación y queda auditada</p></div></div>
          {doors.length ? <div className="mt-3 space-y-2">{doors.map(door => <button key={door.id} onClick={() => unlockDoor(door)} disabled={doorBusy === door.id || !data.edgeGatewayConnected} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300"><LockKeyhole className="h-4 w-4" />{doorBusy === door.id ? 'Solicitando…' : `Abrir ${door.name}`}</button>)}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">El botón se activará cuando se instale el relé y la cerradura.</p>}
          {actionMessage && <p className={`mt-3 rounded-lg p-2.5 text-xs ${actionMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{actionMessage.text}</p>}
        </section>

        {contract && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><FileText className="h-4 w-4" /> Contrato</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-slate-500">Inicio</p><strong>{formatShortDate(contract.startDate)}</strong></div><div><p className="text-xs text-slate-500">Finaliza</p><strong>{contract.endDate ? formatShortDate(contract.endDate) : 'Indefinido'}</strong></div></div>{contract.contractFile && <a href={contract.contractFile} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Download className="h-4 w-4" /> Ver contrato</a>}</section>}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Calendar className="h-4 w-4" /> Historial de pagos</h2>{payments.length ? <div className="mt-2 divide-y divide-slate-100">{payments.slice(0, 12).map(payment => <div key={payment.id} className="flex items-center justify-between py-2.5 text-sm"><span className="text-slate-500">{formatShortDate(payment.date)}</span><strong className={payment.status === 'pending_validation' ? 'text-amber-600' : payment.status === 'rejected' ? 'text-rose-600' : 'text-emerald-600'}>{formatCurrency(payment.amount)}</strong></div>)}</div> : <p className="mt-3 text-sm text-slate-400">Sin pagos registrados.</p>}</section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><MapPin className="h-4 w-4" /> Tu apartamento</h2><div className="mt-3 grid grid-cols-2 gap-3 text-sm">{apt.area > 0 && <div><p className="text-xs text-slate-500">Área</p><strong>{apt.area} m²</strong></div>}{apt.floor > 0 && <div><p className="text-xs text-slate-500">Piso</p><strong>{apt.floor}</strong></div>}{apt.rooms > 0 && <div><p className="text-xs text-slate-500">Habitaciones</p><strong>{apt.rooms}</strong></div>}{apt.bathrooms > 0 && <div><p className="text-xs text-slate-500">Baños</p><strong>{apt.bathrooms}</strong></div>}</div></section>

        <div className="flex items-start gap-2 rounded-2xl bg-blue-50 p-4 text-xs text-blue-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>La cámara y la cerradura se autorizan desde Render, pero el video y la orden física pasan por la pasarela local. Tus credenciales del NVR nunca se muestran aquí.</p></div>
      </main>
    </div>
  );
}
