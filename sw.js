// Service Worker for Battery Recycling Map
const STATIC_CACHE = 'static-v47';
const TILES_CACHE = 'tiles-v2';
let tileCacheCount = 0;

// Pre-computed 1×1 transparent PNG for tile fetch fallback.
// This must be valid base64: atob() throws on a bad string, and an error while
// the script loads stops the whole service worker from installing.
const TRANSPARENT_PIXEL = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
), c => c.charCodeAt(0));

// Critical assets — must cache for app to work (install fails if any are unreachable)
const CRITICAL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './cartowolf/tokens.css',
    './cartowolf/fonts.css',
    './vendor/leaflet/leaflet.css',
    './vendor/leaflet/leaflet.js',
    './vendor/markercluster/MarkerCluster.css',
    './vendor/markercluster/leaflet.markercluster.js'
];

// Optional assets — best-effort caching (install continues if these fail)
const OPTIONAL_ASSETS = [
    './locations.json',
    './data_meta.json',
    './cartowolf/fonts/ibm-plex-mono-latin-400-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-hebrew-hebrew-400-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-hebrew-hebrew-500-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-hebrew-hebrew-600-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-latin-400-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-latin-500-normal.woff2',
    './cartowolf/fonts/ibm-plex-sans-latin-600-normal.woff2'
];

// The precache asks the server, not the browser's HTTP cache: GitHub Pages sends
// max-age=600, so a plain cache.addAll() right after a deploy could store the old files
// under the new cache name, and the new version would arrive one visit late.
const fresh = (url) => new Request(url, { cache: 'reload' });

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('Caching critical assets');
                return cache.addAll(CRITICAL_ASSETS.map(fresh)).then(() => {
                    console.log('Caching optional assets (best-effort)');
                    return Promise.allSettled(
                        OPTIONAL_ASSETS.map(url => cache.add(fresh(url)))
                    ).then(results => {
                        results.forEach((result, i) => {
                            if (result.status === 'rejected') {
                                console.warn('Failed to cache optional asset:', OPTIONAL_ASSETS[i], result.reason?.message);
                            }
                        });
                    });
                });
            })
            .then(() => {
                return self.skipWaiting();
            })
        // No .catch here on purpose: if a critical asset fails, the install must
        // reject. The browser then drops this worker and keeps the old worker and
        // its cache. Swallowing the error would install a worker with an empty cache.
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => {
                        return name !== STATIC_CACHE && name !== TILES_CACHE;
                    })
                    .map((name) => {
                        console.log('Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // Take control of all pages immediately
            return self.clients.claim();
        })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    // Only intercept GET requests
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Handle tile requests separately (cache with limit)
    if (isTileRequest(url)) {
        event.respondWith(handleTileRequest(event.request));
        return;
    }

    // Handle API/data requests (network first): the points, and the date they were fetched
    if (url.pathname.includes('locations.json') || url.pathname.endsWith('/data_meta.json')) {
        event.respondWith(handleDataRequest(event.request));
        return;
    }

    // Handle other requests (cache first)
    event.respondWith(handleStaticRequest(event.request));
});

// Check if request is for map tiles
function isTileRequest(url) {
    return url.hostname === 'tile.openstreetmap.org';
}

// Handle tile requests - cache with size limit
async function handleTileRequest(request) {
    const cache = await caches.open(TILES_CACHE);

    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }

    // Fetch from network
    try {
        const networkResponse = await fetch(request);

        // Only cache successful responses
        if (networkResponse.ok) {
            // Clone response for caching
            const responseToCache = networkResponse.clone();

            // Cache the tile (don't await to not block response)
            cache.put(request, responseToCache).then(() => {
                tileCacheCount++;
                // Clean up old tiles periodically (every 50 new tiles)
                if (tileCacheCount % 50 === 0) {
                    return limitCacheSize(TILES_CACHE, 200);
                }
            }).catch((err) => {
                if (err.name === 'QuotaExceededError') {
                    limitCacheSize(TILES_CACHE, 100).catch(() => {});
                }
            });
        }

        return networkResponse;
    } catch (error) {
        console.log('Tile fetch failed:', error);
        return new Response(TRANSPARENT_PIXEL, {
            status: 200,
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }
        });
    }
}

// Handle data requests - network first with cache fallback
async function handleDataRequest(request) {
    try {
        // Try network first
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            // Update cache with fresh data
            // Not awaited (don't delay the response); a full disk must not become an unhandled error
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone()).catch(() => {});
        }

        return networkResponse;
    } catch (error) {
        // Fallback to cache
        console.log('Network failed, trying cache for:', request.url);
        const cachedResponse = await caches.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        // Return error response
        return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle static requests - cache first
async function handleStaticRequest(request) {
    // Try cache first
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
        // Return cached version, but also update cache in background
        fetchAndCache(request).catch(() => {});
        return cachedResponse;
    }

    // If not in cache, fetch from network
    try {
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone()).catch(() => {});
        }

        return networkResponse;
    } catch (error) {
        console.log('Fetch failed for:', request.url);

        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
            const cache = await caches.open(STATIC_CACHE);
            return await cache.match('./index.html') || new Response('Offline', { status: 503 });
        }

        return new Response('Offline', { status: 503 });
    }
}

// Fetch and update cache in background
async function fetchAndCache(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, response);
        }
    } catch (error) {
        // Silently fail - we already have cached version
    }
}

// Limit cache size by removing oldest entries
async function limitCacheSize(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();

        if (keys.length > maxItems) {
            // Delete oldest entries (first in list)
            const deleteCount = keys.length - maxItems;
            for (let i = 0; i < deleteCount; i++) {
                await cache.delete(keys[i]);
            }
        }
    } catch (error) {
        console.error('Failed to limit cache size:', error);
    }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
    if (event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
