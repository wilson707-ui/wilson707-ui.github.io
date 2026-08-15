/* Service Worker — يحفظ هيكل التطبيق (index.html) عشان يفتح بدون إنترنت.
   تحميل الصفحات والخطوط يتم من داخل index.html نفسه عبر Cache Storage. */

const SHELL_CACHE = 'quran-shell-v1';
const SHELL_FILES = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(async url => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* الملف قد لا يكون موجوداً، تجاهل */ }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // طلبات التنقل (فتح الصفحة نفسها) — شبكة أولاً، ولو فشلت ارجع للنسخة المحفوظة
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', res.clone());
        return res;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  // ملفات من نفس الموقع (manifest، أيقونات، إلخ) — كاش أولاً
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return cached;
      }
    })());
  }
  // باقي الطلبات (صفحات المصحف من GitHub، الخطوط، الصوت، التفسير)
  // تتم إدارتها يدوياً داخل index.html عبر Cache Storage، فنتركها تمر عادي هنا.
});
