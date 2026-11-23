import { initTariffs, searchTariffs, getTariffDetail, getStatus } from './lib/tariff.mjs';

function error(status, message) {
  return Object.assign(new Error(message), { status, data: { error: message } });
}

function integer(value, fallback, min, max) {
  if (value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function adaptRow(row) {
  return {
    ...row,
    code: String(row.digits ?? row.code ?? '').replace(/\D/g, ''),
    formattedCode: row.formattedCode ?? row.code,
    general: row.general ?? row.generalRate ?? '',
    special: row.special ?? row.specialRate ?? '',
    other: row.other ?? row.otherRate ?? '',
    parentDescription: row.parentDescription ?? (Array.isArray(row.path) ? row.path.map(part => typeof part === 'string' ? part : part.description).filter(Boolean).join(' › ') : ''),
  };
}

function adaptDetail(detail) {
  const ancestry = detail.ancestors ?? (Array.isArray(detail.path) ? detail.path : typeof detail.path === 'string' ? detail.path.split(' > ').slice(0, -1) : []);
  return {
    ...adaptRow(detail),
    ancestors: ancestry.map(part => typeof part === 'string' ? { description: part } : part),
    additionalDuties: detail.additionalDuties ?? (detail.layers || []).map(layer => ({ ...layer, heading: layer.heading ?? layer.code, rate: layer.rate ?? layer.rateText, text: layer.text ?? layer.description, status: 'requires_review' })),
    adcvd: detail.adcvd ?? detail.adCvd ?? { status: 'unknown', label: '需按商品范围核验', url: 'https://access.trade.gov/adcvd' },
    sourceUrl: detail.sourceUrl ?? detail.officialUrl ?? 'https://hts.usitc.gov/',
    dataVersion: detail.dataVersion ?? detail.data?.version,
  };
}

function checkSignal(signal) {
  if (signal?.aborted) throw new DOMException('请求已取消。', 'AbortError');
}

// The interface matches the hosted app, while all lookups run on the device.
// The source snapshot and resolver are unchanged; candidate duties are not summed.
export async function localApi(path, signal) {
  checkSignal(signal);
  let url;
  try { url = new URL(path, 'https://tanji.invalid'); }
  catch { throw error(400, '请求格式不正确。'); }

  await initTariffs();
  checkSignal(signal);
  let result;
  if (url.pathname === '/api/status') {
    const status = getStatus();
    result = { ...status, appId: 'tanji-tariff', edition: status.edition ?? status.version, updatedAt: status.updatedAt ?? status.fetchedAt, recordCount: status.recordCount ?? status.rowCount, mode: status.mode ?? 'official_snapshot', deploymentMode: 'static_snapshot' };
  } else if (url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query || (query.length < 2 && !/[\u3400-\u9fff]/u.test(query)) || query.length > 120) throw error(400, '请输入至少 2 位 HS 编码或英文关键词，也支持常用中文品名。');
    const search = await searchTariffs({ query, limit: integer(url.searchParams.get('limit'), 30, 1, 100), offset: integer(url.searchParams.get('offset'), 0, 0, 50000) });
    result = { ...search, items: (search.items || []).map(adaptRow) };
  } else if (url.pathname.startsWith('/api/tariff/')) {
    let code;
    try { code = decodeURIComponent(url.pathname.slice('/api/tariff/'.length)).replace(/[.\s]/g, ''); }
    catch { throw error(400, '请求格式不正确。'); }
    if (!/^\d{2,10}$/.test(code)) throw error(400, '请输入有效的美国 HTS 编码。');
    const detail = await getTariffDetail(code);
    if (!detail) throw error(404, '未找到这个美国 HTS 编码，请尝试前六位搜索。');
    result = adaptDetail(detail);
  } else {
    throw error(404, '没有这个查询接口。');
  }
  checkSignal(signal);
  return typeof navigator !== 'undefined' && navigator.onLine === false ? {
    ...result, offline: true, mode: 'offline_cache',
    offlineNotice: '当前使用已保存的官方税则快照，数据获取日期见页面；候选加征条款仍需按官方适用条件核验。',
  } : result;
}
