// THRN Service Worker v1.0
// Handles: push notifications, offline caching, background sync

const CACHE_NAME = 'thrn-v1';
const OFFLINE_URLS = [
  '/thrn-app.html',
  '/thrn-sw.js'
];

// ---- INSTALL: cache shell ----
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

// ---- ACTIVATE: clean old caches ----
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---- FETCH: serve from cache, fall back to network ----
self.addEventListener('fetch', e => {
  // Skip non-GET and Supabase/external API calls (always need fresh)
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return;
  if (e.request.url.includes('openstreetmap')) return;
  if (e.request.url.includes('nominatim')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || network;
    })
  );
});

// ---- PUSH: incoming notification from server ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) { data = {title: 'THRN Alert', body: e.data ? e.data.text() : 'New notification'}; }

  const options = {
    body: data.body || 'Tap to view',
    icon: data.icon || '/thrn-icon.png',
    badge: '/thrn-badge.png',
    tag: data.tag || 'thrn-alert',
    renotify: true,
    requireInteraction: data.urgent || false,
    data: { url: data.url || '/thrn-app.html', type: data.type || 'general' },
    actions: buildActions(data.type)
  };

  e.waitUntil(self.registration.showNotification(data.title || 'THRN Alert', options));
});

function buildActions(type) {
  if (type === 'incident') {
    return [
      { action: 'dispatch', title: 'Dispatch responder' },
      { action: 'view', title: 'View incident' }
    ];
  }
  if (type === 'case_overdue') {
    return [
      { action: 'open_case', title: 'Open case' },
      { action: 'dismiss', title: 'Dismiss' }
    ];
  }
  return [{ action: 'view', title: 'View' }];
}

// ---- NOTIFICATION CLICK ----
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action;
  const data = e.notification.data || {};

  let targetUrl = data.url || '/thrn-app.html';
  if (action === 'dispatch') targetUrl = '/thrn-app.html#dispatch';
  if (action === 'open_case') targetUrl = '/thrn-app.html#cases';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('thrn') && 'focus' in client) {
          client.postMessage({ action: action, data: data });
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ---- BACKGROUND SYNC: queue case saves when offline ----
self.addEventListener('sync', e => {
  if (e.tag === 'sync-cases') {
    e.waitUntil(syncPendingCases());
  }
  if (e.tag === 'sync-incidents') {
    e.waitUntil(syncPendingIncidents());
  }
});

async function syncPendingCases() {
  // Cases saved offline get queued in IndexedDB, synced here when back online
  // The main app handles reading from IndexedDB and POSTing to Supabase
  const clients2 = await self.clients.matchAll();
  clients2.forEach(c => c.postMessage({ type: 'sync-complete', entity: 'cases' }));
}

async function syncPendingIncidents() {
  const clients2 = await self.clients.matchAll();
  clients2.forEach(c => c.postMessage({ type: 'sync-complete', entity: 'incidents' }));
}
