import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const snapshot = JSON.parse(await readFile(new URL('../public/data/hts-offline.json', import.meta.url), 'utf8'));
const fixture = { ...snapshot, items: snapshot.items.filter(row => row.code === '3925900000') };
const origin = 'https://tariff.example';

async function worker(fetchImpl, { online = true, saved = true } = {}) {
  const stores = new Map();
  const listeners = {};
  const messages = [];
  const key = request => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async match(request) { return data.get(key(request))?.clone(); },
        async put(request, response) { data.set(key(request), response.clone()); },
        async keys() { return [...data.keys()].map(url => new Request(url)); },
        async delete(request) { return data.delete(key(request)); },
        async addAll() {},
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  let requests = 0;
  const scope = {
    location: { origin }, navigator: { onLine: online },
    addEventListener(type, handler) { listeners[type] = handler; },
    clients: { matchAll: async () => [{ postMessage: message => messages.push(message) }], claim: async () => {} },
    skipWaiting: async () => {},
  };
  vm.runInNewContext(source, {
    self: scope, caches, URL, Response, Request, AbortController, setTimeout, clearTimeout,
    fetch: async (...args) => { requests++; return fetchImpl(...args); },
  });
  await (await caches.open('tanji-1.0.2-20261123-shell')).put('/', new Response('<h1>saved app</h1>'));
  if (saved) await (await caches.open('tanji-official-data-v1')).put('/data/hts-offline.json', new Response(JSON.stringify(fixture)));
  return {
    messages, get requests() { return requests; },
    async request(path, mode = 'cors') {
      let response;
      listeners.fetch({ request: { url: origin + path, method: 'GET', mode }, respondWith(value) { response = value; } });
      return response;
    },
    async message(data) { let result; listeners.message({ data, source: { postMessage: message => messages.push(message) }, waitUntil(value) { result = value; } }); await result; },
  };
}

test('桌面图标启动时直接打开已保存首页，不等待失效网址', async () => {
  const sw = await worker(() => new Promise(() => {}));
  const response = await sw.request('/?source=installed', 'navigate');
  assert.match(await response.text(), /saved app/);
  assert.equal(sw.requests, 0);
});

test('入口返回 HTML 时回退到基础税则，连续查询不重复等待网络', async () => {
  const sw = await worker(async () => new Response('<h1>not found</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } }));
  const first = await (await sw.request('/api/search?q=392590')).json();
  assert.equal(first.items[0].general, '5.3%');
  assert.equal(first.mode, 'offline_snapshot');
  const detail = await (await sw.request('/api/tariff/3925900000')).json();
  assert.equal(detail.general, '5.3%');
  assert.equal(detail.additionalDutiesUnavailable, true);
  assert.equal(sw.requests, 1);
});

test('手机离线时直接查询已保存数据，不发网络请求', async () => {
  const sw = await worker(async () => { throw new Error('network'); }, { online: false });
  const body = await (await sw.request('/api/search?q=392590')).json();
  assert.equal(body.total, 1);
  assert.equal(sw.requests, 0);
});

test('正常 JSON 404 保留未找到结果，不用旧快照覆盖', async () => {
  const sw = await worker(async () => new Response(JSON.stringify({ error: '未找到' }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
  const response = await sw.request('/api/tariff/392590');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, '未找到');
});

test('快照下载失败时明确通知页面，能重试恢复保存', async () => {
  let available = false;
  const sw = await worker(async () => {
    if (!available) throw new Error('network');
    return new Response(JSON.stringify(snapshot));
  }, { saved: false });
  await sw.message({ type: 'OFFLINE_STATUS' });
  assert.ok(sw.messages.some(message => message.type === 'OFFLINE_FAILED'));
  available = true;
  await sw.message({ type: 'OFFLINE_STATUS' });
  assert.ok(sw.messages.some(message => message.type === 'OFFLINE_READY' && message.recordCount > 10000));
});
