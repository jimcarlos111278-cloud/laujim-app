// Clear only browser-local application state. The server database is never
// touched by this helper; it is safe to use when a stale PWA/session makes
// the dashboard look empty or offline.
export async function clearAppData() {
  const result = { cookies: 0, caches: 0, serviceWorkers: 0, indexedDB: 0 };

  try {
    const cookieNames = document.cookie
      .split(';')
      .map(value => value.split('=')[0].trim())
      .filter(Boolean);
    for (const name of cookieNames) {
      const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
      document.cookie = `${name}=; ${expires}; path=/`;
      document.cookie = `${name}=; ${expires}; path=/; domain=${location.hostname}`;
      result.cookies += 1;
    }
  } catch {}

  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      for (const key of keys) {
        if (await caches.delete(key)) result.caches += 1;
      }
    }
  } catch {}

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        if (await registration.unregister()) result.serviceWorkers += 1;
      }
    }
  } catch {}

  try {
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const databases = await indexedDB.databases();
      for (const database of databases) {
        if (!database.name) continue;
        await new Promise(resolve => {
          const request = indexedDB.deleteDatabase(database.name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        });
        result.indexedDB += 1;
      }
    }
  } catch {}

  return result;
}

