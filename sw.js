/* Service Worker - Barcellona 2026 PWA
   - Cache-first per HTML, icone, risorse CDN statiche (Leaflet, Google Fonts)
   - Network-first con fallback cache per tiles OpenStreetMap (così offline vedi le tile già viste)
   - Network-only per Supabase (foto sempre aggiornate quando online)
*/

const VERSION = 'v1.0.0';
const STATIC_CACHE = 'barcellona-static-' + VERSION;
const TILES_CACHE = 'barcellona-tiles-' + VERSION;

// Risorse essenziali: pre-caricate all'installazione del SW
const PRECACHE_URLS = [
    './',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './icon-maskable-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
    'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// Install: pre-cache delle risorse critiche
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            // addAll fallisce se anche solo una risorsa non è raggiungibile.
            // Usiamo Promise.allSettled per essere robusti.
            return Promise.allSettled(
                PRECACHE_URLS.map((url) => cache.add(url).catch((e) => {
                    console.warn('[SW] precache failed', url, e);
                }))
            );
        }).then(() => self.skipWaiting())
    );
});

// Activate: pulisce cache vecchie di versioni precedenti
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== STATIC_CACHE && k !== TILES_CACHE)
                    .map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: strategia di caching
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Solo GET cacheable
    if (req.method !== 'GET') return;

    // 1. Supabase (foto, API) → sempre network, no cache
    //    Se offline, l'app mostrerà lo stato "nessuna foto" o il fallback localStorage.
    if (url.hostname.includes('supabase.co')) {
        return; // lascia passare senza intercettare
    }

    // 2. OpenStreetMap tiles → network-first con fallback cache
    //    Le tile viste almeno una volta saranno disponibili offline
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    // Cache solo risposte valide
                    if (res && res.status === 200) {
                        const clone = res.clone();
                        caches.open(TILES_CACHE).then((cache) => cache.put(req, clone));
                    }
                    return res;
                })
                .catch(() => caches.match(req))
        );
        return;
    }

    // 3. Tutto il resto (HTML, JS, CSS, font, icone) → cache-first con aggiornamento
    //    (stale-while-revalidate): serve la cache per velocità, aggiorna in background
    event.respondWith(
        caches.match(req).then((cached) => {
            const fetchPromise = fetch(req)
                .then((res) => {
                    if (res && res.status === 200 && res.type !== 'opaque') {
                        const clone = res.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
                    }
                    return res;
                })
                .catch(() => cached); // offline → restituisci la cache
            return cached || fetchPromise;
        })
    );
});