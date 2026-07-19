import { useState, useEffect } from 'react';
import { Plus, Search, DollarSign, Filter } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate } from '../utils/helpers';

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [paymentMode, setPaymentMode] = useState(null);
  const [fullRent, setFullRent] = useState(0);
  const [form, setForm] = useState({ apartmentId: '', contractId: '', amount: '', date: new Date().toISOString().split('T')[0], type: 'rent', description: '', category: '', isUnexpected: false });

  const expenseCategories = ['Mantenimiento', 'Reparación', 'Limpieza', 'Impuesto', 'Seguro', 'Adecuación', 'Otro'];

  useEffect(() => { load(); }, []);

  async function load() {
    const [p, e, a, t, c] = await Promise.all([
      api.payments.toArray(), api.expenses.toArray(), api.apartments.toArray(),
      api.tenants.toArray(), api.contracts.toArray(),
    ]);
    setPayments(p); setExpenses(e); setApartments(a); setTenants(t); setContracts(c);
  }

  function getApartment(id) { return apartments.find(a => a.id === id); }

  function getActiveContracts(aptId) {
    return contracts.filter(c => c.apartmentId === aptId && (!c.endDate || new Date(c.endDate) > new Date()));
  }

  const allTransactions = [
    ...payments.map(p => ({ ...p, _type: 'Pago', _color: 'bg-emerald-100 text-emerald-700' })),
    ...expenses.map(e => ({ ...e, _type: 'Gasto', _color: 'bg-red-100 text-red-700', type: 'expense' })),
  ].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));

  const filtered = allTransactions.filter(t => {
    const apt = t.apartmentId ? getApartment(t.apartmentId) : null;
    const s = search.toLowerCase();
    const matchesSearch = !search || apt?.name.toLowerCase().includes(s) || t.description?.toLowerCase().includes(s) || t.category?.toLowerCase().includes(s);
    const matchesType = filterType === 'all' || t.type === filterType;
    return matchesSearch && matchesType;
  });

  function openPaymentModal(mode) {
    setPaymentMode(mode);
    const activeContracts = getActiveContracts(Number(form.apartmentId));
    const rent = activeContracts[0]?.monthlyRent || 0;
    setFullRent(rent);
    if (mode === 'full') {
      setForm({ ...form, amount: String(rent) });
    }
    setShowAdd(true);
  }

  async function handleAddPayment(e) {
    e.preventDefault();
    await api.payments.add({
      apartmentId: Number(form.apartmentId),
      contractId: Number(form.contractId) || null,
      amount: Number(form.amount),
      date: form.date,
      type: 'rent',
      paymentMode: paymentMode || 'partial',
      description: paymentMode === 'full' ? `Pago completo de arriendo - ${getApartment(Number(form.apartmentId))?.name}` : `Pago parcial de arriendo - ${getApartment(Number(form.apartmentId))?.name}`,
      createdAt: new Date().toISOString(),
    });
    setShowAdd(false);
    setPaymentMode(null);
    setForm({ apartmentId: '', contractId: '', amount: '', date: new Date().toISOString().split('T')[0], type: 'rent', description: '', category: '', isUnexpected: false });
    load();
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    await api.expenses.add({
      apartmentId: form.apartmentId ? Number(form.apartmentId) : null,
      amount: Number(form.amount),
      date: form.date,
      category: form.category || 'Otro',
      description: form.description,
      isUnexpected: form.isUnexpected || false,
      createdAt: new Date().toISOString(),
    });
    setShowExpense(false);
    setForm({ apartmentId: '', contractId: '', amount: '', date: new Date().toISOString().split('T')[0], type: 'rent', description: '', category: '', isUnexpected: false });
    load();
  }

  const totalPayments = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pagos y Gastos</h1>
          <p className="text-gray-500 mt-1">{payments.length} pagos · {expenses.length} gastos</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={form.apartmentId} onChange={e => {
            const aptId = Number(e.target.value);
            const activeContracts = getActiveContracts(aptId);
            const rent = activeContracts[0]?.monthlyRent || 0;
            setFullRent(rent);
            setForm({...form, apartmentId: e.target.value, contractId: activeContracts[0]?.id || ''});
          }} className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">Apto...</option>
            {apartments.filter(a => a.status === 'occupied').map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button onClick={() => setShowExpense(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Registrar Gasto
          </button>
          <div className="relative group">
            <button disabled={!form.apartmentId} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium">
              <DollarSign className="w-4 h-4" /> Registrar Pago
            </button>
            <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <button onClick={() => openPaymentModal('full')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 rounded-t-lg transition-colors flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Pago Completo
              </button>
              <button onClick={() => openPaymentModal('partial')} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 rounded-b-lg transition-colors flex items-center gap-2">
                <Plus className="w-4 h-4" /> Pago Parcial
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="all">Todos</option>
            <option value="rent">Pagos de arriendo</option>
            <option value="deposit">Depósitos</option>
            <option value="expense">Gastos</option>
            <option value="other">Otros</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium">Total Ingresos</p><p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(totalPayments)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium">Total Gastos</p><p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalExpenses)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 font-medium">Balance Neto</p><p className={`text-xl font-bold mt-1 ${totalPayments - totalExpenses >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(totalPayments - totalExpenses)}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Apartamento</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Concepto</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(t => {
                const apt = t.apartmentId ? getApartment(t.apartmentId) : null;
                return (
                  <tr key={`${t._type}-${t.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500">{formatShortDate(t.date || t.createdAt)}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${t._color}`}>{t._type}</span></td>
                    <td className="px-4 py-3">{apt?.name || 'General'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.description || t.category || t.type}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(t.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8">No hay transacciones registradas</p>}
      </div>

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setPaymentMode(null); }} title={paymentMode === 'full' ? 'Pago Completo de Arriendo' : 'Pago Parcial de Arriendo'}>
        <form onSubmit={handleAddPayment} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Apartamento *</label>
            <select value={form.apartmentId} onChange={e => {
              const aptId = Number(e.target.value);
              const activeContracts = getActiveContracts(aptId);
              const rent = activeContracts[0]?.monthlyRent || 0;
              setFullRent(rent);
              setForm({...form, apartmentId: e.target.value, contractId: activeContracts[0]?.id || '', amount: paymentMode === 'full' ? String(rent) : form.amount});
            }} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required>
              <option value="">Seleccionar...</option>
              {apartments.filter(a => a.status === 'occupied').map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {paymentMode === 'full' && fullRent > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
              <p className="text-emerald-800 font-medium">Canon completo: <strong>{formatCurrency(fullRent)}</strong></p>
              <p className="text-emerald-600 text-xs mt-1">Se registrará el pago por el valor total del arriendo.</p>
            </div>
          )}
          {paymentMode === 'partial' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto * {fullRent > 0 && <span className="text-gray-400 font-normal">(Canon completo: {formatCurrency(fullRent)})</span>}</label>
              <input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
          )}
          {paymentMode === 'full' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
              <input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-xs text-gray-400 mt-1">Auto-calculado del canon. Puedes ajustar si es necesario.</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Pago *</label>
            <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setShowAdd(false); setPaymentMode(null); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
              {paymentMode === 'full' ? 'Confirmar Pago Completo' : 'Registrar Pago Parcial'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showExpense} onClose={() => setShowExpense(false)} title="Registrar Gasto">
        <form onSubmit={handleAddExpense} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Apartamento (opcional)</label>
            <select value={form.apartmentId} onChange={e => setForm({...form, apartmentId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="">General (todos)</option>
              {apartments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción *</label>
            <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto *</label>
              <input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
              <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isUnexpected" checked={form.isUnexpected} onChange={e => setForm({...form, isUnexpected: e.target.checked})} className="rounded border-gray-300" />
            <label htmlFor="isUnexpected" className="text-sm text-gray-700">Gasto imprevisto <span className="text-xs text-gray-400">(no planeado, ej: reparación urgente)</span></label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowExpense(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">Registrar Gasto</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
