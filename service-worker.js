const CACHE_NAME = 'mechpro-shell-v15';
const SHELL_FILES = [
  './',
  './index.html',
  './app.js?v=15',
  './diagnostics-ui.js?v=1',
  './styles.css?v=15',
  './theme.css?v=15',
  './manifest.webmanifest',
  './mechpro-icon.svg',
  './assets/vendor/lucide.min.js',
  './assets/fonts/fonts.css',
  './assets/fonts/dm-sans-latin-400-normal.woff2',
  './assets/fonts/dm-sans-latin-500-normal.woff2',
  './assets/fonts/dm-sans-latin-600-normal.woff2',
  './assets/fonts/dm-sans-latin-700-normal.woff2',
  './assets/fonts/barlow-condensed-latin-500-normal.woff2',
  './assets/fonts/barlow-condensed-latin-600-normal.woff2',
  './assets/fonts/barlow-condensed-latin-700-normal.woff2',
  './assets/fonts/jetbrains-mono-latin-500-normal.woff2',
  './assets/fonts/jetbrains-mono-latin-600-normal.woff2',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  if (['script', 'style'].includes(request.destination)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    }),
  );
});
