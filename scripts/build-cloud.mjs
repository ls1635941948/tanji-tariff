import { readFile, writeFile, mkdir, readdir, cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { initTariffs, getStatus } from '../lib/tariff.mjs';
import { prepareData } from './prepare-data.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let OUTPUT = path.resolve(ROOT, '../tanji-tariff-cloud');
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const args = process.argv.slice(2);
let base = '/';
for (let index = 0; index < args.length; index++) {
  const option = args[index];
  if (!['--base', '--out'].includes(option) || !args[index + 1]) throw new Error('Usage: node scripts/build-cloud.mjs [--base /repository-name/] [--out dist]');
  const value = args[++index];
  if (option === '--base') base = value;
  else OUTPUT = path.resolve(ROOT, value);
}
base = base.replace(/\/{2,}/g, '/');
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base) || base.split('/').some(part => part === '.' || part === '..')) throw new Error('部署路径必须为 / 或 /repository-name/。');
if (OUTPUT === ROOT || ROOT.startsWith(OUTPUT + path.sep)) throw new Error('输出目录不能是源目录或其上级。');
const relativeOutput = path.relative(ROOT, OUTPUT).split(path.sep);
if (relativeOutput[0] !== '..' && relativeOutput[0] !== 'dist' && !(relativeOutput[0] === 'runtime' && relativeOutput.length > 1)) throw new Error('应用目录内仅允许输出到 dist 或 runtime 的子目录，不能覆盖源码。');

await prepareData();
await initTariffs();
const status = getStatus();
const raw = JSON.parse(await readFile(path.join(ROOT, 'data/hts-full.json'), 'utf8'));
if (!Array.isArray(raw.rows) || raw.rows.length < 25000 || status.recordCount < 10000) throw new Error('完整官方税则校验失败，未生成部署包。');
raw.searchable_count = status.recordCount;
if (!Number.isFinite(Date.parse(raw.fetched_at))) throw new Error('数据获取日期缺失。');
const swTemplate = await readFile(path.join(ROOT, 'templates/cloud-sw.js'), 'utf8');
if (!swTemplate.includes('__DATA_VERSION__')) throw new Error('静态版离线模板缺少数据版本占位符。');

await rm(OUTPUT, { recursive: true, force: true });
await mkdir(OUTPUT, { recursive: true });
await cp(path.join(ROOT, 'public'), OUTPUT, { recursive: true });
for (const filename of ['install.html', 'install.js', 'phone-qr.png', 'data/hts-offline.json']) await rm(path.join(OUTPUT, filename), { force: true });
await mkdir(path.join(OUTPUT, 'lib'), { recursive: true });
await mkdir(path.join(OUTPUT, 'vendor/tariff-resolver'), { recursive: true });
await cp(path.join(ROOT, 'vendor/tariff-resolver/core'), path.join(OUTPUT, 'vendor/tariff-resolver/core'), { recursive: true });
for (const filename of ['LICENSE', 'status_overrides.json', 'PROVENANCE.json']) await cp(path.join(ROOT, 'vendor/tariff-resolver', filename), path.join(OUTPUT, 'vendor/tariff-resolver', filename));
for (const filename of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(ROOT, filename), path.join(OUTPUT, filename));

const readFileImport = "import { readFile } from 'node:fs/promises';";
let tariff = await readFile(path.join(ROOT, 'lib/tariff.mjs'), 'utf8');
if (!tariff.includes(readFileImport)) throw new Error('税则模块读取方式已改变，请更新构建脚本。');
tariff = tariff.replace(readFileImport, `async function readFile(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok || !/application\\/(?:[\\w.-]+\\+)?json\\b/i.test(response.headers.get('Content-Type') || '')) throw new Error('无法读取已发布的税则快照，请保持联网后重试。');
  return response.text();
}`);
await writeFile(path.join(OUTPUT, 'lib/tariff.mjs'), tariff);
await cp(path.join(ROOT, 'lib/duty-assessment.mjs'), path.join(OUTPUT, 'lib/duty-assessment.mjs'));
await cp(path.join(ROOT, 'data/reviewed-duty-rules.json'), path.join(OUTPUT, 'data/reviewed-duty-rules.json'));
await cp(path.join(ROOT, 'templates/cloud-api.mjs'), path.join(OUTPUT, 'cloud-api.mjs'));
await writeFile(path.join(OUTPUT, 'data/hts-full.json'), JSON.stringify(raw));
await writeFile(path.join(OUTPUT, 'data/status.json'), JSON.stringify({ ...status, appId: 'tanji-tariff', deploymentMode: 'static_snapshot', buildVersion: '__BUILD_VERSION__' }));

let app = await readFile(path.join(OUTPUT, 'app.js'), 'utf8');
const apiStart = app.indexOf('async function api(path, signal) {');
const apiEnd = app.indexOf('\nfunction renderHistory()', apiStart);
if (apiStart < 0 || apiEnd < 0) throw new Error('页面查询接口已改变，请更新构建脚本。');
app = app.slice(0, apiStart) + `async function api(path, signal) {
  const data = await localApi(path, signal);
  updateConnectivity(data);
  return data;
}
` + app.slice(apiEnd);
app = "import { localApi } from './cloud-api.mjs';\n" + app;
app = app.replace("navigator.serviceWorker.register('/sw.js')", `navigator.serviceWorker.register(${JSON.stringify(base + 'sw.js')})`);
app = app.replaceAll('离线模式 · 当前使用设备保存的税则快照，联网后可更新。', '离线模式 · 使用此设备保存的税则快照，数据获取日期见页尾。');
app = app.replaceAll('离线缓存 · 基础税率与候选条款来自上次保存的快照，联网后可重新查询核对。', '离线缓存 · 基础税率与候选条款来自页面所示日期的快照，联网后请通过官方来源核对。');
await writeFile(path.join(OUTPUT, 'app.js'), app);

let html = await readFile(path.join(OUTPUT, 'index.html'), 'utf8');
html = html.replaceAll('试用入口由当前电脑提供，首次打开与在线更新时需保持电脑开机。保存基础税则后可离线查询。', '部署到固定网址后，手机可独立使用。添加后首次打开请等候离线保存完成；税则按页面所示获取日期提供，并非实时税率。');
html = html.replaceAll('离线模式 · 当前使用设备保存的税则快照，联网后可更新。', '离线模式 · 使用此设备保存的税则快照，数据获取日期见页尾。');
html = html.replace('仅供查询与核对，申报以海关及主管机构认定为准。', '本版使用发布快照，数据获取日期见上方，并非实时税率。申报以海关及主管机构认定为准。');
html = html.replace(/\b(href|src)="\/(?!\/)([^"]*)"/g, (_match, attribute, target) => `${attribute}="${base}${target}"`);
await writeFile(path.join(OUTPUT, 'index.html'), html);

const manifest = JSON.parse(await readFile(path.join(OUTPUT, 'manifest.webmanifest'), 'utf8'));
manifest.id = base;
manifest.scope = base;
manifest.start_url = base + '?source=installed';
manifest.version = '__BUILD_VERSION__';
for (const icon of manifest.icons || []) icon.src = base + icon.src.replace(/^\//, '');
for (const shortcut of manifest.shortcuts || []) shortcut.url = base + shortcut.url.replace(/^\//, '');
await writeFile(path.join(OUTPUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(OUTPUT, '.nojekyll'), '');
await writeFile(path.join(OUTPUT, '404.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>页面不存在 · 探迹关税</title><body><h1>页面不存在</h1><p><a href="${base}">返回探迹关税</a></p></body></html>\n`);
await writeFile(path.join(OUTPUT, '_headers'), `/*
  Cache-Control: no-cache
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
${base}sw.js
  Service-Worker-Allowed: ${base}
`);

async function files(directory, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) output.push(...await files(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}
const initialFiles = await files(OUTPUT);
const assets = initialFiles.filter(filename => !['data/hts-full.json', 'sw.js', '_headers', '404.html', '.nojekyll', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/tariff-resolver/LICENSE', 'vendor/tariff-resolver/PROVENANCE.json'].includes(filename));
await writeFile(path.join(OUTPUT, 'asset-manifest.json'), JSON.stringify(assets, null, 2) + '\n');
const fingerprint = createHash('sha256').update(swTemplate);
for (const filename of await files(OUTPUT)) {
  if (filename === 'sw.js') continue;
  fingerprint.update(filename + '\0').update(await readFile(path.join(OUTPUT, filename))).update('\0');
}
const dataVersion = fingerprint.digest('hex').slice(0, 12);
for (const filename of ['data/status.json', 'manifest.webmanifest']) {
  const content = await readFile(path.join(OUTPUT, filename), 'utf8');
  await writeFile(path.join(OUTPUT, filename), content.replaceAll('__BUILD_VERSION__', dataVersion));
}
await writeFile(path.join(OUTPUT, 'sw.js'), swTemplate.replaceAll('__DATA_VERSION__', dataVersion));
const completeFiles = await files(OUTPUT);
if (completeFiles.length >= 20000) throw new Error('部署文件数超过免费静态托管限制。');
let bytes = 0;
for (const filename of completeFiles) {
  const size = (await stat(path.join(OUTPUT, filename))).size;
  if (size >= MAX_ASSET_BYTES) throw new Error('单个静态文件超过 25 MiB：' + filename);
  bytes += size;
}
await writeFile(path.join(OUTPUT, 'build-info.json'), JSON.stringify({ app: '探迹关税', base, dataVersion, version: raw.version, fetchedAt: raw.fetched_at, recordCount: status.recordCount, sourceRows: raw.rows.length, files: completeFiles.length + 1, assetBytes: bytes, deploymentMode: 'static_snapshot', requiresServer: false }, null, 2) + '\n');
console.log(JSON.stringify({ output: OUTPUT, base, dataVersion, recordCount: status.recordCount, files: completeFiles.length + 1, bytes }, null, 2));
