/* 探迹关税：本地快照用于离线基础查询；加征条款始终保留核验提示。 */
const VERSION = 'tanji-1.0.2-20261123';
const SHELL = VERSION + '-shell';
const API = VERSION + '-api';
const DATA = 'tanji-official-data-v1';
const SNAPSHOT = '/data/hts-offline.json';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
let snapshotPromise;
let syncing;
let networkUnavailableUntil = 0;

async function timedFetch(request, timeout, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(request, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function syncSnapshot(expected) {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      let current;
      try { current = await getSnapshot(); } catch {}
      if (current && (!expected || current.version === expected.version && current.fetchedAt === expected.fetchedAt)) {
        await notifyOfflineReady();
        return;
      }
      const response = await timedFetch(SNAPSHOT, 45000, { cache: 'no-store' });
      if (!response.ok) throw new Error('snapshot_download_failed');
      const next = await response.clone().json();
      if (!Array.isArray(next.items) || next.items.length < 10000 || !next.version) throw new Error('snapshot_invalid');
      await (await caches.open(DATA)).put(SNAPSHOT, response);
      snapshotPromise = Promise.resolve(next);
      await notifyOfflineReady();
    } catch {
      if (!await notifyOfflineReady()) {
        for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage({ type: 'OFFLINE_FAILED' });
      }
    }
    finally { syncing = undefined; }
  })();
  return syncing;
}

async function notifyOfflineReady(target) {
  try {
    const s = await getSnapshot();
    const message = { type: 'OFFLINE_READY', recordCount: (s.items || s.rows || []).length, version: s.version };
    if (target) target.postMessage(message);
    else for (const client of await self.clients.matchAll({ includeUncontrolled: true })) client.postMessage(message);
    return true;
  } catch { return false; }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'OFFLINE_STATUS') event.waitUntil((async () => {
    if (!await notifyOfflineReady(event.source)) await syncSnapshot();
  })());
  if (event.data?.type === 'SYNC_DATA') event.waitUntil(syncSnapshot(event.data));
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(ASSETS.map(asset => new Request(asset, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('tanji-') && ![SHELL, API, DATA].includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
    await syncSnapshot();
  })());
});

async function getSnapshot() {
  if (!snapshotPromise) snapshotPromise = (async () => {
    const cached = await (await caches.open(DATA)).match(SNAPSHOT);
    if (!cached) throw new Error('snapshot_not_downloaded');
    return cached.json();
  })().catch(error => { snapshotPromise = undefined; throw error; });
  return snapshotPromise;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Tanji-Offline': '1', 'Cache-Control': 'no-store' } });
}

const ALIASES = { '塑料': 'plastic', '塑料制品': 'plastic', '木材': 'wood', '木制品': 'wood', '家具': 'furniture', '电源': 'static converters', '充电器': 'static converters', '灯具': 'lamps', '灯': 'lamps', '电池': 'batteries', '锂电池': 'lithium', '钢铁': 'steel', '不锈钢': 'stainless steel', '铝': 'aluminum', '鞋': 'footwear', '服装': 'garments', '玩具': 'toys', '汽车': 'motor vehicles', '轮胎': 'tires', '橡胶': 'rubber', '纺织': 'textile', '纸': 'paper', '玻璃': 'glass', '陶瓷': 'ceramic', '螺丝': 'screws', '紧固件': 'screws', '包': 'bags', '泵': 'pumps', '阀门': 'valves' };

function normalizeCode(code) { return String(code || '').replace(/[.\s]/g, ''); }

async function offlineResponse(url) {
  const s = await getSnapshot();
  const items = s.items || s.rows || [];
  const meta = { version: s.version, fetchedAt: s.fetchedAt, source: s.source, rowCount: items.length };
  if (url.pathname === '/api/status') return json({ ready: true, ...s, items: undefined, rows: undefined, edition: s.version, updatedAt: s.fetchedAt, recordCount: items.length, mode: 'offline_snapshot', offline: true });
  if (url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query || (query.length < 2 && !/[\u3400-\u9fff]/u.test(query)) || query.length > 120) return json({ error: '请输入至少 2 位 HS 编码或英文关键词，也支持常用中文品名。' }, 400);
    const code = normalizeCode(query);
    const hasChinese = /[\u3400-\u9fff]/u.test(query);
    let chineseMatches = (s.chineseAliases || []).filter(a => a.words.some(word => query.includes(word)));
    const longest = Math.max(0, ...chineseMatches.flatMap(a => a.words.filter(w => query.includes(w)).map(w => w.length)));
    chineseMatches = chineseMatches.filter(a => a.words.some(w => query.includes(w) && w.length === longest));
    const chinesePrefixes = chineseMatches.flatMap(a => a.prefixes);
    const translated = (s.aliases || {})[query] || ALIASES[query];
    const terms = (translated || query).toLowerCase().split(/\s+/).filter(Boolean);
    const numeric = /^\d{2,10}$/.test(code);
    const matches = items.filter(row => numeric ? normalizeCode(row.code).startsWith(code) : hasChinese ? chinesePrefixes.some(p => normalizeCode(row.code).startsWith(p)) : terms.every(t => [row.description, row.descriptionZh, row.parentDescription, JSON.stringify(row.path || [])].join(' ').toLowerCase().includes(t)));
    const offset = Math.max(0, Math.min(50000, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0));
    const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '30', 10) || 30));
    return json({ query, translatedQuery: translated, queryTranslated: translated, items: matches.slice(offset, offset + limit), total: matches.length, offset, limit, data: meta, offline: true, mode: 'offline_snapshot' });
  }
  if (url.pathname.startsWith('/api/tariff/')) {
    const code = normalizeCode(decodeURIComponent(url.pathname.slice('/api/tariff/'.length)));
    const item = items.find(row => normalizeCode(row.code) === code);
    if (!item) return json({ error: '离线快照中没有这个完整编码，请尝试前六位搜索。' }, 404);
    const ancestry = Array.isArray(item.path) ? item.path : typeof item.path === 'string' ? item.path.split(' > ').slice(0, -1) : [];
    return json({ ...item, additionalDuties: [], layers: [], additionalDutiesUnavailable: true, ancestors: ancestry.map(p => typeof p === 'string' ? { description: p } : p), adcvd: { status: 'unknown', label: '需按商品范围核验', url: 'https://access.trade.gov/adcvd' }, sourceUrl: 'https://hts.usitc.gov/search?query=' + encodeURIComponent(item.formattedCode || item.code), dataVersion: s.version, data: meta, offline: true, mode: 'offline_snapshot' });
  }
  return json({ error: '当前离线，请联网后重试。', offline: true }, 503);
}

async function cacheApi(request) {
  const cache = await caches.open(API);
  let attemptedNetwork = false;
  try {
    if (self.navigator.onLine === false || Date.now() < networkUnavailableUntil) throw new Error('offline');
    attemptedNetwork = true;
    const response = await timedFetch(request, 3500);
    if (response.status >= 500 || !/application\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('Content-Type') || '')) throw new Error('service_unavailable');
    networkUnavailableUntil = 0;
    if (response.ok) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - 120))) await cache.delete(key);
    }
    return response;
  } catch {
    if (attemptedNetwork) networkUnavailableUntil = Date.now() + 15000;
    const cached = await cache.match(request);
    if (cached) {
      const body = await cached.json();
      return json({ ...body, offline: true, mode: 'offline_cache', offlineNotice: '离线查看上次查询结果，税率以所示快照日期为准。' });
    }
    try { return await offlineResponse(new URL(request.url)); }
    catch { return json({ error: '离线数据尚未下载完成，请联网后打开一次应用。', offline: true }, 503); }
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) { event.respondWith(cacheApi(event.request)); return; }
  if (url.pathname === SNAPSHOT) {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await (await caches.open(DATA)).put(SNAPSHOT, response.clone());
          snapshotPromise = undefined;
          await notifyOfflineReady();
        }
        return response;
      } catch { return (await caches.open(DATA)).match(SNAPSHOT) || new Response('', { status: 503 }); }
    })());
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await (await caches.open(SHELL)).match('/');
      if (cached && ['/', '/index.html'].includes(url.pathname)) return cached;
      try {
        const response = await timedFetch(event.request, 3500);
        if (!response.ok) throw new Error('service_unavailable');
        return response;
      } catch { return cached || new Response('请联网后首次打开探迹关税。', { status: 503 }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await (await caches.open(SHELL)).match(event.request);
    if (cached) return cached;
    return fetch(event.request);
  })());
});
