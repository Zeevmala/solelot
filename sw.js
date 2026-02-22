// Service Worker for Battery Recycling Map
const STATIC_CACHE = 'static-v24';
const TILES_CACHE = 'tiles-v1';
let tileCacheCount = 0;

// Critical assets — must cache for app to work (install fails if any are unreachable)
const CRITICAL_ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

// Optional assets — best-effort caching (install continues if these fail)
const OPTIONAL_ASSETS = [
    './locations.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
    'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
    'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700&display=swap'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('Caching critical assets');
                return cache.addAll(CRITICAL_ASSETS).then(() => {
                    console.log('Caching optional assets (best-effort)');
                    return Promise.allSettled(
                        OPTIONAL_ASSETS.map(url => cache.add(url))
                    );
                });
            })
            .then(() => {
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('Failed to cache critical assets:', error);
            })
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

    // Handle API/data requests (network first)
    if (url.pathname.includes('locations.json')) {
        event.respondWith(handleDataRequest(event.request));
        return;
    }

    // Handle other requests (cache first)
    event.respondWith(handleStaticRequest(event.request));
});

// Check if request is for map tiles
function isTileRequest(url) {
    return url.hostname.includes('tile.openstreetmap.org') ||
           url.hostname.includes('basemaps.cartocdn.com') ||
           url.hostname.includes('arcgisonline.com');
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
                // Clean up old tiles periodically (every 20 caches)
                tileCacheCount++;
                if (tileCacheCount % 20 === 0) {
                    return limitCacheSize(TILES_CACHE, 200);
                }
            }).catch(async (err) => {
                // Handle storage quota exceeded — await so eviction completes before next write
                if (err.name === 'QuotaExceededError') {
                    await limitCacheSize(TILES_CACHE, 100);
                }
            });
        }

        return networkResponse;
    } catch (error) {
        // Return transparent 1x1 PNG fallback instead of blank square
        console.log('Tile fetch failed:', error);
        const TRANSPARENT_PIXEL = Uint8Array.from(atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualEQAAAABJRU5ErkJggg=='
        ), c => c.charCodeAt(0));
        return new Response(TRANSPARENT_PIXEL, {
            status: 200,
            headers: { 'Content-Type': 'image/png' }
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
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
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
        fetchAndCache(request);
        return cachedResponse;
    }

    // If not in cache, fetch from network
    try {
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
        }

        return networkResponse;
    } catch (error) {
        console.log('Fetch failed for:', request.url);

        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
            const cache = await caches.open(STATIC_CACHE);
            return cache.match('./index.html');
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
            cache.put(request, response);
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
