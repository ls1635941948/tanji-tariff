import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initTariffs } from '../lib/tariff.mjs';
import { createAppServer } from '../server.mjs';

let server, base;
before(async () => {
  await initTariffs();
  server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('手机查询使用真实快照并统一税号格式', async () => {
  const response = await fetch(base + '/api/search?q=392590');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.items.length > 0);
  assert.equal(body.items[0].code, '3925900000');
  assert.equal(body.items[0].general, '5.3%');
  assert.match(body.data.version, /HTS/);
  const chinese = await fetch(base + '/api/search?q=' + encodeURIComponent('泵'));
  assert.equal(chinese.status, 200);
  assert.ok((await chinese.json()).total > 0);
});

test('六位码不能被误当作已确认的十位税号', async () => {
  const response = await fetch(base + '/api/tariff/392590');
  assert.equal(response.status, 404);
});

test('详情保留层级、核验状态，不给候选税加总', async () => {
  const response = await fetch(base + '/api/tariff/3925.90.00.00');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.general, '5.3%');
  assert.equal(body.code, '3925900000');
  assert.ok(body.ancestors.length > 0);
  assert.ok(body.ancestors.every(item => typeof item.description === 'string'));
  assert.equal(body.adcvd.status, 'unknown');
  assert.equal(body.totalRate, null);
  assert.ok(body.additionalDuties.every(duty => duty.status === 'requires_review'));
});

test('非法输入受限，网页以外的文件不能下载', async () => {
  const invalid = await fetch(base + '/api/search?q=x');
  assert.equal(invalid.status, 400);
  for (const suffix of ['/data/hts-full.json', '/server.mjs', '/runtime/access.json', '/%2e%2e%2fserver.mjs']) {
    assert.equal((await fetch(base + suffix)).status, 404);
  }
  assert.equal((await fetch(base + '/api/search?q=392590', { method: 'POST' })).status, 405);
});

test('安装文件与离线基础税则可用，源文件使用正确类型', async () => {
  const manifest = await (await fetch(base + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.equal((await fetch(base + icon.src)).status, 200);
  }
  const head = await fetch(base + '/data/hts-offline.json', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /application\/json/);
  assert.equal(await head.text(), '');
  const worker = await fetch(base + '/sw.js');
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.match(worker.headers.get('content-type'), /javascript/);
  const home = await fetch(base);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
