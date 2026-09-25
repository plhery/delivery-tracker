self.addEventListener('activate', (event) => {
  // Remove cache names used by Serwist defaults before private API traffic was
  // explicitly made network-only.
  event.waitUntil(Promise.all([
    caches.delete('apis'),
    caches.delete('cross-origin'),
  ]));
});

self.addEventListener('push', (event) => {
  let decoded = {};
  try {
    decoded = event.data ? event.data.json() : {};
  } catch {
    decoded = {};
  }

  const payload = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
  const text = (value, fallback, limit) => (
    typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback
  );
  // Matches the generic update copy in src/server/push.ts.
  const fallbackCopy = {
    en: ['Parcel update', 'There’s an update to your parcel. Open tracking for details.'],
    de: ['Paket-Update', 'Es gibt Neuigkeiten zu deinem Paket. Öffne die Sendungsverfolgung für Details.'],
    fr: ['Mise à jour du colis', 'Du nouveau pour ton colis. Ouvre le suivi pour les détails.'],
    it: ['Aggiornamento del pacco', 'Ci sono novità sul pacco. Apri il tracciamento per i dettagli.'],
    es: ['Novedades del paquete', 'Hay novedades de tu paquete. Abre el seguimiento para ver los detalles.'],
    pt: ['Atualização do envio', 'Há novidades sobre o teu envio. Abre o seguimento para ver os detalhes.'],
    pl: ['Aktualizacja przesyłki', 'Są nowe informacje o Twojej przesyłce. Otwórz śledzenie, aby zobaczyć szczegóły.'],
  };
  const requestedLanguage = String(payload.lang || self.navigator?.language || 'en').split(/[-_]/)[0].toLowerCase();
  const lang = Object.hasOwn(fallbackCopy, requestedLanguage) ? requestedLanguage : 'en';
  const [fallbackTitle, fallbackBody] = fallbackCopy[lang];
  const title = text(payload.title, fallbackTitle, 120);
  const options = {
    body: text(payload.body, fallbackBody, 500),
    lang,
    icon: text(payload.icon, '/icons/icon-192.png', 2_048),
    badge: text(payload.badge, '/icons/icon-192.png', 2_048),
    tag: text(payload.tag, 'parcel-update', 120),
    renotify: true,
    data: payload.data && typeof payload.data === 'object' ? payload.data : { url: '/' },
  };

  const tasks = [self.registration.showNotification(title, options)];
  if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
    tasks.push(Promise.resolve(self.navigator.setAppBadge(1)).catch(() => undefined));
  }
  // Open windows show the new state now instead of at their next poll. The
  // notification never depends on it. The type matches SERVER_UPDATE_MESSAGE
  // in src/store/apiRepo.ts.
  tasks.push(Promise.resolve()
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then((clients) => clients.forEach((client) => client.postMessage({ type: 'sdt:server-update' })))
    .catch(() => undefined));
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (self.navigator && typeof self.navigator.clearAppBadge === 'function') {
    void self.navigator.clearAppBadge();
  }

  let target;
  try {
    const requested = typeof event.notification.data?.url === 'string'
      ? event.notification.data.url
      : '/';
    target = new URL(requested, self.location.origin);
  } catch {
    target = new URL('/', self.location.origin);
  }
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        try {
          if ('navigate' in client) await client.navigate(target.href);
          if ('focus' in client) return await client.focus();
        } catch {
          // A stale or closing client should not prevent opening a usable one.
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
