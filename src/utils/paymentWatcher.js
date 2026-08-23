import { registerPlugin } from '@capacitor/core';
import { isCapacitor } from './config';

const PaymentWatcher = registerPlugin('PaymentWatcher');

export async function configurePaymentWatcher({ serverUrl, token, enabled = true }) {
  if (!isCapacitor()) return { supported: false, enabled: false };
  try { return await PaymentWatcher.configure({ serverUrl, token, enabled }); }
  catch (error) { return { supported: false, enabled: false, error: error?.message || String(error) }; }
}

export async function getPaymentWatcherStatus() {
  if (!isCapacitor()) return { supported: false, enabled: false, accessGranted: false };
  try { return await PaymentWatcher.getStatus(); }
  catch (error) { return { supported: false, enabled: false, accessGranted: false, error: error?.message || String(error) }; }
}

export async function openPaymentWatcherSettings() {
  if (!isCapacitor()) return { supported: false };
  try { return await PaymentWatcher.openAccessSettings(); }
  catch (error) { return { supported: false, error: error?.message || String(error) }; }
}

export async function stopPaymentWatcher() {
  if (!isCapacitor()) return { supported: false };
  try { return await PaymentWatcher.stop(); }
  catch (error) { return { supported: false, error: error?.message || String(error) }; }
}
