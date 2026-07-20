import { useState, useEffect } from 'react';
import { Building2, Users, DollarSign, CalendarCheck, TrendingUp, Home, AlertTriangle, Clock, Bell, ArrowUpDown, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import StatsCard from '../components/StatsCard';
import { api } from '../api';
import { formatCurrency, daysUntil } from '../utils/helpers';
import { addCalendarReminder } from '../utils/calendar';
import { notifyPaymentReminder } from '../utils/notifications';

export default function Dashboard() {
  const [stats, setStats] = useState({ totalApts: 0, occupied: 0, vacant: 0, totalTenants: 0, monthlyIncome: 0, pendingPayments: 0, vacantApts: [], apartmentsWithDays: [] });
  const [monthReport, setMonthReport] = useState({ current: null, previous: null, delays: [] });

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (stats.apartmentsWithDays.length > 0) {
      const activeIds = stats.apartmentsWithDays.map(a => a.id);
      stats.apartmentsWithDays.filter(a => a.daysLeft <= 3).forEach(a => {
        notifyPaymentReminder(a.name, a.daysLeft);
      });
    }
  }, [stats.apartmentsWithDays]);

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
    const thisMonth = now.toISOString().substring(0, 7);
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = prevDate.toISOString().substring(0, 7);

    const paidThisMonth = payments.filter(p => p.date && p.date.startsWith(thisMonth) && p.type === 'rent');
    const expectedPayments = activeContracts.length;
    const pendingPayments = Math.max(0, expectedPayments - paidThisMonth.length);

    const apartmentsWithDays = apartments.filter(a => a.status === 'occupied').map(a => ({ ...a, ...daysUntil(a.paymentDueDay) })).sort((a, b) => a.daysLeft - b.daysLeft);

    setStats({ totalApts: apartments.length, occupied, vacant, totalTenants: tenants.length, monthlyIncome, pendingPayments, vacantApts, apartmentsWithDays });

    const currPayments = payments.filter(p => p.date && p.date.startsWith(thisMonth) && p.type === 'rent');
    const prevPayments = payments.filter(p => p.date && p.date.startsWith(prevMonth) && p.type === 'rent');
    const currExpenses = expenses.filter(e => e.date && e.date.startsWith(thisMonth));
    const prevExpenses = expenses.filter(e => e.date && e.date.startsWith(prevMonth));

    const delays = apartmentsWithDays.map(a => {
      const lastPayment = payments
        .filter(p => p.apartmentId === a.id && p.type === 'rent')
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      const delayDays = lastPayment ? getDelayDays(lastPayment.date, a.paymentDueDay) : null;
      return { ...a, delayDays, lastPaymentDate: lastPayment?.date || null };
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Ocupación</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="#e5e7eb" strokeWidth="3" />
                <circle cx="18" cy="18" r="16" fill="none" stroke={stats.totalApts > 0 ? '#3b82f6' : '#e5e7eb'} strokeWidth="3" strokeDasharray={`${(stats.occupied / stats.totalApts) * 100} ${100 - (stats.occupied / stats.totalApts) * 100}`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-gray-900 dark:text-white">{stats.totalApts > 0 ? Math.round((stats.occupied / stats.totalApts) * 100) : 0}%</span>
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
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-gray-600 dark:text-gray-400">Ingreso: <strong className="text-gray-900 dark:text-white">{formatCurrency(stats.monthlyIncome)}</strong></span>
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

      {monthReport.current && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><ArrowUpDown className="w-4 h-4" /> Comparativa Mensual</h3>
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

      {stats.apartmentsWithDays.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Clock className="w-4 h-4" /> Próximos Pagos</h3>
          <div className="space-y-2">
            {stats.apartmentsWithDays.map(a => (
              <div key={a.id} className={`flex items-center justify-between p-3 rounded-lg text-sm transition-colors ${a.daysLeft <= 1 ? 'bg-red-50' : a.daysLeft <= 5 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <Link to={`/apartments/${a.id}`} className="flex-1 font-medium text-gray-900 hover:underline">{a.name}</Link>
                <div className="flex items-center gap-2">
                  <button onClick={() => addCalendarReminder(a.name, a.paymentDueDay)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors" title="Agregar recordatorio al calendario">
                    <Bell className="w-3.5 h-3.5" />
                  </button>
                  <span className={`font-bold ${a.daysLeft <= 1 ? 'text-red-700' : a.daysLeft <= 5 ? 'text-amber-700' : 'text-gray-600'}`}>
                    {a.daysLeft === 0 ? '¡Hoy!' : a.daysLeft === 1 ? 'Mañana' : `${a.daysLeft} días`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
