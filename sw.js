const CACHE_NAME = 'quran-cache-v2'; // تم تحديث الإصدار لتجبر المتصفح على التحديث
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon_192.png',
  './icon_512.png'
];

// تثبيت الـ Service Worker وحفظ الملفات الجديدة
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting()) // تفعيل الكود الجديد فوراً
  );
});

// تنظيف الكاش القديم تماماً
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// عرض الملفات من الإنترنت أولاً، وإذا لم يتوفر، يعرضها من الكاش
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
