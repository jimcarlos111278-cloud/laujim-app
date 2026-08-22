import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeScraperWorker = registerPlugin('ScraperWorker');

export function supportsAndroidScraperWorker() {
  return Capacitor.getPlatform?.() === 'android';
}

export function configureAndroidScraperWorker(options) {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.configure(options);
}

export function startAndroidScraperWorker() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.start();
}

export function runAndroidScraperWorkerNow() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.runNow();
}

export function runAndroidGasAccountNow(accountId) {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.runGasAccountNow({ accountId });
}

export function stopAndroidScraperWorker() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.stop();
}

export function rescheduleAndroidScraperWorker() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.reschedule();
}

export function requestAndroidExactAlarmPermission() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.requestExactAlarmPermission();
}

export function openAndroidBatterySettings() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.openBatterySettings();
}

export function requestAndroidBatteryOptimizationExemption() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.requestBatteryOptimizationExemption();
}

export function getAndroidScraperWorkerStatus() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.getStatus();
}

export function getInstalledAndroidVersion() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false, version: '0.0.0' });
  return NativeScraperWorker.getInstalledVersion();
}

export function openAndroidMarketplace() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.openMarketplace();
}

export function runAndroidMarketplaceWorkerNow() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.runMarketplaceNow();
}

export function openAndroidPortal(provider) {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.openPortal({ provider });
}

export function clearAndroidPortalCookies() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.clearPortalCookies();
}
