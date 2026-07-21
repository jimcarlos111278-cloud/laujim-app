import { useState, useEffect } from 'react';
import { getRawBase, isCapacitor } from '../utils/config';

export default function VersionBanner() {
  const [show, setShow] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch('/version.json', { signal: AbortSignal.timeout(3000) })
      .then(r => r.json())
      .then(local => {
        if (!local.version) return;
        const isApk = isCapacitor();
        if (isApk) {
          const serverBase = getRawBase();
          fetch(serverBase + '/version.json', { signal: AbortSignal.timeout(5000) })
            .then(r => r.json())
            .then(server => {
              if (!server.version) return;
              const localPatch = Number(local.version.split('.')[2] || 0);
              const serverPatch = Number(server.version.split('.')[2] || 0);
              if (serverPatch > localPatch) {
                const key = 'apt_update_' + server.version;
                if (!sessionStorage.getItem(key)) {
                  setShow({ version: server.version, apkUrl: serverBase + '/app-debug.apk' });
                  sessionStorage.setItem(key, '1');
                }
              }
            })
            .catch(() => {});
        } else {
          const key = 'apt_build_' + local.build;
          if (!sessionStorage.getItem(key)) {
            setShow({ build: local.build, isPwa: true });
            sessionStorage.setItem(key, '1');
          }
        }
      })
      .catch(() => {});
  }, []);

  if (!show) return null;

  if (show.isPwa) {
    if (!dismissed) {
      setTimeout(() => { if (!dismissed) window.location.reload(); }, 3000);
    }
    return (
      <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-yellow-50 dark:bg-yellow-900/80 border-t border-yellow-200 dark:border-yellow-700 shadow-lg">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <span className="font-medium">Nueva versión disponible</span>
            <span className="text-yellow-600 ml-1">— actualizando en 3s...</span>
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setDismissed(true)} className="px-3 py-1.5 text-xs rounded-lg border border-yellow-300 text-yellow-700 hover:bg-yellow-100">Cancelar</button>
            <button onClick={() => window.location.reload()} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">Ahora</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-3 bg-blue-50 dark:bg-blue-900/80 border-t border-blue-200 dark:border-blue-700 shadow-lg">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <span className="font-medium">Nueva versión {show.version} disponible</span>
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setDismissed(true)} className="px-3 py-1.5 text-xs rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-100">Cerrar</button>
          <button onClick={() => { window.location.href = show.apkUrl; }} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">Descargar APK</button>
        </div>
      </div>
    </div>
  );
}
