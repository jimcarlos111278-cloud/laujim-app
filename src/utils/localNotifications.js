const STORAGE_KEY = 'laujim-notif-config';

export function getNotifConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { enabled: false, daysBefore: 3 };
}

export function saveNotifConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export async function schedulePaymentReminders(apartments) {
  const config = getNotifConfig();
  if (!config.enabled) return;

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    const now = new Date();
    const notifications = [];

    for (const apt of apartments) {
      if (apt.status !== 'occupied') continue;
      const dueDay = apt.paymentDueDay || 5;
      const notifDate = new Date(now.getFullYear(), now.getMonth(), dueDay - config.daysBefore);

      if (notifDate <= now) {
        notifDate.setMonth(notifDate.getMonth() + 1);
      }

      notifications.push({
        id: apt.id,
        title: 'Pago próximo',
        body: `${apt.name}: el canon vence en ${config.daysBefore} días`,
        schedule: { at: notifDate },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        iconColor: '#2563EB',
      });

      notifications.push({
        id: apt.id + 1000,
        title: 'Pago vencido',
        body: `${apt.name}: el canon debería estar pagado`,
        schedule: { at: new Date(now.getFullYear(), now.getMonth(), dueDay) },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        iconColor: '#DC2626',
      });
    }

    await LocalNotifications.schedule({ notifications });
  } catch (e) {
    console.error('Local notifications error:', e);
  }
}

export async function cancelAllNotifications() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id })),
      });
    }
  } catch (e) {
    console.error('Cancel notifications error:', e);
  }
}
