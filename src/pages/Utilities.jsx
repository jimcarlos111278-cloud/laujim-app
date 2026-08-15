import { useState, useEffect, useRef } from 'react';
import { Zap, Droplets, Flame, Search, ExternalLink, ChevronLeft, ChevronRight, RefreshCw, MessageCircle, Scan, Image as ImageIcon, Trash2, Settings2, AlertTriangle } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { getCurrentPeriod, getPeriodLabel, nextPeriod, prevPeriod, servicePaymentUrl } from '../utils/helpers';
import { getBase, AUTH_TOKEN, isCapacitor } from '../utils/config';
import jsQR from 'jsqr';

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
  const checkedAt = new Date(iso).getTime();
  if (!Number.isFinite(checkedAt)) return 'sin datos';
  const ms = Date.now() - checkedAt;
  if (ms < 0) return 'recién actualizado';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'hace menos de 1 minuto';
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
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

const AIR_E_PUBLIC_PAYMENT_URL = 'https://airepagos.st/';
// Gas payment links are now generated from the contract number. Only Triple A
// still needs a receipt QR to give the tenant a public payment link.
const QR_SERVICES = new Set(['water']);
const SCAN_MAX_WIDTH = 640;
const GAS_ACCOUNT_LIMIT = 10;

function gasCode(apartment) {
  return String(apartment?.gasPaymentCode || '').trim();
}

function buildGasAccounts(apartments) {
  const groups = new Map();
  const contractAccounts = new Map();
  const conflicts = [];
  let automaticApartmentIndex = 0;
  const sorted = [...(apartments || [])]
    .filter(apartment => gasCode(apartment))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'es', { numeric: true }));

  for (const apartment of sorted) {
    const code = gasCode(apartment);
    const explicitAccount = String(apartment.gasAccountId || '').trim();
    const accountId = explicitAccount || `gas-${Math.floor(automaticApartmentIndex / GAS_ACCOUNT_LIMIT) + 1}`;
    automaticApartmentIndex += 1;
    const previousAccounts = contractAccounts.get(code) || new Set();
    if (previousAccounts.size > 0 && !previousAccounts.has(accountId)) {
      conflicts.push({ code, apartment: apartment.name, accounts: [...previousAccounts, accountId] });
    }
    previousAccounts.add(accountId);
    contractAccounts.set(code, previousAccounts);
    if (!groups.has(accountId)) groups.set(accountId, { id: accountId, contracts: [], apartments: [] });
    const group = groups.get(accountId);
    if (!group.contracts.includes(code)) group.contracts.push(code);
    group.apartments.push(apartment);
  }

  return { accounts: [...groups.values()].sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })), conflicts };
}

function gasAccountLabel(accountId) {
  const match = String(accountId || '').match(/(\d+)$/);
  return match ? `Cuenta ${Number(match[1])}` : String(accountId || 'Sin cuenta');
}

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
  const [gasAccountNote, setGasAccountNote] = useState('');
  const [scanService, setScanService] = useState(null);
  const [scanApartmentId, setScanApartmentId] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const scanServiceRef = useRef(null);
  const scanApartmentRef = useRef(null);
  const scanDetectorRef = useRef(null);
  const scanTimerRef = useRef(null);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);
  const gasAccountSummary = buildGasAccounts(apartments);

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
        entries[apt.id] = { electricity, water, gas };
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

  function qrPaymentField(service) {
    return 'waterPaymentUrl';
  }

  function normalizeReceiptQrUrl(raw, service) {
    if (!QR_SERVICES.has(service)) return '';
    let value = String(raw || '').trim().replace(/[\s),.;]+$/g, '');
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:') {
        const knownPaymentHost = /(?:^|\.)portal\.aaa\.com\.co$|(?:^|\.)gascaribe\.com$/i.test(url.hostname);
        if (!knownPaymentHost) return '';
        url.protocol = 'https:';
      }
      if (url.protocol !== 'https:') return '';
      const host = url.hostname.toLowerCase();
      const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
      if (service === 'water') {
        const isReceipt = host.endsWith('portal.aaa.com.co') && /^\/pagos(?:\/|$)/i.test(path);
        return isReceipt ? url.toString() : '';
      }
      if (host.endsWith('gascaribe.com') && /^\/(?:login|contracts)(?:\/|$)/i.test(path)) return '';
      if (host.endsWith('gascaribe.com') && path === '/payments' && [...url.searchParams.keys()].length === 0) return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  function closeQrScanner() {
    scanServiceRef.current = null;
    scanApartmentRef.current = null;
    setScanService(null);
    setScanApartmentId(null);
    stopWebCam();
  }

  function openWebQrScanner(apartmentId, service) {
    scanServiceRef.current = service;
    scanApartmentRef.current = apartmentId;
    setScanService(service);
    setScanApartmentId(apartmentId);
    setScanStatus('Iniciando cámara…');
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(startWebCam, 150);
  }

  function barcodeRawValue(barcode) {
    return String(barcode?.rawValue || barcode?.displayValue || barcode?.urlBookmark?.url || '').trim();
  }

  async function saveScannedPaymentUrl(apartmentId, service, rawValue) {
    if (service !== 'water') throw new Error('Gases del Caribe usa el enlace permanente por contrato; no se guarda el QR mensual.');
    const url = normalizeReceiptQrUrl(rawValue, service);
    if (!url) {
      throw new Error(service === 'water'
        ? 'El QR no parece ser un enlace de pago nativo de Triple A.'
        : 'El QR no contiene un enlace de pago válido de Gases del Caribe.');
    }
    const field = qrPaymentField(service);
    const saved = await api.apartments.update(Number(apartmentId), { [field]: url });
    if (!saved || saved[field] !== url) throw new Error('Aiven no confirmó el enlace QR. Inténtalo de nuevo.');
    setApartments(current => current.map(apartment => (
      Number(apartment.id) === Number(apartmentId) ? { ...apartment, [field]: url } : apartment
    )));
    return url;
  }

  async function handleScanButton(apartmentId, service) {
    if (!QR_SERVICES.has(service)) return;
    if (isCapacitor()) {
      let rawValue = '';
      try {
        const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
        const supported = await BarcodeScanner.isSupported?.();
        if (supported && supported.supported === false) throw new Error('Este dispositivo no tiene cámara disponible.');
        const permission = await BarcodeScanner.checkPermissions?.();
        if (permission && permission.camera !== 'granted' && permission.camera !== 'limited') {
          const requested = await BarcodeScanner.requestPermissions?.();
          if (requested && requested.camera !== 'granted' && requested.camera !== 'limited') {
            throw new Error('Permiso de cámara denegado. Actívalo en Ajustes > Laujim > Cámara.');
          }
        }
        const module = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable?.();
        if (module && module.available === false) {
          try { await BarcodeScanner.installGoogleBarcodeScannerModule?.(); } catch {}
          throw new Error('El lector nativo se está instalando. Se abrirá el lector de respaldo.');
        }
        const { BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
        const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode], autoZoom: true });
        rawValue = barcodeRawValue(result.barcodes?.[0]);
        if (!rawValue) return;
        await saveScannedPaymentUrl(apartmentId, service, rawValue);
      } catch (error) {
        console.error('QR payment scan error:', error);
        if (rawValue) {
          alert(error.message || 'Aiven no confirmó el enlace QR.');
          return;
        }
        // Some Android devices do not have Google's ready-to-use module. Keep
        // the same in-app camera flow as the web version instead of ending on
        // an empty scanner screen.
        openWebQrScanner(apartmentId, service);
      }
      return;
    }
    openWebQrScanner(apartmentId, service);
  }

  async function getScanDetector() {
    if (scanDetectorRef.current) return scanDetectorRef.current;
    if (window.BarcodeDetector) {
      try {
        scanDetectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        return scanDetectorRef.current;
      } catch {
        try { scanDetectorRef.current = new window.BarcodeDetector(); return scanDetectorRef.current; } catch {}
      }
    }
    return null;
  }

  async function detectQrInVideo(video) {
    if (!video || video.readyState < video.HAVE_CURRENT_DATA) return null;
    const detector = await getScanDetector();
    if (detector) {
      try {
        const detected = await detector.detect(video);
        if (detected.length) return barcodeRawValue(detected[0]);
      } catch {}
    }
    const width = Math.min(video.videoWidth || SCAN_MAX_WIDTH, SCAN_MAX_WIDTH);
    const height = Math.min(video.videoHeight || 480, Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || SCAN_MAX_WIDTH))));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const detected = jsQR(image.data, image.width, image.height);
      return detected?.data || null;
    } catch {
      return null;
    }
  }

  async function detectQrInFile(file) {
    let bitmap = null;
    try {
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(file, { resizeWidth: SCAN_MAX_WIDTH, resizeQuality: 'high' });
      } else {
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image();
          const objectUrl = URL.createObjectURL(file);
          image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
          image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo abrir la imagen.')); };
          image.src = objectUrl;
        });
      }
      const detector = await getScanDetector();
      if (detector) {
        try {
          const detected = await detector.detect(bitmap);
          if (detected.length) {
            if (typeof bitmap.close === 'function') bitmap.close();
            return barcodeRawValue(detected[0]);
          }
        } catch {}
      }
      const canvas = document.createElement('canvas');
      const sourceWidth = bitmap.width || bitmap.naturalWidth || SCAN_MAX_WIDTH;
      const sourceHeight = bitmap.height || bitmap.naturalHeight || 480;
      const scale = Math.min(1, SCAN_MAX_WIDTH / sourceWidth);
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const detected = jsQR(image.data, image.width, image.height);
      return detected?.data || null;
    } catch {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      return null;
    }
  }

  function startWebCam() {
    if (!scanServiceRef.current || !navigator.mediaDevices?.getUserMedia) {
      setScanStatus('Cámara no disponible aquí; pulsa “Subir foto”.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(stream => {
      if (!videoRef.current || !scanServiceRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play().then(() => {
          setScanStatus('Enfoca el QR del recibo.');
          scanTimerRef.current = setTimeout(scanVideoFrame, 500);
        }).catch(() => setScanStatus('No se pudo iniciar la cámara; pulsa “Subir foto”.'));
      };
    }).catch(() => {
      setScanStatus('Permiso de cámara no disponible; pulsa “Subir foto”.');
    });
  }

  function stopWebCam() {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setScanStatus('');
  }

  async function scanVideoFrame() {
    const service = scanServiceRef.current;
    const apartmentId = scanApartmentRef.current;
    if (!service || apartmentId === null) return;
    const rawValue = await detectQrInVideo(videoRef.current);
    if (rawValue) {
      try {
        setScanStatus('QR detectado; guardando enlace...');
        await saveScannedPaymentUrl(apartmentId, service, rawValue);
        closeQrScanner();
      } catch (error) {
        setScanStatus(error.message || 'El QR no es válido para este servicio.');
        scanTimerRef.current = setTimeout(scanVideoFrame, 1000);
      }
      return;
    }
    scanTimerRef.current = setTimeout(scanVideoFrame, 500);
  }

  async function handleScanFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const service = scanServiceRef.current;
    const apartmentId = scanApartmentRef.current;
    if (!service || apartmentId === null) return;
    const rawValue = await detectQrInFile(file);
    try {
      if (!rawValue) throw new Error('No se encontró un código QR en la imagen.');
      setScanStatus('QR detectado; guardando enlace...');
      await saveScannedPaymentUrl(apartmentId, service, rawValue);
      closeQrScanner();
    } catch (error) {
      setScanStatus(error.message || 'No se pudo guardar el QR.');
      alert(error.message || 'No se pudo guardar el QR.');
    }
  }

  useEffect(() => () => closeQrScanner(), []);

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
      .replace(/{link_aire}/g, servicePaymentUrl(apt, 'electricity') || 'No configurado')
      .replace(/{link_triplea}/g, servicePaymentUrl(apt, 'water') || 'No configurado')
      .replace(/{link_gases}/g, servicePaymentUrl(apt, 'gas') || 'No configurado');
    window.open(`https://wa.me/${fullNum}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function getCode(apt, svc) {
    if (!apt) return '';
    if (svc === 'water') return apt.waterPaymentCode || '';
    if (svc === 'gas') return apt.gasPaymentCode || '';
    return apt.electricityPaymentCode || apt.nic || '';
  }

  function getUrl(apt, svc) { return servicePaymentUrl(apt, svc); }

  const scanApartment = apartments.find(apartment => Number(apartment.id) === Number(scanApartmentId));

  async function handleElectricityPay(apt) {
    if (!apt) return;
    window.open(AIR_E_PUBLIC_PAYMENT_URL, '_blank', 'noopener,noreferrer');
  }

  async function handleDeletePaymentLink(apt, service) {
    if (!apt || !QR_SERVICES.has(service)) return;
    const label = service === 'water' ? 'Triple A' : 'Gases del Caribe';
    if (!window.confirm(`Eliminar el enlace QR de ${label} del apartamento ${apt.name}?`)) return;
    const field = qrPaymentField(service);
    await api.apartments.update(apt.id, { [field]: null });
    setApartments(current => current.map(apartment => (
      apartment.id === apt.id ? { ...apartment, [field]: null } : apartment
    )));
  }

  async function handleGasAccountChange(apartment, nextAccountId) {
    const currentAccountId = String(apartment.gasAccountId || '').trim() || gasAccountSummary.accounts.find(account => account.apartments.some(item => item.id === apartment.id))?.id;
    if (!nextAccountId || nextAccountId === currentAccountId) return;
    const target = gasAccountSummary.accounts.find(account => account.id === nextAccountId);
    if (target && target.apartments.length >= GAS_ACCOUNT_LIMIT && !target.apartments.some(item => item.id === apartment.id)) {
      window.alert(`La ${gasAccountLabel(nextAccountId)} ya tiene ${GAS_ACCOUNT_LIMIT} apartamentos. Crea otra cuenta o mueve primero un apartamento.`);
      return;
    }
    try {
      const saved = await api.apartments.update(apartment.id, { gasAccountId: nextAccountId });
      setApartments(current => current.map(item => item.id === apartment.id ? { ...item, gasAccountId: saved?.gasAccountId || nextAccountId } : item));
      setGasAccountNote(`Apartamento ${apartment.name} asignado a ${gasAccountLabel(nextAccountId)}.`);
      setTimeout(() => setGasAccountNote(''), 3500);
    } catch (error) {
      window.alert(`No se pudo guardar la cuenta de Gases: ${error.message}`);
    }
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
  const highestGasAccount = gasAccountSummary.accounts.reduce((highest, account) => {
    const number = Number(String(account.id).match(/(\d+)$/)?.[1] || 0);
    return Math.max(highest, number);
  }, 0);
  const gasAccountOptions = Array.from({ length: Math.max(1, highestGasAccount + 1) }, (_, index) => `gas-${index + 1}`);

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

      {/* Gases account assignment */}
      {gasAccountSummary.accounts.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-amber-950 dark:text-amber-100">Cuentas de Gases del Caribe</h2>
                  <p className="text-[11px] text-amber-800 dark:text-amber-200">Máximo {GAS_ACCOUNT_LIMIT} apartamentos por cuenta. El enlace de pago siempre se genera por contrato.</p>
                </div>
                {gasAccountNote && <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{gasAccountNote}</span>}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {gasAccountSummary.accounts.map(account => (
                  <div key={account.id} className="rounded-lg border border-amber-200 bg-white/80 p-2.5 dark:border-amber-900/50 dark:bg-gray-800/70">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{gasAccountLabel(account.id)}</span>
                      <span className={`text-[11px] font-semibold ${account.apartments.length >= GAS_ACCOUNT_LIMIT ? 'text-red-600' : 'text-amber-700 dark:text-amber-300'}`}>{account.apartments.length}/{GAS_ACCOUNT_LIMIT} apartamentos</span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">Aptos: {account.apartments.map(item => item.name).join(', ')}</p>
                  </div>
                ))}
              </div>
              {gasAccountSummary.conflicts.length > 0 && (
                <div className="mt-2 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Hay contratos repetidos asignados a cuentas diferentes ({gasAccountSummary.conflicts.map(item => `${item.code} · apto ${item.apartment}`).join('; ')}). Un mismo contrato debe quedar en una sola cuenta del portal.</span>
                </div>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-amber-800 dark:text-amber-200">Cambiar apartamento de cuenta</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {apartments.filter(apartment => gasCode(apartment)).map(apartment => {
                    const inferred = gasAccountSummary.accounts.find(account => account.apartments.some(item => item.id === apartment.id))?.id || 'gas-1';
                    return (
                      <label key={apartment.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] dark:bg-gray-800/60">
                        <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">Apto {apartment.name} · {gasCode(apartment)}</span>
                        <select value={inferred} onChange={event => handleGasAccountChange(apartment, event.target.value)} className="rounded border border-gray-300 bg-white px-1.5 py-1 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100">
                          {gasAccountOptions.map(accountId => <option key={accountId} value={accountId}>{gasAccountLabel(accountId)}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>
        </section>
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
                const gasAccount = svc === 'gas' ? gasAccountSummary.accounts.find(account => account.apartments.some(item => item.id === apt.id)) : null;
                return (
                  <div key={svc} className={`px-3 py-2.5 flex items-center gap-2 ${s.bgLight} dark:bg-transparent`}>
                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.color} flex items-center justify-center shadow-sm shrink-0`}>
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-white">{s.name}</p>
                      {code && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.codeLabel}: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{code}</span></p>}
                      {gasAccount && <p className="text-[11px] text-amber-700 dark:text-amber-300">{gasAccountLabel(gasAccount.id)} · pago por contrato</p>}
                      {(svc === 'water' || svc === 'gas') && debts[apt.id] && (() => {
                        const bill = debts[apt.id][svc];
                        return (
                          <>
                            <p className={`text-xs font-semibold mt-1 ${waterBillClass(bill)}`} title={bill?.error || ''}>
                              {bill ? waterBillLabel(bill) : 'Sin datos de consulta'}
                              {bill?.status === 'pending' && bill.numFacturas > 0 && ` · ${bill.numFacturas} ${bill.numFacturas === 1 ? 'factura' : 'facturas'}`}
                              <span className="text-gray-400 dark:text-gray-500 font-normal"> · {bill ? (waterBillMeta(bill) || `datos ${timeAgo(bill.actualizado)}`) : 'nunca sincronizado'}</span>
                            </p>
                            {bill?.error && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate" title={bill.error}>Último error: {bill.error}</p>}
                          </>
                        );
                      })()}
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
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      {svc === 'electricity' ? (
                        <button onClick={() => handleElectricityPay(apt)} aria-label={`Pagar Air-e del apartamento ${apt.name}`} className="inline-flex h-8 w-8 sm:h-7 sm:w-auto sm:px-2 items-center justify-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-violet-600 rounded-md hover:from-purple-600 hover:to-violet-700 transition-all shadow-sm">
                          <ExternalLink className="w-3 h-3" /><span className="hidden sm:inline">Pagar</span>
                        </button>
                      ) : svc === 'gas' ? (
                        url ? (
                          <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} aria-label={`Pagar ${s.name} del apartamento ${apt.name}`} title="Pagar por contrato" className="inline-flex h-8 w-8 sm:h-7 sm:w-auto sm:px-2 items-center justify-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-md hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-sm">
                            <ExternalLink className="w-3 h-3" /><span className="hidden sm:inline">Pagar</span>
                          </button>
                        ) : <span className="text-[11px] text-gray-400">Sin contrato</span>
                      ) : (
                        <>
                          {url && (
                            <button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} aria-label={`Pagar ${s.name} del apartamento ${apt.name}`} title="Pagar" className="inline-flex h-8 w-8 sm:h-7 sm:w-auto sm:px-2 items-center justify-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-md hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-sm">
                              <ExternalLink className="w-3 h-3" /><span className="hidden sm:inline">Pagar</span>
                            </button>
                          )}
                          <button onClick={() => handleScanButton(apt.id, svc)} aria-label={`${url ? 'Reemplazar' : 'Escanear'} QR de ${s.name} del apartamento ${apt.name}`} className="inline-flex h-8 w-8 sm:h-7 sm:w-auto sm:px-2 items-center justify-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white/80 dark:bg-gray-700 hover:bg-white dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 rounded-md transition-colors" title={url ? 'Reemplazar enlace QR' : 'Escanear QR del recibo'}>
                            <Scan className="w-3 h-3" /><span className="hidden sm:inline">{url ? 'Escanear otro' : 'Escanear'}</span>
                          </button>
                          {url && (
                            <button onClick={() => handleDeletePaymentLink(apt, svc)} aria-label={`Eliminar enlace de ${s.name} del apartamento ${apt.name}`} className="inline-flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center text-red-600 dark:text-red-400 bg-white/80 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-md transition-colors" title="Eliminar enlace QR">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </>
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

      <Modal
        open={scanService !== null}
        onClose={closeQrScanner}
        title={scanService ? `Escanear QR - ${services[scanService].name}${scanApartment ? ` · Apto ${scanApartment.name}` : ''}` : ''}
        size="sm"
      >
        <div className="p-1">
          <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ minHeight: 280 }}>
            <video ref={videoRef} className="w-full h-full object-cover" muted autoPlay playsInline />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-52 h-52 border-2 border-emerald-400 rounded-xl opacity-80" />
            </div>
            {scanStatus && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                <p className="text-white text-xs text-center">{scanStatus}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Enfoca el QR del recibo físico. El enlace se guardará para que el inquilino pueda pagar sin entrar al portal administrativo.</p>
          <div className="flex gap-2">
            <button onClick={() => scannerRef.current?.click()} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm">
              <ImageIcon className="w-4 h-4" /> Subir foto
            </button>
            <button onClick={closeQrScanner} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm">
              Cancelar
            </button>
          </div>
          <input ref={scannerRef} type="file" accept="image/*" onChange={handleScanFile} className="hidden" />
        </div>
      </Modal>

    </div>
  );
}
