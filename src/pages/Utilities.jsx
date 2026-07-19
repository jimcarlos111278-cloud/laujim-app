import { useState, useEffect } from 'react';
import { Zap, Droplets, Flame, Plus, Search, ExternalLink, CheckCircle, XCircle, ChevronLeft, ChevronRight, Save, AlertTriangle } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate, getCurrentPeriod, getPeriodLabel, nextPeriod, prevPeriod, isOverdueByReadingDate } from '../utils/helpers';

const serviceIcons = { water: Droplets, gas: Flame, electricity: Zap };
const serviceNames = { water: 'Agua', gas: 'Gas', electricity: 'Electricidad' };
const serviceColors = { water: 'text-blue-600 bg-blue-50', gas: 'text-amber-600 bg-amber-50', electricity: 'text-yellow-600 bg-yellow-50' };

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
  const [showGrid, setShowGrid] = useState(false);
  const [gridPeriod, setGridPeriod] = useState(getCurrentPeriod());
  const [gridData, setGridData] = useState({});
  const [form, setForm] = useState({ apartmentId: '', service: 'water', paymentCode: '', period: getCurrentPeriod(), amount: '', dueDate: '', readingDate: '', paid: false, notes: '' });

  useEffect(() => { load(); }, []);

  async function load() {
    const [r, a] = await Promise.all([api.utilityPayments.toArray(), api.apartments.toArray()]);
    setRecords(r); setApartments(a);
  }

  function getApartment(id) { return apartments.find(a => a.id === id); }

  const filtered = records.filter(r => {
    const apt = getApartment(r.apartmentId);
    const s = search.toLowerCase();
    return (!search || apt?.name.toLowerCase().includes(s) || r.paymentCode?.includes(s)) &&
      (filterService === 'all' || r.service === filterService);
  });

  async function handleAdd(e) {
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
  }

  async function togglePaid(record) {
    await api.utilityPayments.update(record.id, {
      paid: !record.paid,
      paidDate: !record.paid ? new Date().toISOString() : null,
    });
    load();
  }

  function openGrid() {
    setGridPeriod(getCurrentPeriod());
    buildGridData(getCurrentPeriod());
    setShowGrid(true);
  }

  function buildGridData(period) {
    const data = {};
    for (const apt of apartments) {
      data[apt.id] = {};
      for (const svc of ['water', 'gas', 'electricity']) {
        const existing = records.find(r => r.apartmentId === apt.id && r.service === svc && r.period === period);
        data[apt.id][svc] = {
          paid: existing ? existing.paid : false,
          recordId: existing ? existing.id : null,
          paymentCode: existing ? existing.paymentCode : '',
          amount: existing ? existing.amount : 0,
          readingDate: existing ? existing.readingDate : '',
          dueDate: existing ? existing.dueDate : '',
        };
      }
    }
    setGridData(data);
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
  }

  async function saveGrid() {
    for (const aptId of Object.keys(gridData)) {
      for (const svc of ['water', 'gas', 'electricity']) {
        const cell = gridData[aptId][svc];
        const existing = records.find(r => r.apartmentId === Number(aptId) && r.service === svc && r.period === gridPeriod);
        if (cell.recordId && existing) {
          await api.utilityPayments.update(cell.recordId, {
            paid: cell.paid,
            paidDate: cell.paid ? new Date().toISOString() : null,
          });
        } else if (!existing) {
          const apt = getApartment(Number(aptId));
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
        }
      }
    }
    await load();
    buildGridData(gridPeriod);
    alert('Guardado correctamente');
  }

  const pendingCount = records.filter(r => !r.paid).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Servicios Públicos</h1>
          <p className="text-gray-500 mt-1">{pendingCount} pendientes de pago</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openGrid} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium">
            <CheckCircle className="w-4 h-4" /> Pagar Recibos
          </button>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" /> Agregar
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar por apto o código..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={filterService} onChange={e => setFilterService(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="all">Todos los servicios</option>
          <option value="water">Agua</option>
          <option value="gas">Gas</option>
          <option value="electricity">Electricidad</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Servicio</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Apartamento</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Período</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Lectura</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Código</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Valor</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Vence</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Pagado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.toReversed().map(r => {
                const apt = getApartment(r.apartmentId);
                const Icon = serviceIcons[r.service];
                const website = utilityWebsites[r.service];
                const overdue = !r.paid && r.readingDate && isOverdueByReadingDate(r.period,
                  r.service === 'water' ? (apt?.waterReadingDay || 10) : r.service === 'gas' ? (apt?.gasReadingDay || 12) : (apt?.electricityReadingDay || 15));
                return (
                  <tr key={r.id} className={`hover:bg-gray-50 ${overdue ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${serviceColors[r.service]}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="font-medium">{serviceNames[r.service]}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{apt?.name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.period}</td>
                    <td className="px-4 py-3 text-gray-500">{r.readingDate ? formatShortDate(r.readingDate) : '-'}</td>
                    <td className="px-4 py-3">
                      <code className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono">{r.paymentCode || '-'}</code>
                    </td>
                    <td className="px-4 py-3 font-medium">{r.amount ? formatCurrency(r.amount) : '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.dueDate ? formatShortDate(r.dueDate) : '-'}</td>
                    <td className="px-4 py-3">
                      {r.paid
                        ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle className="w-4 h-4" /> Sí</span>
                        : <span className="flex items-center gap-1 text-amber-600">
                            {overdue ? <AlertTriangle className="w-4 h-4 text-red-500" /> : <XCircle className="w-4 h-4" />}
                            {overdue ? 'Vencido' : 'No'}
                          </span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {r.paymentCode && (
                          <a href={website.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors" title={`Pagar en ${website.name}`}>
                            <ExternalLink className="w-3 h-3" /> Pagar
                          </a>
                        )}
                        <button onClick={() => togglePaid(r)} className={`px-2 py-1 text-xs rounded transition-colors ${r.paid ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'}`}>
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
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8">No hay registros de servicios públicos</p>}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Nuevo Registro de Servicio" size="lg">
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Apartamento *</label>
              <select value={form.apartmentId} onChange={e => setForm({...form, apartmentId: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required>
                <option value="">Seleccionar...</option>
                {apartments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Servicio *</label>
              <select value={form.service} onChange={e => setForm({...form, service: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="water">Agua</option>
                <option value="gas">Gas</option>
                <option value="electricity">Electricidad</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Período</label>
              <input type="month" value={form.period} onChange={e => setForm({...form, period: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código de Pago</label>
              <input type="text" value={form.paymentCode} onChange={e => setForm({...form, paymentCode: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Ej: 1234567890" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor</label>
              <input type="number" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Lectura</label>
              <input type="date" value={form.readingDate} onChange={e => setForm({...form, readingDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Vencimiento</label>
              <input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="paid" checked={form.paid} onChange={e => setForm({...form, paid: e.target.checked})} className="rounded border-gray-300" />
            <label htmlFor="paid" className="text-sm text-gray-700">Ya está pagado</label>
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

      <Modal open={showGrid} onClose={() => setShowGrid(false)} title={`Pagar Recibos - ${getPeriodLabel(gridPeriod)}`} size="xl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => handleGridPeriodChange('prev')} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-5 h-5" /></button>
            <span className="font-semibold text-lg">{getPeriodLabel(gridPeriod)}</span>
            <button onClick={() => handleGridPeriodChange('next')} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-5 h-5" /></button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 font-medium text-gray-600 border border-gray-200">Apto</th>
                  <th className="text-center px-3 py-2 font-medium text-blue-600 border border-gray-200 bg-blue-50">Agua</th>
                  <th className="text-center px-3 py-2 font-medium text-amber-600 border border-gray-200 bg-amber-50">Gas</th>
                  <th className="text-center px-3 py-2 font-medium text-yellow-600 border border-gray-200 bg-yellow-50">Electricidad</th>
                </tr>
              </thead>
              <tbody>
                {apartments.map(apt => {
                  const w = gridData[apt.id]?.water || {};
                  const g = gridData[apt.id]?.gas || {};
                  const e = gridData[apt.id]?.electricity || {};
                  const wOverdue = !w.paid && isOverdueByReadingDate(gridPeriod, apt.waterReadingDay || 10);
                  const gOverdue = !g.paid && isOverdueByReadingDate(gridPeriod, apt.gasReadingDay || 12);
                  const eOverdue = !e.paid && isOverdueByReadingDate(gridPeriod, apt.electricityReadingDay || 15);
                  return (
                    <tr key={apt.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium border border-gray-200">{apt.name}</td>
                      <td className={`text-center border border-gray-200 ${wOverdue ? 'bg-red-50' : ''}`}>
                        <label className="flex items-center justify-center gap-1.5 p-2 cursor-pointer">
                          <input type="checkbox" checked={w.paid} onChange={e => handleGridPaidChange(apt.id, 'water', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                          {wOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500" title="Vencido" />}
                        </label>
                      </td>
                      <td className={`text-center border border-gray-200 ${gOverdue ? 'bg-red-50' : ''}`}>
                        <label className="flex items-center justify-center gap-1.5 p-2 cursor-pointer">
                          <input type="checkbox" checked={g.paid} onChange={e => handleGridPaidChange(apt.id, 'gas', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-amber-600" />
                          {gOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500" title="Vencido" />}
                        </label>
                      </td>
                      <td className={`text-center border border-gray-200 ${eOverdue ? 'bg-red-50' : ''}`}>
                        <label className="flex items-center justify-center gap-1.5 p-2 cursor-pointer">
                          <input type="checkbox" checked={e.paid} onChange={e => handleGridPaidChange(apt.id, 'electricity', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-yellow-600" />
                          {eOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500" title="Vencido" />}
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => { setShowGrid(false); load(); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cerrar</button>
            <button onClick={saveGrid} className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Save className="w-4 h-4" /> Guardar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
