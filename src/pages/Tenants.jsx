import { useState, useEffect } from 'react';
import { Plus, Search, Phone, MessageCircle, Trash2, Monitor, Smartphone, Pencil } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { getViewMode } from '../utils/viewMode';

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [vm, setVm] = useState(getViewMode());
  const [form, setForm] = useState({ name: '', phone: '', documentId: '', workPhone: '', workAddress: '', notes: '', linkedAptId: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    const [t, c, a] = await Promise.all([api.tenants.toArray(), api.contracts.toArray(), api.apartments.toArray()]);
    setTenants(t); setContracts(c); setApartments(a);
  }

  function getApartmentName(tenant) {
    if (tenant.apartmentId) {
      const apt = apartments.find(a => a.id === tenant.apartmentId);
      if (apt) return apt.name;
    }
    const c = contracts.find(ct => ct.tenantId === tenant.id && (!ct.endDate || new Date(ct.endDate) > new Date()));
    return c ? apartments.find(a => a.id === c.apartmentId)?.name : null;
  }

  const sorted = [...tenants].sort((a, b) => {
    const aptA = getApartmentName(a) || '';
    const aptB = getApartmentName(b) || '';
    if (aptA && aptB) return aptA.localeCompare(aptB, undefined, { numeric: true });
    if (aptA) return -1;
    if (aptB) return 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = sorted.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.documentId?.includes(search)
  );

  async function handleAdd(e) {
    e.preventDefault();
    try {
      const newTenant = await api.tenants.add({
        ...form,
        apartmentId: form.linkedAptId ? Number(form.linkedAptId) : undefined,
        linkedAptId: undefined,
        createdAt: new Date().toISOString(),
      });
      if (form.linkedAptId) {
        const apt = apartments.find(a => a.id === Number(form.linkedAptId));
        if (apt && apt.status !== 'occupied') {
          await api.apartments.update(apt.id, { status: 'occupied' });
        }
      }
      setShowAdd(false);
      setForm({ name: '', phone: '', documentId: '', workPhone: '', workAddress: '', notes: '', linkedAptId: '' });
      load();
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este inquilino?')) return;
    try {
      await api.tenants.delete(id);
      load();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    await api.tenants.update(editingTenant.id, {
      name: form.name,
      phone: form.phone,
      documentId: form.documentId,
      workPhone: form.workPhone,
      workAddress: form.workAddress,
      notes: form.notes,
      apartmentId: form.linkedAptId ? Number(form.linkedAptId) : null,
    });
    setShowEdit(false);
    setEditingTenant(null);
    setForm({ name: '', phone: '', documentId: '', workPhone: '', workAddress: '', notes: '', linkedAptId: '' });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Inquilinos</h1>
          <p className="text-gray-500 mt-1">{tenants.length} registrados</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" /> Agregar Inquilino
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar inquilino..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {vm === 'horizontal' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Documento</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Teléfono</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tel. Trabajo</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Dir. Trabajo</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Apartamento</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(t => {
                  const aptName = getApartmentName(t);
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                      <td className="px-4 py-3 text-gray-500">{t.documentId || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-gray-500">
                          {t.phone ? (
                            <>
                              <span className="text-gray-700">{t.phone}</span>
                              <a href={`tel:${t.phone}`} className="p-1 hover:text-green-600" title="Llamar"><Phone className="w-3.5 h-3.5" /></a>
                              <a href={`https://wa.me/57${t.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-1 hover:text-emerald-600" title="WhatsApp"><MessageCircle className="w-3.5 h-3.5" /></a>
                            </>
                          ) : <span className="text-gray-400">-</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{t.workPhone || '-'}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[120px] truncate" title={t.workAddress || ''}>{t.workAddress || '-'}</td>
                      <td className="px-4 py-3">{aptName ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{aptName}</span> : <span className="text-gray-400">-</span>}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => { setEditingTenant(t); setForm({ name: t.name, phone: t.phone || '', documentId: t.documentId || '', workPhone: t.workPhone || '', workAddress: t.workAddress || '', notes: t.notes || '', linkedAptId: t.apartmentId || '' }); setShowEdit(true); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(t => {
              const aptName = getApartmentName(t);
              return (
                <div key={t.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.documentId || '-'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {t.phone && (
                        <>
                          <a href={`tel:${t.phone}`} className="p-1.5 text-gray-400 hover:text-green-600 transition-colors"><Phone className="w-4 h-4" /></a>
                          <a href={`https://wa.me/57${t.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-emerald-600 transition-colors"><MessageCircle className="w-4 h-4" /></a>
                        </>
                      )}
                      <button onClick={() => { setEditingTenant(t); setForm({ name: t.name, phone: t.phone || '', documentId: t.documentId || '', workPhone: t.workPhone || '', workAddress: t.workAddress || '', notes: t.notes || '', linkedAptId: t.apartmentId || '' }); setShowEdit(true); }} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-500">Teléfono:</span><span className="text-gray-700">{t.phone || '-'}</span>
                    <span className="text-gray-500">Tel. Trabajo:</span><span className="text-gray-700">{t.workPhone || '-'}</span>
                    <span className="text-gray-500">Dir. Trabajo:</span><span className="text-gray-700">{t.workAddress || '-'}</span>
                    <span className="text-gray-500">Apartamento:</span><span className="text-gray-700">{aptName ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{aptName}</span> : '-'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8">No se encontraron inquilinos</p>}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nuevo Inquilino">
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo *</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
            <input type="text" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Documento (Cédula)</label>
            <input type="text" value={form.documentId} onChange={e => setForm({...form, documentId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asociar a Apartamento (opcional)</label>
            <select value={form.linkedAptId} onChange={e => setForm({...form, linkedAptId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">-- Sin apartamento --</option>
              {apartments.map(a =>
                <option key={a.id} value={a.id}>{a.name}</option>
              )}
            </select>
            <p className="text-xs text-gray-400 mt-1">Al seleccionar un apartamento se asignará directamente al inquilino.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono de Trabajo</label>
              <input type="text" value={form.workPhone} onChange={e => setForm({...form, workPhone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de Trabajo</label>
              <input type="text" value={form.workAddress} onChange={e => setForm({...form, workAddress: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar</button>
          </div>
        </form>
      </Modal>

      <Modal open={showEdit} onClose={() => { setShowEdit(false); setEditingTenant(null); }} title="Editar Inquilino">
        <form onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo *</label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
            <input type="text" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Documento (Cédula)</label>
            <input type="text" value={form.documentId} onChange={e => setForm({...form, documentId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Asociar a Apartamento (opcional)</label>
            <select value={form.linkedAptId} onChange={e => setForm({...form, linkedAptId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">-- Sin apartamento --</option>
              {apartments.map(a =>
                <option key={a.id} value={a.id}>{a.name}</option>
              )}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono de Trabajo</label>
              <input type="text" value={form.workPhone} onChange={e => setForm({...form, workPhone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de Trabajo</label>
              <input type="text" value={form.workAddress} onChange={e => setForm({...form, workAddress: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setShowEdit(false); setEditingTenant(null); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar Cambios</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}