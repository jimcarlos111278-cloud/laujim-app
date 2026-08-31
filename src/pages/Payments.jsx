import { useState, useEffect } from 'react';
import { Plus, Search, DollarSign, Filter, Trash2, Check, X, Eye, Clock3, RefreshCw, Smartphone, BellRing, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate } from '../utils/helpers';
import { AUTH_TOKEN, getBase } from '../utils/config';
import { configurePaymentWatcher, getPaymentWatcherStatus, openPaymentWatcherSettings, stopPaymentWatcher } from '../utils/paymentWatcher';

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
  const [reviewingId, setReviewingId] = useState(null);
  const [ocrBusyId, setOcrBusyId] = useState(null);
  const [fullRent, setFullRent] = useState(0);
  const [automation, setAutomation] = useState({ events: [], rules: [], alerts: [], pending: 0, autoConfirmed: 0 });
  const [automationTab, setAutomationTab] = useState('queue');
  const [automationError, setAutomationError] = useState('');
  const [automationBusy, setAutomationBusy] = useState('');
  const [watcherStatus, setWatcherStatus] = useState(null);
  const [associationChoices, setAssociationChoices] = useState({});
  const [form, setForm] = useState({ apartmentId: '', contractId: '', amount: '', date: new Date().toISOString().split('T')[0], type: 'rent', description: '', category: '', isUnexpected: false });

  const expenseCategories = ['Mantenimiento', 'Reparación', 'Limpieza', 'Impuesto', 'Seguro', 'Adecuación', 'Otro'];

  useEffect(() => {
    load();
    loadAutomation();
    getPaymentWatcherStatus().then(setWatcherStatus);
    const interval = setInterval(loadAutomation, 15000);
    return () => clearInterval(interval);
  }, []);

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
      period: form.date.slice(0, 7),
      type: 'rent',
      paymentMode: paymentMode || 'partial',
      status: 'approved',
      approvedAt: new Date().toISOString(),
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

  async function handleDelete(id, type) {
    if (!confirm('¿Eliminar esta transacción?')) return;
    if (type === 'Pago') {
      await api.payments.delete(id);
    } else {
      await api.expenses.delete(id);
    }
    load();
  }

  async function loadAutomation() {
    try {
      const result = await api.paymentAutomation.summary();
      setAutomation(result);
      setAutomationError('');
    } catch (error) { setAutomationError(error.message || 'No se pudo cargar la cola automática.'); }
  }

  async function associateEvent(eventId, apartmentId, remember = true) {
    if (!apartmentId) return;
    setAutomationBusy(`associate-${eventId}`);
    try { await api.paymentAutomation.associate(eventId, apartmentId, remember); await Promise.all([loadAutomation(), load()]); }
    catch (error) { window.alert(error.message); }
    finally { setAutomationBusy(''); }
  }

  async function dismissEvent(eventId) {
    setAutomationBusy(`dismiss-${eventId}`);
    try { await api.paymentAutomation.dismiss(eventId); await loadAutomation(); }
    catch (error) { window.alert(error.message); }
    finally { setAutomationBusy(''); }
  }

  async function activatePaymentWatcher() {
    const next = await configurePaymentWatcher({ serverUrl: getBase(), token: AUTH_TOKEN, enabled: true });
    setWatcherStatus(next);
    if (next?.accessGranted === false) await openPaymentWatcherSettings();
  }

  async function disablePaymentWatcher() {
    const next = await stopPaymentWatcher();
    setWatcherStatus(next);
  }

  async function reviewPayment(payment, action) {
    const verb = action === 'approve' ? 'aprobar' : 'rechazar';
    if (!confirm(`¿Seguro que deseas ${verb} este comprobante?`)) return;
    setReviewingId(payment.id);
    try {
      const res = await fetch(`${getBase()}/whatsapp/cloud/payment-validations/${payment.id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': AUTH_TOKEN }, body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (error) { alert(`No fue posible ${verb} el comprobante: ${error.message}`); }
    finally { setReviewingId(null); }
  }

  async function openProof(payment) {
    try {
      const res = await fetch(`${getBase()}/whatsapp/cloud/payment-validations/${payment.id}/proof`, { headers: { 'x-auth-token': AUTH_TOKEN } });
      if (!res.ok) throw new Error(await res.text());
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { alert(`No fue posible abrir el comprobante: ${error.message}`); }
  }

  async function retryOcr(payment) {
    setOcrBusyId(payment.id);
    try {
      const res = await fetch(`${getBase()}/whatsapp/cloud/payment-validations/${payment.id}/ocr`, {
        method: 'POST', headers: { 'x-auth-token': AUTH_TOKEN },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'No fue posible repetir el OCR');
      await load();
    } catch (error) { alert(error.message); }
    finally { setOcrBusyId(null); }
  }

  const pendingValidations = payments.filter(p => p.status === 'pending_validation')
    .sort((a, b) => new Date(b.submittedAt || b.createdAt) - new Date(a.submittedAt || a.createdAt));
  const confirmedPayments = payments.filter(p => p.status !== 'pending_validation' && p.status !== 'rejected');
  const totalPayments = confirmedPayments.reduce((s, p) => s + (p.amount || 0), 0);
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Pagos automáticos</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Laujim toma la notificación bancaria como señal únicamente para el pago del canon. Solo confirma automáticamente una regla aprendida cuyo remitente y valor coincidan; los servicios públicos se consultan por sus portales y no se registran desde SMS.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={loadAutomation} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw className="h-3.5 w-3.5" /> Actualizar</button>
            {watcherStatus?.supported && watcherStatus?.enabled ? (
              <button type="button" onClick={disablePaymentWatcher} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"><BellRing className="h-3.5 w-3.5" /> Captura activa</button>
            ) : (
              <button type="button" onClick={activatePaymentWatcher} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"><Smartphone className="h-3.5 w-3.5" /> Activar en este celular</button>
            )}
          </div>
        </div>

        {watcherStatus?.supported && watcherStatus?.enabled && !watcherStatus?.accessGranted && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span><AlertTriangle className="mr-1 inline h-4 w-4" />Falta conceder acceso a notificaciones de Android.</span><button type="button" onClick={openPaymentWatcherSettings} className="font-bold underline">Abrir configuración</button></div>}
        {watcherStatus && !watcherStatus.supported && <p className="mt-3 text-xs text-slate-500">En la web se pueden revisar y asociar eventos. La captura automática requiere la APK y el permiso de acceso a notificaciones.</p>}
        {automationError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{automationError}</p>}

        <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-700">
          {[['queue', 'Pagos en cola', automation.pending], ['confirmed', 'Confirmados', automation.autoConfirmed], ['rules', 'Reglas aprendidas', automation.rules?.length || 0]].map(([id, label, count]) => <button key={id} type="button" onClick={() => setAutomationTab(id)} className={`rounded-lg px-3 py-2 text-xs font-semibold ${automationTab === id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{label} <span className="ml-1 opacity-70">{count}</span></button>)}
        </div>

        {automationTab === 'queue' && <div className="mt-3 space-y-3">
          {(automation.events || []).filter(event => event.status === 'pending_association').map(event => {
            const candidates = event.candidates || [];
            const selected = associationChoices[event.id] || candidates[0]?.apartmentId || '';
            return <div key={event.id} className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0"><p className="font-semibold text-slate-900 dark:text-white">{formatCurrency(event.amount)} · Canon · {event.provider || 'Origen no identificado'}</p><p className="text-xs text-slate-600 dark:text-slate-300">{event.payerIdentifierMasked || event.payerName || 'Remitente no visible'} · {event.transferChannel === 'llave' ? 'por llave' : event.transferChannel === 'cuenta' ? 'por cuenta' : event.transferChannel === 'otro_banco' ? 'desde otro banco' : 'canal no informado'} · {formatShortDate(event.receivedAt || event.createdAt)}</p><p className="mt-1 text-xs text-amber-800 dark:text-amber-200">No se pudo determinar el apartamento con seguridad.</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={selected} onChange={e => setAssociationChoices(prev => ({ ...prev, [event.id]: e.target.value }))} className="min-w-[170px] rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs text-slate-900 dark:border-amber-800 dark:bg-slate-900 dark:text-white"><option value="">Seleccionar apartamento</option>{apartments.map(apt => <option key={apt.id} value={apt.id}>{apt.name}</option>)}</select>
                  <button type="button" disabled={!selected || automationBusy === `associate-${event.id}`} onClick={() => associateEvent(event.id, Number(selected), true)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Asociar</button>
                  <button type="button" disabled={automationBusy === `dismiss-${event.id}`} onClick={() => dismissEvent(event.id)} className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300"><XCircle className="h-3.5 w-3.5" /> Falsa alarma</button>
                </div>
              </div>
              {candidates.length > 0 && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Coincidencias parciales: {candidates.map(item => item.apartmentName || 'Apartamento').join(', ')}. Se requiere confirmación.</p>}
            </div>;
          })}
          {(automation.events || []).filter(event => event.status === 'pending_association').length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No hay pagos pendientes de asociación.</div>}
        </div>}

        {automationTab === 'confirmed' && <div className="mt-3 space-y-2">{(automation.events || []).filter(event => ['auto_confirmed', 'manually_confirmed'].includes(event.status)).map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/20"><span className="font-medium text-slate-900 dark:text-white">{formatCurrency(event.amount)} · Canon · Apartamento {event.apartmentName || 'asociado'}</span><span className="text-xs text-emerald-700 dark:text-emerald-300">{event.status === 'auto_confirmed' ? 'Confirmado por regla' : 'Confirmado manualmente'} · {formatShortDate(event.receivedAt || event.createdAt)}</span></div>)}{(automation.events || []).filter(event => ['auto_confirmed', 'manually_confirmed'].includes(event.status)).length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Aún no hay pagos confirmados por este flujo.</div>}</div>}

        {automationTab === 'rules' && <div className="mt-3 space-y-2">{(automation.rules || []).map(rule => <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"><span className="text-slate-900 dark:text-white">{rule.provider || 'Origen'} · {rule.identifierMasked || 'identificador protegido'}</span><span className="text-xs text-slate-500 dark:text-slate-400">Canon · Apartamento {apartments.find(apt => Number(apt.id) === Number(rule.apartmentId))?.name || '—'} · {rule.amountMode === 'fixed' ? formatCurrency(rule.amount) : 'canon vigente'}</span></div>)}{(automation.rules || []).length === 0 && <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">Las reglas aparecen después de confirmar un pago y elegir “recordar asociación”.</div>}</div>}
      </section>

      {pendingValidations.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock3 className="w-5 h-5 text-amber-600" />
            <div><h2 className="font-semibold text-amber-950">Comprobantes por validar</h2><p className="text-xs text-amber-800">No se suman al recaudo hasta que los apruebes.</p></div>
          </div>
          <div className="space-y-2">
            {pendingValidations.map(payment => {
              const apt = getApartment(payment.apartmentId);
              const tenant = tenants.find(t => t.id === payment.tenantId);
              const busy = reviewingId === payment.id;
              return <div key={payment.id} className="bg-white border border-amber-100 rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="min-w-0 flex-1"><p className="font-medium text-gray-900">{apt?.name || 'Apartamento'} · {tenant?.name || 'Inquilino'}</p><p className="text-xs text-gray-500">{formatCurrency(payment.amount)} · Corresponde a {payment.period || 'este período'} · Recibido {formatShortDate(payment.submittedAt || payment.createdAt)}</p>{payment.detectedAmount && <p className="mt-1 text-xs text-blue-700">OCR detectó: {formatCurrency(payment.detectedAmount)}{payment.receiptOcr?.provider ? ` · ${payment.receiptOcr.provider}` : ''}{payment.receiptOcr?.reference ? ` · Ref. ${payment.receiptOcr.reference}` : ''}</p>}<p className="mt-1 text-xs text-slate-500">{payment.receiptOcr ? `Lectura del comprobante: ${payment.receiptOcr.status === 'readable' ? `legible (${payment.receiptOcr.confidence}%)` : payment.receiptOcr.status === 'partial' ? `parcial (${payment.receiptOcr.confidence}%)` : 'sin datos suficientes'}. Requiere revisión manual.` : 'Sin lectura OCR disponible.'}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openProof(payment)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-lg hover:bg-gray-50"><Eye className="w-3.5 h-3.5" /> Ver comprobante</button>
                  {payment.receiptOcr && payment.receiptOcr.status !== 'readable' && <button disabled={ocrBusyId === payment.id} onClick={() => retryOcr(payment)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-60"><RefreshCw className={`w-3.5 h-3.5 ${ocrBusyId === payment.id ? 'animate-spin' : ''}`} /> Reintentar OCR</button>}
                  <button disabled={busy} onClick={() => reviewPayment(payment, 'approve')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Aprobar</button>
                  <button disabled={busy} onClick={() => reviewPayment(payment, 'reject')} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"><X className="w-3.5 h-3.5" /> Rechazar</button>
                </div>
              </div>;
            })}
          </div>
        </section>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Apartamento</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Concepto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                <th className="px-4 py-3 w-10"></th>
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
                    <td className="px-4 py-3">{t._type === 'Pago' ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.status === 'pending_validation' ? 'bg-amber-100 text-amber-700' : t.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{t.status === 'pending_validation' ? 'En validación' : t.status === 'rejected' ? 'Rechazado' : 'Aprobado'}</span> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(t.amount)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(t.id, t._type)} className="p-1 text-gray-300 hover:text-red-500 transition-colors" title="Eliminar">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
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
