import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, DollarSign, Calendar, Edit2, Trash2, User, FileText, Camera, Phone, Plus, X, Download, Image, MessageCircle, Hash, Clock, Droplets, Flame, Zap, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, QrCode, Scan, Share2, Globe, Copy, Check, Bell, Send } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentHistoryChart from '../components/PaymentHistoryChart';
import { api } from '../api';
import { photoUrl, isCapacitor, getBase, AUTH_TOKEN } from '../utils/config';
import { formatCurrency, formatShortDate, daysUntil, getCurrentPeriod, getPeriodLabel, prevPeriod, nextPeriod, isOverdueByReadingDate, servicePaymentUrl, gasContractPaymentUrl } from '../utils/helpers';
import { generateMarketplaceJson } from '../utils/marketplaceBookmarklet';
import { openAndroidMarketplace, runAndroidMarketplaceWorkerNow } from '../utils/androidScraperWorker';
import { generateApartmentPDF } from '../utils/pdf';
import { addCalendarReminder } from '../utils/calendar';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

const serviceNames = { water: 'Agua', gas: 'Gas', electricity: 'Electricidad' };
const serviceIcons = { water: Droplets, gas: Flame, electricity: Zap };
const serviceColors = { water: 'text-blue-600 bg-blue-50', gas: 'text-amber-600 bg-amber-50', electricity: 'text-yellow-600 bg-yellow-50' };
const utilityWebsites = {
  water: { name: 'Triple A', url: 'https://portal.aaa.com.co/pagos' },
  gas: { name: 'Gases del Caribe', url: 'https://portal.gascaribe.com/login' },
  electricity: { name: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
};

function normalizeScannedPaymentUrl(raw, service) {
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
    if (service === 'water') return host.endsWith('portal.aaa.com.co') && /^\/pagos(?:\/|$)/i.test(path) ? url.toString() : '';
    if (service === 'gas') {
      if (!host.endsWith('gascaribe.com')) return '';
      if (/^\/(?:login|contracts)(?:\/|$)/i.test(path)) return '';
      if (path === '/payments' && [...url.searchParams.keys()].length === 0) return '';
      return url.toString();
    }
    return '';
  } catch {
    return '';
  }
}

const DEFAULT_WA_SERVICES_TEMPLATE = `Hola {nombre} 👋

Te saluda la administración de apartamentos Laujim.

🏠 Apartamento: {apto}

⚡ Air-e — Deuda Total: {deuda_aire}
NIC: {nic_aire}
💳 Pago Air-e: {link_aire}

💧 Triple A — Deuda Total: {deuda_agua}
Póliza: {poliza_agua}
💳 Pago Triple A: {link_triplea}

🔥 Gases del Caribe — Deuda Total: {deuda_gas}
Contrato: {contrato_gas}
💳 Pago Gases: {link_gases}

Puedes responder por este mismo medio si necesitas ayuda. ¡Gracias!`;

const DEFAULT_WA_REMINDER_TEMPLATE = `Hola {nombre} 👋

Te saluda la administración de apartamentos Laujim.

🏠 Apartamento: {apto}
📊 Canon de {periodo}: {valor_canon}
📅 Vencimiento: {fecha_vencimiento}
📌 Estado: {estado_canon}

⚡ Air-e — Deuda Total: {deuda_aire}
💧 Triple A — Deuda Total: {deuda_agua}
🔥 Gases del Caribe — Deuda Total: {deuda_gas}

💳 Enlaces de pago:
⚡ Air-e: {link_aire}
💧 Triple A: {link_triplea}
🔥 Gases del Caribe: {link_gases}

Cuando realices el pago del canon, responde adjuntando el comprobante para validarlo. ¡Gracias!`;

function latestUtilityRecord(records, service) {
  return [...(records || [])]
    .filter(record => record?.service === service)
    .sort((left, right) => new Date(right.checkedAt || right.scrapedAt || right.updatedAt || 0).getTime() -
      new Date(left.checkedAt || left.scrapedAt || left.updatedAt || 0).getTime())[0] || null;
}

function utilityDebtText(record) {
  const raw = record?.deudaTotalCOP ?? record?.deudaCOP;
  const debt = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(debt)) return `$${Math.max(0, Math.round(debt)).toLocaleString('es-CO')}${debt === 0 ? ' · Al día' : ''}`;
  if (record?.status === 'paid') return '$0 · Al día';
  return 'Sin dato confirmado';
}

function expandWhatsAppTemplate(template, values) {
  return Object.entries(values).reduce((message, [key, value]) =>
    message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? '')), String(template || ''));
}

export default function ApartmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [apt, setApt] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [contract, setContract] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [showExpForm, setShowExpForm] = useState(false);
  const [expForm, setExpForm] = useState({ amount: '', date: new Date().toISOString().split('T')[0], category: '', description: '' });
  const expenseSuggestions = ['Fuga de agua', 'Mantenimiento general', 'Reparación eléctrica', 'Limpieza de tanque', 'Pintura', 'Fontanería', 'Cambio de cerradura', 'Gotera', 'Aire acondicionado', 'Reparación de pared'];

  async function delExp(expenseId) {
    if (!window.confirm('¿Eliminar este gasto?')) return;
    await api.expenses.delete(expenseId);
    load();
  }
  const [familyMembers, setFamilyMembers] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [utilityRecords, setUtilityRecords] = useState([]);
  const [utilityPeriod, setUtilityPeriod] = useState(getCurrentPeriod());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [newMember, setNewMember] = useState({ name: '', phone: '' });
  const [uploading, setUploading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareFailed, setShareFailed] = useState(null);
  const [galleryIdx, setGalleryIdx] = useState(null);
  const fileRef = useRef(null);
  const [scanService, setScanService] = useState(null);
  const scanServiceRef = useRef(null);
  const scanTimerRef = useRef(null);
  const [scanStatus, setScanStatus] = useState('');
  const [qrUrls, setQrUrls] = useState({});
  const [showQrModal, setShowQrModal] = useState(null);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);
  const [marketplaceUrl, setMarketplaceUrl] = useState('');
  const [marketplaceJob, setMarketplaceJob] = useState(null);
  const [marketplaceLogs, setMarketplaceLogs] = useState([]);
  const [marketplaceBusy, setMarketplaceBusy] = useState(false);
  const [marketplaceMessage, setMarketplaceMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [publicPageCopied, setPublicPageCopied] = useState(false);
  const [showWaModal, setShowWaModal] = useState(false);

  useEffect(() => { if (id) load(); }, [id]);

  useEffect(() => {
    if (!apt?.id || !marketplaceJob || !['queued', 'claimed', 'processing'].includes(marketplaceJob.status)) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const jobs = await api.marketplace.jobs(apt.id);
        const latest = jobs[0] || null;
        const logs = latest ? await api.marketplace.logs(latest.id, 25) : [];
        if (!cancelled) {
          setMarketplaceJob(latest);
          setMarketplaceLogs(logs);
        }
      } catch { /* keep the last known state */ }
    };
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [apt?.id, marketplaceJob?.id, marketplaceJob?.status]);

  async function load() {
    const a = await api.apartments.get(Number(id));
    if (!a) { navigate('/apartments'); return; }
    setApt(a);
    setForm({
      ...a,
      marketplaceBedrooms: a.marketplaceBedrooms !== undefined ? a.marketplaceBedrooms : a.rooms || '',
      marketplaceBathrooms: a.marketplaceBathrooms !== undefined ? a.marketplaceBathrooms : a.bathrooms || '',
      marketplaceRentalType: a.marketplaceRentalType || 'Departamento/condominio',
      paymentRemindersEnabled: a.paymentRemindersEnabled !== false,
      paymentReminderDays: Array.isArray(a.paymentReminderDays) ? a.paymentReminderDays : [-3, 0, 3],
    });

    const [allC, allP, allE, allV, allF, allT, allPhotos, allU] = await Promise.all([
      api.contracts.toArray(), api.payments.toArray(), api.expenses.toArray(),
      api.vacancies.toArray(), api.familyMembers.toArray(), api.tenants.toArray(), api.photos.toArray(), api.utilityPayments.toArray(),
    ]);
    const aptContracts = allC.filter(c => c.apartmentId === a.id);
    setContracts(aptContracts);
    const active = aptContracts.find(c => !c.endDate || new Date(c.endDate) > new Date());
    setContract(active);
    let t = active ? allT.find(t => t.id === active.tenantId) : null;
    if (!t) t = allT.find(t => t.apartmentId === a.id);
    setTenant(t || null);

    setPayments(allP.filter(p => p.apartmentId === a.id));
    setExpenses(allE.filter(e => e.apartmentId === a.id));
    setVacancies(allV.filter(v => v.apartmentId === a.id));
    setFamilyMembers(allF.filter(f => f.apartmentId === a.id));
    setPhotos(allPhotos.filter(p => p.apartmentId === a.id));
    setUtilityRecords(allU.filter(u => u.apartmentId === a.id));
    setMarketplaceUrl(a.marketplaceUrl || '');
    try {
      const jobs = await api.marketplace.jobs(a.id);
      const latest = jobs[0] || null;
      setMarketplaceJob(latest);
      setMarketplaceLogs(latest ? await api.marketplace.logs(latest.id, 25) : []);
    } catch {
      setMarketplaceJob(null);
      setMarketplaceLogs([]);
    }
    setUtilityPeriod(getCurrentPeriod());
    // Generate QR codes for existing payment URLs
    const urls = {};
    for (const svc of ['water', 'gas']) {
      const url = servicePaymentUrl(a, svc);
      if (url) {
        try { urls[svc] = await QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } }); } catch {}
      }
    }
    if (Object.keys(urls).length > 0) setQrUrls(urls);
  }

  async function handleSave(e) {
    e.preventDefault();
    const nic = form.nic || form.electricityPaymentCode || '';
    const autoUrl = nic ? 'https://airepagos.st/' : '';
    await api.apartments.update(Number(id), {
      ...form,
      monthlyRent: Number(form.monthlyRent),
      depositAmount: Number(form.depositAmount),
      refCatastral: form.refCatastral || '',
      area: Number(form.area || 0),
      waterReadingDay: Number(form.waterReadingDay || 10),
      gasReadingDay: Number(form.gasReadingDay || 12),
      electricityReadingDay: Number(form.electricityReadingDay || 15),
      paymentRemindersEnabled: form.paymentRemindersEnabled !== false,
      paymentReminderDays: (Array.isArray(form.paymentReminderDays) ? form.paymentReminderDays : [-3, 0, 3])
        .map(Number).filter(day => Number.isInteger(day) && day >= -15 && day <= 31),
      waterPaymentUrl: form.waterPaymentUrl || '',
      // Gases no longer uses the monthly receipt/coupon QR. Persist only the
      // public contract payment route generated from the contract number.
      gasPaymentUrl: gasContractPaymentUrl(form.gasPaymentCode),
      electricityPaymentUrl: autoUrl || form.electricityPaymentUrl || '',
    });
    setEditing(false);
    load();
  }

  async function handleDelete() {
    if (confirm('¿Eliminar este apartamento?')) {
      await api.apartments.delete(Number(id));
      navigate('/apartments');
    }
  }

  async function addMember(e) {
    e.preventDefault();
    if (!newMember.name.trim()) return;
    await api.familyMembers.add({ apartmentId: apt.id, name: newMember.name.trim(), phone: newMember.phone.trim() });
    setNewMember({ name: '', phone: '' });
    const allF = await api.familyMembers.toArray();
    setFamilyMembers(allF.filter(f => f.apartmentId === apt.id));
  }

  async function deleteMember(memberId) {
    await api.familyMembers.delete(memberId);
    const allF = await api.familyMembers.toArray();
    setFamilyMembers(allF.filter(f => f.apartmentId === apt.id));
  }

  async function endVacancy(vacId) {
    await api.vacancies.update(vacId, { endDate: new Date().toISOString() });
    load();
  }

  async function handlePhotoUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const file of files) {
      try { await api.uploadPhoto(file, Number(id)); ok++; } catch { fail++; }
    }
    setUploading(false);
    e.target.value = '';
    if (fail > 0) alert(ok + ' foto(s) subida(s), ' + fail + ' error(es)');
    load();
  }

  async function deletePhoto(photoId) {
    if (confirm('¿Eliminar esta foto?')) await api.deletePhoto(photoId);
    load();
  }

  function downloadPhoto(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name || 'foto'; a.click();
  }

  function openGallery(idx) {
    setGalleryIdx(idx);
  }

  function closeGallery() {
    setGalleryIdx(null);
  }

  function prevPhoto() {
    if (galleryIdx === null) return;
    setGalleryIdx(galleryIdx === 0 ? photos.length - 1 : galleryIdx - 1);
  }

  function nextPhoto() {
    if (galleryIdx === null) return;
    setGalleryIdx(galleryIdx === photos.length - 1 ? 0 : galleryIdx + 1);
  }

  useEffect(() => {
    function handleKey(e) {
      if (galleryIdx === null) return;
      if (e.key === 'Escape') closeGallery();
      if (e.key === 'ArrowLeft') prevPhoto();
      if (e.key === 'ArrowRight') nextPhoto();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [galleryIdx, photos.length]);

  // ─── QR Scanner ───

  const SCAN_MAX_W = 640;
  const scanDetectorRef = useRef(null);

  function barcodeRawValue(barcode) {
    return String(barcode?.rawValue || barcode?.displayValue || barcode?.urlBookmark?.url || '').trim();
  }

  async function getDetector() {
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

  async function detectVideo(video) {
    if (video.readyState < video.HAVE_CURRENT_DATA) return null;
    const detector = await getDetector();
    if (detector) {
      try { const b = await detector.detect(video); if (b.length > 0) return barcodeRawValue(b[0]); } catch {}
    }
    const w = Math.min(video.videoWidth || 640, SCAN_MAX_W);
    const h = Math.min(video.videoHeight || 480, Math.round(w * ((video.videoHeight || 480) / (video.videoWidth || 640))));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) return code.data;
    } catch {}
    return null;
  }

  async function detectFile(file) {
    let bitmap = null;
    try {
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(file, { resizeWidth: SCAN_MAX_W, resizeQuality: 'high' });
      } else {
        bitmap = await new Promise((resolve, reject) => {
          const image = new Image();
          const objectUrl = URL.createObjectURL(file);
          image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
          image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo abrir la imagen.')); };
          image.src = objectUrl;
        });
      }
      const detector = await getDetector();
      if (detector) {
        try {
          const b = await detector.detect(bitmap);
          if (b.length > 0) {
            if (typeof bitmap.close === 'function') bitmap.close();
            return barcodeRawValue(b[0]);
          }
        } catch {}
      }
      const canvas = document.createElement('canvas');
      const sourceWidth = bitmap.width || bitmap.naturalWidth || SCAN_MAX_W;
      const sourceHeight = bitmap.height || bitmap.naturalHeight || 480;
      const scale = Math.min(1, SCAN_MAX_W / sourceWidth);
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      return code ? code.data : null;
    } catch {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      return null;
    }
  }

  async function saveScanResult(data, svc) {
    if (svc === 'gas') throw new Error('Gases del Caribe usa el enlace permanente por contrato; no se guarda el QR mensual.');
    const url = normalizeScannedPaymentUrl(data, svc);
    if (!url) {
      throw new Error(svc === 'water'
        ? 'El QR no parece ser un enlace de pago nativo de Triple A.'
        : 'El QR no contiene un enlace de pago válido de Gases del Caribe.');
    }
    const field = svc === 'water' ? 'waterPaymentUrl' : svc === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl';
    const saved = await api.apartments.update(Number(id), { [field]: url });
    if (!saved || saved[field] !== url) throw new Error('Aiven no confirmó el enlace QR. Inténtalo de nuevo.');
    const updated = { ...apt, [field]: url };
    setApt(updated);
    setForm(updated);
    generateQr(svc, url);
  }

  async function askAndSaveNIC() {
    const nic = window.prompt('Ingresa el NIC de Air-e (7 dígitos):', '');
    if (!nic || !nic.trim()) return;
    const digits = nic.trim().replace(/\D/g, '');
    if (digits.length < 4) { alert('El NIC debe tener al menos 4 dígitos'); return; }
    const url = 'https://airepagos.st/';
    await api.apartments.update(Number(id), { nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url });
    const updated = { ...apt, nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url };
    setApt(updated);
    setForm(updated);
    openPaymentUrl(url);
  }

  function handlePayElectricity() {
    const url = servicePaymentUrl(apt, 'electricity');
    if (url) {
      openPaymentUrl(url);
    } else {
      askAndSaveNIC();
    }
  }

  function openWebScanner(svc) {
    scanServiceRef.current = svc;
    setScanStatus('Iniciando cámara…');
    setScanService(svc);
  }

  function closeScanner() {
    scanServiceRef.current = null;
    stopWebCam();
    setScanService(null);
  }

  async function handleScanButton(svc) {
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
        if (rawValue) await saveScanResult(rawValue, svc);
      } catch (error) {
        console.error('Native scan error:', error);
        if (rawValue) alert(error.message || 'Aiven no confirmó el enlace QR.');
        else openWebScanner(svc);
      }
    } else {
      openWebScanner(svc);
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
    })
      .then(stream => {
        if (!videoRef.current || !scanServiceRef.current) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        const v = videoRef.current;
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          v.play().then(() => {
            setScanStatus('Enfoca el QR del recibo.');
            scanTimerRef.current = setTimeout(webDoScan, 500);
          }).catch(() => setScanStatus('No se pudo iniciar la cámara; pulsa “Subir foto”.'));
        };
      })
      .catch(() => {
        setScanStatus('Permiso de cámara no disponible; pulsa “Subir foto”.');
      });
  }

  function stopWebCam() {
    setScanStatus('');
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  }

  useEffect(() => {
    if (scanService === null) return undefined;
    const timer = setTimeout(startWebCam, 250);
    return () => clearTimeout(timer);
  }, [scanService]);

  async function webDoScan() {
    const svc = scanServiceRef.current;
    if (!svc || !videoRef.current) return;
    const val = await detectVideo(videoRef.current);
    if (val) {
      try {
        setScanStatus('QR detectado; guardando enlace…');
        await saveScanResult(val, svc);
        closeScanner();
      } catch (error) {
        setScanStatus(error.message || 'El QR no es válido para este servicio.');
        scanTimerRef.current = setTimeout(webDoScan, 1000);
      }
      return;
    }
    scanTimerRef.current = setTimeout(webDoScan, 500);
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const val = await detectFile(file);
    const svc = scanServiceRef.current;
    if (val && svc) {
      try {
        setScanStatus('QR detectado; guardando enlace…');
        await saveScanResult(val, svc);
        closeScanner();
      } catch (error) {
        setScanStatus(error.message || 'No se pudo guardar el QR.');
        alert(error.message || 'No se pudo guardar el QR.');
      }
    } else if (val && !svc) {
      try { await saveScanResult(val, showQrModal); } catch (error) { alert(error.message || 'No se pudo guardar el QR.'); }
    } else {
      alert('No se encontró un código QR en la imagen');
    }
  }

  async function generateQr(svc, url) {
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } });
      setQrUrls(prev => ({ ...prev, [svc]: dataUrl }));
    } catch {}
  }

  function openPaymentUrl(url) {
    if (isCapacitor()) {
      window.open(url, '_system');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  useEffect(() => {
    return () => stopWebCam();
  }, []);

  function callNumber(phone) {
    window.location.href = 'tel:' + phone;
  }

  function whatsappNumber(phone) {
    const num = phone.replace(/[^0-9]/g, '');
    window.open('https://wa.me/57' + num, '_blank');
  }

  function whatsappServiceTemplateValues() {
    const records = {
      electricity: latestUtilityRecord(utilityRecords, 'electricity'),
      water: latestUtilityRecord(utilityRecords, 'water'),
      gas: latestUtilityRecord(utilityRecords, 'gas'),
    };
    const links = {
      electricity: servicePaymentUrl(apt, 'electricity') || 'No configurado',
      water: servicePaymentUrl(apt, 'water') || 'No configurado',
      gas: servicePaymentUrl(apt, 'gas') || 'No configurado',
    };
    return {
      deuda_aire: utilityDebtText(records.electricity),
      deuda_agua: utilityDebtText(records.water),
      deuda_gas: utilityDebtText(records.gas),
      nic_aire: apt?.electricityPaymentCode || apt?.nic || 'No configurado',
      poliza_agua: apt?.waterPaymentCode || records.water?.waterPaymentCode || 'No configurada',
      contrato_gas: apt?.gasPaymentCode || records.gas?.gasPaymentCode || 'No configurado',
      link_aire: links.electricity,
      link_triplea: links.water,
      link_gases: links.gas,
    };
  }

  function handleWhatsAppReminder() {
    if (!tenant || !tenant.phone) { alert('El inquilino no tiene teléfono registrado'); return; }
    const num = tenant.phone.replace(/[^0-9]/g, '');
    const fullNum = num.startsWith('57') ? num : '57' + num;
    const period = getCurrentPeriod();
    const [year, month] = period.split('-').map(Number);
    const dueDay = Math.min(31, Math.max(1, Number(apt?.paymentDueDay) || 5));
    const lastDay = new Date(year, month, 0).getDate();
    const dueDate = new Date(year, month - 1, Math.min(dueDay, lastDay));
    const today = new Date();
    const alreadyPaid = payments.some(payment => String(payment.period || payment.date || '').slice(0, 7) === period &&
      payment.type === 'rent' && payment.status !== 'pending_validation' && payment.status !== 'rejected');
    const pendingProof = payments.some(payment => String(payment.period || payment.date || '').slice(0, 7) === period &&
      payment.type === 'rent' && payment.status === 'pending_validation');
    const estado = alreadyPaid ? 'Pagado' : pendingProof ? 'Comprobante pendiente de validación' : dueDate < today ? 'Vencido' : 'Pendiente';
    const template = localStorage.getItem('wa_template_reminder') || DEFAULT_WA_REMINDER_TEMPLATE;
    const msg = expandWhatsAppTemplate(template, {
      nombre: tenant.name || '',
      apto: apt?.name || '',
      periodo: getPeriodLabel(period),
      valor_canon: Number(contract?.monthlyRent || apt?.monthlyRent || 0).toLocaleString('es-CO'),
      fecha_vencimiento: dueDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
      estado_canon: estado,
      ...whatsappServiceTemplateValues(),
    });
    window.open(`https://wa.me/${fullNum}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function handleWhatsAppServices() {
    if (!tenant || !tenant.phone) { alert('El inquilino no tiene teléfono registrado'); return; }
    const num = tenant.phone.replace(/[^0-9]/g, '');
    const fullNum = num.startsWith('57') ? num : '57' + num;
    const template = localStorage.getItem('wa_template_services') || DEFAULT_WA_SERVICES_TEMPLATE;
    const msg = expandWhatsAppTemplate(template, {
      nombre: tenant.name || '',
      apto: apt?.name || '',
      ...whatsappServiceTemplateValues(),
    });
    window.open(`https://wa.me/${fullNum}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function generateMarketplaceText() {
    const title = `🏠 Arriendo Apartamento ${apt.name}`;
    const specs = [`${apt.rooms || '?'} habs`, `${apt.bathrooms || '?'} baños`, `${apt.area || '?'} m²`].join(' · ');
    const price = `💰 $${Number(apt.monthlyRent || 0).toLocaleString('es-CO')}/mes`;
    const lines = [
      title,
      '',
      `📍 Apartamento ${apt.name}`,
      specs,
      price,
      '',
      apt.description || '',
      '',
      '📞 Para más información, contáctame.',
    ];
    return lines.join('\n');
  }

  async function saveMarketplaceUrl() {
    const url = prompt('Pega la URL de la publicación en Facebook Marketplace:', marketplaceUrl || '');
    if (url === null) return;
    await api.apartments.update(Number(id), { marketplaceUrl: url });
    setMarketplaceUrl(url);
    window.dispatchEvent(new CustomEvent('laujim-marketplace-save-url', {
      detail: { aptId: Number(id), aptName: apt?.name || '', url: url }
    }));
  }

  function copyAdText() {
    navigator.clipboard.writeText(generateMarketplaceText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => alert('No se pudo copiar. Selecciona el texto manualmente.'));
  }

  async function copyPublicApartmentPage() {
    if (!apt?.id) return;
    const url = `${window.location.origin}/publico/apartamento/${apt.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setPublicPageCopied(true);
      setTimeout(() => setPublicPageCopied(false), 2000);
    } catch {
      window.prompt('Copia este enlace para compartir la página del apartamento:', url);
    }
  }

  function openMarketplace() {
    window.open('https://www.facebook.com/marketplace/you/selling', '_blank');
  }

  function autoFillMarketplace() {
    try {
      const photoUrls = photos.map(p => photoUrl(p)).filter(Boolean);
      const data = generateMarketplaceJson(apt, photoUrls);
      const jsonString = JSON.stringify(data);

      window.postMessage({ type: 'LAUJIM_MARKETPLACE_DATA', data: data }, '*');

      var el = document.getElementById('__LAUJIM_EXT_DATA__');
      if (!el) {
        el = document.createElement('div');
        el.id = '__LAUJIM_EXT_DATA__';
        el.style.display = 'none';
        document.body.appendChild(el);
      }
      el.textContent = jsonString;

      var wait = function (resolve) {
        if (el.getAttribute('data-status') === 'saved') { resolve(); return; }
        var observer = new MutationObserver(function () {
          if (el.getAttribute('data-status') === 'saved') {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(el, { attributes: true, attributeFilter: ['data-status'] });
        setTimeout(function () { observer.disconnect(); resolve(); }, 2000);
      };

      new Promise(wait).then(function () {
        setTimeout(function () {
          var e = document.getElementById('__LAUJIM_EXT_DATA__');
          if (e) e.remove();
        }, 1000);
        navigator.clipboard.writeText(jsonString).then(function () {
          var w = window.open('https://web.facebook.com/marketplace/create/rental', '_blank');
          if (w) setTimeout(function () { try { w.focus(); } catch {} }, 1000);
        }).catch(function () {
          var w = window.open('https://web.facebook.com/marketplace/create/rental', '_blank');
          if (w) setTimeout(function () { try { w.focus(); } catch {} }, 1000);
        });
      });
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  function openPublishedAd() {
    if (marketplaceUrl) window.open(marketplaceUrl, '_blank');
  }

  async function queueMarketplacePublication() {
    if (!apt?.id || marketplaceBusy) return;
    setMarketplaceBusy(true);
    setMarketplaceMessage(null);
    try {
      const response = await api.marketplace.publish(apt.id);
      const job = response.job || null;
      setMarketplaceJob(job);
      let localMessage = '';
      if (isCapacitor()) {
        try {
          await runAndroidMarketplaceWorkerNow();
          localMessage = ' El navegador local ya fue activado.';
        } catch (error) {
          localMessage = ` Quedó en cola; abre Facebook en la APK si solicita sesión (${error.message || 'worker no disponible'}).`;
        }
      }
      setMarketplaceMessage({
        type: 'success',
        text: response.alreadyQueued
          ? `Ese apartamento ya estaba en la cola.${localMessage}`
          : `Publicación enviada al teléfono.${localMessage || ' El worker Android la recogerá en su próxima comprobación.'}`,
      });
    } catch (error) {
      setMarketplaceMessage({ type: 'error', text: error.message || 'No se pudo crear la publicación.' });
    } finally {
      setMarketplaceBusy(false);
    }
  }

  async function retryMarketplacePublication() {
    if (!marketplaceJob?.id || marketplaceBusy) return;
    setMarketplaceBusy(true);
    setMarketplaceMessage(null);
    try {
      const response = await api.marketplace.retry(marketplaceJob.id);
      setMarketplaceJob(response.job || null);
      if (isCapacitor()) await runAndroidMarketplaceWorkerNow().catch(() => null);
      setMarketplaceMessage({ type: 'success', text: 'Reintento enviado al worker Android.' });
    } catch (error) {
      setMarketplaceMessage({ type: 'error', text: error.message || 'No se pudo reintentar.' });
    } finally {
      setMarketplaceBusy(false);
    }
  }

  async function openMarketplaceLogin() {
    try {
      await openAndroidMarketplace();
    } catch (error) {
      setMarketplaceMessage({ type: 'error', text: error.message || 'No se pudo abrir Facebook en la APK.' });
    }
  }

  async function shareToWhatsAppApt() {
    if (!apt) return;
    setShareLoading(true);
    setShareFailed(null);
    try {
      const text = [
        `Apartamento ${apt.name} - ${apt.status === 'vacant' ? 'DISPONIBLE' : 'ARRENDADO'}`,
        apt.description || '',
        `Canon: $${(apt.monthlyRent || 0).toLocaleString()}`,
        apt.rooms ? `${apt.rooms} hab / ${apt.bathrooms} ba\u00f1os / ${apt.area} m\u00b2` : '',
        apt.notes || '',
      ].filter(Boolean).join('\n');
      const publicPageUrl = `${window.location.origin}/publico/apartamento/${apt.id}`;
      const fullText = text + '\n\nMás información y servicios: ' + publicPageUrl;
      const photoUrls = photos.map(p => { const u = photoUrl(p); return u || null; }).filter(Boolean);

      if (isCapacitor()) {
        try {
          const { Filesystem, Directory } = await import('@capacitor/filesystem');
          const { Share } = await import('@capacitor/share');
          const files = [];
          for (let i = 0; i < photoUrls.length; i++) {
            try {
              const res = await fetch(photoUrls[i]);
              const blob = await res.blob();
              const b64 = await new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(blob); });
              const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
              const r = await Filesystem.writeFile({ path: `apto_${i + 1}.${ext}`, data: b64.split(',')[1], directory: Directory.Cache });
              files.push(r.uri);
            } catch (e) { console.warn('[Share] Photo fetch/save failed:', photoUrls[i], e); }
          }
          if (files.length > 0) {
            await Share.share({ text: fullText, files, dialogTitle: 'Compartir Apartamento' });
            return;
          }
        } catch (e) { console.warn('[Share] Capacitor share failed:', e); }
      }

      if (photoUrls.length > 0) {
        try {
          const files = [];
          for (const url of photoUrls) {
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const mime = blob.type || 'image/jpeg';
              const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
              files.push(new File([blob], `foto.${ext}`, { type: mime }));
            } catch (e) { console.warn('[Share] Photo fetch failed:', url, e); }
          }
          if (files.length > 0) {
            await navigator.share({ files, text: fullText });
            return;
          }
        } catch (e) {
          if (e.name === 'AbortError') return;
          console.warn('[Share] Web Share with files failed:', e);
        }
      }

      if (navigator.share) {
        try {
          await navigator.share({ text: fullText });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      if (photoUrls.length > 0) setShareFailed(photoUrls);
      const waText = photoUrls.length > 0 ? fullText + '\n\n' + photoUrls.join('\n') : fullText;
      const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
      window.open(waUrl, '_blank');
      if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        try { window.open(`whatsapp://send?text=${encodeURIComponent(waText)}`); } catch {}
      }
    } finally {
      setShareLoading(false);
    }
  }

  function toggleUtilityPaid(record) {
    api.utilityPayments.update(record.id, {
      paid: !record.paid,
      paidDate: !record.paid ? new Date().toISOString() : null,
    }).then(() => load());
  }

  function getUtilityForPeriod(service, period) {
    return utilityRecords.find(r => r.service === service && r.period === period);
  }

  if (!apt) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;

  const totalIncome = payments.filter(p => p.type === 'rent' && p.status !== 'pending_validation' && p.status !== 'rejected').reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0) + payments.filter(p => p.type === 'expense').reduce((s, p) => s + (p.amount || 0), 0);
  const { daysLeft: daysToPay, targetDate: nextPayDate } = daysUntil(apt.paymentDueDay);

  const services = ['water', 'gas', 'electricity'];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/apartments')} className="p-2 hover:bg-gray-200 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{apt.name}</h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${apt.status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{apt.status === 'occupied' ? 'ARRENDADO' : 'DISPONIBLE'}</span>
          </div>
          <p className="text-gray-500 text-sm">{apt.description || 'Sin descripción'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar"><Edit2 className="w-5 h-5" /></button>
          <button onClick={handleDelete} className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar"><Trash2 className="w-5 h-5" /></button>
          <button onClick={() => generateApartmentPDF(apt, tenant, contract)} className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="Descargar PDF"><FileText className="w-5 h-5" /></button>
          <button onClick={copyPublicApartmentPage} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title={publicPageCopied ? 'Enlace copiado' : 'Copiar página pública'}>
            {publicPageCopied ? <Check className="w-5 h-5 text-emerald-600" /> : <Copy className="w-5 h-5" />}
          </button>
          <button onClick={shareToWhatsAppApt} disabled={shareLoading} className="p-2 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Compartir por WhatsApp">
            <MessageCircle className="w-5 h-5" />
          </button>
          <a href={`/generate-contract/${apt.id}`} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Generar Contrato">
            <FileText className="w-5 h-5" />
          </a>
        </div>
      </div>

      {shareFailed && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">No se pudieron adjuntar las fotos a WhatsApp. Abre los enlaces para descargar y comparte manualmente:</p>
          <div className="space-y-1">
            {shareFailed.map((url, i) => (
              <p key={i} className="text-xs leading-relaxed break-all">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">{url}</a>
              </p>
            ))}
          </div>
          <button onClick={() => setShareFailed(null)} className="mt-2 text-xs text-amber-600 hover:underline">Cerrar</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Canon</p><p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(apt.monthlyRent)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Depósito</p><p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(apt.depositAmount)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Día de Pago</p><p className="text-xl font-bold text-gray-900 mt-1">{apt.paymentDueDay || 5}</p></div>
        <div className={`rounded-xl border p-4 ${daysToPay <= 1 ? 'bg-red-50 border-red-200' : daysToPay <= 5 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <p className="text-xs font-medium uppercase flex items-center gap-1"><Clock className="w-3 h-3" /> Próximo Pago</p>
          <p className={`text-xl font-bold mt-1 ${daysToPay <= 1 ? 'text-red-700' : daysToPay <= 5 ? 'text-amber-700' : 'text-gray-900'}`}>
            {daysToPay === 0 ? '¡Hoy!' : daysToPay === 1 ? 'Mañana' : `${daysToPay} días`}
          </p>
          <p className="text-xs text-gray-400 mt-1">{nextPayDate.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => addCalendarReminder(apt.name, apt.paymentDueDay)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline">
              <Calendar className="w-3 h-3" /> Recordatorio
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><User className="w-4 h-4" /> Inquilino Actual</h3>
            {tenant ? (
              <div className="space-y-2 text-sm">
                <p><span className="text-gray-500">Nombre:</span> <strong>{tenant.name}</strong></p>


                <p><span className="text-gray-500">Teléfono:</span> {tenant.phone || '-'}</p>
                {tenant.phone && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => callNumber(tenant.phone)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs hover:bg-green-100 transition-colors"><Phone className="w-3 h-3" /> Llamar</button>
                    <button onClick={() => setShowWaModal(true)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 transition-colors"><MessageCircle className="w-3 h-3" /> WhatsApp</button>
                  </div>
                )}
                {contract && <p><span className="text-gray-500">Desde:</span> {formatShortDate(contract.startDate)}</p>}
              </div>
            ) : <p className="text-gray-400 text-sm">Sin inquilino</p>}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><User className="w-4 h-4" /> Residentes / Familiares</h3>
            {familyMembers.length > 0 ? (
              <div className="space-y-2 mb-3">
                {familyMembers.map(m => (
                  <div key={m.id} className="p-2.5 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{m.name}</p>
                        {m.phone && <p className="text-xs text-gray-500">{m.phone}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        {m.phone && (
                          <>
                            <button onClick={() => callNumber(m.phone)} className="p-1.5 text-green-600 hover:bg-green-100 rounded transition-colors" title="Llamar"><Phone className="w-3.5 h-3.5" /></button>
                            <button onClick={() => whatsappNumber(m.phone)} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded transition-colors" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></button>
                          </>
                        )}
                        <button onClick={() => deleteMember(m.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-gray-400 text-sm mb-3">Sin residentes registrados</p>}
            <form onSubmit={addMember} className="flex gap-2">
              <input type="text" placeholder="Nombre" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
              <input type="text" placeholder="Teléfono" value={newMember.phone} onChange={e => setNewMember({...newMember, phone: e.target.value})} className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <button type="submit" className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"><Plus className="w-4 h-4" /></button>
            </form>
          </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Resumen Financiero</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Total ingresos:</span><strong className="text-emerald-600">{formatCurrency(totalIncome)}</strong></div>
                <div className="flex justify-between"><span className="text-gray-500">Total gastos:</span><strong className="text-red-600">{formatCurrency(totalExpenses)}</strong></div>
                <div className="flex justify-between border-t border-gray-200 pt-2"><span className="text-gray-500">Neto:</span><strong>{formatCurrency(totalIncome - totalExpenses)}</strong></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Gastos</h3>
                <button onClick={() => setShowExpForm(true)} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors"><Plus className="w-3 h-3" /> Añadir</button>
              </div>
              {expenses.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">Sin gastos registrados</p>
              ) : (
                <div className="space-y-1.5">
                  {expenses.sort((a, b) => new Date(b.date) - new Date(a.date)).map(e => (
                    <div key={e.id} className="flex items-center justify-between py-1.5 px-3 bg-red-50 rounded-lg text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-500 whitespace-nowrap">{new Date(e.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</span>
                        <span className="text-gray-800">{e.description}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-medium text-red-600 whitespace-nowrap">-{formatCurrency(e.amount)}</span>
                        <button onClick={() => delExp(e.id)} className="p-1 text-gray-400 hover:text-red-600 transition-colors" title="Eliminar gasto"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showExpForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Nuevo Gasto</h4>
                <form onSubmit={async e => {
                  e.preventDefault();
                  await api.expenses.add({
                    apartmentId: Number(id),
                    amount: Number(expForm.amount),
                    date: expForm.date,
                    category: expForm.category || 'Otro',
                    description: expForm.description,
                    isUnexpected: false,
                    createdAt: new Date().toISOString(),
                  });
                  setShowExpForm(false);
                  setExpForm({ amount: '', date: new Date().toISOString().split('T')[0], category: '', description: '' });
                  load();
                }} className="space-y-3">
                  <select value={expForm.category} onChange={e => setExpForm({...expForm, category: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required>
                    <option value="">Categoría</option>
                    {expenseSuggestions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input type="text" value={expForm.description} onChange={e => setExpForm({...expForm, description: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Descripción" required />
                  <div className="grid grid-cols-2 gap-3">
                    <input type="number" value={expForm.amount} onChange={e => setExpForm({...expForm, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Monto" required />
                    <input type="date" value={expForm.date} onChange={e => setExpForm({...expForm, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowExpForm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
                    <button type="submit" className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors">Guardar</button>
                  </div>
                </form>
              </div>
            )}

          <PaymentHistoryChart apartment={apt} payments={payments} />
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Zap className="w-4 h-4" /> Servicios Públicos</h3>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1">
                <button onClick={() => setUtilityPeriod(prevPeriod(utilityPeriod))} className="p-1 hover:bg-gray-100 rounded"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-medium px-2">{getPeriodLabel(utilityPeriod)}</span>
                <button onClick={() => setUtilityPeriod(nextPeriod(utilityPeriod))} className="p-1 hover:bg-gray-100 rounded"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <button onClick={() => setUtilityPeriod(getCurrentPeriod())} className="text-xs text-blue-600 hover:underline">Hoy</button>
            </div>
            <div className="space-y-2">
              {services.map(svc => {
                const rec = getUtilityForPeriod(svc, utilityPeriod);
                const readingDay = svc === 'water' ? (apt.waterReadingDay || 10) : svc === 'gas' ? (apt.gasReadingDay || 12) : (apt.electricityReadingDay || 15);
                const overdue = rec && !rec.paid && isOverdueByReadingDate(utilityPeriod, readingDay);
                const overdueCount = utilityRecords.filter(r => r.service === svc && !r.paid).length;
                const Icon = serviceIcons[svc];
                const paymentUrl = servicePaymentUrl(apt, svc);
                return (
                  <div key={svc} className={`p-3 rounded-lg border ${overdue ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded-lg ${serviceColors[svc]}`}><Icon className="w-3.5 h-3.5" /></div>
                        <span className="font-medium text-sm">{serviceNames[svc]}</span>
                      </div>
                      {overdue && <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Vencido</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>Código: <code className="px-1 bg-white rounded font-mono">{rec?.paymentCode || utilityRecords.find(r => r.service === svc && r.paymentCode)?.paymentCode || (svc === 'water' ? apt.waterPaymentCode : svc === 'gas' ? apt.gasPaymentCode : apt.electricityPaymentCode || apt.nic) || '-'}</code></span>
                      <span>Valor: {rec?.amount ? formatCurrency(rec.amount) : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex gap-1">
                        {rec?.paymentCode && (
                          <a href={utilityWebsites[svc].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100 rounded transition-colors">
                            <ExternalLink className="w-3 h-3" /> Pagar web
                          </a>
                        )}
                        {svc === 'electricity' ? (
                          <button onClick={handlePayElectricity} className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${paymentUrl ? 'text-emerald-600 hover:bg-emerald-100 font-medium' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}>
                            <ExternalLink className="w-3 h-3" /> Pagar
                          </button>
                        ) : svc === 'gas' ? (
                          paymentUrl && (
                            <button onClick={() => openPaymentUrl(paymentUrl)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-100 rounded transition-colors font-medium">
                              <ExternalLink className="w-3 h-3" /> Pagar por contrato
                            </button>
                          )
                        ) : (
                          <>
                            {paymentUrl && (
                              <>
                                <button onClick={() => setShowQrModal(svc)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100 rounded transition-colors">
                                  <QrCode className="w-3 h-3" /> QR
                                </button>
                                <button onClick={() => openPaymentUrl(paymentUrl)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-100 rounded transition-colors font-medium">
                                  <ExternalLink className="w-3 h-3" /> Pagar
                                </button>
                              </>
                            )}
                            <button onClick={() => handleScanButton(svc)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" title="Escanear QR de recibo">
                              <Scan className="w-3 h-3" /> Escanear
                            </button>
                          </>
                        )}
                        <input ref={scannerRef} type="file" accept="image/*" onChange={handleScanFile} className="hidden" />
                      </div>
                      {rec ? (
                        <button onClick={() => toggleUtilityPaid(rec)} className={`px-2 py-1 text-xs rounded transition-colors ${rec.paid ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}>
                          {rec.paid ? 'No Pagado' : 'Pagado'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Sin registro</span>
                      )}
                    </div>
                    {overdueCount > 1 && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {overdueCount} recibos sin pagar
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* QR payment modal */}
          <Modal open={showQrModal !== null} onClose={() => setShowQrModal(null)} size="sm">
            {showQrModal && qrUrls[showQrModal] && (
              <div className="p-4 text-center">
                <h3 className="font-semibold text-gray-900 mb-1">Pago {serviceNames[showQrModal]}</h3>
                <p className="text-xs text-gray-500 mb-4">{apt.name}</p>
                <img src={qrUrls[showQrModal]} alt="QR de pago" className="mx-auto w-56 h-56 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => openPaymentUrl(servicePaymentUrl(apt, showQrModal))} />
                <p className="text-xs text-gray-400 mt-2">Toca el QR o el botón para pagar</p>
                <button onClick={() => openPaymentUrl(servicePaymentUrl(apt, showQrModal))} className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-medium">
                  <ExternalLink className="w-4 h-4" /> Pagar ahora
                </button>
                {showQrModal !== 'electricity' && (
                  <button onClick={() => { const svc = showQrModal; setShowQrModal(null); handleScanButton(svc); }} className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors text-sm">
                    <Scan className="w-4 h-4" /> Escanear otro QR
                  </button>
                )}
              </div>
            )}
          </Modal>

          {/* Scanner modal */}
          <Modal open={scanService !== null} onClose={closeScanner} title={scanService ? `Escaneando QR - ${serviceNames[scanService]}` : ''}>
            <div className="p-4">
              <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ minHeight: 280 }}>
                <video ref={videoRef} className="w-full h-full object-cover" muted autoPlay playsInline />
                {scanService !== null && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-emerald-400 rounded-xl opacity-70" />
                  </div>
                )}
                {scanStatus && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                    <p className="text-white text-xs text-center">{scanStatus}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => scannerRef.current?.click()} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <Image className="w-4 h-4" /> Subir foto
                </button>
                <button onClick={closeScanner} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm">
                  Cancelar
                </button>
              </div>
            </div>
          </Modal>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Image className="w-4 h-4" /> Fotos del Apartamento</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map((p, i) => (
                <div key={p.id} className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-pointer" onClick={() => openGallery(i)}>
                  <img src={photoUrl(p)} alt={p.originalName || 'Foto'} className="w-full h-full object-cover" loading="lazy" onError={e => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'; }} />
                  <div className="absolute inset-0 bg-gray-200 items-center justify-center hidden"><Image className="w-6 h-6 text-gray-400" /></div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <button onClick={e => { e.stopPropagation(); downloadPhoto(photoUrl(p), p.originalName || 'foto'); }} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-blue-600" title="Descargar"><Download className="w-3.5 h-3.5" /></button>
                    <button onClick={e => { e.stopPropagation(); deletePhoto(p.id); }} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-red-600" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            {photos.length > 1 && (
              <button onClick={() => photos.forEach(p => downloadPhoto(photoUrl(p), p.originalName || 'foto'))} className="w-full flex items-center justify-center gap-2 px-4 py-2 mb-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"><Download className="w-4 h-4" /> Descargar todas ({photos.length})</button>
            )}
            <input type="file" accept="image/*" multiple ref={fileRef} onChange={handlePhotoUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
              <Camera className="w-4 h-4" /> {uploading ? 'Subiendo...' : 'Subir Fotos'}
            </button>
          </div>

          {galleryIdx !== null && photos[galleryIdx] && (
            <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={closeGallery}>
              <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
                <button onClick={closeGallery} className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm p-1 z-10">Cerrar [Esc]</button>
                <img src={photoUrl(photos[galleryIdx])} alt={photos[galleryIdx].originalName || 'Foto'} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
                <div className="flex items-center justify-between w-full mt-3">
                  <button onClick={prevPhoto} className="flex items-center gap-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors text-sm"><ChevronLeft className="w-4 h-4" /> Anterior</button>
                  <span className="text-white/70 text-sm">{galleryIdx + 1} / {photos.length}</span>
                  <button onClick={nextPhoto} className="flex items-center gap-1 px-4 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 transition-colors text-sm">Siguiente <ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Share2 className="w-4 h-4" /> Facebook Marketplace</h3>
            {apt.status === 'vacant' ? (
              <div className="space-y-3">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500 mb-1">Texto del anuncio (previsualización):</p>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{generateMarketplaceText()}</pre>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={copyAdText} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors border border-blue-300 text-blue-700 hover:bg-blue-50">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copiado' : 'Copiar anuncio'}
                  </button>
                  <button onClick={openMarketplace} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors bg-blue-600 text-white hover:bg-blue-700">
                    <Globe className="w-3.5 h-3.5" /> Abrir Marketplace
                  </button>
                  <button onClick={autoFillMarketplace} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors bg-emerald-600 text-white hover:bg-emerald-700">
                    <Zap className="w-3.5 h-3.5" /> Auto-llenar
                  </button>
                  <button onClick={queueMarketplacePublication} disabled={marketplaceBusy || ['queued', 'claimed', 'processing'].includes(marketplaceJob?.status)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    <Send className="w-3.5 h-3.5" /> {marketplaceBusy ? 'Enviando…' : 'Publicar con el teléfono'}
                  </button>
                  {isCapacitor() && (
                    <button onClick={openMarketplaceLogin} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors border border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                      <Globe className="w-3.5 h-3.5" /> Iniciar sesión de Facebook
                    </button>
                  )}
                  <button onClick={saveMarketplaceUrl} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors border border-gray-300 text-gray-600 hover:bg-gray-50">
                    <Share2 className="w-3.5 h-3.5" /> {marketplaceUrl ? 'Actualizar URL' : 'Guardar URL'}
                  </button>
                </div>
                {marketplaceJob && (
                  <div className={`rounded-lg border p-3 text-xs ${marketplaceJob.status === 'published' ? 'border-green-200 bg-green-50 text-green-800' : ['failed', 'needs_login', 'needs_review'].includes(marketplaceJob.status) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`}>
                    <p><strong>Worker local:</strong> {marketplaceJob.status} · intento {marketplaceJob.attempts || 0}</p>
                    {marketplaceJob.message && <p className="mt-1">{marketplaceJob.message}</p>}
                    {marketplaceJob.error && <p className="mt-1">{marketplaceJob.error}</p>}
                    {['failed', 'needs_login', 'needs_review'].includes(marketplaceJob.status) && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {isCapacitor() && <button onClick={openMarketplaceLogin} className="rounded-md border border-amber-400 px-2 py-1 font-medium">Abrir Facebook</button>}
                        <button onClick={retryMarketplacePublication} disabled={marketplaceBusy} className="rounded-md bg-amber-700 px-2 py-1 font-medium text-white disabled:opacity-50">Reintentar</button>
                      </div>
                    )}
                  </div>
                )}
                {marketplaceLogs.length > 0 && (
                  <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <summary className="cursor-pointer font-semibold">Logs de Facebook ({marketplaceLogs.length})</summary>
                    <div className="mt-2 max-h-52 space-y-2 overflow-auto">
                      {marketplaceLogs.map(log => (
                        <div key={log.id} className="rounded-md bg-white p-2 shadow-sm">
                          <p className="font-medium">{log.stage} · {new Date(log.eventAt || log.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
                          <p className="mt-0.5 text-slate-600">{log.message}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {marketplaceMessage && (
                  <div className={`rounded-lg p-3 text-xs ${marketplaceMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{marketplaceMessage.text}</div>
                )}
                <p className="text-[11px] text-gray-500">Render solo pone el anuncio en cola. La sesión de Facebook, el 2FA y la publicación se ejecutan localmente en el navegador de la APK; no se guarda la contraseña en Laujim.</p>
                {marketplaceUrl && (
                  <div className="flex items-center gap-3">
                    <button onClick={openPublishedAd} className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                      <ExternalLink className="w-3.5 h-3.5" /> Abrir publicación guardada
                    </button>
                    <button onClick={async () => {
                      await api.apartments.update(Number(id), { marketplaceUrl: '' });
                      setMarketplaceUrl('');
                      window.dispatchEvent(new CustomEvent('laujim-marketplace-remove-url', { detail: { aptId: Number(id) } }));
                    }} className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:underline">
                      <Trash2 className="w-3 h-3" /> Eliminar URL
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Cambia el estado a <strong>Disponible</strong> para preparar el anuncio de Marketplace.</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Contratos</h3>
            {contracts.length === 0 ? <p className="text-gray-400 text-sm">Sin contratos</p> : (
              <div className="space-y-2">
                {contracts.toReversed().map(c => (
                  <div key={c.id} className="p-3 bg-gray-50 rounded-lg text-sm">
                    <p className="font-medium text-gray-900">{formatShortDate(c.startDate)} → {c.endDate ? formatShortDate(c.endDate) : 'Actual'}</p>
                    <p className="text-gray-500">{formatCurrency(c.monthlyRent)}/mes · Depósito {c.depositPaid ? '✓' : '✗'}</p>
                    {c.contractFile && (
                      <a href={c.contractFile} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:underline">
                        <Download className="w-3 h-3" /> Descargar contrato
                      </a>
                    )}
                    <a href={`/generate-contract/${apt.id}`} className="inline-flex items-center gap-1 mt-1 ml-2 text-xs text-indigo-600 hover:underline">
                      <FileText className="w-3 h-3" /> Generar nuevo
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Historial de Vacancias</h3>
            {vacancies.length === 0 ? <p className="text-gray-400 text-sm">Sin registros</p> : (
              <div className="space-y-2 text-sm">
                {vacancies.toReversed().map(v => (
                  <div key={v.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                    <span>{formatShortDate(v.startDate)} {v.endDate ? `→ ${formatShortDate(v.endDate)}` : '(actual)'}</span>
                    {!v.endDate && <button onClick={() => endVacancy(v.id)} className="text-xs text-blue-600 hover:underline">Finalizar</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Especificaciones</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Habitaciones:</span> <strong>{apt.rooms || '-'}</strong></div>
              <div><span className="text-gray-500">Baños:</span> <strong>{apt.bathrooms || '-'}</strong></div>
              <div><span className="text-gray-500">Área:</span> <strong>{apt.area || '-'} m²</strong></div>
              <div><span className="text-gray-500">Piso:</span> <strong>{apt.floor || '-'}</strong></div>
              <div className="col-span-2"><span className="text-gray-500">Ref. Catastral:</span> <strong>{apt.refCatastral || '-'}</strong></div>
              <div className="col-span-2"><span className="text-gray-500">NIC (Air-e):</span> <strong>{apt.nic || '-'}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400">Lectura Agua:</span> <strong className="text-gray-900 dark:text-white">Día {apt.waterReadingDay || 7}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400">N° Póliza (Triple A):</span> <strong className="text-gray-900 dark:text-white">{apt.waterPaymentCode || apt.nic || '-'}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400">Lectura Gas:</span> <strong className="text-gray-900 dark:text-white">Día {apt.gasReadingDay || 7}</strong></div>
            <div><span className="text-gray-500 dark:text-gray-400">N° Contrato (Gases del Caribe):</span> <strong className="text-gray-900 dark:text-white">{apt.gasPaymentCode || apt.nic || '-'}</strong></div>
            <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">Lectura Electricidad:</span> <strong className="text-gray-900 dark:text-white">Día {apt.electricityReadingDay || 21}</strong></div>
            <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">N° NIC (Air-e):</span> <strong className="text-gray-900 dark:text-white">{apt.electricityPaymentCode || apt.nic || '-'}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Editar Apartamento" size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Piso</label>
              <input type="number" value={form.floor} onChange={e => setForm({...form, floor: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Canon de Arriendo</label>
              <input type="number" value={form.monthlyRent} onChange={e => setForm({...form, monthlyRent: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depósito</label>
              <input type="number" value={form.depositAmount} onChange={e => setForm({...form, depositAmount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Día de Pago</label>
              <input type="number" min="1" max="31" value={form.paymentDueDay} onChange={e => setForm({...form, paymentDueDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recordatorios WhatsApp</label>
              <label className="flex items-center gap-2 text-sm text-gray-700 mt-2"><input type="checkbox" checked={form.paymentRemindersEnabled !== false} onChange={e => setForm({...form, paymentRemindersEnabled: e.target.checked})} className="rounded border-gray-300" /> Enviar recordatorios de pago</label>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Días para recordar</label>
              <input type="text" value={(form.paymentReminderDays || [-3, 0, 3]).join(', ')} onChange={e => setForm({...form, paymentReminderDays: e.target.value.split(',').map(value => Number(value.trim())).filter(value => Number.isInteger(value))})} placeholder="-3, 0, 3" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <p className="text-xs text-gray-400 mt-1">Usa números separados por coma: -3 es tres días antes, 0 el día de pago y 3 tres días después.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="occupied">Arrendado</option>
                <option value="vacant">Disponible</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Habitaciones</label>
              <input type="number" value={form.rooms} onChange={e => setForm({...form, rooms: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baños</label>
              <input type="number" value={form.bathrooms} onChange={e => setForm({...form, bathrooms: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Área (m²)</label>
              <input type="number" value={form.area} onChange={e => setForm({...form, area: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Hash className="w-3 h-3" /> NIC (Air-e)</label>
              <input type="text" value={form.nic || ''} onChange={e => setForm({...form, nic: e.target.value})} placeholder="Ej: 1234567890" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ref. Catastral (Predial)</label>
              <input type="text" value={form.refCatastral || ''} onChange={e => setForm({...form, refCatastral: e.target.value})} placeholder="Ej: 0105000004210006901010001" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lectura Agua (día)</label>
              <input type="number" min="1" max="31" value={form.waterReadingDay || 7} onChange={e => setForm({...form, waterReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N° Póliza (Triple A)</label>
              <input type="text" value={form.waterPaymentCode || ''} onChange={e => setForm({...form, waterPaymentCode: e.target.value})} placeholder="Ej: 1234567890" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1"><QrCode className="w-3 h-3" /> URL Pago Agua (QR)</label>
              <input type="url" value={form.waterPaymentUrl || ''} onChange={e => setForm({...form, waterPaymentUrl: e.target.value})} placeholder="URL del pago (opcional)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lectura Gas (día)</label>
              <input type="number" min="1" max="31" value={form.gasReadingDay || 7} onChange={e => setForm({...form, gasReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N° Contrato (Gases del Caribe)</label>
              <input type="text" value={form.gasPaymentCode || ''} onChange={e => setForm({...form, gasPaymentCode: e.target.value})} placeholder="Ej: 9876543210" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Enlace de pago por contrato</label>
              <input type="url" value={gasContractPaymentUrl(form.gasPaymentCode)} readOnly placeholder="Se genera al ingresar el contrato" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-gray-100 text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lectura Electricidad (día)</label>
              <input type="number" min="1" max="31" value={form.electricityReadingDay || 21} onChange={e => setForm({...form, electricityReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">N° NIC (Air-e)</label>
              <input type="text" value={form.electricityPaymentCode || ''} onChange={e => setForm({...form, electricityPaymentCode: e.target.value})} placeholder="Ej: 5678901234" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> URL de pago Air-e (página pública)</label>
              <input type="url" value={form.electricityPaymentUrl || ''} onChange={e => setForm({...form, electricityPaymentUrl: e.target.value})} placeholder="URL del pago (opcional)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2"><Globe className="w-4 h-4" /> Facebook Marketplace — Arriendo</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Dirección para Facebook Marketplace</label>
                <input type="text" value={form.marketplaceAddress || ''} onChange={e => setForm({...form, marketplaceAddress: e.target.value})} placeholder="Ej: Cra 1 #23-45, Barranquilla, Atlántico" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de alquiler</label>
                <select value={form.marketplaceRentalType || 'Departamento/condominio'} onChange={e => setForm({...form, marketplaceRentalType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="Departamento/condominio">Departamento/condominio</option>
                  <option value="Casa">Casa</option>
                  <option value="Townhouse">Townhouse</option>
                  <option value="Solo habitación">Solo habitación</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de habitaciones</label>
                <input type="number" min="0" max="20" value={form.marketplaceBedrooms ?? ''} onChange={e => setForm({...form, marketplaceBedrooms: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de baños</label>
                <input type="number" min="0" max="20" step="0.5" value={form.marketplaceBathrooms ?? ''} onChange={e => setForm({...form, marketplaceBathrooms: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Disponibilidad</label>
                <input type="date" value={form.marketplaceAvailability || ''} onChange={e => setForm({...form, marketplaceAvailability: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de lavadero</label>
                <select value={form.marketplaceLaundryType || 'Ninguno'} onChange={e => setForm({...form, marketplaceLaundryType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="Lavadero en la unidad">Lavadero en la unidad</option>
                  <option value="Lavadero en el edificio">Lavadero en el edificio</option>
                  <option value="Lavadero disponible">Lavadero disponible</option>
                  <option value="Ninguno">Ninguno</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de estacionamiento</label>
                <select value={form.marketplaceParkingType || 'Ninguno'} onChange={e => setForm({...form, marketplaceParkingType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="Ninguno">Ninguno</option>
                  <option value="Estacionamiento cubierto">Estacionamiento cubierto</option>
                  <option value="Estacionamiento en la vía pública">Estacionamiento en la vía pública</option>
                  <option value="Estacionamiento privado">Estacionamiento privado</option>
                  <option value="Estacionamiento disponible">Estacionamiento disponible</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de aire acondicionado</label>
                <select value={form.marketplaceAirConditioningType || 'Ninguno'} onChange={e => setForm({...form, marketplaceAirConditioningType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="Ninguno">Ninguno</option>
                  <option value="Aire acondicionado central">Aire acondicionado central</option>
                  <option value="Aire acondicionado disponible">Aire acondicionado disponible</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de calefacción</label>
                <select value={form.marketplaceHeatingType || 'Ninguno'} onChange={e => setForm({...form, marketplaceHeatingType: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value="Ninguno">Ninguno</option>
                  <option value="Calefacción central">Calefacción central</option>
                  <option value="Calefacción eléctrica">Calefacción eléctrica</option>
                  <option value="Calefacción de gas">Calefacción de gas</option>
                  <option value="Calefacción por radiadores">Calefacción por radiadores</option>
                  <option value="Calefacción disponible">Calefacción disponible</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pies cuadrados de la propiedad</label>
                <input type="number" value={form.marketplaceSquareFeet || ''} onChange={e => setForm({...form, marketplaceSquareFeet: e.target.value})} placeholder="Opcional. Se calculará desde m² si se deja vacío" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.marketplaceCatFriendly === true} onChange={e => setForm({...form, marketplaceCatFriendly: e.target.checked})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">Se aceptan gatos</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.marketplaceDogFriendly === true} onChange={e => setForm({...form, marketplaceDogFriendly: e.target.checked})} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">Se aceptan perros</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar Cambios</button>
          </div>
        </form>
      </Modal>

      <Modal open={showWaModal} onClose={() => setShowWaModal(false)} title="Enviar por WhatsApp" size="sm">
        <div className="space-y-2 p-2">
          <button onClick={() => { setShowWaModal(false); whatsappNumber(tenant?.phone); }} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors text-left">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center"><MessageCircle className="w-5 h-5 text-emerald-600" /></div>
            <div><p className="text-sm font-medium text-gray-900">Enviar mensaje</p><p className="text-xs text-gray-400">Chat directo de WhatsApp</p></div>
          </button>
          {(() => {
            const n1 = localStorage.getItem('wa_template_name1') || 'Servicios y deudas';
            const n2 = localStorage.getItem('wa_template_name2') || 'Cobro de canon y servicios';
            return <>
              <button onClick={() => { setShowWaModal(false); handleWhatsAppServices(); }} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors text-left">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center"><Globe className="w-5 h-5 text-blue-600" /></div>
                <div><p className="text-sm font-medium text-gray-900">{n1}</p><p className="text-xs text-gray-400">Enlaces de servicios públicos</p></div>
              </button>
              <button onClick={() => { setShowWaModal(false); handleWhatsAppReminder(); }} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors text-left">
                <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center"><Bell className="w-5 h-5 text-amber-600" /></div>
                <div><p className="text-sm font-medium text-gray-900">{n2}</p><p className="text-xs text-gray-400">Recordatorio de canon de arriendo</p></div>
              </button>
            </>;
          })()}
        </div>
      </Modal>
    </div>
  );
}
