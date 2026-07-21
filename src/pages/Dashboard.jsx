import { useState, useEffect } from 'react';
import { Building2, Users, DollarSign, CalendarCheck, TrendingUp, Home, AlertTriangle, Clock, Bell, AlertCircle, CheckCircle2, XCircle, Plus, Trash2, AlertOctagon } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatsCard from '../components/StatsCard';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate, daysUntil, getCurrentPeriod, getPeriodLabel, nextPeriod, formatRelativeDueDate } from '../utils/helpers';
import { addCalendarReminder } from '../utils/calendar';
import { notifyPaymentReminder } from '../utils/notifications';

export default function Dashboard() {
  const [stats, setStats] = useState({ totalApts: 0, occupied: 0, vacant: 0, totalTenants: 0, monthlyIncome: 0, expectedIncome: 0, collectedIncome: 0, pendingPayments: 0, vacantApts: [], overdue: [], thisMonthMissing: [], nextMonthMissing: [] });
  const [showPay, setShowPay] = useState(null);
  const [payStep, setPayStep] = useState('period');
  const [payPeriod, setPayPeriod] = useState(getCurrentPeriod());
  const [payForm, setPayForm] = useState({ amount: '', date: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showExpense, setShowExpense] = useState(null);
  const [expenseForm, setExpenseForm] = useState({ amount: '', date: new Date().toISOString().split('T')[0], description: '', category: 'Mantenimiento', isUnexpected: true });

  const expenseCategories = ['Mantenimiento', 'Reparación', 'Limpieza', 'Impuesto', 'Seguro', 'Adecuación', 'Otro'];

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    const [apartments, tenants, contracts, payments, expenses] = await Promise.all([
      api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray(), api.payments.toArray(), api.expenses.toArray(),
    ]);

    const occupied = apartments.filter(a => a.status === 'occupied').length;
    const vacant = apartments.filter(a => a.status === 'vacant').length;
    const vacantApts = apartments.filter(a => a.status === 'vacant');

    const activeContracts = contracts.filter(c => !c.endDate || new Date(c.endDate) > new Date());
    const expectedIncome = activeContracts.reduce((sum, c) => sum + (c.monthlyRent || 0), 0);

    const now = new Date();
    const currentDay = now.getDate();
    const thisMonth = now.toISOString().substring(0, 7);

    const paidThisMonth = payments.filter(p => p.date && p.date.startsWith(thisMonth) && p.type === 'rent');
    const collectedThisMonth = paidThisMonth.reduce((s, p) => s + (p.amount || 0), 0);
    const collectedTotal = payments.filter(p => p.type === 'rent').reduce((s, p) => s + (p.amount || 0), 0);
    const pendingPayments = Math.max(0, activeContracts.length - paidThisMonth.length);

    const occupiedApts = apartments.filter(a => a.status === 'occupied');
    const currentPeriod = getCurrentPeriod();

    const enriched = occupiedApts.map(a => {
      const { daysLeft, targetDate } = daysUntil(a.paymentDueDay);
      const lastPayment = payments
        .filter(p => p.apartmentId === a.id && p.type === 'rent')
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const periodPayment = payments.find(p => p.apartmentId === a.id && p.type === 'rent' && p.date && p.date.startsWith(currentPeriod));
      const paidThisPeriod = !!periodPayment;
      const contract = activeContracts.find(c => c.apartmentId === a.id);
      const tenant = contract ? tenants.find(t => t.id === contract.tenantId) : null;
      return { ...a, daysLeft, targetDate, lastPayment, periodPayment, paidThisPeriod, rent: contract?.monthlyRent || a.monthlyRent, tenant, contract };
    });

    const overdue = enriched
      .filter(a => a.paymentDueDay <= currentDay)
      .sort((a, b) => Math.abs(a.daysLeft) - Math.abs(b.daysLeft));

    const thisMonthMissing = enriched
      .filter(a => a.paymentDueDay > currentDay)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const nextMonthMissing = occupiedApts.map(a => {
      const contract = activeContracts.find(c => c.apartmentId === a.id);
      return { ...a, rent: contract?.monthlyRent || a.monthlyRent };
    }).sort((a, b) => (a.paymentDueDay || 30) - (b.paymentDueDay || 30));

    setStats({ totalApts: apartments.length, occupied, vacant, totalTenants: tenants.length, monthlyIncome: expectedIncome, expectedIncome, collectedIncome: collectedTotal, collectedThisMonth, pendingPayments, vacantApts, overdue, thisMonthMissing, nextMonthMissing });
  }

  function openPayModal(apt) {
    setShowPay(apt);
    setPayStep('period');
    setPayPeriod(getCurrentPeriod());
    setPayForm({ amount: String(apt.rent), date: '' });
  }

  function handlePeriodSelect(period) {
    setPayPeriod(period);
    setPayStep('type');
  }

  function handlePayOnTime() {
    const apt = showPay;
    if (!apt) return;
    const targetDate = new Date();
    targetDate.setDate(apt.paymentDueDay);
    if (targetDate > new Date()) targetDate.setMonth(targetDate.getMonth() - 1);
    setPayForm({ ...payForm, date: targetDate.toISOString().split('T')[0] });
    setPayStep('confirm');
  }

  function handlePayToday() {
    setPayForm({ ...payForm, date: new Date().toISOString().split('T')[0] });
    setPayStep('confirm');
  }

  function handlePayManual() {
    setPayStep('manualDate');
  }

  function handleManualDateSubmit() {
    if (!payForm.date) return;
    setPayStep('confirm');
  }

  async function handleConfirmPay(e) {
    e.preventDefault();
    if (!showPay) return;
    await api.payments.add({
      apartmentId: showPay.id,
      contractId: null,
      amount: Number(payForm.amount),
      date: payForm.date,
      period: payPeriod,
      type: 'rent',
      paymentMode: 'full',
      description: `Pago de arriendo - ${showPay.name} (${getPeriodLabel(payPeriod)})`,
      createdAt: new Date().toISOString(),
    });
    setShowPay(null);
    setPayStep('period');
    setPayForm({ amount: '', date: '' });
    loadStats();
  }

  async function handleDeletePayment(paymentId) {
    await api.payments.delete(paymentId);
    setConfirmDelete(null);
    loadStats();
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    if (!showExpense) return;
    await api.expenses.add({
      apartmentId: showExpense.id,
      amount: Number(expenseForm.amount),
      date: expenseForm.date,
      category: expenseForm.category || 'Otro',
      description: expenseForm.description || `Gasto - ${showExpense.name}`,
      isUnexpected: expenseForm.isUnexpected,
      createdAt: new Date().toISOString(),
    });
    setShowExpense(null);
    setExpenseForm({ amount: '', date: new Date().toISOString().split('T')[0], description: '', category: 'Mantenimiento', isUnexpected: true });
    loadStats();
  }

  const overdueCount = stats.overdue.filter(a => !a.paidThisPeriod).length;
  const monthlyCollectionRate = stats.expectedIncome > 0 ? Math.round((stats.collectedThisMonth / stats.expectedIncome) * 100) : 0;
  const occupancyRate = stats.totalApts > 0 ? Math.round((stats.occupied / stats.totalApts) * 100) : 0;

  const now = new Date();
  const currentMonthLabel = now.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthLabel = nextMonthDate.toLocaleString('es-CO', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 mt-1">Resumen general de tu conjunto residencial</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Apartamentos" value={`${stats.occupied}/${stats.totalApts}`} subtitle={`${stats.vacant} disponibles`} icon={Building2} color="blue" />
        <StatsCard title="Inquilinos" value={stats.totalTenants} subtitle="Activos" icon={Users} color="green" />
        <StatsCard title="Ingreso Máximo Esperado" value={formatCurrency(stats.expectedIncome)} subtitle="Canones activos" icon={DollarSign} color="purple" />
        <StatsCard title="Recolectado Total" value={formatCurrency(stats.collectedIncome)} subtitle={`${formatCurrency(stats.collectedThisMonth)} este mes / ${formatCurrency(stats.expectedIncome)} esperado`} icon={TrendingUp} color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Ocupación</h3>
          <div className="flex items-center gap-6">
            <div className="relative w-28 h-28">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray={`${occupancyRate} ${100 - occupancyRate}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-900 dark:text-white">{occupancyRate}%</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-gray-600 dark:text-gray-400">Ocupados: <strong className="text-gray-900 dark:text-white">{stats.occupied}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span className="text-gray-600 dark:text-gray-400">Vacantes: <strong className="text-gray-900 dark:text-white">{stats.vacant}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-gray-600 dark:text-gray-400">Total recaudado: <strong className="text-gray-900 dark:text-white">{formatCurrency(stats.collectedIncome)}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-gray-600 dark:text-gray-400">Este mes: <strong className="text-gray-900 dark:text-white">{formatCurrency(stats.collectedThisMonth)}</strong> / {formatCurrency(stats.expectedIncome)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Acciones Rápidas</h3>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/apartments" className="p-3 bg-blue-50 rounded-lg text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors text-center">Ver Apartamentos</Link>
            <Link to="/payments" className="p-3 bg-emerald-50 rounded-lg text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors text-center">Registrar Pago</Link>
            <Link to="/tenants" className="p-3 bg-purple-50 rounded-lg text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors text-center">Gestionar Inquilinos</Link>
            <Link to="/reports" className="p-3 bg-amber-50 rounded-lg text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors text-center">Ver Reportes</Link>
          </div>
        </div>
      </div>

      {stats.vacant > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-amber-800">Apartamentos Vacantes</h3>
              <p className="text-amber-700 text-sm mt-1">
                Hay {stats.vacant} apartamento(s) sin inquilino. {stats.vacant > 0 && `Posible pérdida de ~${formatCurrency(stats.vacant * 800000)}/mes.`}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {stats.vacantApts.map(apt => (
                  <Link key={apt.id} to={`/apartments/${apt.id}`} className="inline-flex items-center gap-1 px-3 py-1.5 bg-white rounded-lg text-sm text-amber-700 border border-amber-300 hover:bg-amber-100 transition-colors">
                    <Home className="w-3.5 h-3.5" />
                    {apt.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {overdueCount > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            Ya deberían estar pagos — {currentMonthLabel}
            <span className="text-sm font-normal text-gray-400">({overdueCount} pendiente(s))</span>
          </h3>
          <div className="space-y-2">
            {stats.overdue.map(a => {
              const isPaid = a.paidThisPeriod;
              const payment = a.periodPayment;
              return (
                <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${isPaid ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                  <div className="flex items-center gap-3 flex-1">
                    <Link to={`/apartments/${a.id}`} className="font-medium text-gray-900 hover:underline">{a.name}</Link>
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Pagado {payment ? formatShortDate(payment.date) : ''}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">
                        <XCircle className="w-3 h-3" /> Atrasado
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{formatRelativeDueDate(a.paymentDueDay)} · {formatCurrency(a.rent)}</span>
                    {a.tenant?.phone && (
                      <>
                        <a href={`https://wa.me/${a.tenant.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                          WhatsApp
                        </a>
                        <a href={`tel:${a.tenant.phone}`} className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                          Llamar
                        </a>
                      </>
                    )}
                    {isPaid && payment && (
                      <button onClick={() => setConfirmDelete(payment)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Eliminar pago">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {!isPaid && (
                      <button onClick={() => openPayModal(a)} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">
                        Pagar
                      </button>
                    )}
                    <button onClick={() => { setShowExpense(a); }} className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-1" title="Agregar gasto imprevisto">
                      <AlertOctagon className="w-3 h-3" /> Imprevistos
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.thisMonthMissing.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-500" />
            Este mes faltan — {currentMonthLabel}
          </h3>
          <div className="space-y-2">
            {stats.thisMonthMissing.map(a => (
              <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${a.daysLeft <= 1 ? 'bg-red-50' : a.daysLeft <= 5 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <Link to={`/apartments/${a.id}`} className="flex-1 font-medium text-gray-900 hover:underline">{a.name}</Link>
                <div className="flex items-center gap-2">
                  <button onClick={() => addCalendarReminder(a.name, a.paymentDueDay)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Recordatorio">
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                  {a.tenant?.phone && (
                    <>
                      <a href={`https://wa.me/${a.tenant.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="px-2 py-1 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                        WhatsApp
                      </a>
                      <a href={`tel:${a.tenant.phone}`} className="px-2 py-1 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                        Llamar
                      </a>
                    </>
                  )}
                  <span className="text-xs text-gray-400">{formatRelativeDueDate(a.paymentDueDay)}</span>
                  <span className="font-medium text-gray-700">{formatCurrency(a.rent)}</span>
                  <button onClick={() => openPayModal(a)} className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                    Pagar
                  </button>
                  <button onClick={() => { setShowExpense(a); }} className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-1" title="Agregar gasto imprevisto">
                    <AlertOctagon className="w-3 h-3" /> Imprevistos
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.nextMonthMissing.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-purple-500" />
            Para el próximo mes faltan — {nextMonthLabel}
          </h3>
          <div className="space-y-2">
            {stats.nextMonthMissing.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg text-sm bg-gray-50">
                <Link to={`/apartments/${a.id}`} className="flex-1 font-medium text-gray-900 hover:underline">{a.name}</Link>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Vence día {a.paymentDueDay}</span>
                  <span className="font-medium text-gray-700">{formatCurrency(a.rent)}</span>
                  <button onClick={() => openPayModal(a)} className="px-2.5 py-1 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors" title="Pagar por adelantado">
                    Pagar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Select period */}
      <Modal open={!!showPay && payStep === 'period'} onClose={() => { setShowPay(null); setPayStep('period'); }} title={`Pago — ${showPay?.name || ''}`}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">¿A qué período corresponde este pago?</p>
          <button onClick={() => handlePeriodSelect(getCurrentPeriod())} className="w-full p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 font-medium hover:bg-blue-100 transition-colors text-left">
            <CalendarCheck className="w-5 h-5 mb-1" />
            Mes actual: {currentMonthLabel}
            <p className="text-xs text-blue-500 font-normal mt-0.5">Vence día {showPay?.paymentDueDay} — {formatCurrency(showPay?.rent || 0)}</p>
          </button>
          <button onClick={() => handlePeriodSelect(nextPeriod(getCurrentPeriod()))} className="w-full p-4 bg-purple-50 border border-purple-200 rounded-xl text-sm text-purple-700 font-medium hover:bg-purple-100 transition-colors text-left">
            <CalendarCheck className="w-5 h-5 mb-1" />
            Próximo mes: {nextMonthLabel}
            <p className="text-xs text-purple-500 font-normal mt-0.5">Vence día {showPay?.paymentDueDay} — {formatCurrency(showPay?.rent || 0)}</p>
          </button>
        </div>
      </Modal>

      {/* Step 2: Payment type */}
      <Modal open={!!showPay && payStep === 'type'} onClose={() => { setShowPay(null); setPayStep('period'); }} title={`Pago — ${showPay?.name || ''} (${getPeriodLabel(payPeriod)})`}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">¿Cómo quieres registrar este pago?</p>
          <button onClick={handlePayOnTime} className="w-full p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 font-medium hover:bg-blue-100 transition-colors text-left">
            <CheckCircle2 className="w-5 h-5 mb-1" />
            Pagó puntual
            <p className="text-xs text-blue-500 font-normal mt-0.5">Ya había pagado en la fecha de vencimiento y olvidé registrar</p>
          </button>
          <button onClick={handlePayToday} className="w-full p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-medium hover:bg-emerald-100 transition-colors text-left">
            <Clock className="w-5 h-5 mb-1" />
            Pagó hoy
            <p className="text-xs text-emerald-500 font-normal mt-0.5">Está pagando hoy, registrar fecha actual</p>
          </button>
          <button onClick={handlePayManual} className="w-full p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 font-medium hover:bg-amber-100 transition-colors text-left">
            <CalendarCheck className="w-5 h-5 mb-1" />
            Otra fecha
            <p className="text-xs text-amber-500 font-normal mt-0.5">Elegir una fecha manualmente</p>
          </button>
        </div>
      </Modal>

      {/* Step 2b: Manual date */}
      <Modal open={!!showPay && payStep === 'manualDate'} onClose={() => setPayStep('type')} title={`Fecha manual — ${showPay?.name || ''}`}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de pago *</label>
            <input type="date" value={payForm.date} onChange={e => setPayForm({...payForm, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setPayStep('type')} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Atrás</button>
            <button onClick={handleManualDateSubmit} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors" disabled={!payForm.date}>Continuar</button>
          </div>
        </div>
      </Modal>

      {/* Step 3: Confirm */}
      <Modal open={!!showPay && payStep === 'confirm'} onClose={() => { setShowPay(null); setPayStep('period'); }} title="Confirmar Pago">
        <form onSubmit={handleConfirmPay} className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Apartamento:</span><strong>{showPay?.name}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Período:</span><strong>{getPeriodLabel(payPeriod)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Fecha:</span><strong>{formatShortDate(payForm.date)}</strong></div>
            <div className="flex justify-between"><span className="text-gray-500">Monto:</span><strong>{formatCurrency(Number(payForm.amount))}</strong></div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input type="date" value={payForm.date} onChange={e => setPayForm({...payForm, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setPayStep('type')} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Atrás</button>
            <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">Confirmar Pago</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar Pago">
        <p className="text-sm text-gray-600 mb-4">¿Estás seguro de eliminar este pago? Esta acción no se puede deshacer.</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={() => handleDeletePayment(confirmDelete.id)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Eliminar</button>
        </div>
      </Modal>

      <Modal open={!!showExpense} onClose={() => { setShowExpense(null); setExpenseForm({ amount: '', date: '', description: '', category: 'Mantenimiento', isUnexpected: false }); }} title={`Imprevisto - ${showExpense?.name || ''}`}>
        <form onSubmit={handleAddExpense} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
            <select value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder={`Gasto - ${showExpense?.name || ''}`} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto *</label>
              <input type="number" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha *</label>
              <input type="date" value={expenseForm.date} onChange={e => setExpenseForm({...expenseForm, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isUnexpected" checked={expenseForm.isUnexpected} onChange={e => setExpenseForm({...expenseForm, isUnexpected: e.target.checked})} className="rounded border-gray-300" />
            <label htmlFor="isUnexpected" className="text-sm text-gray-700">Es imprevisto</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setShowExpense(null); setExpenseForm({ amount: '', date: '', description: '', category: 'Mantenimiento', isUnexpected: true }); }} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Registrar Imprevisto</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
