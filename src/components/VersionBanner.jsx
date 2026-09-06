import { useState, useEffect, useCallback } from 'react';
import { getRawBase, isCapacitor } from '../utils/config';
import { getInstalledAndroidVersion } from '../utils/androidScraperWorker';
import { absoluteApkUrl, compareVersions, getLatestAppRelease } from '../utils/appRelease';

function versionIsNewer(remote, local) {
  return compareVersions(remote, local) > 0;
}

async function readInstalledAndroidVersion() {
  try {
    const installed = await getInstalledAndroidVersion();
    if (installed?.version && installed.version !== '0.0.0') return installed;
  } catch {
    // APKs anteriores a 1.0.24 no exponen todavía el método nativo.
  }

  const response = await fetch('/app-version.json?installed=' + Date.now(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function triggerNativeUpdateNotification(version, apkUrl) {
  if (!window.Capacitor) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
    } catch {}

    try {
      await LocalNotifications.createChannel({
        id: 'laujim_updates',
        name: 'Actualizaciones de Laujim',
        description: 'Notificaciones sobre nuevas versiones del APK',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
      });
    } catch {}

    await LocalNotifications.schedule({
      notifications: [{
        id: 99999,
        title: `🚀 Nueva versión ${version} de Laujim`,
        body: `Toca aquí para descargar e instalar la actualización v${version}.`,
        channelId: 'laujim_updates',
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        iconColor: '#2563EB',
        extra: { apkUrl, action: 'download_update' },
      }],
    });
  } catch (err) {
    console.warn('Native update notification could not be scheduled:', err?.message || err);
  }
}

export default function VersionBanner() {
  const [show, setShow] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const checkVersion = useCallback(async () => {
    if (isCapacitor()) {
      const serverBase = getRawBase();
      try {
        const [installed, server] = await Promise.all([
          readInstalledAndroidVersion(),
          getLatestAppRelease(),
        ]);
        if (!server.version || !versionIsNewer(server.version, installed.version)) return;
        const url = absoluteApkUrl(serverBase, server.apkUrl);
        setShow({ version: server.version, apkUrl: url, installedVersion: installed.version });
        
        const notifKey = 'apt_notif_sent_' + server.version;
        if (!sessionStorage.getItem(notifKey)) {
          sessionStorage.setItem(notifKey, '1');
          triggerNativeUpdateNotification(server.version, url);
        }
      } catch (e) {
        console.warn('Could not check latest app release:', e?.message || e);
      }
      return;
    }

    try {
      const res = await fetch('/version.json?t=' + Date.now(), { signal: AbortSignal.timeout(3000) });
      const local = await res.json();
      if (!local.build) return;
      const key = 'apt_build_' + local.build;
      if (!sessionStorage.getItem(key)) {
        setShow({ build: local.build, isPwa: true });
      }
    } catch {}
  }, []);

  useEffect(() => {
    checkVersion();
    const interval = setInterval(checkVersion, 3 * 60 * 1000);
    const onFocus = () => checkVersion();
    window.addEventListener('focus', onFocus);

    if (window.Capacitor) {
      import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
        LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
          const url = notification.notification?.extra?.apkUrl;
          if (url) window.open(url, '_system');
        }).catch(() => {});
      }).catch(() => {});
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkVersion]);

  function closeBanner() {
    setDismissed(true);
  }

  function handleDownload() {
    if (!show?.apkUrl) return;
    if (window.Capacitor) {
      window.open(show.apkUrl, '_system');
    } else {
      window.location.href = show.apkUrl;
    }
  }

  if (!show || dismissed) return null;

  if (show.isPwa) {
    return (
      <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-50 rounded-2xl border border-amber-400/40 bg-amber-500/95 text-amber-950 p-3.5 shadow-2xl backdrop-blur-md animate-fade-in flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl">✨</span>
          <div>
            <p className="text-xs font-bold text-gray-900 leading-tight">Nueva versión disponible</p>
            <p className="text-[11px] text-amber-950/80">Recarga para ver las últimas mejoras</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 items-center">
          <button type="button" onClick={closeBanner} className="text-xs text-amber-950/70 hover:text-amber-950 px-2 py-1">Ignorar</button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-black transition active:scale-95">Actualizar</button>
        </div>
      </div>
    );
  }

  return (
    <aside aria-label="Actualización disponible" className="fixed top-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-50 rounded-2xl border border-blue-400/40 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white p-3.5 shadow-2xl backdrop-blur-md animate-fade-in flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 text-xl shadow-inner">
          🚀
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-white leading-tight">
            Nueva versión {show.version} lista
          </p>
          <p className="text-[11px] text-blue-100/80 truncate">
            {show.installedVersion ? `Instalada: v${show.installedVersion} · ` : ''}Toca para descargar APK
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1.5 items-center">
        <button
          type="button"
          onClick={closeBanner}
          className="text-xs text-blue-200 hover:text-white px-2 py-1 transition"
          title="Cerrar aviso"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-md hover:bg-blue-50 transition active:scale-95 flex items-center gap-1 shrink-0"
        >
          Descargar APK
        </button>
      </div>
    </aside>
  );
}
