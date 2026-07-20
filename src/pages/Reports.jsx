import { useState, useEffect } from 'react';
import { TrendingUp, CalendarDays, DollarSign, Clock, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { api } from '../api';
import { formatCurrency, getMonthName, getCurrentPeriod } from '../utils/helpers';

export default function Reports() {
  const [apartments, setApartments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => { load(); }, []);

  async function load() {
    const [a, p, e, c, v] = await Promise.all([
      api.apartments.toArray(), api.payments.toArray(), api.expenses.toArray(),
      api.contracts.toArray(), api.vacancies.toArray(),
    ]);
    setApartments(a); setPayments(p); setExpenses(e); setContracts(c); setVacancies(v);
  }

  const paymentsThisYear = payments.filter(p => p.date && p.date.startsWith(String(year)));
  const expensesThisYear = expenses.filter(e => e.date && e.date.startsWith(String(year)));

  const monthlyIncome = Array.from({length: 12}, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const total = paymentsThisYear.filter(p => p.date?.substring(5, 7) === m && p.type === 'rent').reduce((s, p) => s + (p.amount || 0), 0);
    const count = paymentsThisYear.filter(p => p.date?.substring(5, 7) === m && p.type === 'rent').length;
    return { month: getMonthName(i + 1), income: total, count };
  });

  const monthlyExpenses = Array.from({length: 12}, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const total = expensesThisYear.filter(e => e.date?.substring(5, 7) === m).reduce((s, e) => s + (e.amount || 0), 0);
    const count = expensesThisYear.filter(e => e.date?.substring(5, 7) === m).length;
    return { month: getMonthName(i + 1), expenses: total, count };
  });

  const monthlyNeto = monthlyIncome.map((mi, i) => ({
    month: mi.month.substring(0, 3),
    Ingresos: mi.income,
    Gastos: monthlyExpenses[i].expenses,
    Neto: mi.income - monthlyExpenses[i].expenses,
  }));

  const monthlyDelay = Array.from({length: 12}, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const monthPayments = paymentsThisYear.filter(p => p.date?.substring(5, 7) === m && p.type === 'rent');
    const tempDate = new Date(year, i, 1);
    const monthName = tempDate.toLocaleString('es-CO', { month: 'short' });

    let totalDelayDays = 0;
    let paymentCount = 0;
    monthPayments.forEach(p => {
      const apt = apartments.find(a => a.id === p.apartmentId);
      if (apt && apt.paymentDueDay) {
        const payDate = new Date(p.date);
        const delay = Math.max(0, payDate.getDate() - apt.paymentDueDay);
        totalDelayDays += delay;
        paymentCount++;
      }
    });

    return {
      month: monthName,
      avgDelay: paymentCount > 0 ? Math.round(totalDelayDays / paymentCount) : 0,
      totalDelay: totalDelayDays,
      payments: paymentCount,
    };
  });

  const totalIncome = paymentsThisYear.reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = expensesThisYear.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalIncome - totalExpenses;

  const occupied = apartments.filter(a => a.status === 'occupied').length;
  const occupancyRate = apartments.length > 0 ? (occupied / apartments.length * 100) : 0;

  const currentPeriod = getCurrentPeriod();
  const expectedMonthlyIncome = contracts
    .filter(c => !c.endDate || new Date(c.endDate) > new Date())
    .reduce((sum, c) => sum + (c.monthlyRent || 0), 0);

  const totalPotentialYear = expectedMonthlyIncome * 12;

  const vacantDays = vacancies.reduce((total, v) => {
    const start = new Date(v.startDate);
    const end = v.endDate ? new Date(v.endDate) : new Date();
    return total + Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
  }, 0);

  const expectedPayments = occupied * 12;
  const actualPayments = paymentsThisYear.filter(p => p.type === 'rent').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reportes</h1>
          <p className="text-gray-500 mt-1">Rentabilidad y estadísticas del año {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors">&lt;</button>
          <span className="px-4 py-1.5 bg-gray-100 rounded-lg text-sm font-medium">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors">&gt;</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Ingresos Totales</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{formatCurrency(totalIncome)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Gastos Totales</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Ganancia Neta</p>
          <p className={`text-2xl font-bold mt-1 ${netProfit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(netProfit)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Tasa de Ocupación</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{occupancyRate.toFixed(0)}%</p>
          <p className="text-xs text-gray-400">{occupied}/{apartments.length} aptos ocupados</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium uppercase">Potencial Anual</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">{formatCurrency(totalPotentialYear)}</p>
          <p className="text-xs text-gray-400">{actualPayments}/{expectedPayments} pagos recibidos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Ingresos por Mes</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyIncome}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Ingresos" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-gray-500">
            {monthlyIncome.filter(m => m.income > 0).slice(0, 4).map(m => (
              <div key={m.month} className="p-2 bg-emerald-50 rounded"><strong className="text-emerald-700 block">{formatCurrency(m.income)}</strong>{m.month}</div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Gastos por Mes</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyExpenses}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} name="Gastos" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs text-gray-500">
            {monthlyExpenses.filter(m => m.expenses > 0).slice(0, 4).map(m => (
              <div key={m.month} className="p-2 bg-red-50 rounded"><strong className="text-red-700 block">{formatCurrency(m.expenses)}</strong>{m.month}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Ingresos vs Gastos Mensuales</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyNeto}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v / 1000000).toFixed(1)}M`} />
              <Tooltip formatter={v => formatCurrency(v)} />
              <Bar dataKey="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Gastos" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Clock className="w-4 h-4" /> Días de Retraso Promedio por Mes</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyDelay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v, name) => name === 'avgDelay' ? [`${v} días`, 'Promedio'] : [v, name === 'totalDelay' ? 'Total días' : 'Cantidad']} />
              <Line type="monotone" dataKey="avgDelay" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="avgDelay" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-6 gap-2 text-center text-xs text-gray-500">
            {monthlyDelay.filter(m => m.payments > 0).map(m => (
              <div key={m.month} className="p-2 bg-amber-50 rounded">
                <strong className="text-amber-700 block">{m.avgDelay} días</strong>
                {m.month}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Detalle de Retrasos por Apartamento</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-600">Apto</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Pagos</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Retraso Prom.</th>
                  <th className="text-center px-3 py-2 font-medium text-gray-600">Retraso Total</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-600">Recaudado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {apartments.filter(a => a.status === 'occupied').map(apt => {
                  const aptPayments = paymentsThisYear.filter(p => p.apartmentId === apt.id && p.type === 'rent');
                  const totalDelay = aptPayments.reduce((s, p) => {
                    const delay = Math.max(0, new Date(p.date).getDate() - (apt.paymentDueDay || 15));
                    return s + delay;
                  }, 0);
                  const avgDelay = aptPayments.length > 0 ? Math.round(totalDelay / aptPayments.length) : 0;
                  const income = aptPayments.reduce((s, p) => s + (p.amount || 0), 0);
                  return (
                    <tr key={apt.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900 font-medium">{apt.name}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{aptPayments.length}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${avgDelay === 0 ? 'bg-emerald-100 text-emerald-700' : avgDelay <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          {avgDelay} días
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-600">{totalDelay} días</td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-600">{formatCurrency(income)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Resumen de Vacancias</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Días totales desocupados:</span>
              <strong>{vacantDays} días</strong>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Apartamentos vacantes ahora:</span>
              <strong>{apartments.length - occupied}</strong>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-500">Ingreso perdido estimado:</span>
              <strong className="text-red-600">
                {formatCurrency(vacantDays > 0 && occupied > 0 ? (totalIncome / Math.max(1, occupied)) / 30 * vacantDays : 0)}
              </strong>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500 font-medium">Eficiencia de Recaudo:</span>
              <strong className={totalPotentialYear > 0 ? (totalIncome / totalPotentialYear * 100) >= 80 ? 'text-emerald-600' : 'text-amber-600' : 'text-gray-600'}>
                {totalPotentialYear > 0 ? `${Math.round(totalIncome / totalPotentialYear * 100)}%` : 'N/A'}
              </strong>
            </div>
          </div>
          {vacancies.length > 0 && (
            <div className="mt-4 space-y-2">
              {vacancies.map(v => {
                const apt = apartments.find(a => a.id === v.apartmentId);
                return (
                  <div key={v.id} className="p-2 bg-gray-50 rounded text-xs">
                    <span className="font-medium">{apt?.name || `Apto #${v.apartmentId}`}</span>
                    <span className="text-gray-400 ml-2">
                      {new Date(v.startDate).toLocaleDateString()} → {v.endDate ? new Date(v.endDate).toLocaleDateString() : 'Actualidad'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
