const CACHE = 'apt-manager-v1';
const ASSETS = ['/', '/manifest.json', '/icons.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.endsWith('/version.json')) {
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(cache =>
      fetch(e.request)
        .then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => caches.match(e.request))
    )
  );
});
