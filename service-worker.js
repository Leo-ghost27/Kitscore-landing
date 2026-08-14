const CACHE_NAME = 'kitscore-shell-v2';

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Never intercept calls to Supabase, Stripe, Resend, or any third-party API —
// those must always hit the network live. Only handle same-origin, static-shell requests.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isGet = event.request.method === 'GET';

  if (!isSameOrigin || !isGet) {
    return; // let the browser handle it normally, no caching, no interception
  }

  if (event.request.mode === 'navigate') {
    // Network-first for pages, so logged-in app pages always get fresh data;
    // fall back to a cached shell only if the network is genuinely unavailable.
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (css/js/png/svg): network-first, so edits show up immediately.
  // Only fall back to the cached copy if the network request genuinely fails
  // (offline). This trades a little offline-speed for always-fresh app code.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          // Clone synchronously, right here, before any async gap. The
          // previous version cloned response.clone() as an argument
          // evaluated *inside* the caches.open().then() callback --
          // meaning the clone only happened after that promise resolved,
          // by which point `return response` below had already handed
          // the original off to be consumed, sometimes locking the body
          // before the clone ran. That's exactly what threw
          // "Failed to execute 'clone' on 'Response': Response body is
          // already used" -- a real, reproducible error seen throughout
          // the Instagram OAuth debugging session, not a one-off.
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
