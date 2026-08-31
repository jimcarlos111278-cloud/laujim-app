const STORAGE_KEY = 'laujim-notif-config';
const NOTIFICATION_POLICY_VERSION = 2;

const DEFAULT_CONFIG = {
  enabled: false,
  daysBefore: 3,
  backgroundEnabled: true,
  whatsapp: true,
  scraper: true,
  facebook: true,
  // Payment reminders are intentionally opt-in.
  payments: false,
  sound: true,
  notificationPolicyVersion: NOTIFICATION_POLICY_VERSION,
};

export function getNotifConfig() {
  let parsed = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {}
  const config = { ...DEFAULT_CONFIG, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  // Existing installs had payment notifications enabled by default. Migrate
  // once so an update also stops old scheduled reminders.
  if (!parsed || Number(parsed.notificationPolicyVersion || 0) < NOTIFICATION_POLICY_VERSION) {
    config.payments = false;
    config.notificationPolicyVersion = NOTIFICATION_POLICY_VERSION;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch {}
  }
  return config;
}

export function saveNotifConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...DEFAULT_CONFIG,
    ...config,
    notificationPolicyVersion: NOTIFICATION_POLICY_VERSION,
  }));
}

export async function schedulePaymentReminders(apartments) {
  const config = getNotifConfig();
  if (!config.enabled || config.payments === false) {
    await cancelAllNotifications();
    return;
  }

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
