let permission = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (permission === 'granted') return true;
  if (permission === 'denied') return false;
  const result = await Notification.requestPermission();
  permission = result;
  return result === 'granted';
}

export function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/icons.svg' });
}

export function notifyPaymentReminder(apartmentName, daysLeft) {
  if (daysLeft <= 0) {
    notify('Pago vencido', `${apartmentName} — el pago debería haberse realizado hoy`);
  } else if (daysLeft <= 1) {
    notify('Pago mañana', `${apartmentName} — el pago vence mañana`);
  } else if (daysLeft <= 3) {
    notify('Pago próximo', `${apartmentName} — vence en ${daysLeft} días`);
  }
}
