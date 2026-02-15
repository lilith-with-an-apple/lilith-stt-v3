// sw.js - Service Worker FINAL V1007
const CACHE_NAME = 'stt-v3-cache-v1007';
const ASSETS = [
    'index.html',
    'manifest.json',
    'src/main.js',
    'src/workers/model-worker.js',
    'src/workers/storage-worker.js',
    'src/workers/sherpa-worker.js',
    'src/lib/sherpa-onnx-asr.js',
    'src/lib/sherpa-onnx-asr.wasm'
];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((res) => res || fetch(e.request))
    );
});
