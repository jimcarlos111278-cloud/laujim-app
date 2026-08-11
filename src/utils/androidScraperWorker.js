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

export function stopAndroidScraperWorker() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.stop();
}

export function getAndroidScraperWorkerStatus() {
  if (!supportsAndroidScraperWorker()) return Promise.resolve({ supported: false });
  return NativeScraperWorker.getStatus();
}
