const CACHE_NAME = 'mess-pass-v3';
const APP_SHELL = ['./', './manifest.json', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'CACHE_URLS' || !Array.isArray(data.urls)) {
    return;
  }

  const sameOriginUrls = data.urls
    .map((u) => {
      try {
        return new URL(u, self.location.href);
      } catch {
        return null;
      }
    })
    .filter(
      (u) =>
        u !== null &&
        u.origin === self.location.origin &&
        !u.pathname.startsWith('/@') &&
        !u.pathname.startsWith('/src/') &&
        !u.pathname.startsWith('/node_modules/')
    )
    .map((u) => u.href);

  if (sameOriginUrls.length === 0) return;

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        sameOriginUrls.map(async (url) => {
          const existing = await cache.match(url);
          if (existing) return;
          try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response && response.ok && response.type === 'basic') {
              await cache.put(url, response.clone());
            }
          } catch {
            // Ignore offline errors during background pre-caching
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache Vite/Astro dev server HMR or source module endpoints
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return;
  }

  // Navigations: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./', clone));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match('./')) ||
            new Response('Offline', {
              status: 503,
              statusText: 'Offline',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        })
    );
    return;
  }

  // Immutable hashed build assets (/_astro/*): cache-first
  if (url.pathname.includes('/_astro/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Other static assets: network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((c) => c || Response.error()))
  );
});
