import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatCurrency, getPeriodLabel, getCurrentPeriod, prevPeriod } from '../utils/helpers';

const MONTHS_TO_SHOW = 12;
const COLORS = {
  paid: '#10B981',
  late: '#EF4444',
  vacant: '#9CA3AF',
  noData: '#E5E7EB',
};

function getPaymentStatus(payments, period, apartment) {
  if (apartment.status === 'vacant') return 'vacant';

  const payment = payments.find(
    p => p.period === period && p.type === 'rent'
  );

  if (!payment || !payment.paid) return 'noData';

  if (payment.paid && payment.paidDate) {
    const dueDay = apartment.paymentDueDay || 5;
    const [y, m] = period.split('-').map(Number);
    const dueDate = new Date(y, m - 1, dueDay);
    const paidDate = new Date(payment.paidDate);
    if (paidDate > dueDate) return 'late';
  }

  return 'paid';
}

function getChartData(apartment, payments) {
  const data = [];
  let current = getCurrentPeriod();

  for (let i = 0; i < MONTHS_TO_SHOW; i++) {
    const status = getPaymentStatus(payments, current, apartment);
    const payment = payments.find(p => p.period === current && p.type === 'rent');
    data.unshift({
      period: current,
      label: getPeriodLabel(current),
      status,
      amount: payment?.paid ? (payment.amount || 0) : 0,
    });
    current = prevPeriod(current);
  }

  return data;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0].payload;
  const statusLabels = {
    paid: 'Pagado a tiempo',
    late: 'Pagado con retraso',
    vacant: 'Apartamento vacante',
    noData: 'Sin pago registrado',
  };
  const statusColors = {
    paid: 'text-emerald-600',
    late: 'text-red-600',
    vacant: 'text-gray-500',
    noData: 'text-gray-400',
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 mb-1">{entry.label}</p>
      <p className={`${statusColors[entry.status]}`}>{statusLabels[entry.status]}</p>
      {entry.amount > 0 && (
        <p className="text-gray-600 mt-1">{formatCurrency(entry.amount)}</p>
      )}
    </div>
  );
}

export default function PaymentHistoryChart({ apartment, payments }) {
  const data = getChartData(apartment, payments);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-4">Historial de Pagos (Últimos 12 Meses)</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#6B7280' }}
              tickFormatter={v => v.split(' ')[0].slice(0, 3)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F3F4F6' }} />
            <Bar
              dataKey="amount"
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
              shape={props => {
                const { x, y, width, height, payload } = props;
                const color = COLORS[payload.status] || COLORS.noData;
                return <rect x={x} y={y} width={width} height={height} fill={color} rx={4} />;
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> A tiempo</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Con retraso</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-300 inline-block" /> Vacante</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-100 inline-block" /> Sin pago</span>
      </div>
    </div>
  );
}
