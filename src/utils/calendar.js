const UID_KEY = 'laujim_calendar_uids';

function uidForApt(apt) {
  const slug = apt.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `laujim-pago-${slug}@laujim.app`;
}

function getStoredUIDs() {
  try { return JSON.parse(localStorage.getItem(UID_KEY) || '[]'); } catch { return []; }
}

function saveStoredUIDs(uids) {
  localStorage.setItem(UID_KEY, JSON.stringify(uids));
}

function fmtDate(d) {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function nextDueDate(dueDay) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let d = new Date(year, month, dueDay);
  if (now.getDate() > dueDay) d = new Date(year, month + 1, dueDay);
  return d;
}

export function generateICS({ title, description, date, location }) {
  const d = new Date(date);
  const fmt = fmtDate(d);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Laujim//Gestion Aptos//ES',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:' + fmt.slice(0, 8),
    'DTEND;VALUE=DATE:' + fmt.slice(0, 8),
    'SUMMARY:' + title,
    'DESCRIPTION:' + (description || '').replace(/\n/g, '\\n'),
    'LOCATION:' + (location || ''),
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio: ' + title,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return ics;
}

export function downloadICS(ics, filename) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'recordatorio.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function addCalendarReminder(apartmentName, dueDay) {
  const dueDate = nextDueDate(dueDay);
  const title = `Pago de arriendo - ${apartmentName}`;
  const description = `Recordatorio de pago de arriendo para ${apartmentName}. D\u00eda de pago: ${dueDay} de cada mes.`;
  const ics = generateICS({ title, description, date: dueDate });
  downloadICS(ics, `pago-${apartmentName.toLowerCase().replace(/\s+/g, '-')}.ics`);
}

export function generateAllPaymentReminders(apartments) {
  const oldUIDs = getStoredUIDs();
  const currentUIDs = [];
  const events = [];

  for (const a of apartments) {
    if (a.status !== 'occupied' || !a.paymentDueDay) continue;
    const uid = uidForApt(a);
    currentUIDs.push(uid);
    const dueDate = nextDueDate(a.paymentDueDay);
    const fmt = fmtDate(dueDate).slice(0, 8);
    const title = `Pago arriendo - ${a.name}`;
    events.push([
      'BEGIN:VEVENT',
      'UID:' + uid,
      'DTSTAMP:' + fmtDate(new Date()),
      'DTSTART;VALUE=DATE:' + fmt,
      'DTEND;VALUE=DATE:' + fmt,
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=' + a.paymentDueDay,
      'SUMMARY:' + title,
      'DESCRIPTION:Recordatorio de pago para ' + a.name + '. Vence el d\u00eda ' + a.paymentDueDay + ' de cada mes.',
      'STATUS:CONFIRMED',
      'SEQUENCE:1',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatorio: ' + title,
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n'));
  }

  for (const oldUID of oldUIDs) {
    if (!currentUIDs.includes(oldUID)) {
      events.push([
        'BEGIN:VEVENT',
        'UID:' + oldUID,
        'DTSTAMP:' + fmtDate(new Date()),
        'STATUS:CANCELLED',
        'SEQUENCE:2',
        'SUMMARY:Evento eliminado',
        'END:VEVENT',
      ].join('\r\n'));
    }
  }

  if (events.length === 0) return null;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Laujim//Gestion Aptos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Pagos de Arriendo',
    events.join('\r\n'),
    'END:VCALENDAR',
  ].join('\r\n');

  downloadICS(ics, 'todos-los-pagos.ics');
  saveStoredUIDs(currentUIDs);
  return events.length;
}

export function syncAndGenerateReminders(apartments) {
  const count = generateAllPaymentReminders(apartments);
  return count || 0;
}
