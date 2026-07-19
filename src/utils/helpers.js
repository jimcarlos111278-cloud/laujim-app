export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatShortDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function daysBetween(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return Math.max(0, Math.floor((e - s) / (1000 * 60 * 60 * 24)));
}

export function monthsBetween(start, end) {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

export function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getMonthName(monthNum) {
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return months[monthNum - 1] || '';
}

export function getPeriodLabel(period) {
  const [y, m] = period.split('-');
  return `${getMonthName(Number(m))} ${y}`;
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

export function daysUntil(paymentDay) {
  const now = new Date();
  const currentDay = now.getDate();
  let target = new Date(now.getFullYear(), now.getMonth(), paymentDay);
  if (currentDay > paymentDay) target = new Date(now.getFullYear(), now.getMonth() + 1, paymentDay);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

export function periodToDate(period) {
  const [y, m] = period.split('-');
  return new Date(Number(y), Number(m) - 1, 1);
}

export function nextPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function getAllPeriodsFrom(startPeriod) {
  const periods = [];
  let current = startPeriod;
  const now = getCurrentPeriod();
  while (current <= now) {
    periods.push(current);
    current = nextPeriod(current);
  }
  return periods;
}

export function isOverdueByReadingDate(period, readingDay) {
  const [y, m] = period.split('-').map(Number);
  const readingDate = new Date(y, m - 1, readingDay);
  const twoWeeksAfter = new Date(readingDate);
  twoWeeksAfter.setDate(twoWeeksAfter.getDate() + 14);
  return new Date() > twoWeeksAfter;
}
