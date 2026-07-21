import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, DollarSign, Calendar, Edit2, Trash2, User, FileText, Camera, Phone, Plus, X, Download, Image, MessageCircle, Hash, Clock, Droplets, Flame, Zap, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, QrCode, Scan } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentHistoryChart from '../components/PaymentHistoryChart';
import { api } from '../api';
import { photoUrl, isCapacitor } from '../utils/config';
import { formatCurrency, formatShortDate, daysUntil, getCurrentPeriod, getPeriodLabel, prevPeriod, nextPeriod, isOverdueByReadingDate } from '../utils/helpers';
import { generateApartmentPDF } from '../utils/pdf';
import { addCalendarReminder } from '../utils/calendar';
import QRCode from 'qrcode';
import jsQR from 'jsqr';

const serviceNames = { water: 'Agua', gas: 'Gas', electricity: 'Electricidad' };
const serviceIcons = { water: Droplets, gas: Flame, electricity: Zap };
const serviceColors = { water: 'text-blue-600 bg-blue-50', gas: 'text-amber-600 bg-amber-50', electricity: 'text-yellow-600 bg-yellow-50' };
const utilityWebsites = {
  water: { name: 'Triple A', url: 'https://portal.aaa.com.co/pagos' },
  gas: { name: 'Gases del Caribe', url: 'https://www.gascaribe.com/' },
  electricity: { name: 'Air-e', url: 'https://portal.air-e.com/Pagar#/List' },
};

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
  const [qrUrls, setQrUrls] = useState({});
  const [showQrModal, setShowQrModal] = useState(null);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => { if (id) load(); }, [id]);

  async function load() {
    const a = await api.apartments.get(Number(id));
    if (!a) { navigate('/apartments'); return; }
    setApt(a);
    setForm({ ...a });

    const [allC, allP, allE, allV, allF, allT, allPhotos, allU] = await Promise.all([
      api.contracts.toArray(), api.payments.toArray(), api.expenses.toArray(),
      api.vacancies.toArray(), api.familyMembers.toArray(), api.tenants.toArray(), api.photos.toArray(), api.utilityPayments.toArray(),
    ]);
    const aptContracts = allC.filter(c => c.apartmentId === a.id);
    setContracts(aptContracts);
    const active = aptContracts.find(c => !c.endDate || new Date(c.endDate) > new Date());
    setContract(active);
    const t = active ? allT.find(t => t.id === active.tenantId) : null;
    setTenant(t || null);

    setPayments(allP.filter(p => p.apartmentId === a.id));
    setExpenses(allE.filter(e => e.apartmentId === a.id));
    setVacancies(allV.filter(v => v.apartmentId === a.id));
    setFamilyMembers(allF.filter(f => f.apartmentId === a.id));
    setPhotos(allPhotos.filter(p => p.apartmentId === a.id));
    setUtilityRecords(allU.filter(u => u.apartmentId === a.id));
    setUtilityPeriod(getCurrentPeriod());
    // Generate QR codes for existing payment URLs
    const urls = {};
    for (const [svc, field] of [['water', 'waterPaymentUrl'], ['gas', 'gasPaymentUrl'], ['electricity', 'electricityPaymentUrl']]) {
      if (a[field]) {
        try { urls[svc] = await QRCode.toDataURL(a[field], { width: 240, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } }); } catch {}
      }
    }
    if (Object.keys(urls).length > 0) setQrUrls(urls);
  }

  async function handleSave(e) {
    e.preventDefault();
    await api.apartments.update(Number(id), {
      ...form,
      monthlyRent: Number(form.monthlyRent),
      depositAmount: Number(form.depositAmount),
      area: Number(form.area || 0),
      waterReadingDay: Number(form.waterReadingDay || 10),
      gasReadingDay: Number(form.gasReadingDay || 12),
      electricityReadingDay: Number(form.electricityReadingDay || 15),
      waterPaymentUrl: form.waterPaymentUrl || '',
      gasPaymentUrl: form.gasPaymentUrl || '',
      electricityPaymentUrl: form.electricityPaymentUrl || '',
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

  async function startScanner() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        scanLoop();
      }
    } catch {
      // Fallback: if camera fails, trigger file upload
      if (scannerRef.current) scannerRef.current.click();
    }
  }

  function stopScanner() {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  }

  function scanLoop() {
    if (!videoRef.current || scanService === null) return;
    const video = videoRef.current;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        handleScanResult(code.data);
        return;
      }
    }
    requestAnimationFrame(scanLoop);
  }

  async function handleScanResult(data) {
    stopScanner();
    const url = data.startsWith('http') ? data : 'https://' + data;
    const svc = scanService;
    setScanService(null);
    const updated = { ...apt };
    if (svc === 'water') updated.waterPaymentUrl = url;
    else if (svc === 'gas') updated.gasPaymentUrl = url;
    else updated.electricityPaymentUrl = url;
    await api.apartments.update(Number(id), { [svc === 'water' ? 'waterPaymentUrl' : svc === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl']: url });
    setApt(updated);
    setForm(updated);
    generateQr(svc, url);
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      URL.revokeObjectURL(img.src);
      if (code && code.data) {
        handleScanResult(code.data);
      } else {
        alert('No se encontró un código QR en la imagen');
      }
    } catch {
      alert('Error al procesar la imagen');
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
    return () => stopScanner();
  }, []);

  function callNumber(phone) {
    window.location.href = 'tel:' + phone;
  }

  function whatsappNumber(phone) {
    const num = phone.replace(/[^0-9]/g, '');
    window.open('https://wa.me/57' + num, '_blank');
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
      const fullText = text + '\n\n' + window.location.href;
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

  const totalIncome = payments.filter(p => p.type === 'rent').reduce((s, p) => s + (p.amount || 0), 0);
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
                <p><span className="text-gray-500">Email:</span> {tenant.email || '-'}</p>
                <p><span className="text-gray-500">Teléfono:</span> {tenant.phone || '-'}</p>
                {tenant.phone && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => callNumber(tenant.phone)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs hover:bg-green-100 transition-colors"><Phone className="w-3 h-3" /> Llamar</button>
                    <button onClick={() => whatsappNumber(tenant.phone)} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs hover:bg-emerald-100 transition-colors"><MessageCircle className="w-3 h-3" /> WhatsApp</button>
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
                        {apt[svc === 'water' ? 'waterPaymentUrl' : svc === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl'] && (
                          <>
                            <button onClick={() => setShowQrModal(svc)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100 rounded transition-colors">
                              <QrCode className="w-3 h-3" /> QR
                            </button>
                            <button onClick={() => openPaymentUrl(apt[svc === 'water' ? 'waterPaymentUrl' : svc === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl'])} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-100 rounded transition-colors font-medium">
                              <ExternalLink className="w-3 h-3" /> Pagar
                            </button>
                          </>
                        )}
                        <button onClick={() => { setScanService(svc); setTimeout(startScanner, 100); }} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors" title="Escanear QR de recibo">
                          <Scan className="w-3 h-3" /> Escanear
                        </button>
                        <input ref={scannerRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} className="hidden" />
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
                <img src={qrUrls[showQrModal]} alt="QR de pago" className="mx-auto w-56 h-56 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => openPaymentUrl(apt[showQrModal === 'water' ? 'waterPaymentUrl' : showQrModal === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl'])} />
                <p className="text-xs text-gray-400 mt-2">Toca el QR o el botón para pagar</p>
                <button onClick={() => openPaymentUrl(apt[showQrModal === 'water' ? 'waterPaymentUrl' : showQrModal === 'gas' ? 'gasPaymentUrl' : 'electricityPaymentUrl'])} className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors text-sm font-medium">
                  <ExternalLink className="w-4 h-4" /> Pagar ahora
                </button>
                <button onClick={() => { setScanService(showQrModal); setShowQrModal(null); setTimeout(startScanner, 100); }} className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors text-sm">
                  <Scan className="w-4 h-4" /> Escanear otro QR
                </button>
              </div>
            )}
          </Modal>

          {/* Scanner modal */}
          <Modal open={scanService !== null} onClose={() => { stopScanner(); setScanService(null); }} title={scanService ? `Escaneando QR - ${serviceNames[scanService]}` : ''}>
            <div className="p-4">
              <div className="relative bg-black rounded-xl overflow-hidden mb-3" style={{ minHeight: 280 }}>
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                {scanService !== null && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-48 border-2 border-emerald-400 rounded-xl opacity-70" />
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 text-center mb-3">Apunta la cámara al código QR del recibo</p>
              <div className="flex gap-2">
                <button onClick={() => scannerRef.current?.click()} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm">
                  <Image className="w-4 h-4" /> Subir foto
                </button>
                <button onClick={() => { stopScanner(); setScanService(null); }} className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors text-sm">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1"><QrCode className="w-3 h-3" /> URL Pago Gas (QR)</label>
              <input type="url" value={form.gasPaymentUrl || ''} onChange={e => setForm({...form, gasPaymentUrl: e.target.value})} placeholder="URL del pago (opcional)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-1"><QrCode className="w-3 h-3" /> URL Pago Electricidad (QR)</label>
              <input type="url" value={form.electricityPaymentUrl || ''} onChange={e => setForm({...form, electricityPaymentUrl: e.target.value})} placeholder="URL del pago (opcional)" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
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
    </div>
  );
}
