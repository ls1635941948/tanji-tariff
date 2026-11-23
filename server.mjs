import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGzip } from 'node:zlib';
import { initTariffs, searchTariffs, getTariffDetail, getStatus } from './lib/tariff.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function sendJson(req, res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { ...securityHeaders, 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function integer(value, fallback, min, max) {
  if (value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function adaptRow(row) {
  return { ...row, code: String(row.digits ?? row.code ?? '').replace(/\D/g, ''), formattedCode: row.formattedCode ?? row.code, general: row.general ?? row.generalRate ?? '', special: row.special ?? row.specialRate ?? '', other: row.other ?? row.otherRate ?? '', parentDescription: row.parentDescription ?? (Array.isArray(row.path) ? row.path.map(p => typeof p === 'string' ? p : p.description).filter(Boolean).join(' › ') : '') };
}

function adaptDetail(detail) {
  const row = adaptRow(detail);
  const ancestry = detail.ancestors ?? (Array.isArray(detail.path) ? detail.path : typeof detail.path === 'string' ? detail.path.split(' > ').slice(0, -1) : []);
  return {
    ...row,
    ancestors: ancestry.map(p => typeof p === 'string' ? { description: p } : p),
    additionalDuties: detail.additionalDuties ?? (detail.layers || []).map(layer => ({ ...layer, heading: layer.heading ?? layer.code, rate: layer.rate ?? layer.rateText, text: layer.text ?? layer.description, status: 'requires_review' })),
    adcvd: detail.adcvd ?? detail.adCvd ?? { status: 'unknown', label: '需按商品范围核验', url: 'https://access.trade.gov/adcvd' },
    sourceUrl: detail.sourceUrl ?? detail.officialUrl ?? 'https://hts.usitc.gov/',
    dataVersion: detail.dataVersion ?? detail.data?.version,
  };
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.setHeader('Allow', 'GET, HEAD');
        return sendJson(req, res, 405, { error: '此服务仅支持查询。' });
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return sendJson(req, res, 200, { ok: true });
      if (url.pathname === '/api/status') {
        const s = await getStatus();
        return sendJson(req, res, 200, { ...s, appId: 'tanji-tariff', edition: s.edition ?? s.version, updatedAt: s.updatedAt ?? s.fetchedAt, recordCount: s.recordCount ?? s.rowCount, mode: s.mode ?? 'official_snapshot' });
      }
      if (url.pathname === '/api/search') {
        const query = (url.searchParams.get('q') || '').trim();
        if (!query || (query.length < 2 && !/[\u3400-\u9fff]/u.test(query)) || query.length > 120) return sendJson(req, res, 400, { error: '请输入至少 2 位 HS 编码或英文关键词，也支持常用中文品名。' });
        const result = await searchTariffs({ query, limit: integer(url.searchParams.get('limit'), 30, 1, 100), offset: integer(url.searchParams.get('offset'), 0, 0, 50000) });
        return sendJson(req, res, 200, { ...result, items: (result.items || []).map(adaptRow) });
      }
      if (url.pathname.startsWith('/api/tariff/')) {
        const code = decodeURIComponent(url.pathname.slice('/api/tariff/'.length)).replace(/[.\s]/g, '');
        if (!/^\d{2,10}$/.test(code)) return sendJson(req, res, 400, { error: '请输入有效的美国 HTS 编码。' });
        const detail = await getTariffDetail(code);
        if (!detail) return sendJson(req, res, 404, { error: '未找到这个美国 HTS 编码，请尝试前六位搜索。' });
        return sendJson(req, res, 200, adaptDetail(detail));
      }
      if (url.pathname === '/api/install') {
        let access = {};
        try { access = JSON.parse(await readFile(path.join(ROOT, 'runtime/access.json'), 'utf8')); } catch {}
        return sendJson(req, res, 200, { publicUrl: access.publicUrl || null, localUrl: access.localUrl || null, temporary: true });
      }
      if (url.pathname.startsWith('/api/')) return sendJson(req, res, 404, { error: '没有这个查询接口。' });
      const requestPath = decodeURIComponent(url.pathname);
      const relative = requestPath === '/' ? 'index.html' : requestPath === '/install' ? 'install.html' : requestPath.slice(1);
      if (relative.split(/[\\/]/).some(p => p === '..' || p.startsWith('.'))) return sendJson(req, res, 404, { error: '页面不存在。' });
      const target = path.resolve(PUBLIC, relative);
      if (!target.startsWith(PUBLIC + path.sep)) return sendJson(req, res, 404, { error: '页面不存在。' });
      let info;
      try { info = await stat(target); } catch { return sendJson(req, res, 404, { error: '页面不存在。' }); }
      if (!info.isFile()) return sendJson(req, res, 404, { error: '页面不存在。' });
      const ext = path.extname(target);
      const headers = { ...securityHeaders, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ['.html', '.json', '.webmanifest'].includes(ext) || relative === 'sw.js' ? 'no-cache' : 'public, max-age=3600', 'Vary': 'Accept-Encoding' };
      if (relative === 'sw.js') headers['Service-Worker-Allowed'] = '/';
      const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && info.size > 1024 && !['.png', '.ico'].includes(ext);
      if (gzip) headers['Content-Encoding'] = 'gzip'; else headers['Content-Length'] = info.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(target);
      stream.on('error', () => res.destroy());
      if (gzip) stream.pipe(createGzip()).pipe(res); else stream.pipe(res);
    } catch (error) {
      console.error('[request]', error.message);
      if (!res.headersSent) sendJson(req, res, error instanceof URIError ? 400 : 503, { error: error instanceof URIError ? '请求格式不正确。' : '暂时无法读取税则数据，请稍后重试。' });
      else res.destroy();
    }
  });
}

export async function startServer({ port = Number(process.env.PORT || 8787), host = process.env.HOST || '0.0.0.0' } = {}) {
  await initTariffs();
  const server = createAppServer();
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const updateWhenStale = async () => {
    const current = getStatus();
    const lastFetch = Date.parse(current.fetchedAt || current.updatedAt || '');
    if (Number.isFinite(lastFetch) && Date.now() - lastFetch < 24 * 60 * 60 * 1000) return;
    try {
      const { updateData } = await import('./scripts/update-data.mjs');
      const status = await updateData();
      console.log('官方税则已更新：' + status.version);
    } catch (error) { console.error('本次更新未完成，继续使用已保存的税则：' + error.message); }
  };
  const updateTimer = setInterval(updateWhenStale, 6 * 60 * 60 * 1000);
  updateTimer.unref();
  server.once('close', () => clearInterval(updateTimer));
  void updateWhenStale();
  console.log('探迹关税已启动：http://localhost:' + server.address().port);
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startServer().catch(error => { console.error('启动失败：', error.message); process.exitCode = 1; });
}
