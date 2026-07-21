import { useState, useEffect, useRef } from 'react';
import { Zap, Droplets, Flame, Plus, Search, ExternalLink, CheckCircle, XCircle, ChevronLeft, ChevronRight, Save, AlertTriangle, List, Grid3X3, DollarSign, Hash, QrCode, Scan, Image } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate, getCurrentPeriod, getPeriodLabel, nextPeriod, prevPeriod, isOverdueByReadingDate } from '../utils/helpers';
import { isCapacitor } from '../utils/config';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

const serviceIcons = { water: Droplets, gas: Flame, electricity: Zap };
const serviceNames = { water: 'Agua', gas: 'Gas', electricity: 'Electricidad' };
const serviceColors = { water: 'text-blue-600 bg-blue-50', gas: 'text-amber-600 bg-amber-50', electricity: 'text-yellow-600 bg-yellow-50' };
const serviceBgColors = { water: 'bg-blue-50', gas: 'bg-amber-50', electricity: 'bg-yellow-50' };
const serviceBorderColors = { water: 'border-blue-200', gas: 'border-amber-200', electricity: 'border-yellow-200' };
const serviceDarkBg = { water: 'dark:bg-blue-900/20', gas: 'dark:bg-amber-900/20', electricity: 'dark:bg-yellow-900/20' };

const utilityWebsites = {
  water: { name: 'Triple A', url: 'https://portal.aaa.com.co/pagos' },
  gas: { name: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
  electricity: { name: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
};

export default function Utilities() {
  const [records, setRecords] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');
  const [filterService, setFilterService] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [gridPeriod, setGridPeriod] = useState(getCurrentPeriod());
  const [gridData, setGridData] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ apartmentId: '', service: 'water', paymentCode: '', period: getCurrentPeriod(), amount: '', dueDate: '', readingDate: '', paid: false, notes: '' });
  const [scanAptId, setScanAptId] = useState(null);
  const [scanService, setScanService] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const [qrUrls, setQrUrls] = useState({});
  const [showQrModal, setShowQrModal] = useState(null);
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const scanTimerRef = useRef(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const [r, a] = await Promise.all([api.utilityPayments.toArray(), api.apartments.toArray()]);
    setRecords(r); setApartments(a);
    buildGridData(gridPeriod, r, a);
  }

  function getApartment(id) { return apartments.find(a => a.id === id); }

  async function handleElectricityPay(apt) {
    if (!apt) return;
    if (apt.electricityPaymentUrl) {
      window.open(apt.electricityPaymentUrl, '_blank');
      return;
    }
    const nic = window.prompt('Ingresa el NIC de Air-e (' + apt.name + '):', '');
    if (!nic || !nic.trim()) return;
    const digits = nic.trim().replace(/\D/g, '');
    if (digits.length < 4) { alert('El NIC debe tener al menos 4 dígitos'); return; }
    const url = `https://portal.air-e.com/Pagar#/User/${digits}/NUMEROCONTRATO`;
    await api.apartments.update(apt.id, { nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url });
    const idx = apartments.findIndex(a => a.id === apt.id);
    if (idx !== -1) {
      const updated = [...apartments];
      updated[idx] = { ...updated[idx], nic: digits, electricityPaymentCode: digits, electricityPaymentUrl: url };
      setApartments(updated);
    }
    window.open(url, '_blank');
  }

  function getAptPaymentUrl(apt, svc) {
    if (!apt) return '';
    if (svc === 'water') return apt.waterPaymentUrl || '';
    if (svc === 'gas') return apt.gasPaymentUrl || '';
    return apt.electricityPaymentUrl || '';
  }

  async function generateQr(aptId, svc, url) {
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 160, margin: 1, color: { dark: '#1f2937', light: '#ffffff' } });
      setQrUrls(prev => ({ ...prev, [aptId + '-' + svc]: dataUrl }));
    } catch {}
  }

  async function handleScanQR(aptId, svc) {
    setScanAptId(aptId);
    setScanService(svc);
    setScanStatus('Iniciando cámara...');
    setTimeout(startScan, 100);
  }

  function startScan() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then(stream => {
        if (!videoRef.current) return;
        const v = videoRef.current;
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          v.play().then(() => {
            setScanStatus('Enfoca el QR en el recuadro');
            scanTimerRef.current = setTimeout(doScan, 500);
          }).catch(e => console.error('play:', e));
        };
      })
      .catch(() => {
        setScanStatus('Cámara no disponible, usa subir foto');
        setTimeout(() => scannerRef.current?.click(), 300);
      });
  }

  function stopScan() {
    setScanStatus('');
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
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
      const w = Math.min(v.videoWidth || 640, 640);
      const h = Math.min(v.videoHeight || 480, Math.round(w * ((v.videoHeight || 480) / (v.videoWidth || 640))));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) val = code.data;
      } catch {}
    }
    if (val) {
      setScanStatus('¡QR detectado!');
      const url = val.startsWith('http') ? val : 'https://' + val;
      const apt = getApartment(scanAptId);
      const svc = scanService;
      const field = svc === 'water' ? 'waterPaymentUrl' : 'gasPaymentUrl';
      await api.apartments.update(scanAptId, { [field]: url });
      const idx = apartments.findIndex(a => a.id === scanAptId);
      if (idx !== -1) {
        const updated = [...apartments];
        updated[idx] = { ...updated[idx], [field]: url };
        setApartments(updated);
      }
      generateQr(scanAptId, svc, url);
      stopScan();
      setScanAptId(null);
      setScanService(null);
      return;
    }
    scanTimerRef.current = setTimeout(doScan, 500);
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const bitmap = await createImageBitmap(file, { resizeWidth: 640, resizeQuality: 'high' });
      let val = null;
      if (window.BarcodeDetector) {
        try { const d = new window.BarcodeDetector({ formats: ['qr_code'] }); const b = await d.detect(bitmap); if (b.length > 0) val = b[0].rawValue; } catch {}
      }
      if (!val) {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code && code.data) val = code.data;
      } else { bitmap.close(); }
      if (val) {
        const url = val.startsWith('http') ? val : 'https://' + val;
        const apt = getApartment(scanAptId);
        const svc = scanService;
        const field = svc === 'water' ? 'waterPaymentUrl' : 'gasPaymentUrl';
        await api.apartments.update(scanAptId, { [field]: url });
        const idx = apartments.findIndex(a => a.id === scanAptId);
        if (idx !== -1) {
          const updated = [...apartments];
          updated[idx] = { ...updated[idx], [field]: url };
          setApartments(updated);
        }
        generateQr(scanAptId, svc, url);
        stopScan();
        setScanAptId(null);
        setScanService(null);
      } else {
        alert('No se encontró un código QR en la imagen');
      }
    } catch (e) { console.error('Scan file:', e); alert('Error al procesar la imagen'); }
  }

  useEffect(() => {
    return () => { if (scanTimerRef.current) clearTimeout(scanTimerRef.current); if (videoRef.current?.srcObject) { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); } };
  }, []);

  function getServicePaymentCode(apt, service) {
    if (!apt) return '';
    if (service === 'water') return apt.waterPaymentCode || apt.nic || '';
    if (service === 'gas') return apt.gasPaymentCode || apt.nic || '';
    if (service === 'electricity') return apt.electricityPaymentCode || apt.nic || '';
    return apt.nic || '';
  }

  function buildGridData(period, recs, apts) {
    const r = recs || records;
    const a = apts || apartments;
    const data = {};
    for (const apt of a) {
      data[apt.id] = {};
      for (const svc of ['water', 'gas', 'electricity']) {
        const existing = r.find(r => r.apartmentId === apt.id && r.service === svc && r.period === period);
        const code = getServicePaymentCode(apt, svc);
        data[apt.id][svc] = {
          paid: existing ? existing.paid : false,
          recordId: existing ? existing.id : null,
          paymentCode: existing ? (existing.paymentCode || code) : code,
          amount: existing ? existing.amount : 0,
          amountChanged: false,
          readingDate: existing ? existing.readingDate : '',
          dueDate: existing ? existing.dueDate : '',
        };
      }
    }
    setGridData(data);
    setDirty(false);
  }

  function handleGridPeriodChange(dir) {
    const next = dir === 'next' ? nextPeriod(gridPeriod) : prevPeriod(gridPeriod);
    setGridPeriod(next);
    buildGridData(next);
  }

  function handleGridPaidChange(aptId, service, paid) {
    setGridData(prev => ({
      ...prev,
      [aptId]: {
        ...prev[aptId],
        [service]: { ...prev[aptId][service], paid },
      },
    }));
    setDirty(true);
  }

  function handleAmountChange(aptId, service, amount) {
    setGridData(prev => ({
      ...prev,
      [aptId]: {
        ...prev[aptId],
        [service]: { ...prev[aptId][service], amount: Number(amount), amountChanged: true },
      },
    }));
    setDirty(true);
  }

  async function saveGrid() {
    setSaving(true);
    let created = 0, updated = 0;
    for (const aptId of Object.keys(gridData)) {
      const apt = getApartment(Number(aptId));
      const aptUpdate = {};
      for (const svc of ['water', 'gas', 'electricity']) {
        const cell = gridData[aptId][svc];
        const existing = records.find(r => r.apartmentId === Number(aptId) && r.service === svc && r.period === gridPeriod);
        if (cell.recordId && existing) {
          await api.utilityPayments.update(cell.recordId, {
            paid: cell.paid,
            paidDate: cell.paid ? new Date().toISOString() : null,
            amount: cell.amountChanged ? cell.amount : existing.amount,
            paymentCode: cell.paymentCode || existing.paymentCode,
          });
          updated++;
        } else {
          const readingDay = svc === 'water' ? (apt?.waterReadingDay || 10)
            : svc === 'gas' ? (apt?.gasReadingDay || 12) : (apt?.electricityReadingDay || 15);
          const d = new Date();
          const defaultReading = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(readingDay).padStart(2, '0')}`;
          await api.utilityPayments.add({
            apartmentId: Number(aptId),
            service: svc,
            period: gridPeriod,
            paymentCode: cell.paymentCode || '',
            amount: cell.amount || 0,
            readingDate: cell.readingDate || defaultReading,
            paid: cell.paid,
            paidDate: cell.paid ? new Date().toISOString() : null,
            createdAt: new Date().toISOString(),
          });
          created++;
        }
        // Save payment code to apartment if changed
        const existingAptCode = svc === 'water' ? apt?.waterPaymentCode
          : svc === 'gas' ? apt?.gasPaymentCode : apt?.electricityPaymentCode;
        if (cell.paymentCode && cell.paymentCode !== existingAptCode) {
          const field = svc === 'water' ? 'waterPaymentCode'
            : svc === 'gas' ? 'gasPaymentCode' : 'electricityPaymentCode';
          aptUpdate[field] = cell.paymentCode;
        }
      }
      if (Object.keys(aptUpdate).length > 0 && apt) {
        await api.apartments.update(apt.id, aptUpdate);
      }
    }
    await load();
    setDirty(false);
    setSaving(false);
    alert(`Guardado: ${created} creado(s), ${updated} actualizado(s)`);
  }

  const filtered = records.filter(r => {
    const apt = getApartment(r.apartmentId);
    const s = search.toLowerCase();
    return (!search || apt?.name.toLowerCase().includes(s) || r.paymentCode?.includes(s)) &&
      (filterService === 'all' || r.service === filterService);
  });

  const pendingCount = records.filter(r => !r.paid).length;
  const overdueCount = records.filter(r => {
    if (r.paid) return false;
    const apt = getApartment(r.apartmentId);
    const day = r.service === 'water' ? (apt?.waterReadingDay || 10)
      : r.service === 'gas' ? (apt?.gasReadingDay || 12) : (apt?.electricityReadingDay || 15);
    return isOverdueByReadingDate(r.period, day);
  }).length;
  const totalPending = records.filter(r => !r.paid).reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Servicios Públicos</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {pendingCount} pendientes · {overdueCount} vencidos · {formatCurrency(totalPending)} por pagar
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTable(!showTable)} className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg transition-colors text-sm font-medium border ${showTable ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
            {showTable ? <Grid3X3 className="w-4 h-4" /> : <List className="w-4 h-4" />}
            {showTable ? 'Matriz' : 'Lista'}
          </button>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Agregar
          </button>
        </div>
      </div>

      {/* Period Navigation + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5">
          <button onClick={() => handleGridPeriodChange('prev')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-gray-900 dark:text-white min-w-[140px] text-center">{getPeriodLabel(gridPeriod)}</span>
          <button onClick={() => handleGridPeriodChange('next')} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
            <ChevronRight className="w-5 h-5" />
          </button>
          <button onClick={() => { setGridPeriod(getCurrentPeriod()); buildGridData(getCurrentPeriod()); }} className="ml-1 text-xs text-blue-600 hover:underline px-2">Hoy</button>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar apto o código..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={filterService} onChange={e => setFilterService(e.target.value)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="all">Todos</option>
          <option value="water">Agua</option>
          <option value="gas">Gas</option>
          <option value="electricity">Electricidad</option>
        </select>
      </div>

      {/* Grid View */}
      {!showTable ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white dark:bg-gray-800 z-10 text-left px-3 py-3 font-semibold text-gray-700 dark:text-gray-300 border-b-2 border-gray-200 dark:border-gray-700 min-w-[90px]">Apartamento</th>
                  {(filterService === 'all' ? ['water', 'gas', 'electricity'] : [filterService]).map(svc => {
                    const Icon = serviceIcons[svc];
                    return (
                      <th key={svc} className={`text-center px-2 py-3 font-semibold border-b-2 border-gray-200 dark:border-gray-700 ${serviceColors[svc]} ${serviceDarkBg[svc]}`}>
                        <div className="flex items-center justify-center gap-1.5">
                          <Icon className="w-4 h-4" />
                          <span>{serviceNames[svc]}</span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {apartments
                  .filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()) || Object.values(gridData[a.id] || {}).some(c => (c.paymentCode || '').includes(search)))
                  .map(apt => {
                    const services = filterService === 'all' ? ['water', 'gas', 'electricity'] : [filterService];
                    return (
                      <tr key={apt.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="sticky left-0 bg-white dark:bg-gray-800 z-10 px-3 py-3 font-medium text-gray-900 dark:text-white border-r border-gray-100 dark:border-gray-700">
                          {apt.name}
                        </td>
                        {services.map(svc => {
                          const cell = gridData[apt.id]?.[svc] || {};
                          const readingDay = svc === 'water' ? (apt.waterReadingDay || 10)
                            : svc === 'gas' ? (apt.gasReadingDay || 12) : (apt.electricityReadingDay || 15);
                          const overdue = !cell.paid && isOverdueByReadingDate(gridPeriod, readingDay);
                          const paid = cell.paid;
                          const code = cell.paymentCode || getServicePaymentCode(apt, svc);
                          const Icon = serviceIcons[svc];

                          let cellBg = 'bg-white dark:bg-gray-800';
                          if (paid) cellBg = 'bg-emerald-50 dark:bg-emerald-900/20';
                          else if (overdue) cellBg = 'bg-red-50 dark:bg-red-900/20';

                          return (
                            <td key={svc} className={`px-2 py-2 ${cellBg} border-r border-gray-100 dark:border-gray-700 last:border-r-0`}>
                              <div className="flex flex-col items-center gap-1 min-w-[130px]">
                                {/* Status + Checkbox row */}
                                <div className="flex items-center justify-center gap-1.5 w-full">
                                  {paid ? (
                                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                                      <CheckCircle className="w-3.5 h-3.5" /> Pagado
                                    </span>
                                  ) : overdue ? (
                                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
                                      <AlertTriangle className="w-3.5 h-3.5" /> Vencido
                                    </span>
                                  ) : (
                                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
                                      <XCircle className="w-3.5 h-3.5" /> Pendiente
                                    </span>
                                  )}
                                </div>
                                {/* Amount row */}
                                <div className="flex items-center gap-1">
                                  <DollarSign className="w-3 h-3 text-gray-400" />
                                  <input
                                    type="number"
                                    value={cell.amount || ''}
                                    onChange={e => handleAmountChange(apt.id, svc, e.target.value)}
                                    placeholder="0"
                                    className="w-20 text-center text-xs font-medium text-gray-700 dark:text-gray-200 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-blue-500 outline-none"
                                  />
                                </div>
                                {/* Payment Code row */}
                                <div className="flex items-center gap-1">
                                  <Hash className="w-3 h-3 text-gray-400 shrink-0" />
                                  <input
                                    type="text"
                                    value={cell.paymentCode || ''}
                                    onChange={e => {
                                      setGridData(prev => ({
                                        ...prev,
                                        [apt.id]: {
                                          ...prev[apt.id],
                                          [svc]: { ...prev[apt.id][svc], paymentCode: e.target.value },
                                        },
                                      }));
                                      setDirty(true);
                                    }}
                                    placeholder="Código"
                                    className="w-full min-w-[70px] text-[10px] text-gray-700 dark:text-gray-200 bg-transparent border-b border-dashed border-gray-300 dark:border-gray-600 focus:border-blue-500 outline-none text-center"
                                    title={code}
                                  />
                                </div>
                                {/* Action row: QR / Escanear / Pagar */}
                                <div className="flex items-center justify-center gap-1 w-full mt-0.5 flex-wrap">
                                  {svc === 'electricity' ? (
                                    <button onClick={() => handleElectricityPay(apt)} className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline cursor-pointer bg-transparent border-0" title="Pagar Air-e">
                                      <ExternalLink className="w-2.5 h-2.5" /> Pagar
                                    </button>
                                  ) : (
                                    <>
                                      {getAptPaymentUrl(apt, svc) ? (
                                        <>
                                          <button onClick={() => { const k = apt.id + '-' + svc; if (!qrUrls[k]) generateQr(apt.id, svc, getAptPaymentUrl(apt, svc)); setShowQrModal(k); }} className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:underline cursor-pointer bg-transparent border-0" title="Ver QR">
                                            <QrCode className="w-2.5 h-2.5" /> QR
                                          </button>
                                          <button onClick={() => window.open(getAptPaymentUrl(apt, svc), '_blank')} className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 hover:underline cursor-pointer bg-transparent border-0" title="Pagar">
                                            <ExternalLink className="w-2.5 h-2.5" /> Pagar
                                          </button>
                                        </>
                                      ) : (
                                        <button onClick={() => handleScanQR(apt.id, svc)} className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 hover:underline cursor-pointer bg-transparent border-0" title="Escanear QR de recibo">
                                          <Scan className="w-2.5 h-2.5" /> Escanear
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {apartments.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 py-8">No hay apartamentos registrados</p>}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Servicio</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Apartamento</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Período</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Lectura</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Código</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Valor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Vence</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Pagado</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-300">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.toReversed().map(r => {
                  const apt = getApartment(r.apartmentId);
                  const Icon = serviceIcons[r.service];
                  const website = utilityWebsites[r.service];
                  const overdue = !r.paid && r.readingDate && isOverdueByReadingDate(r.period,
                    r.service === 'water' ? (apt?.waterReadingDay || 10) : r.service === 'gas' ? (apt?.gasReadingDay || 12) : (apt?.electricityReadingDay || 15));
                  return (
                    <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${overdue ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${serviceColors[r.service]}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <span className="font-medium text-gray-900 dark:text-white">{serviceNames[r.service]}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-white">{apt?.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.period}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.readingDate ? formatShortDate(r.readingDate) : '-'}</td>
                      <td className="px-4 py-3">
                        <code className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs font-mono text-gray-800 dark:text-gray-200">{r.paymentCode || '-'}</code>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.amount ? formatCurrency(r.amount) : '-'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.dueDate ? formatShortDate(r.dueDate) : '-'}</td>
                      <td className="px-4 py-3">
                        {r.paid
                          ? <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle className="w-4 h-4" /> Sí</span>
                          : <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                              {overdue ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <XCircle className="w-4 h-4" />}
                              {overdue ? 'Vencido' : 'No'}
                            </span>
                        }
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.service === 'electricity' ? (
                            <button onClick={() => handleElectricityPay(apt)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors cursor-pointer bg-transparent border-0" title="Pagar Air-e">
                              <ExternalLink className="w-3 h-3" /> Pagar
                            </button>
                          ) : (
                            <>
                              {getAptPaymentUrl(apt, r.service) ? (
                                <>
                                  <button onClick={() => { const k = apt.id + '-' + r.service; if (!qrUrls[k]) generateQr(apt.id, r.service, getAptPaymentUrl(apt, r.service)); setShowQrModal(k); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors cursor-pointer bg-transparent border-0" title="Ver QR">
                                    <QrCode className="w-3 h-3" /> QR
                                  </button>
                                  <button onClick={() => window.open(getAptPaymentUrl(apt, r.service), '_blank')} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors cursor-pointer bg-transparent border-0" title="Pagar">
                                    <ExternalLink className="w-3 h-3" /> Pagar
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => handleScanQR(apt.id, r.service)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded transition-colors cursor-pointer bg-transparent border-0" title="Escanear QR">
                                  <Scan className="w-3 h-3" /> Escanear
                                </button>
                              )}
                            </>
                          )}
                          <button onClick={async () => { await api.utilityPayments.update(r.id, { paid: !r.paid, paidDate: !r.paid ? new Date().toISOString() : null }); load(); }} className={`px-2 py-1 text-xs rounded transition-colors ${r.paid ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30' : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'}`}>
                            {r.paid ? 'No Pagado' : 'Pagado'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 py-8">No hay registros de servicios públicos</p>}
        </div>
      )}

      {/* Save Bar */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">Tienes cambios sin guardar</p>
            <button onClick={saveGrid} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium">
              <Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </div>
        </div>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nuevo Registro de Servicio" size="lg">
        <form onSubmit={async (e) => {
          e.preventDefault();
          await api.utilityPayments.add({
            apartmentId: Number(form.apartmentId),
            service: form.service,
            paymentCode: form.paymentCode,
            period: form.period,
            amount: Number(form.amount),
            dueDate: form.dueDate,
            readingDate: form.readingDate || null,
            paid: form.paid,
            paidDate: form.paid ? new Date().toISOString() : null,
            notes: form.notes,
            createdAt: new Date().toISOString(),
          });
          setShowAdd(false);
          setForm({ apartmentId: '', service: 'water', paymentCode: '', period: getCurrentPeriod(), amount: '', dueDate: '', readingDate: '', paid: false, notes: '' });
          load();
        }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apartamento *</label>
              <select value={form.apartmentId} onChange={e => {
                const apt = getApartment(Number(e.target.value));
                setForm({...form, apartmentId: e.target.value, paymentCode: getServicePaymentCode(apt, form.service)});
              }} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" required>
                <option value="">Seleccionar...</option>
                {apartments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Servicio *</label>
              <select value={form.service} onChange={e => setForm({...form, service: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option value="water">Agua</option>
                <option value="gas">Gas</option>
                <option value="electricity">Electricidad</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Período</label>
              <input type="month" value={form.period} onChange={e => setForm({...form, period: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Código de Pago</label>
              <input type="text" value={form.paymentCode} onChange={e => setForm({...form, paymentCode: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" placeholder="Auto-completado del apto" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor</label>
              <input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de Lectura</label>
              <input type="date" value={form.readingDate} onChange={e => setForm({...form, readingDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha de Vencimiento</label>
              <input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="paid" checked={form.paid} onChange={e => setForm({...form, paid: e.target.checked})} className="rounded border-gray-300" />
            <label htmlFor="paid" className="text-sm text-gray-700 dark:text-gray-300">Ya está pagado</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar</button>
          </div>
        </form>
      </Modal>

      {/* QR Scanner modal */}
      <input ref={scannerRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} className="hidden" />
      <Modal open={scanService !== null} onClose={() => { stopScan(); setScanAptId(null); setScanService(null); }} title={scanService ? `Escaneando QR - ${serviceNames[scanService]}` : ''}>
        <div className="p-4">
          <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ minHeight: 280 }}>
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
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
            <button onClick={() => { stopScan(); setScanAptId(null); setScanService(null); }} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm">
              Cancelar
            </button>
          </div>
        </div>
      </Modal>

      {/* QR view modal */}
      <Modal open={showQrModal !== null} onClose={() => setShowQrModal(null)} size="sm">
        {showQrModal && qrUrls[showQrModal] && (
          <div className="p-4 text-center">
            <img src={qrUrls[showQrModal]} alt="QR de pago" className="mx-auto w-56 h-56 rounded-xl shadow-sm" />
            <p className="text-xs text-gray-400 mt-2">Código QR de pago</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
