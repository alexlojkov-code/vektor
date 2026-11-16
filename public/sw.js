/* Service worker «Вектора»: приложение открывается и без интернета.
   Стратегия — сначала сеть: после деплоя пользователь сразу получает свежую версию,
   а копия в кэше нужна, когда сети нет или она отвечает дольше 4 секунд.
   /api/* и чужие домены не трогаем: AI, вход и синхронизация всегда идут в сеть.
   При изменении списка SHELL поднимите номер версии в CACHE. */
const CACHE = 'vektor-v2';
const TIMEOUT_MS = 4000;
const SHELL = [
  '/app.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/css/tokens.css', '/css/base.css', '/css/app.css', '/css/liquid-glass.css',
  '/js/app.js', '/js/store.js', '/js/ui.js', '/js/chat.js', '/js/markdown.js', '/js/directions.js',
  '/js/tasks.js', '/js/calc.js', '/js/metrics.js', '/js/account.js', '/js/merge.js', '/js/pwa.js',
  '/js/liquid-glass.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('vektor-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  let servedCopy = null; // копия, отданная из-за медленной сети
  const network = fetch(req).then(async res => {
    if (res.ok && res.type === 'basic') {
      await cache.put(req, res.clone());
      // Страница уже показана из старой копии, а на сервере новая версия — предлагаем обновить
      const changed = servedCopy && (res.headers.get('etag') || '') !== (servedCopy.headers.get('etag') || '');
      if (changed && req.mode === 'navigate') {
        const client = await self.clients.get(event.resultingClientId || event.clientId);
        client?.postMessage({ type: 'vektor-updated' });
      }
    }
    return res;
  });
  event.waitUntil(network.catch(() => {})); // ответ сети обновит кэш, даже если отдали копию
  const fromCache = () => cache.match(req, { ignoreSearch: req.mode === 'navigate' });

  // Сеть не ответила вовремя — отдаём копию, если она есть, иначе продолжаем ждать сеть
  const slow = new Promise(resolve => setTimeout(resolve, TIMEOUT_MS)).then(fromCache).then(hit => (servedCopy = hit));
  try {
    const first = await Promise.race([network, slow.then(hit => hit || network)]);
    if (first) return first;
  } catch {}
  const hit = await fromCache();
  if (hit) return hit;
  // Офлайн и страницы нет в кэше — открываем приложение (у лендинга своя копия, если его открывали)
  if (req.mode === 'navigate') return (await cache.match('/app.html')) || Response.error();
  return Response.error();
}
