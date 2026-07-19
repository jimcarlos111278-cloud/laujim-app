import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, CalendarDays, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { api } from '../api';
import { formatCurrency, getMonthName } from '../utils/helpers';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

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
    return { month: getMonthName(i + 1), income: total };
  });

  const monthlyExpenses = Array.from({length: 12}, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const total = expensesThisYear.filter(e => e.date?.substring(5, 7) === m).reduce((s, e) => s + (e.amount || 0), 0);
    return { month: getMonthName(i + 1), expenses: total };
  });

  const monthlyData = monthlyIncome.map((mi, i) => ({
    month: mi.month.substring(0, 3),
    Ingresos: mi.income,
    Gastos: monthlyExpenses[i].expenses,
    Neto: mi.income - monthlyExpenses[i].expenses,
  }));

  const totalIncome = paymentsThisYear.reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = expensesThisYear.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = totalIncome - totalExpenses;

  const expenseByCategory = expensesThisYear.reduce((acc, e) => {
    const cat = e.category || 'Otro';
    if (!acc[cat]) acc[cat] = 0;
    acc[cat] += e.amount || 0;
    return acc;
  }, {});

  const expensePieData = Object.entries(expenseByCategory).map(([name, value]) => ({ name, value }));

  const vacantDays = vacancies.reduce((total, v) => {
    const start = new Date(v.startDate);
    const end = v.endDate ? new Date(v.endDate) : new Date();
    return total + Math.max(0, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
  }, 0);

  const occupied = apartments.filter(a => a.status === 'occupied').length;
  const vacancyRate = apartments.length > 0 ? ((apartments.length - occupied) / apartments.length * 100) : 0;

  const totalPotentialIncome = occupied * (payments.length > 0 ? payments.reduce((s, p) => s + (p.amount || 0), 0) / payments.length : 0);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <p className="text-2xl font-bold text-blue-600 mt-1">{vacancyRate.toFixed(0)}%</p>
          <p className="text-xs text-gray-400">{occupied}/{apartments.length} aptos ocupados</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Ingresos vs Gastos Mensuales</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
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
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Gastos por Categoría</h3>
          {expensePieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={expensePieData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {expensePieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-400 text-center py-12">No hay gastos registrados este año</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Vacancias</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-gray-100"><span className="text-gray-500">Días totales desocupados:</span><strong>{vacantDays} días</strong></div>
            <div className="flex justify-between py-1.5 border-b border-gray-100"><span className="text-gray-500">Apartamentos vacantes ahora:</span><strong>{apartments.length - occupied}</strong></div>
            <div className="flex justify-between py-1.5"><span className="text-gray-500">Ingreso perdido estimado:</span><strong className="text-red-600">{formatCurrency(vacantDays > 0 && apartments.length > 0 ? (totalIncome / Math.max(1, occupied)) / 30 * vacantDays : 0)}</strong></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Rentabilidad por Apartamento</h3>
          {apartments.map(apt => {
            const aptPayments = payments.filter(p => p.apartmentId === apt.id && p.date?.startsWith(String(year)) && p.type === 'rent');
            const aptExpenses = expenses.filter(e => e.apartmentId === apt.id && e.date?.startsWith(String(year)));
            const income = aptPayments.reduce((s, p) => s + (p.amount || 0), 0);
            const exp = aptExpenses.reduce((s, e) => s + (e.amount || 0), 0);
            return (
              <div key={apt.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0 text-sm">
                <span className="text-gray-700">{apt.name}</span>
                <div className="flex items-center gap-4">
                  <span className="text-emerald-600">+{formatCurrency(income)}</span>
                  <span className="text-red-600">-{formatCurrency(exp)}</span>
                  <span className="font-medium w-24 text-right">{formatCurrency(income - exp)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
