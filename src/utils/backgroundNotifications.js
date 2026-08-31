import { registerPlugin } from '@capacitor/core';
import { isCapacitor } from './config';

const BackgroundNotifications = registerPlugin('BackgroundNotifications');

export async function configureBackgroundNotifications({ serverUrl, token, preferences = {} }) {
  if (!isCapacitor()) return { supported: false, enabled: false };
  try {
    return await BackgroundNotifications.configure({
      serverUrl,
      token,
      whatsapp: preferences.whatsapp !== false,
      scraper: preferences.scraper !== false,
      facebook: preferences.facebook !== false,
      payments: preferences.payments === true,
      sound: preferences.sound !== false,
    });
  } catch (error) {
    console.warn('Background notifications unavailable:', error?.message || error);
    return { supported: false, enabled: false, error: error?.message || String(error) };
  }
}

export async function stopBackgroundNotifications() {
  if (!isCapacitor()) return { supported: false };
  try { return await BackgroundNotifications.stop(); }
  catch (error) { console.warn('Background notifications stop failed:', error?.message || error); return { supported: false }; }
}

export async function getBackgroundNotificationStatus() {
  if (!isCapacitor()) return { supported: false, enabled: false };
  try { return await BackgroundNotifications.getStatus(); }
  catch (error) { return { supported: false, enabled: false, error: error?.message || String(error) }; }
}
