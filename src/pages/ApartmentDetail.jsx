import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, DollarSign, Calendar, Edit2, Trash2, User, FileText, Camera, Phone, Plus, X, Download, Image, MessageCircle, Hash, Clock, Droplets, Flame, Zap, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentHistoryChart from '../components/PaymentHistoryChart';
import { api } from '../api';
import { photoUrl, isCapacitor } from '../utils/config';
import { formatCurrency, formatShortDate, daysUntil, getCurrentPeriod, getPeriodLabel, prevPeriod, nextPeriod, isOverdueByReadingDate } from '../utils/helpers';
import { generateApartmentPDF } from '../utils/pdf';
import { addCalendarReminder } from '../utils/calendar';

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
  const [familyMembers, setFamilyMembers] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [utilityRecords, setUtilityRecords] = useState([]);
  const [utilityPeriod, setUtilityPeriod] = useState(getCurrentPeriod());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [newMember, setNewMember] = useState({ name: '', phone: '' });
  const [uploading, setUploading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const fileRef = useRef(null);

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
    a.href = url; a.download = name; a.click();
  }

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
    try {
      const text = [
        `Apartamento ${apt.name} - ${apt.status === 'vacant' ? 'DISPONIBLE' : 'OCUPADO'}`,
        apt.description || '',
        `Canon: $${(apt.monthlyRent || 0).toLocaleString()}`,
        apt.rooms ? `${apt.rooms} hab / ${apt.bathrooms} ba\u00f1os / ${apt.area} m\u00b2` : '',
        apt.notes || '',
      ].filter(Boolean).join('\n');

      const photoUrls = photos.map(p => { const u = photoUrl(p.url); return u || null; }).filter(Boolean);

      if (isCapacitor()) {
        try {
          const { Share } = await import('@capacitor/share');
          const shareText = text + '\n\n' + window.location.href;
          const files = [];
          for (const url of photoUrls) {
            try {
              const blob = await (await fetch(url)).blob();
              const base64 = await new Promise(r => { const f = new FileReader(); f.onloadend = () => r(f.result); f.readAsDataURL(blob); });
              files.push(base64);
            } catch {}
          }
          await Share.share({ text: shareText, files: files.length > 0 ? files : undefined, dialogTitle: 'Compartir Apartamento' });
          return;
        } catch {}
      }

      if (navigator.share) {
        try {
          await navigator.share({ text: text + '\n\n' + window.location.href });
          return;
        } catch {}
      }

      const waUrl = `https://wa.me/?text=${encodeURIComponent(text + '\n\n' + window.location.href)}`;
      window.open(waUrl, '_blank');
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
  const daysToPay = daysUntil(apt.paymentDueDay);

  const services = ['water', 'gas', 'electricity'];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/apartments')} className="p-2 hover:bg-gray-200 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{apt.name}</h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${apt.status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{apt.status === 'occupied' ? 'OCUPADO' : 'VACANTE'}</span>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Canon</p><p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(apt.monthlyRent)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Depósito</p><p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(apt.depositAmount)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium uppercase">Día de Pago</p><p className="text-xl font-bold text-gray-900 mt-1">{apt.paymentDueDay || 5}</p></div>
        <div className={`rounded-xl border p-4 ${daysToPay <= 1 ? 'bg-red-50 border-red-200' : daysToPay <= 5 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <p className="text-xs font-medium uppercase flex items-center gap-1"><Clock className="w-3 h-3" /> Próximo Pago</p>
          <p className={`text-xl font-bold mt-1 ${daysToPay <= 1 ? 'text-red-700' : daysToPay <= 5 ? 'text-amber-700' : 'text-gray-900'}`}>{daysToPay} días</p>
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
                      <span>Código: <code className="px-1 bg-white rounded font-mono">{rec?.paymentCode || apt.nic || '-'}</code></span>
                      <span>Valor: {rec?.amount ? formatCurrency(rec.amount) : '-'}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex gap-1">
                        {rec?.paymentCode && (
                          <a href={utilityWebsites[svc].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100 rounded transition-colors">
                            <ExternalLink className="w-3 h-3" /> Pagar
                          </a>
                        )}
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

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Image className="w-4 h-4" /> Fotos del Apartamento</h3>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map(p => (
                <div key={p.id} className="relative group aspect-square bg-gray-100 rounded-lg overflow-hidden">
                  <img src={photoUrl(p.url)} alt={p.originalName} className="w-full h-full object-cover" loading="lazy" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                  <div className="absolute inset-0 bg-gray-200 items-center justify-center hidden"><Image className="w-6 h-6 text-gray-400" /></div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <button onClick={() => downloadPhoto(photoUrl(p.url), p.originalName)} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-blue-600" title="Descargar"><Download className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deletePhoto(p.id)} className="p-1.5 bg-white rounded-full text-gray-700 hover:text-red-600" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            <input type="file" accept="image/*" multiple ref={fileRef} onChange={handlePhotoUpload} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
              <Camera className="w-4 h-4" /> {uploading ? 'Subiendo...' : 'Subir Fotos'}
            </button>
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
              <div className="col-span-2"><span className="text-gray-500">NIC / Código de pago:</span> <strong>{apt.nic || '-'}</strong></div>
              <div><span className="text-gray-500">Lectura Agua:</span> <strong>Día {apt.waterReadingDay || 10}</strong></div>
              <div><span className="text-gray-500">Lectura Gas:</span> <strong>Día {apt.gasReadingDay || 12}</strong></div>
              <div className="col-span-2"><span className="text-gray-500">Lectura Electricidad:</span> <strong>Día {apt.electricityReadingDay || 15}</strong></div>
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
                <option value="occupied">Ocupado</option>
                <option value="vacant">Vacante</option>
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
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Hash className="w-3 h-3" /> NIC / Código de Pago</label>
              <input type="text" value={form.nic || ''} onChange={e => setForm({...form, nic: e.target.value})} placeholder="Ej: 1234567890" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lectura Agua (día)</label>
              <input type="number" min="1" max="31" value={form.waterReadingDay || 10} onChange={e => setForm({...form, waterReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lectura Gas (día)</label>
              <input type="number" min="1" max="31" value={form.gasReadingDay || 12} onChange={e => setForm({...form, gasReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lectura Electricidad (día)</label>
              <input type="number" min="1" max="31" value={form.electricityReadingDay || 15} onChange={e => setForm({...form, electricityReadingDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
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
