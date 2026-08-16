/* Service Worker
   1) يحفظ هيكل التطبيق (index.html) عشان يفتح بدون إنترنت.
   2) يدير تحميل صفحات المصحف والخطوط في الخلفية، بحيث يكمل حتى لو
      المستخدم طلع من التطبيق أو صغّر المتصفح (طالما المتصفح نفسه شغال).
      ملاحظة: لا يوجد ضمان متصفح 100% لإكمال التحميل لو المستخدم قفل
      المتصفح تماماً أو قتل التطبيق من الخلفية بالجوال — هذا سلوك خارج
      عن تحكم أي تطبيق ويب. لكن التحميل يعتمد على استئناف تلقائي: أي
      صفحة/خط محفوظ مسبقاً يُتخطى، فلو انقطع التحميل يكمل من حيث وقف
      بدل ما يبدأ من الصفر.
*/

const SHELL_CACHE = 'quran-shell-v1';
const PAGES_CACHE = 'quran-pages-v1'; // نفس الاسم المستخدم داخل index.html
const SHELL_FILES = ['./', './index.html', './manifest.json'];

const RAW_BASE = 'https://raw.githubusercontent.com/MohamadHajjRabee/quran-qcf4/main';
const FONT_CDN = 'https://cdn.jsdelivr.net/gh/MohamadHajjRabee/quran-qcf4@main/fonts-woff2';
const TOTAL_PAGES = 604;
const ALL_FONT_NAMES = (() => {
  const n = ['QCF4_QBSML'];
  for (let i = 1; i <= 46; i++) n.push(`QCF4_Hafs_${String(i).padStart(2, '0')}`);
  return n;
})();
const pad3 = n => String(n).padStart(3, '0');
const fontUrl = name => `${FONT_CDN}/${name}${name === 'QCF4_QBSML' ? '' : '_W'}.woff2`;
const pageUrl = n => `${RAW_BASE}/pages/${pad3(n)}.json`;

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
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== PAGES_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

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
  // صفحات المصحف/الخطوط (GitHub، jsdelivr) تدار عبر رسائل التحميل بالأسفل، تُترك تمر عادي هنا.
});

/* ===================== تحميل الخلفية ===================== */
let downloading = false;

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}

async function getStatus() {
  const cache = await caches.open(PAGES_CACHE);
  let pagesDone = 0;
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    if (await cache.match(pageUrl(p))) pagesDone++;
  }
  let fontsDone = 0;
  for (const f of ALL_FONT_NAMES) {
    if (await cache.match(fontUrl(f))) fontsDone++;
  }
  return {
    pagesDone, pagesTotal: TOTAL_PAGES,
    fontsDone, fontsTotal: ALL_FONT_NAMES.length,
    complete: pagesDone === TOTAL_PAGES && fontsDone === ALL_FONT_NAMES.length,
    downloading
  };
}

async function downloadAllPages() {
  if (downloading) return;
  downloading = true;
  try {
    const cache = await caches.open(PAGES_CACHE);

    for (const f of ALL_FONT_NAMES) {
      const u = fontUrl(f);
      if (!(await cache.match(u))) {
        try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch (e) {}
      }
    }

    const BATCH = 10;
    let done = 0;
    for (let s = 1; s <= TOTAL_PAGES; s += BATCH) {
      const jobs = [];
      for (let p = s; p < Math.min(s + BATCH, TOTAL_PAGES + 1); p++) {
        jobs.push((async () => {
          const u = pageUrl(p);
          if (!(await cache.match(u))) {
            try { const r = await fetch(u); if (r.ok) await cache.put(u, r); } catch (e) {}
          }
        })());
      }
      await Promise.all(jobs);
      done += jobs.length;
      broadcast({ type: 'PAGES_DOWNLOAD_PROGRESS', done, total: TOTAL_PAGES });
    }

    const status = await getStatus();
    downloading = false;
    broadcast({ type: 'PAGES_DOWNLOAD_DONE', complete: status.complete });
  } catch (e) {
    downloading = false;
    broadcast({ type: 'PAGES_DOWNLOAD_ERROR' });
  }
}

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'START_PAGES_DOWNLOAD') {
    event.waitUntil(downloadAllPages());
  } else if (data.type === 'CHECK_PAGES_STATUS') {
    event.waitUntil((async () => {
      const status = await getStatus();
      const src = event.source;
      if (src) src.postMessage({ type: 'PAGES_STATUS', ...status });
    })());
  }
});

// دعم Background Sync كإجراء احتياطي: لو المتصفح يدعمه، يحاول يستأنف
// التحميل تلقائياً أول ما يرجع الاتصال بالإنترنت، حتى لو التطبيق مقفول.
self.addEventListener('sync', event => {
  if (event.tag === 'download-pages') {
    event.waitUntil(downloadAllPages());
  }
});
