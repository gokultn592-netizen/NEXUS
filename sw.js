const CACHE_NAME = 'nexus-shell-v62';
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
      // Use Map to handle individual caching of resources so one failure doesn't block the whole precache
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

// Activate Event — Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== 'nexus-files-cache') {
            console.log('[Service Worker] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event — Intercept network requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Skip non-GET requests and non-http/https schemes (chrome-extension://, etc.)
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // 2. Firebase Config Endpoint — Network First, fallback to Cache
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
          return caches.match(event.request);
        })
    );
    return;
  }

  // 3. Local JS scripts — Network-First strategy to guarantee instant code updates for all users
  if (url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 4. Local static shell assets & HTML pages — Network-First strategy to ensure 100% instant UI updates on 1st load!
  const isStatic = STATIC_ASSETS.some(asset => {
    if (asset === '/') return url.pathname === '/';
    const cleanAsset = asset.endsWith('.html') ? asset.slice(0, -5) : asset;
    return url.pathname === asset || url.pathname === cleanAsset || url.pathname.endsWith(asset) || url.pathname.endsWith(cleanAsset);
  });

  const isNavigationOrHtml = event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';

  if (isNavigationOrHtml || isStatic) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => {
          console.log('[Service Worker] Serving cached HTML for offline access:', url.pathname);
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            if (!url.pathname.endsWith('.html') && url.pathname !== '/') {
              return caches.match(url.pathname + '.html') || caches.match('/index.html');
            }
            return caches.match('/index.html');
          });
        })
    );
    return;
  }

  // 5. External CDN assets (Google Fonts, GSAP, Tailwind, Three.js, Firebase) — Cache-First with Network Fallback
  const isExternal = EXTERNAL_ASSETS.some(asset => url.href.startsWith(asset)) || 
                     url.host.includes('gstatic.com') || 
                     url.host.includes('googleapis.com') ||
                     url.host.includes('tailwindcss.com') ||
                     url.host.includes('cloudflare.com') ||
                     url.host.includes('jsdelivr.net') ||
                     url.host.includes('unpkg.com');

  if (isExternal) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
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
