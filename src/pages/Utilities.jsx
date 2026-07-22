import { useState, useEffect, useRef } from 'react';
import { Zap, Droplets, Flame, Search, ExternalLink, QrCode, Scan, Image, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { getCurrentPeriod, getPeriodLabel, nextPeriod, prevPeriod } from '../utils/helpers';
import QRCode from 'qrcode';
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

function QrViewContent({ showQrModal, qrUrls, apartments, getUrl }) {
  const [aptIdStr, svc] = showQrModal.split('-');
  const apt = apartments.find(a => a.id === parseInt(aptIdStr));
  const url = getUrl(apt, svc);
  const s = services[svc];
  return (
    <div className="p-4 text-center">
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${s?.badgeColor || ''}`}>
        {s?.icon && <s.icon className="w-3.5 h-3.5" />}
        {s?.name || svc}
      </div>
      <img src={qrUrls[showQrModal]} alt="QR de pago" className="mx-auto w-52 h-52 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700" />
      {url && <p className="text-xs text-gray-400 mt-2 break-all bg-gray-50 dark:bg-gray-800 p-2 rounded-lg font-mono">{url}</p>}
      {url && <button onClick={() => window.open(url, '_blank')} className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-medium rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-sm"><ExternalLink className="w-4 h-4" /> Abrir enlace de pago</button>}
      <p className="text-xs text-gray-400 mt-2">Escanea con tu banco para pagar</p>
    </div>
  );
}

export default function Utilities() {
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState(getCurrentPeriod());
  const [qrUrls, setQrUrls] = useState({});
  const [showQrModal, setShowQrModal] = useState(null);
  const [scanAptId, setScanAptId] = useState(null);
  const [scanService, setScanService] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const scanTimerRef = useRef(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    return () => { if (scanTimerRef.current) clearTimeout(scanTimerRef.current); if (videoRef.current?.srcObject) { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); } };
  }, []);

  async function load() {
    const a = await api.apartments.toArray();
    setApartments(a);
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

  async function generateQr(aptId, svc, url) {
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 160, margin: 1, color: { dark: '#1f2937', light: '#ffffff' } });
      setQrUrls(prev => ({ ...prev, [aptId + '-' + svc]: dataUrl }));
    } catch {}
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

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar apto o código..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {/* Apartment cards */}
      <div className="grid gap-4">
        {filtered.map(apt => (
          <div key={apt.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-bold text-gray-900 dark:text-white text-base">Apartamento {apt.name}</h2>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {['water', 'gas', 'electricity'].map(svc => {
                const s = services[svc];
                const Icon = s.icon;
                const code = getCode(apt, svc);
                const url = getUrl(apt, svc);
                const qrKey = apt.id + '-' + svc;
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
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {svc === 'electricity' ? (
                        <button onClick={() => handleElectricityPay(apt)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-purple-500 to-violet-600 rounded-lg hover:from-purple-600 hover:to-violet-700 transition-all shadow-sm">
                          <ExternalLink className="w-3 h-3" /> Pagar
                        </button>
                      ) : (
                        <>
                          {url ? (
                            <>
                              <button onClick={() => { if (!qrUrls[qrKey]) generateQr(apt.id, svc, url); setShowQrModal(qrKey); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50 rounded-lg transition-colors">
                                <QrCode className="w-3 h-3" /> QR
                              </button>
                              <button onClick={() => window.open(url, '_blank')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-sm">
                                <ExternalLink className="w-3 h-3" /> Pagar
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleScanQR(apt.id, svc)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 rounded-lg transition-colors">
                              <Scan className="w-3 h-3" /> Escanear
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

      {/* QR Scanner */}
      <input ref={scannerRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} className="hidden" />
      <Modal open={scanService !== null} onClose={() => { stopScan(); setScanAptId(null); setScanService(null); }} title={scanService ? `Escaneando QR - ${services[scanService]?.name}` : ''}>
        <div className="p-4">
          <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ minHeight: 260 }}>
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            {scanService !== null && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-44 h-44 border-2 border-emerald-400 rounded-xl opacity-70" /></div>}
            {scanStatus && <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3"><p className="text-white text-xs text-center">{scanStatus}</p></div>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => scannerRef.current?.click()} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm"><Image className="w-4 h-4" /> Subir foto</button>
            <button onClick={() => { stopScan(); setScanAptId(null); setScanService(null); }} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm">Cancelar</button>
          </div>
        </div>
      </Modal>

      {/* QR view */}
      <Modal open={showQrModal !== null} onClose={() => setShowQrModal(null)} size="sm">
        {showQrModal && qrUrls[showQrModal] && <QrViewContent showQrModal={showQrModal} qrUrls={qrUrls} apartments={apartments} getUrl={getUrl} />}
      </Modal>
    </div>
  );
}