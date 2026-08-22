import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Building2, Home, Users, DollarSign, Search, Phone, MessageCircle, Bot } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { AUTH_TOKEN, getBase } from '../utils/config';
import { formatCurrency } from '../utils/helpers';

export default function Apartments() {
  const navigate = useNavigate();
  const [apartments, setApartments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [whatsappBusy, setWhatsappBusy] = useState('');
  const [form, setForm] = useState({ name: '', description: '', monthlyRent: '', depositAmount: '', paymentDueDay: 5, rooms: 2, bathrooms: 1, area: '', floor: 1 });

  useEffect(() => { load(); }, []);

  async function load() {
    const [apts, tnts, cnts] = await Promise.all([api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray()]);
    setApartments(apts); setTenants(tnts); setContracts(cnts);
  }

  function getCurrentTenants(aptId) {
    const direct = tenants.filter(t => t.apartmentId === aptId);
    const activeContracts = contracts.filter(c => c.apartmentId === aptId && (!c.endDate || new Date(c.endDate) > new Date()));
    const fromContracts = activeContracts.map(c => tenants.find(t => t.id === c.tenantId)).filter(Boolean);
    const seen = new Set();
    return [...direct, ...fromContracts].filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }

  const filtered = apartments.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) || (a.description || '').toLowerCase().includes(search.toLowerCase()));

  async function handleAdd(e) {
    e.preventDefault();
    await api.apartments.add({
      ...form,
      monthlyRent: Number(form.monthlyRent),
      depositAmount: Number(form.depositAmount),
      area: Number(form.area),
      floor: Number(form.floor),
      status: 'vacant',
      notes: '',
      createdAt: new Date().toISOString(),
    });
    setShowAdd(false);
    setForm({ name: '', description: '', monthlyRent: '', depositAmount: '', paymentDueDay: 5, rooms: 2, bathrooms: 1, area: '', floor: 1 });
    load();
  }

  async function toggleStatus(apt) {
    const newStatus = apt.status === 'occupied' ? 'vacant' : 'occupied';
    await api.apartments.update(apt.id, { status: newStatus });
    if (newStatus === 'vacant') {
      const active = contracts.filter(c => c.apartmentId === apt.id && (!c.endDate || new Date(c.endDate) > new Date()));
      for (const c of active) {
        await api.contracts.update(c.id, { endDate: new Date().toISOString().split('T')[0] });
      }
    }
    load();
  }

  async function callWhatsAppCloud(tenant, endpoint, action) {
    if (!tenant?.id || whatsappBusy) return;
    setWhatsappBusy(`${tenant.id}:${action}`);
    try {
      const response = await fetch(`${getBase()}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'No fue posible usar WhatsApp Cloud.');
      if (!data.conversationId) throw new Error('WhatsApp Cloud no devolvió una conversación.');
      navigate(`/whatsapp?conversation=${data.conversationId}`);
    } catch (error) {
      window.alert(error.message || 'No fue posible usar WhatsApp Cloud.');
    } finally {
      setWhatsappBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Apartamentos</h1>
          <p className="text-gray-500 mt-1">{apartments.length} unidades en total</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <Plus className="w-4 h-4" /> Agregar Apartamento
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Buscar apartamento..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(apt => {
          const currentTenants = getCurrentTenants(apt.id);
          return (
            <Link key={apt.id} to={`/apartments/${apt.id}`} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-blue-200 transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-gray-400" />
                  <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">{apt.name}</h3>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${apt.status === 'occupied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                  {apt.status === 'occupied' ? 'OCUPADO' : 'VACANTE'}
                </span>
              </div>
              <div className="space-y-1.5 text-sm text-gray-500" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>{formatCurrency(apt.monthlyRent)}/mes</span>
                </div>
                {currentTenants.length > 0 && (
                  <div className="border-t border-gray-100 pt-2 mt-2 space-y-2">
                    {currentTenants.map(t => (
                      <div key={t.id} className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Users className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                          <span className="text-gray-800 truncate">{t.name}</span>
                        </div>
                        {t.phone && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <a href={`tel:${t.phone}`} className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors" title="Llamar"><Phone className="w-3.5 h-3.5" /></a>
                            <button type="button" disabled={Boolean(whatsappBusy)} onClick={event => { event.preventDefault(); event.stopPropagation(); callWhatsAppCloud(t, '/whatsapp/cloud/start-conversation', 'open'); }} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50" title="Abrir WhatsApp Cloud" aria-label="Abrir WhatsApp Cloud"><MessageCircle className="w-3.5 h-3.5" /></button>
                            <button type="button" disabled={Boolean(whatsappBusy)} onClick={event => { event.preventDefault(); event.stopPropagation(); callWhatsAppCloud(t, '/whatsapp/cloud/send-tenant-template', 'template'); }} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50" title="Enviar plantilla de cobro por WhatsApp Cloud" aria-label="Enviar plantilla de cobro por WhatsApp Cloud"><Bot className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {apt.rooms && (
                  <div className="flex items-center gap-2">
                    <Home className="w-3.5 h-3.5" />
                    <span>{apt.rooms} hab, {apt.bathrooms} baños{apt.area ? `, ${apt.area}m²` : ''}</span>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nuevo Apartamento" size="lg">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Piso</label>
              <input type="number" value={form.floor} onChange={e => setForm({...form, floor: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Canon de Arriendo *</label>
              <input type="number" value={form.monthlyRent} onChange={e => setForm({...form, monthlyRent: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Depósito</label>
              <input type="number" value={form.depositAmount} onChange={e => setForm({...form, depositAmount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Día de Pago</label>
              <input type="number" min="1" max="31" value={form.paymentDueDay} onChange={e => setForm({...form, paymentDueDay: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Habitaciones</label>
              <input type="number" value={form.rooms} onChange={e => setForm({...form, rooms: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baños</label>
              <input type="number" value={form.bathrooms} onChange={e => setForm({...form, bathrooms: Number(e.target.value)})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Área (m²)</label>
              <input type="number" value={form.area} onChange={e => setForm({...form, area: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">Guardar</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
