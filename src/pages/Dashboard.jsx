import { useState, useEffect } from 'react';
import { Building2, Users, DollarSign, CalendarCheck, TrendingUp, Home, AlertTriangle, Clock, Bell, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatsCard from '../components/StatsCard';
import Modal from '../components/Modal';
import { api } from '../api';
import { formatCurrency, formatShortDate, daysUntil, getCurrentPeriod, formatDate } from '../utils/helpers';
import { addCalendarReminder } from '../utils/calendar';
import { notifyPaymentReminder } from '../utils/notifications';

export default function Dashboard() {
  const [stats, setStats] = useState({ totalApts: 0, occupied: 0, vacant: 0, totalTenants: 0, monthlyIncome: 0, pendingPayments: 0, vacantApts: [], upcoming: [], overdue: [] });
  const [monthReport, setMonthReport] = useState({ current: null, previous: null, delays: [] });
  const [showPay, setShowPay] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().split('T')[0] });

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (stats.upcoming.length > 0) {
      stats.upcoming.filter(a => a.daysLeft <= 3).forEach(a => {
        notifyPaymentReminder(a.name, a.daysLeft);
      });
    }
  }, [stats.upcoming]);

  function getDelayDays(paymentDate, dueDay) {
    if (!paymentDate) return 0;
    const d = new Date(paymentDate);
    const payDay = d.getDate();
    return Math.max(0, payDay - dueDay);
  }

  async function loadStats() {
    const [apartments, tenants, contracts, payments, expenses] = await Promise.all([
      api.apartments.toArray(), api.tenants.toArray(), api.contracts.toArray(), api.payments.toArray(), api.expenses.toArray(),
    ]);

    const occupied = apartments.filter(a => a.status === 'occupied').length;
    const vacant = apartments.filter(a => a.status === 'vacant').length;
    const vacantApts = apartments.filter(a => a.status === 'vacant');

    const activeContracts = contracts.filter(c => !c.endDate || new Date(c.endDate) > new Date());
    const monthlyIncome = activeContracts.reduce((sum, c) => sum + (c.monthlyRent || 0), 0);

    const now = new Date();
    const currentDay = now.getDate();
    const thisMonth = now.toISOString().substring(0, 7);
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = prevDate.toISOString().substring(0, 7);

    const paidThisMonth = payments.filter(p => p.date && p.date.startsWith(thisMonth) && p.type === 'rent');
    const expectedPayments = activeContracts.length;
    const pendingPayments = Math.max(0, expectedPayments - paidThisMonth.length);

    const occupiedApts = apartments.filter(a => a.status === 'occupied');
    const currentPeriod = getCurrentPeriod();

    const enriched = occupiedApts.map(a => {
      const { daysLeft, targetDate } = daysUntil(a.paymentDueDay);
      const lastPayment = payments
        .filter(p => p.apartmentId === a.id && p.type === 'rent')
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const paidThisPeriod = !!payments.find(p => p.apartmentId === a.id && p.type === 'rent' && p.date && p.date.startsWith(currentPeriod));
      const contract = activeContracts.find(c => c.apartmentId === a.id);
      return { ...a, daysLeft, targetDate, lastPayment, paidThisPeriod, rent: contract?.monthlyRent || a.monthlyRent };
    });

    const overdue = enriched
      .filter(a => a.paymentDueDay <= currentDay)
      .sort((a, b) => a.paymentDueDay - b.paymentDueDay);

    const upcoming = enriched
      .filter(a => a.paymentDueDay > currentDay)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    setStats({ totalApts: apartments.length, occupied, vacant, totalTenants: tenants.length, monthlyIncome, pendingPayments, vacantApts, upcoming, overdue });

    const currPayments = payments.filter(p => p.date && p.date.startsWith(thisMonth) && p.type === 'rent');
    const prevPayments = payments.filter(p => p.date && p.date.startsWith(prevMonth) && p.type === 'rent');
    const currExpenses = expenses.filter(e => e.date && e.date.startsWith(thisMonth));
    const prevExpenses = expenses.filter(e => e.date && e.date.startsWith(prevMonth));

    const delays = enriched.map(a => {
      const delayDays = a.lastPayment ? getDelayDays(a.lastPayment.date, a.paymentDueDay) : null;
      return { ...a, delayDays, lastPaymentDate: a.lastPayment?.date || null };
    });

    setMonthReport({
      current: {
        label: now.toLocaleString('es-CO', { month: 'long', year: 'numeric' }),
        payments: currPayments.reduce((s, p) => s + (p.amount || 0), 0),
        expense: currExpenses.reduce((s, e) => s + (e.amount || 0), 0),
        unexpected: currExpenses.filter(e => e.isUnexpected).reduce((s, e) => s + (e.amount || 0), 0),
        count: currPayments.length,
      },
      previous: {
        label: prevDate.toLocaleString('es-CO', { month: 'long', year: 'numeric' }),
        payments: prevPayments.reduce((s, p) => s + (p.amount || 0), 0),
        expense: prevExpenses.reduce((s, e) => s + (e.amount || 0), 0),
        unexpected: prevExpenses.filter(e => e.isUnexpected).reduce((s, e) => s + (e.amount || 0), 0),
        count: prevPayments.length,
      },
      delays,
    });
  }

  async function handleQuickPay(e) {
    e.preventDefault();
    if (!showPay) return;
    await api.payments.add({
      apartmentId: showPay.id,
      contractId: null,
      amount: Number(payForm.amount),
      date: payForm.date,
      type: 'rent',
      paymentMode: 'full',
      description: `Pago de arriendo - ${showPay.name}`,
      createdAt: new Date().toISOString(),
    });
    setShowPay(null);
    setPayForm({ amount: '', date: new Date().toISOString().split('T')[0] });
    loadStats();
  }

  function formatTargetDate(date) {
    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'long' });
  }

  function getOverdueLabel(daysLeft, paymentDueDay) {
    if (daysLeft > 0) return { text: 'Al día', cls: 'text-emerald-600' };
    const overdue = Math.abs(daysLeft);
    if (overdue === 0) return { text: 'Vence hoy', cls: 'text-amber-600 font-medium' };
    if (overdue <= 3) return { text: `${overdue} día(s) de atraso`, cls: 'text-red-600 font-medium' };
    return { text: `${overdue} día(s) de atraso`, cls: 'text-red-700 font-bold' };
  }

  const overdueCount = stats.overdue.filter(a => !a.paidThisPeriod).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 mt-1">Resumen general de tu conjunto residencial</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Apartamentos" value={`${stats.occupied}/${stats.totalApts}`} subtitle={`${stats.vacant} disponibles`} icon={Building2} color="blue" />
        <StatsCard title="Inquilinos" value={stats.totalTenants} subtitle="Activos" icon={Users} color="green" />
        <StatsCard title="Ingreso Mensual" value={formatCurrency(stats.monthlyIncome)} subtitle="De arriendos activos" icon={DollarSign} color="purple" />
        <StatsCard title="Pagos Pendientes" value={stats.pendingPayments} subtitle="Este mes" icon={CalendarCheck} color={stats.pendingPayments > 0 ? 'amber' : 'green'} />
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
            Ya deberían estar pagos
            <span className="text-sm font-normal text-gray-400">({overdueCount} pendiente(s))</span>
          </h3>
          <div className="space-y-2">
            {stats.overdue.map(a => {
              const label = getOverdueLabel(a.daysLeft, a.paymentDueDay);
              return (
                <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${a.paidThisPeriod ? 'bg-emerald-50 border border-emerald-200' : a.daysLeft < 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200'}`}>
                  <div className="flex items-center gap-3 flex-1">
                    <Link to={`/apartments/${a.id}`} className="font-medium text-gray-900 hover:underline">{a.name}</Link>
                    {a.paidThisPeriod ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                        <CheckCircle2 className="w-3 h-3" /> Pagado
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${label.cls}`}>{label.text}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Vence día {a.paymentDueDay} · {formatCurrency(a.rent)}</span>
                    {!a.paidThisPeriod && (
                      <button onClick={() => { setShowPay(a); setPayForm({ amount: String(a.rent), date: new Date().toISOString().split('T')[0] }); }} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors">
                        Pagar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.upcoming.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Próximos Pagos</h3>
          <div className="space-y-2">
            {stats.upcoming.map(a => (
              <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${a.daysLeft <= 1 ? 'bg-red-50' : a.daysLeft <= 5 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <Link to={`/apartments/${a.id}`} className="flex-1 font-medium text-gray-900 hover:underline">{a.name}</Link>
                <div className="flex items-center gap-2">
                  <button onClick={() => addCalendarReminder(a.name, a.paymentDueDay)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Agregar recordatorio al calendario">
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                  <span className={`font-bold ${a.daysLeft <= 1 ? 'text-red-700' : a.daysLeft <= 5 ? 'text-amber-700' : 'text-gray-600'}`}>
                    {a.daysLeft === 0 ? '¡Hoy!' : a.daysLeft === 1 ? 'Mañana' : `${a.daysLeft} días`}
                  </span>
                  <span className="text-xs text-gray-400">({formatTargetDate(a.targetDate)})</span>
                  <button onClick={() => { setShowPay(a); setPayForm({ amount: String(a.rent), date: new Date().toISOString().split('T')[0] }); }} className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
                    Pagar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {monthReport.current && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Comparativa Mensual</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-blue-700 uppercase">{monthReport.current.label}</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-blue-600">Pagos:</span><strong className="text-blue-900">{formatCurrency(monthReport.current.payments)} ({monthReport.current.count})</strong></div>
                <div className="flex justify-between"><span className="text-blue-600">Gastos:</span><strong className="text-red-600">{formatCurrency(monthReport.current.expense)}</strong></div>
                {monthReport.current.unexpected > 0 && <div className="flex justify-between"><span className="text-blue-600">Imprevistos:</span><strong className="text-red-700">{formatCurrency(monthReport.current.unexpected)}</strong></div>}
                <div className="flex justify-between pt-1 border-t border-blue-200"><span className="text-blue-600 font-medium">Neto:</span><strong className={monthReport.current.payments - monthReport.current.expense >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(monthReport.current.payments - monthReport.current.expense)}</strong></div>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-xs font-medium text-gray-600 uppercase">{monthReport.previous.label}</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Pagos:</span><strong className="text-gray-900">{formatCurrency(monthReport.previous.payments)} ({monthReport.previous.count})</strong></div>
                <div className="flex justify-between"><span className="text-gray-600">Gastos:</span><strong className="text-red-600">{formatCurrency(monthReport.previous.expense)}</strong></div>
                {monthReport.previous.unexpected > 0 && <div className="flex justify-between"><span className="text-gray-600">Imprevistos:</span><strong className="text-red-700">{formatCurrency(monthReport.previous.unexpected)}</strong></div>}
                <div className="flex justify-between pt-1 border-t border-gray-200"><span className="text-gray-600 font-medium">Neto:</span><strong className={monthReport.previous.payments - monthReport.previous.expense >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(monthReport.previous.payments - monthReport.previous.expense)}</strong></div>
              </div>
            </div>
          </div>
          {monthReport.delays.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Días de demora por apartamento</h4>
              <div className="space-y-1">
                {monthReport.delays.map(d => (
                  <div key={d.id} className="flex items-center justify-between py-1 text-sm">
                    <span className="text-gray-700">{d.name}</span>
                    <span className={d.delayDays === null ? 'text-gray-400' : d.delayDays > 0 ? 'text-red-600 font-medium' : 'text-emerald-600'}>
                      {d.delayDays === null ? 'Sin pagos' : d.delayDays === 0 ? 'Al día' : `${d.delayDays} día(s) de retraso`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Modal open={!!showPay} onClose={() => setShowPay(null)} title={`Registrar Pago - ${showPay?.name || ''}`}>
        <form onSubmit={handleQuickPay} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto *</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm({...payForm, amount: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de Pago *</label>
            <input type="date" value={payForm.date} onChange={e => setPayForm({...payForm, date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowPay(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">Confirmar Pago</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
