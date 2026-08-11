import { useState, useEffect } from 'react';
import { Zap, Droplets, Flame, Search, ExternalLink, ChevronLeft, ChevronRight, RefreshCw, MessageCircle } from 'lucide-react';
import { api } from '../api';
import { getCurrentPeriod, getPeriodLabel, nextPeriod, prevPeriod } from '../utils/helpers';
import { getBase, AUTH_TOKEN } from '../utils/config';

const services = {
  water: {
    name: 'Triple A', icon: Droplets, color: 'from-blue-500 to-blue-600', textColor: 'text-blue-600',
    bgLight: 'bg-blue-50', badgeColor: 'bg-blue-100 text-blue-700', codeLabel: 'N° Póliza',
  },
  gas: {
    name: 'Gases del Caribe', icon: Flame, color: 'from-amber-500 to-orange-600', textColor: 'text-amber-600',
    bgLight: 'bg-amber-50', badgeColor: 'bg-amber-100 text-amber-700', codeLabel: 'N° Contrato',
  },
  electricity: {
    name: 'Air-e', icon: Zap, color: 'from-purple-500 to-violet-600', textColor: 'text-purple-600',
    bgLight: 'bg-purple-50', badgeColor: 'bg-purple-100 text-purple-700', codeLabel: 'NIC',
  },
};

function timeAgo(iso) {
  if (!iso) return 'sin datos';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'recién actualizado';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'hace menos de 1 h';
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function waterBillLabel(bill) {
  if (!bill) return '';
  const debt = Number(bill.deudaCOP);
  if (Number.isFinite(debt) && debt > 0) return `Deuda Total: $${debt.toLocaleString('es-CO')}`;
  if (bill.status === 'pending') return 'Deuda Total pendiente · valor no informado';
  if (bill.status === 'paid') return 'Al día · Sin deuda';
  if (bill.status === 'captcha') return 'Requiere verificación manual';
  if (bill.status === 'timeout') return 'Consulta agotó el tiempo';
  if (bill.status === 'error') return 'Portal sin datos confirmados';
  return 'Estado no identificado';
}

function waterBillClass(bill) {
  if (bill?.status === 'pending' && Number(bill.deudaCOP) > 0) return 'text-red-600 dark:text-red-400';
  if (bill?.status === 'paid') return 'text-emerald-600 dark:text-emerald-400';
  return 'text-amber-600 dark:text-amber-400';
}

function waterBillMeta(bill) {
  if (!bill) return '';
  const parts = [];
  if (bill.factura) parts.push(`factura ${bill.factura}`);
  if (bill.periodo) parts.push(`periodo ${bill.periodo}`);
  if (bill.actualizado) parts.push(`datos ${timeAgo(bill.actualizado)}`);
  return parts.join(' · ');
}

const PORTALS = [
  { key: 'electricity', name: 'Energía', icon: Zap, url: 'https://portal.air-e.com/Login?returnurl=%2fMis-Facturas%2fListado-de-Facturas' },
  { key: 'water', name: 'Agua', icon: Droplets, url: 'https://portal.aaa.com.co/polizas' },
  { key: 'gas', name: 'Gas', icon: Flame, url: 'https://portal.gascaribe.com/login' },
];

export default function Utilities() {
  const [apartments, setApartments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [debts, setDebts] = useState({});
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [waterSyncingNow, setWaterSyncingNow] = useState(false);
  const [waterSyncNote, setWaterSyncNote] = useState('');
  const [gasSyncingNow, setGasSyncingNow] = useState(false);
  const [gasSyncNote, setGasSyncNote] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const [a, t, c] = await Promise.all([
      api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray(),
    ]);
    setApartments(a); setTenants(t); setContracts(c);
    await loadDebts(a);
  }

  async function loadDebts(apts) {
    const entries = {};
    await Promise.all((apts || []).map(async apt => {
      try {
        const res = await fetch(getBase() + '/public/utility-status/' + apt.id, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const data = await res.json();
        const electricity = data?.services?.electricity?.payment;
        const water = data?.services?.water?.payment;
        const gas = data?.services?.gas?.payment;
        if (electricity || water || gas) entries[apt.id] = { electricity, water, gas };
      } catch {}
    }));
    setDebts(entries);
  }

  async function handleSync() {
    if (syncingNow) return;
    setSyncingNow(true);
    setSyncNote('Sincronizando deuda de Air-e…');
    try {
      const res = await fetch(getBase() + '/scrape-air-e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          setSyncNote('Sin permisos de administración para sincronizar.');
        } else {
          setSyncNote('El servidor rechazó la sincronización.');
        }
        setSyncingNow(false);
        return;
      }
      setSyncNote('Scrape en curso, actualizando datos…');
      setTimeout(async () => {
        try { await loadDebts(apartments); } catch {}
        setSyncingNow(false);
        setSyncNote('');
      }, 45000);
    } catch {
      setSyncNote('No se pudo iniciar la sincronización. Verifica la conexión.');
      setSyncingNow(false);
    }
  }

  async function handleWaterSync() {
    if (waterSyncingNow) return;
    setWaterSyncingNow(true);
    setWaterSyncNote('Consultando el portal global de Triple A…');
    try {
      const res = await fetch(getBase() + '/scrape-water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        setWaterSyncNote(res.status === 401 || res.status === 403 ? 'Sin permisos de administración para consultar agua.' : 'El servidor rechazó la consulta.');
        setWaterSyncingNow(false);
        return;
      }
      setWaterSyncNote('Consulta en curso; actualizando resultados…');
      setTimeout(async () => {
        try { await loadDebts(apartments); } catch {}
        setWaterSyncingNow(false);
        setWaterSyncNote('');
      }, 120000);
    } catch {
      setWaterSyncNote('No se pudo iniciar la consulta de agua. Verifica la conexión.');
      setWaterSyncingNow(false);
    }
  }

  async function handleGasSync() {
    if (gasSyncingNow) return;
    setGasSyncingNow(true);
    setGasSyncNote('Consultando el portal global de Gases del Caribe…');
    try {
      const res = await fetch(getBase() + '/scrape-gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        setGasSyncNote(res.status === 401 || res.status === 403 ? 'Sin permisos de administración para consultar gas.' : 'El servidor rechazó la consulta.');
        setGasSyncingNow(false);
        return;
      }
      setGasSyncNote('Consulta en curso; actualizando resultados…');
      setTimeout(async () => {
        try { await loadDebts(apartments); } catch {}
        setGasSyncingNow(false);
        setGasSyncNote('');
      }, 120000);
    } catch {
      setGasSyncNote('No se pudo iniciar la consulta de gas. Verifica la conexión.');
      setGasSyncingNow(false);
    }
  }

  function getActiveTenant(aptId) {
    const contract = contracts.find(c => c.apartmentId === aptId && (!c.endDate || new Date(c.endDate) > new Date()));
    return contract ? tenants.find(t => t.id === contract.tenantId) : null;
  }

  async function handleWhatsAppServices(apt) {
    const tenant = getActiveTenant(apt.id);
    if (!tenant || !tenant.phone) { alert('El inquilino no tiene teléfono registrado'); return; }
    const num = tenant.phone.replace(/[^0-9]/g, '');
    const fullNum = num.startsWith('57') ? num : '57' + num;
    const template = localStorage.getItem('wa_template_services') || '👋 ¡Hola {nombre}!\n\nTe habla la administración de la inmobiliaria. Sabemos que es fácil perder la información de pago de los servicios, por eso te compartimos los enlaces directos:\n\n🌬️ Aire: {link_aire}\n💧 Triple A: {link_triplea}\n🔥 Gases: {link_gases}\n\n📌 También puedes ingresar a nuestro sistema con tu apartamento {apto} y tu cédula para consultar esta información y contactarnos por el chat directo.\n👉 https://laujim-app.onrender.com/login\n\n¡Gracias!';
    const msg = template
      .replace(/{nombre}/g, tenant.name || '')
      .replace(/{apto}/g, apt.name || '')
      .replace(/{link_aire}/g, apt.electricityPaymentUrl || 'https://portal.air-e.com/Pagar#/List')
      .replace(/{link_triplea}/g, apt.waterPaymentUrl || 'https://portal.aaa.com.co/pagos')
      .replace(/{link_gases}/g, apt.gasPaymentUrl || 'https://portal.gascaribe.com/login');
    window.open(`https://wa.me/${fullNum}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function getCode(apt, svc) {
    if (!apt) return '';
    if (svc === 'water') return apt.waterPaymentCode || '';
    if (svc === 'gas') return apt.gasPaymentCode || '';
    return apt.electricityPaymentCode || apt.nic || '';
  }

  function getUrl(apt, svc) {
    if (!apt) return '';
    if (svc === 'water') return apt.waterPaymentUrl || '';
    if (svc === 'gas') return apt.gasPaymentUrl || '';
    return apt.electricityPaymentUrl || '';
  }

  async function handleElectricityPay(apt) {
    if (!apt) return;
    if (apt.electricityPaymentUrl) { window.open(apt.electricityPaymentUrl, '_blank'); return; }
    const existingNIC = apt.nic || apt.electricityPaymentCode || '';
    if (existingNIC.replace(/\D/g, '').length >= 4) {
      const digits = existingNIC.replace(/\D/g, '');
      const url = `https://portal.air-e.com/Pagar#/User/${digits}/NUMEROCONTRATO`;
      await api.apartments.update(apt.id, { nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url });
      const idx = apartments.findIndex(a => a.id === apt.id);
      if (idx !== -1) { const u = [...apartments]; u[idx] = { ...u[idx], nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url }; setApartments(u); }
      window.open(url, '_blank'); return;
    }
    const nic = window.prompt('Ingresa el NIC de Air-e (' + apt.name + '):', '');
    if (!nic || !nic.trim()) return;
    const digits = nic.trim().replace(/\D/g, '');
    if (digits.length < 4) { alert('El NIC debe tener al menos 4 dígitos'); return; }
    const url = `https://portal.air-e.com/Pagar#/User/${digits}/NUMEROCONTRATO`;
    await api.apartments.update(apt.id, { nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url });
    const idx = apartments.findIndex(a => a.id === apt.id);
    if (idx !== -1) { const u = [...apartments]; u[idx] = { ...u[idx], nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url }; setApartments(u); }
    window.open(url, '_blank');
  }

  /* Legacy QR scanner removed: service links now come only from official portals.
  function handleScanQR(aptId, svc) {
    setScanAptId(aptId); setScanService(svc); setScanStatus('Iniciando cámara...');
    setTimeout(startScan, 100);
  }

  function startScan() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then(stream => {
        if (!videoRef.current) return;
        const v = videoRef.current; v.srcObject = stream;
        v.onloadedmetadata = () => { v.play().then(() => { setScanStatus('Enfoca el QR'); scanTimerRef.current = setTimeout(doScan, 500); }).catch(() => {}); };
      })
      .catch(() => { setScanStatus('Cámara no disponible'); setTimeout(() => scannerRef.current?.click(), 300); });
  }

  function stopScan() {
    setScanStatus('');
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject) { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; }
  }

  async function doScan() {
    const v = videoRef.current;
    if (!v || scanAptId === null) return;
    if (v.readyState < v.HAVE_CURRENT_DATA) { scanTimerRef.current = setTimeout(doScan, 500); return; }
    let val = null;
    if (window.BarcodeDetector) {
      try { const d = new window.BarcodeDetector({ formats: ['qr_code'] }); const b = await d.detect(v); if (b.length > 0) val = b[0].rawValue; } catch {}
    }
    if (!val) {
      const w = Math.min(v.videoWidth || 640, 640); const h = Math.min(v.videoHeight || 480, Math.round(w * ((v.videoHeight || 480) / (v.videoWidth || 640))));
      try { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, w, h); const img = ctx.getImageData(0, 0, w, h); const code = jsQR(img.data, img.width, img.height); if (code && code.data) val = code.data; } catch {}
    }
    if (val) {
      setScanStatus('¡QR detectado!');
      const url = val.startsWith('http') ? val : 'https://' + val;
      const field = scanService === 'water' ? 'waterPaymentUrl' : 'gasPaymentUrl';
      await api.apartments.update(scanAptId, { [field]: url });
      const idx = apartments.findIndex(a => a.id === scanAptId);
      if (idx !== -1) { const u = [...apartments]; u[idx] = { ...u[idx], [field]: url }; setApartments(u); }
      generateQr(scanAptId, scanService, url);
      stopScan(); setScanAptId(null); setScanService(null); return;
    }
    scanTimerRef.current = setTimeout(doScan, 500);
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return; e.target.value = '';
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: 640, resizeQuality: 'high' });
      let val = null;
      if (window.BarcodeDetector) { try { const d = new window.BarcodeDetector({ formats: ['qr_code'] }); const b = await d.detect(bitmap); if (b.length > 0) val = b[0].rawValue; } catch {} }
      if (!val) {
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const img = ctx.getImageData(0, 0, c.width, c.height); const code = jsQR(img.data, img.width, img.height); if (code && code.data) val = code.data;
      } else { bitmap.close(); }
      if (val) {
        const url = val.startsWith('http') ? val : 'https://' + val;
        const field = scanService === 'water' ? 'waterPaymentUrl' : 'gasPaymentUrl';
        await api.apartments.update(scanAptId, { [field]: url });
        const idx = apartments.findIndex(a => a.id === scanAptId);
        if (idx !== -1) { const u = [...apartments]; u[idx] = { ...u[idx], [field]: url }; setApartments(u); }
        generateQr(scanAptId, scanService, url);
        stopScan(); setScanAptId(null); setScanService(null);
      } else { alert('No se encontró QR en la imagen'); }
    } catch { alert('Error al procesar la imagen'); }
  }

  */
  const filtered = apartments.filter(a => {
    if (!search) return true;
    const s = search.toLowerCase();
    return a.name.toLowerCase().includes(s) || getCode(a, 'water').includes(s) || getCode(a, 'gas').includes(s) || getCode(a, 'electricity').includes(s);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Servicios Públicos</h1>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{apartments.length} apartamentos</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1">
            <button onClick={() => { const p = prevPeriod(period); setPeriod(p); }} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-medium text-gray-900 dark:text-white min-w-[110px] text-center">{getPeriodLabel(period)}</span>
            <button onClick={() => { const p = nextPeriod(period); setPeriod(p); }} className="p-0.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400"><ChevronRight className="w-4 h-4" /></button>
            <button onClick={() => setPeriod(getCurrentPeriod())} className="ml-1 text-[10px] text-blue-600 hover:underline px-1"><RefreshCw className="w-3 h-3 inline" /></button>
          </div>
        </div>
      </div>

      {/* Portals + Sync */}
      <div className="flex flex-wrap items-center gap-2">
        {PORTALS.map(p => {
          const Icon = p.icon;
          return (
            <button key={p.key} onClick={() => window.open(p.url, '_blank', 'noopener')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors shadow-sm">
              <Icon className="w-3.5 h-3.5" /> Portal {p.name}
            </button>
          );
        })}
        <button onClick={handleSync} disabled={syncingNow} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg hover:from-purple-600 hover:to-violet-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
          <RefreshCw className={`w-3.5 h-3.5 ${syncingNow ? 'animate-spin' : ''}`} /> {syncingNow ? 'Sincronizando…' : 'Sync ahora'}
        </button>
        <button onClick={handleWaterSync} disabled={waterSyncingNow} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg hover:from-blue-600 hover:to-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
          <Droplets className={`w-3.5 h-3.5 ${waterSyncingNow ? 'animate-pulse' : ''}`} /> {waterSyncingNow ? 'Consultando agua…' : 'Actualizar agua'}
        </button>
        <button onClick={handleGasSync} disabled={gasSyncingNow} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-orange-600 rounded-lg hover:from-amber-600 hover:to-orange-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm">
          <Flame className={`w-3.5 h-3.5 ${gasSyncingNow ? 'animate-pulse' : ''}`} /> {gasSyncingNow ? 'Consultando gas…' : 'Actualizar gas'}
        </button>
        {syncNote && <span className="text-xs text-gray-500 dark:text-gray-400">{syncNote}</span>}
        {waterSyncNote && <span className="text-xs text-gray-500 dark:text-gray-400">{waterSyncNote}</span>}
        {gasSyncNote && <span className="text-xs text-gray-500 dark:text-gray-400">{gasSyncNote}</span>}
      </div>
      {syncingNow && (
        <p className="text-[11px] text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800 rounded-lg px-3 py-2">
          Si Air-e pide un código OTP o verificación, el servidor no podrá completarla automáticamente: usa el botón "Portal Energía" e inicia sesión manualmente.
        </p>
      )}

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar apto o código..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {/* Apartment cards */}
      <div className="grid gap-4">
        {filtered.map(apt => (
          <div key={apt.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="font-bold text-gray-900 dark:text-white text-base">Apartamento {apt.name}</h2>
              {(() => { const t = getActiveTenant(apt.id); return t && t.phone ? <button onClick={() => handleWhatsAppServices(apt)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors" title="Enviar enlaces de servicios por WhatsApp"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</button> : null; })()}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {['water', 'gas', 'electricity'].map(svc => {
                const s = services[svc];
                const Icon = s.icon;
                const code = getCode(apt, svc);
                const url = getUrl(apt, svc);
                return (
                  <div key={svc} className={`px-4 py-3 flex items-center gap-3 ${s.bgLight} dark:bg-transparent`}>
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-sm shrink-0`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.name}</p>
                      {code && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.codeLabel}: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{code}</span></p>}
                      {svc === 'water' && debts[apt.id]?.water && (
                        <p className={`text-xs font-semibold mt-1 ${waterBillClass(debts[apt.id].water)}`}>
                          {waterBillLabel(debts[apt.id].water)}
                          {debts[apt.id].water.status === 'pending' && debts[apt.id].water.numFacturas > 0 && ` · ${debts[apt.id].water.numFacturas} ${debts[apt.id].water.numFacturas === 1 ? 'factura' : 'facturas'}`}
                          {waterBillMeta(debts[apt.id].water) && <span className="text-gray-400 dark:text-gray-500 font-normal"> · {waterBillMeta(debts[apt.id].water)}</span>}
                        </p>
                      )}
                      {svc === 'gas' && debts[apt.id]?.gas && (
                        <p className={`text-xs font-semibold mt-1 ${waterBillClass(debts[apt.id].gas)}`}>
                          {waterBillLabel(debts[apt.id].gas)}
                          {debts[apt.id].gas.status === 'pending' && debts[apt.id].gas.numFacturas > 0 && ` · ${debts[apt.id].gas.numFacturas} ${debts[apt.id].gas.numFacturas === 1 ? 'factura' : 'facturas'}`}
                          {waterBillMeta(debts[apt.id].gas) && <span className="text-gray-400 dark:text-gray-500 font-normal"> · {waterBillMeta(debts[apt.id].gas)}</span>}
                        </p>
                      )}
                      {svc === 'electricity' && debts[apt.id]?.electricity && (
                        <p className={`text-xs font-semibold mt-1 ${debts[apt.id].electricity.deudaCOP > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                          {debts[apt.id].electricity.deudaCOP > 0
                            ? <>Deuda Total: <span className="font-bold">${Number(debts[apt.id].electricity.deudaCOP).toLocaleString('es-CO')}</span></>
                            : 'Al día · Sin deuda'}
                          <span className="text-gray-400 dark:text-gray-500 font-normal"> · datos {timeAgo(debts[apt.id].electricity.actualizado)}</span>
                        </p>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {svc === 'electricity' ? (
                        <button onClick={() => handleElectricityPay(apt)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg hover:from-purple-600 hover:to-violet-700 transition-all shadow-sm">
                          <ExternalLink className="w-3 h-3" /> Pagar
                        </button>
                      ) : (
                        url ? (
                          <button onClick={() => window.open(url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-sm">
                            <ExternalLink className="w-3 h-3" /> Pagar
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400 dark:text-gray-500">Portal pendiente</span>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 py-8">No se encontraron apartamentos</p>}
      </div>

    </div>
  );
}
