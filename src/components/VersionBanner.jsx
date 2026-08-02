import { useState, useEffect } from 'react';
import { getRawBase, isCapacitor } from '../utils/config';

function versionIsNewer(remote, local) {
  const parts = value => String(value || '0').split('.').map(part => Number(part) || 0);
  const a = parts(remote); const b = parts(local);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0);
  }
  return false;
}

export default function VersionBanner() {
  const [show, setShow] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isCapacitor()) {
      const serverBase = getRawBase();
      Promise.all([
        fetch('/app-version.json', { signal: AbortSignal.timeout(3000) }).then(r => r.json()),
        fetch(serverBase + '/app-version.json', { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      ]).then(([local, server]) => {
        // Only a deliberate APK release should request installation. Render
        // deployments alone must not show a false update banner.
        if (!server.version || !versionIsNewer(server.version, local.version)) return;
        const key = 'apt_update_' + server.version;
        if (!sessionStorage.getItem(key)) {
          setShow({ version: server.version, apkUrl: server.apkUrl || serverBase + '/app-debug.apk' });
          sessionStorage.setItem(key, '1');
        }
      }).catch(() => {});
      return;
    }

    fetch('/version.json', { signal: AbortSignal.timeout(3000) }).then(r => r.json()).then(local => {
      if (!local.build) return;
      const key = 'apt_build_' + local.build;
      if (!sessionStorage.getItem(key)) {
        setShow({ build: local.build, isPwa: true });
        sessionStorage.setItem(key, '1');
      }
    }).catch(() => {});
  }, []);

  if (!show) return null;
  if (show.isPwa) return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-yellow-200 bg-yellow-50 p-3 shadow-lg dark:border-yellow-700 dark:bg-yellow-900/80">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <p className="text-sm text-yellow-800 dark:text-yellow-100"><span className="font-medium">Nueva versión disponible</span></p>
        <div className="flex shrink-0 gap-2"><button onClick={() => setDismissed(true)} className="rounded-lg border border-yellow-300 px-3 py-1.5 text-xs text-yellow-800">Cerrar</button><button onClick={() => window.location.reload()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">Actualizar</button></div>
      </div>
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-blue-200 bg-blue-50 p-3 shadow-lg dark:border-blue-700 dark:bg-blue-950">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <p className="text-sm text-blue-900 dark:text-blue-100"><span className="font-medium">Nueva versión {show.version} disponible</span></p>
        <div className="flex shrink-0 gap-2"><button onClick={() => setDismissed(true)} className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs text-blue-800 dark:text-blue-100">Cerrar</button><button onClick={() => { window.location.href = show.apkUrl; }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white">Descargar APK</button></div>
      </div>
    </div>
  );
}
