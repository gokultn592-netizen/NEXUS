const CACHE_NAME = 'nexus-shell-v83';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/notice.html',
  '/discussion.html',
  '/admin.html',
  '/manifest.json',
  '/pwa-helper.js',
  '/particle-sphere.js',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico'
];

const EXTERNAL_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js',
  'https://cdn.jsdelivr.net/gh/studio-freight/lenis@1.0.27/bundled/lenis.min.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&family=Syne:wght@500;600;700;800&display=swap'
];

const ALL_PRECACHE = [...STATIC_ASSETS, ...EXTERNAL_ASSETS];

// Install Event — Pre-cache static and external shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching app shell...');
      return Promise.allSettled(
        ALL_PRECACHE.map(asset => {
          return cache.add(asset)
            .then(() => console.log(`[Service Worker] Cached: ${asset}`))
            .catch(err => console.error(`[Service Worker] Failed to cache: ${asset}`, err));
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate Event — Clean up old caches, claim clients immediately, and notify windows
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== 'nexus-files-cache') {
            console.log('[Service Worker] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
      .then(() => {
        // Broadcast update notification to all open client windows
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
          });
        });
      })
  );
});

// Message Event — Support immediate skip-waiting from client page
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    console.log('[Service Worker] SKIP_WAITING signal received, activating immediately...');
    self.skipWaiting();
  }
  if (event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Fetch Event — Intercept network requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET requests and non-http/https schemes (chrome-extension://, etc.)
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // 2. CRITICAL AUTH BYPASS: Never intercept Firebase Auth handlers, Google Identity endpoints,
  // or Firestore real-time streams. Intercepting these breaks popup postMessage handshakes,
  // caches dynamic auth tokens, and blocks user sign-in.
  if (
    url.pathname.startsWith('/__') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('accounts.google.com') ||
    url.hostname.includes('apis.google.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebaseio.com')
  ) {
    return; // Pass through directly to browser network engine
  }

  // 3. Firebase Config Endpoint — Network First, fallback to Cache
  if (url.href.includes('/api/firebase-config')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          console.log('[Service Worker] Serving cached Firebase configuration...');
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
    return;
  }

  // 4. Navigation / HTML pages — Network-First to guarantee fresh updates without hard-refresh or clearing cookies
  const isNavigationOrHtml = event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  if (isNavigationOrHtml) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          console.log('[Service Worker] Network offline, serving cached navigation page...');
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          const fallback = await caches.match('/index.html', { ignoreSearch: true });
          if (fallback) return fallback;
          return caches.match('/', { ignoreSearch: true });
        })
    );
    return;
  }

  // 5. Local JavaScript scripts (pwa-helper.js, particle-sphere.js) — Network-First with cache fallback
  if (url.origin === self.location.origin && url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // 6. Local static shell assets (manifest.json, favicon.ico, icons) — Stale-While-Revalidate
  const isStatic = STATIC_ASSETS.some(asset => {
    if (asset === '/') return url.pathname === '/';
    return url.pathname === asset || url.pathname.endsWith(asset);
  });

  if (isStatic) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        }).catch(() => undefined);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 7. External CDN assets (Google Fonts, GSAP, Tailwind, Three.js, Firebase) — Cache-First with Network Fallback
  // Note: Fonts are scoped specifically; Google Identity & token endpoints were bypassed above
  const isExternal = EXTERNAL_ASSETS.some(asset => url.href.startsWith(asset)) || 
                     url.host === 'fonts.googleapis.com' || 
                     url.host === 'fonts.gstatic.com' ||
                     url.host.includes('tailwindcss.com') ||
                     url.host.includes('cdnjs.cloudflare.com') ||
                     url.host.includes('jsdelivr.net') ||
                     url.host.includes('unpkg.com');

  if (isExternal) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        }).catch(() => {
          console.warn('[Service Worker] External CDN asset unavailable offline:', event.request.url);
        });
      })
    );
    return;
  }
});
