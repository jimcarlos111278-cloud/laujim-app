import { useState, useEffect, useRef } from 'react';
import { Plus, Search, Trash2, Download, Upload, Monitor, Smartphone } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate } from '../utils/helpers';
import { getViewMode } from '../utils/viewMode';

export default function Contracts() {
  const [contracts, setContracts] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [vm, setVm] = useState(getViewMode());
  const fileRef = useRef(null);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [form, setForm] = useState({ apartmentId: '', tenantId: '', startDate: '', endDate: '', monthlyRent: '', depositAmount: '', depositPaid: false, terms: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    const [c, a, t] = await Promise.all([api.contracts.toArray(), api.apartments.toArray(), api.tenants.toArray()]);
    setContracts(c); setApartments(a); setTenants(t);
  }

  function getApartment(id) { return apartments.find(a => a.id === id); }
  function getTenant(id) { return tenants.find(t => t.id === id); }

  const filtered = contracts.filter(c => {
    const apt = getApartment(c.apartmentId);
    const ten = getTenant(c.tenantId);
    const s = search.toLowerCase();
    return apt?.name.toLowerCase().includes(s) || ten?.name.toLowerCase().includes(s);
  });

  async function handleAdd(e) {
    e.preventDefault();
    const apt = getApartment(Number(form.apartmentId));
    const newContract = await api.contracts.add({
      apartmentId: Number(form.apartmentId),
      tenantId: Number(form.tenantId),
      startDate: form.startDate,
      endDate: form.endDate || null,
      monthlyRent: Number(form.monthlyRent),
      depositAmount: Number(form.depositAmount),
      depositPaid: form.depositPaid,
      terms: form.terms,
      createdAt: new Date().toISOString(),
    });
    if (form.fileToUpload) {
      try {
        const result = await api.uploadContract(form.fileToUpload, newContract.id);
        await api.contracts.update(newContract.id, { contractFile: result.url });
      } catch {}
    }
    if (apt) await api.apartments.update(apt.id, { status: 'occupied' });
    setShowAdd(false);
    setForm({ apartmentId: '', tenantId: '', startDate: '', endDate: '', monthlyRent: '', depositAmount: '', depositPaid: false, terms: '', fileToUpload: null });
    load();
  }

  async function handleTerminate(contract) {
    if (!confirm('¿Finalizar este contrato?')) return;
    await api.contracts.update(contract.id, { endDate: new Date().toISOString() });
    const allC = await api.contracts.toArray();
    const hasOtherActive = allC.filter(c => c.apartmentId === contract.apartmentId && c.id !== contract.id && (!c.endDate || new Date(c.endDate) > new Date())).length;
    if (hasOtherActive === 0) await api.apartments.update(contract.apartmentId, { status: 'vacant' });
    load();
  }

  async function handleDelete(id) {
    if (confirm('¿Eliminar este contrato permanentemente?')) {
      await api.contracts.delete(id);
      load();
    }
  }

  async function handleUploadFile(e) {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;
    setUploading(true);
    try {
      const result = await api.uploadContract(file, uploadTarget.id);
      await api.contracts.update(uploadTarget.id, { contractFile: result.url });
      load();
    } catch (err) {
      alert('Error al subir: ' + err.message);
    }
    setUploading(false);
    setUploadTarget(null);
  }

  const availableApts = apartments.filter(a => a.status === 'vacant');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Contratos</h1>
          <p className="text-gray-500 mt-1">{contracts.length} registros</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" /> Nuevo Contrato
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar por apto o inquilino..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {vm === 'horizontal' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Apartamento</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Inquilino</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Inicio</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Fin</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Canon</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Depósito</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Documento</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.toReversed().map(c => {
                  const apt = getApartment(c.apartmentId);
                  const ten = getTenant(c.tenantId);
                  const isActive = !c.endDate || new Date(c.endDate) > new Date();
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{apt?.name || '-'}</td>
                      <td className="px-4 py-3">{ten?.name || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{formatShortDate(c.startDate)}</td>
                      <td className="px-4 py-3">{c.endDate ? formatShortDate(c.endDate) : <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">Vigente</span>}</td>
                      <td className="px-4 py-3 font-medium">{formatCurrency(c.monthlyRent)}</td>
                      <td className="px-4 py-3">{c.depositPaid ? <span className="text-emerald-600">✓</span> : <span className="text-amber-600">Pendiente</span>}</td>
                      <td className="px-4 py-3 text-center">
                        {c.contractFile ? (
                          <a href={c.contractFile} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" title="Descargar PDF">
                            <Download className="w-3.5 h-3.5" /> PDF
                          </a>
                        ) : (
                          <button onClick={() => { setUploadTarget(c); fileRef.current?.click(); }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600" title="Adjuntar PDF">
                            <Upload className="w-3.5 h-3.5" /> Subir
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isActive && <button onClick={() => handleTerminate(c)} className="px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded transition-colors">Finalizar</button>}
                          <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.toReversed().map(c => {
              const apt = getApartment(c.apartmentId);
              const ten = getTenant(c.tenantId);
              const isActive = !c.endDate || new Date(c.endDate) > new Date();
              return (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{apt?.name || '-'}</p>
                      <p className="text-xs text-gray-500">{ten?.name || '-'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {isActive && <button onClick={() => handleTerminate(c)} className="px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 rounded transition-colors">Finalizar</button>}
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500">Inicio:</span><span className="text-gray-700">{formatShortDate(c.startDate)}</span>
                    <span className="text-gray-500">Fin:</span><span className="text-gray-700">{c.endDate ? formatShortDate(c.endDate) : <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">Vigente</span>}</span>
                    <span className="text-gray-500">Canon:</span><span className="text-gray-700 font-medium">{formatCurrency(c.monthlyRent)}</span>
                    <span className="text-gray-500">Depósito:</span><span className="text-gray-700">{c.depositPaid ? <span className="text-emerald-600">✓ Pagado</span> : <span className="text-amber-600">Pendiente</span>}</span>
                    <span className="text-gray-500">Documento:</span><span className="text-gray-700">
                      {c.contractFile ? (
                        <a href={c.contractFile} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><Download className="w-3.5 h-3.5" /> PDF</a>
                      ) : (
                        <button onClick={() => { setUploadTarget(c); fileRef.current?.click(); }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"><Upload className="w-3.5 h-3.5" /> Subir</button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8">No se encontraron contratos</p>}
      </div>

      <input type="file" accept=".pdf,image/*" ref={fileRef} onChange={handleUploadFile} className="hidden" />

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nuevo Contrato" size="lg">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Apartamento *</label>
              <select value={form.apartmentId} onChange={e => {
                const apt = apartments.find(a => a.id === Number(e.target.value));
                setForm({...form, apartmentId: e.target.value, monthlyRent: apt?.monthlyRent || '', depositAmount: apt?.depositAmount || ''});
              }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required>
                <option value="">Seleccionar...</option>
                {apartments.map(a => (
                  <option key={a.id} value={a.id}>{a.name} - {a.status === 'occupied' ? 'OCUPADO' : 'VACANTE'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Inquilino *</label>
              <select value={form.tenantId} onChange={e => setForm({...form, tenantId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required>
                <option value="">Seleccionar...</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Inicio *</label>
              <input type="date" value={form.startDate} onChange={e => setForm({...form, startDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Fin (opcional)</label>
              <input type="date" value={form.endDate} onChange={e => setForm({...form, endDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Canon de Arriendo *</label>
              <input type="number" value={form.monthlyRent} onChange={e => setForm({...form, monthlyRent: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depósito</label>
              <input type="number" value={form.depositAmount} onChange={e => setForm({...form, depositAmount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="depositPaid" checked={form.depositPaid} onChange={e => setForm({...form, depositPaid: e.target.checked})} className="rounded border-gray-300" />
            <label htmlFor="depositPaid" className="text-sm text-gray-700">Depósito pagado</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Documento PDF del contrato (opcional)</label>
            <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              {form.fileToUpload ? form.fileToUpload.name : 'Adjuntar archivo PDF'}
              <input type="file" accept=".pdf" className="hidden" onChange={e => setForm({...form, fileToUpload: e.target.files?.[0] || null})} />
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Términos del contrato</label>
            <textarea value={form.terms} onChange={e => setForm({...form, terms: e.target.value})} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Cláusulas, condiciones, etc." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Crear Contrato</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
