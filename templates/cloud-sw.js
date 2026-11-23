/* Static hosting: all queries run on the phone using the published snapshot. */
const VERSION = '__DATA_VERSION__';
const BASE = new URL(self.registration.scope).pathname;
const PREFIX = 'tanji-cloud:' + BASE + ':';
const SHELL = PREFIX + VERSION + ':shell';
const DATA = PREFIX + 'official-data-v1';
const asset = relative => new URL(relative.replace(/^\/+/, ''), self.registration.scope).href;
const SNAPSHOT = asset('data/hts-full.json');
let syncing;

async function timedFetch(request, timeout, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(request, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function announceReady(target) {
  try {
    const saved = await (await caches.open(DATA)).match(SNAPSHOT);
    if (!saved) return false;
    const snapshot = await saved.json();
    if (!Array.isArray(snapshot.rows) || snapshot.rows.length < 25000 || !snapshot.version) return false;
    const message = { type: 'OFFLINE_READY', version: snapshot.version, recordCount: snapshot.searchable_count };
    if (target) target.postMessage(message);
    else for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
    return true;
  } catch { return false; }
}

async function saveData() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const saved = await (await caches.open(DATA)).match(SNAPSHOT);
      const expected = await (await caches.open(SHELL)).match(asset('data/status.json'));
      if (saved && expected) {
        const [raw, status] = await Promise.all([saved.json(), expected.json()]);
        if (raw.version === status.version && raw.fetched_at === status.fetchedAt && Array.isArray(raw.rows) && raw.rows.length >= 25000) {
          await announceReady();
          return;
        }
      }
      const response = await timedFetch(SNAPSHOT, 60000, { cache: 'reload' });
      if (!response.ok) throw new Error('snapshot_download_failed');
      const raw = await response.clone().json();
      if (!Array.isArray(raw.rows) || raw.rows.length < 25000 || !raw.version) throw new Error('snapshot_invalid');
      await (await caches.open(DATA)).put(SNAPSHOT, response);
      await announceReady();
    } catch {
      if (!await announceReady()) {
        for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage({ type: 'OFFLINE_FAILED' });
      }
    }
  })();
  try { await syncing; } finally { syncing = undefined; }
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const manifest = await timedFetch(asset('asset-manifest.json'), 15000, { cache: 'reload' });
  if (!manifest.ok) throw new Error('asset_manifest_unavailable');
  const files = await manifest.json();
  const shell = await caches.open(SHELL);
  await shell.addAll(files.map(file => new Request(asset(file), { cache: 'reload' })));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  await saveData();
  if (await announceReady()) {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && ![SHELL, DATA].includes(key)) await caches.delete(key);
    }
  }
})()));

self.addEventListener('message', event => {
  if (event.data?.type === 'OFFLINE_STATUS') event.waitUntil((async () => {
    if (!await announceReady(event.source)) await saveData();
  })());
  if (event.data?.type === 'SYNC_DATA') event.waitUntil(saveData());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE) || event.request.method !== 'GET') return;
  const relative = url.pathname.slice(BASE.length);
  if (event.request.mode === 'navigate' && ['', 'index.html'].includes(relative)) {
    event.respondWith((async () => (await (await caches.open(SHELL)).match(asset('index.html'))) || fetch(event.request))());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(relative === 'data/hts-full.json' ? DATA : SHELL);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (relative === 'data/hts-full.json' && response.ok) {
      const raw = await response.clone().json();
      if (Array.isArray(raw.rows) && raw.rows.length >= 25000 && raw.version) {
        await cache.put(event.request, response.clone());
        await announceReady();
      }
    }
    return response;
  })());
});
