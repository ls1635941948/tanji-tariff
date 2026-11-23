import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This portable backup uses plain JSON so file:// never needs fetch, a server,
// a service worker, or a browser decompression API.
const snapshot = JSON.parse(await readFile(new URL('../public/data/hts-offline.json', import.meta.url), 'utf8'));
if (snapshot.items.length < 20000) throw new Error('Refusing to package an incomplete tariff snapshot');
const strings = [];
const stringIds = new Map();
const intern = value => {
  const text = value || '';
  if (!stringIds.has(text)) { stringIds.set(text, strings.length); strings.push(text); }
  return stringIds.get(text);
};
const rows = snapshot.items.map(item => [
  item.code, intern(item.description), intern(item.descriptionZh), intern(item.general),
  intern(item.special), intern(item.other), intern(item.parentDescription),
  intern((item.unit || []).join(' / ')), item.rateInherited ? 1 : 0,
]);
const payload = JSON.stringify({
  version: snapshot.version, releasedAt: snapshot.releasedAt, fetchedAt: snapshot.fetchedAt,
  source: snapshot.source, license: snapshot.license, aliases: snapshot.chineseAliases,
  strings, rows,
}).replace(/</g, '\\u003c');

const html = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light"><title>探迹关税 · 离线查询</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#16383c;background:#f0f5f2;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}button,a{-webkit-tap-highlight-color:transparent}button{cursor:pointer}a{color:#176c63}header{background:#123f40;color:white;padding:24px max(20px,calc((100vw - 840px)/2)) 32px}header .top{display:flex;align-items:center;justify-content:space-between;gap:12px}h1{font-size:24px;letter-spacing:1px;margin:0}header p{margin:10px 0 0;color:#c9dfd8;font-size:14px;line-height:1.6}.badge{display:inline-block;border:1px solid #719b8a;border-radius:99px;padding:5px 10px;color:#d4eacc;font-size:12px;white-space:nowrap}main{width:min(840px,100%);margin:-15px auto 0;padding:0 16px 35px}.panel{background:#fff;border:1px solid #dde8e1;border-radius:19px;padding:20px;box-shadow:0 7px 30px #183c3110}.route{font-size:13px;color:#60756a;margin-bottom:16px}.route strong{color:#1c4b40}.search{display:flex;gap:9px}.search input{width:100%;min-width:0;border:1px solid #ccdcd4;border-radius:11px;padding:13px;background:#f8fbf9;outline:none;color:#183d3d}.search input:focus{border-color:#2a8570;box-shadow:0 0 0 3px #2a857015}button.primary{background:#1e655a;border:0;border-radius:11px;color:white;padding:12px 20px;font-weight:600}.samples{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0 0}.samples button{border:0;background:#edf4ef;color:#44685a;padding:7px 10px;border-radius:8px;font-size:12px}.notice{font-size:12px;line-height:1.7;color:#746239;background:#fbf7e9;padding:12px 14px;border-radius:10px;margin:15px 0 0}.tabs{display:flex;gap:7px;margin:21px 0 13px}.tabs button{border:1px solid #d6e3dc;border-radius:99px;padding:9px 17px;color:#506c60;background:#fff;font-size:14px}.tabs button[aria-selected=true]{background:#1b5149;color:#fff;border-color:#1b5149}.result-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;font-size:13px;color:#697c71}.result-head strong{color:#244d42}.result-card{background:#fff;border:1px solid #dce6df;border-radius:14px;padding:17px;margin-bottom:10px}.card-top{display:flex;gap:10px;align-items:start;justify-content:space-between}.code{font-size:18px;font-weight:700;color:#244c42;letter-spacing:.6px}.code button{border:0;background:transparent;padding:0;color:inherit;font:inherit;letter-spacing:inherit;text-align:left}.save{border:1px solid #dce6df;background:white;color:#416d59;border-radius:8px;padding:7px 10px;font-size:12px;white-space:nowrap}.save[aria-pressed=true]{background:#edf6ef;border-color:#a6c6ad}.zh{font-size:12px;color:#65806e;margin:7px 0}.description{font-size:14px;line-height:1.55;margin:9px 0 6px;color:#23473f;overflow-wrap:anywhere}.path{font-size:12px;color:#849187;line-height:1.5;margin:0;overflow-wrap:anywhere}.card-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:13px;padding-top:12px;border-top:1px solid #edf1ed}.rate-label{font-size:12px;color:#738678}.rate{font-weight:700;color:#1b6d54;font-size:18px;display:block;margin-top:3px}.details-button{background:#edf5f0;color:#3e6956;border:0;padding:9px 12px;border-radius:8px;font-size:13px}.empty{padding:35px 20px;text-align:center;line-height:1.8;color:#768779;background:#ffffff90;border:1px dashed #cbdad0;border-radius:15px;font-size:14px}.pager{display:flex;gap:12px;justify-content:center;margin:20px 0}.pager button{border:1px solid #cbded1;background:#fff;color:#38624d;border-radius:9px;padding:10px 16px}.pager button:disabled{opacity:.4;cursor:default}footer{font-size:11px;line-height:1.9;color:#8b998c;margin-top:25px;padding:0 3px}footer a{color:#6c8776}.storage{color:#9b6737;font-size:12px;line-height:1.6;margin:8px 0 0}dialog{width:min(660px,calc(100% - 28px));border:0;border-radius:19px;padding:0;color:#25443e;max-height:88vh;box-shadow:0 20px 80px #0004}dialog::backdrop{background:#153b3299}.dialog-inner{padding:24px}.dialog-head{display:flex;gap:10px;justify-content:space-between;align-items:start}.close{border:0;border-radius:99px;background:#edf2ee;color:#3b5a4c;font-size:20px;width:32px;height:32px;flex:0 0 32px}.dialog-inner h2{margin:0;font-size:23px;overflow-wrap:anywhere}.dialog-inner h3{font-size:14px;margin:24px 0 10px}.detail-grid{display:grid;grid-template-columns:1fr;gap:10px}.detail-cell{padding:13px;background:#f3f7f3;border-radius:10px;font-size:13px;line-height:1.65;overflow-wrap:anywhere}.detail-cell strong{display:block;margin-top:3px;color:#1a634b;font-size:18px}.external{display:block;text-align:center;background:#1d6557;color:#fff;text-decoration:none;padding:13px;border-radius:10px;margin-top:18px;font-size:14px}.small{font-size:12px;line-height:1.7;color:#7a887b}.error{background:#fff3e6;color:#8a562e;padding:15px;border-radius:12px;line-height:1.8}.loading{padding:30px 0;text-align:center;color:#687d6e}@media(min-width:650px){.detail-grid{grid-template-columns:repeat(3,1fr)}.search input{padding:15px}.panel{padding:24px}header{padding-top:30px;padding-bottom:39px}}@media(max-width:370px){header{padding:20px 16px 30px}h1{font-size:21px}.badge{font-size:10px}main{padding:0 11px 25px}.panel{padding:16px}.search{gap:6px}button.primary{padding:10px 13px}.code{font-size:16px}.result-card{padding:14px}}
</style>
</head>
<body>
<header><div class="top"><h1>探迹关税</h1><span class="badge">离线备用版</span></div><p>按 HS 编码查询美国进口基础税率</p></header>
<main>
<section class="panel" aria-label="关税查询">
<div class="route"><strong>美国进口税则</strong> · 常规税率查询</div>
<form id="search-form" class="search"><input id="query" aria-label="HS编码或商品名称" placeholder="输入 HS 编码 / 英文 / 常见中文" autocomplete="off" maxlength="120"><button class="primary" type="submit">查询</button></form>
<div class="samples"><button type="button" data-query="392590">392590</button><button type="button" data-query="电源适配器">电源适配器</button><button type="button" data-query="家具">家具</button><button type="button" data-query="plastic">plastic</button></div>
<p class="notice">仅查询所附版本的基础税率。加征税、反倾销税、反补贴税及商品归类须另行核验；显示的基础税率不等于最终应缴总税率。中文仅帮助定位类目。</p>
</section>
<nav class="tabs" aria-label="查询与收藏"><button id="search-tab" type="button" role="tab" aria-selected="true">查询结果</button><button id="favorites-tab" type="button" role="tab" aria-selected="false">我的收藏 <span id="favorite-count">0</span></button></nav>
<p id="storage-notice" class="storage" hidden></p>
<div id="result-head" class="result-head"></div><section id="results" aria-live="polite"><div class="loading">正在读取随文件附带的税则…</div></section>
<div id="pager" class="pager" hidden><button type="button" id="prev">上一页</button><button type="button" id="next">下一页</button></div>
<footer id="meta">本文件不需要联网即可查询；打开官方核验链接需要网络。收藏由浏览器保管，本地文件下可能无法长期保存。<br>本文件是浏览器备用文件，不是 iPhone 安装包。手机文件预览器可能无法运行查询，请使用支持脚本的浏览器。</footer>
</main>
<dialog id="detail"><div class="dialog-inner"><div class="dialog-head"><h2 id="detail-code"></h2><button class="close" id="close-detail" aria-label="关闭详情">×</button></div><div id="detail-body"></div></div></dialog>
<script type="application/json" id="snapshot">__PAYLOAD__</script>
<script>
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const format = code => code.length === 10 ? code.slice(0,4)+'.'+code.slice(4,6)+'.'+code.slice(6,8)+'.'+code.slice(8) : code.slice(0,4)+'.'+code.slice(4,6)+'.'+code.slice(6);
  const displayRate = rate => rate === 'Free' ? '免税（Free）' : rate || '未列明，请核验';
  const favoriteKey = 'tanji.tariff.standalone.favorites.v1';
  let data, items, byCode, matches = [], page = 0, tab = 'search', query = '', favorites = [], persistent = true;
  const pageSize = 25;
  try {
    data = JSON.parse(el('snapshot').textContent);
    items = data.rows.map(row => ({code:row[0],description:data.strings[row[1]],zh:data.strings[row[2]],general:data.strings[row[3]],special:data.strings[row[4]],other:data.strings[row[5]],parent:data.strings[row[6]],unit:data.strings[row[7]],inherited:!!row[8]}));
    byCode = new Map(items.map(item => [item.code,item]));
    for (const item of items) item.search = (item.parent+' '+item.description).toLowerCase();
    try {
      const stored = JSON.parse(localStorage.getItem(favoriteKey) || '[]');
      favorites = Array.isArray(stored) ? stored.filter(code => typeof code === 'string' && byCode.has(code)) : [];
      localStorage.setItem(favoriteKey, JSON.stringify(favorites));
    } catch (_) { persistent = false; }
    el('meta').insertAdjacentHTML('afterbegin', escape(data.version)+' · '+items.length.toLocaleString()+' 条税号<br>官方版本发布日期 '+escape(data.releasedAt || '未提供')+' · 数据获取日 '+escape(data.fetchedAt.slice(0,10))+'<br>来源：<a href="https://hts.usitc.gov/" target="_blank" rel="noopener noreferrer">美国国际贸易委员会 USITC</a> · '+escape(data.license)+'<br>');
    if (!persistent) { el('storage-notice').hidden = false; el('storage-notice').textContent = '当前浏览器无法保存本地收藏。收藏仍可在本次打开期间使用。'; }
    render();
  } catch (error) {
    el('results').innerHTML = '<div class="error">未能读取文件内的税则。请重新下载完整文件，并用支持 JavaScript 的浏览器打开。</div>';
    return;
  }
  function search(value) {
    query = value.trim().slice(0,120);
    el('query').value = query;
    page = 0; tab = 'search'; matches = [];
    if (!query) { render(); return; }
    if (/^[\d.\s-]+$/.test(query)) {
      const code = query.replace(/\D/g,'');
      if (code) matches = items.filter(item => item.code.startsWith(code));
    } else if (/[\u3400-\u9fff]/.test(query)) {
      const aliases = data.aliases.flatMap(alias => alias.words.filter(word => query.includes(word)).map(word => ({word,prefixes:alias.prefixes})));
      const length = Math.max(0,...aliases.map(alias => alias.word.length));
      const prefixes = aliases.filter(alias => alias.word.length === length).flatMap(alias => alias.prefixes);
      if (prefixes.length) matches = items.filter(item => prefixes.some(prefix => item.code.startsWith(prefix)));
    } else {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      matches = items.filter(item => words.every(word => item.search.includes(word)));
    }
    render();
  }
  function render() {
    el('search-tab').setAttribute('aria-selected',String(tab === 'search'));
    el('favorites-tab').setAttribute('aria-selected',String(tab === 'favorites'));
    el('favorite-count').textContent = favorites.length;
    const list = tab === 'favorites' ? favorites.map(code => byCode.get(code)).filter(Boolean) : matches;
    const maxPage = Math.max(0,Math.ceil(list.length/pageSize)-1);
    page = Math.min(page,maxPage);
    if (tab === 'search' && !query) {
      el('result-head').textContent = '';
      el('results').innerHTML = '<div class="empty">输入 HS 编码开始查询<br>支持 4～10 位编码前缀及常见中文类目</div>';
    } else if (!list.length) {
      el('result-head').textContent = '';
      el('results').innerHTML = '<div class="empty">'+(tab === 'favorites' ? '还没有收藏，查询后点击“收藏”即可保存。' : '没有找到结果。可尝试更短的 HS 编码或英文名称。<br>中文仅覆盖常见类目，不能自动判断准确归类。')+'</div>';
    } else {
      el('result-head').innerHTML = '<span>共 <strong>'+list.length.toLocaleString()+'</strong> 条'+(tab === 'favorites' ? '收藏' : '结果')+'</span><span>第 '+(page+1)+' / '+(maxPage+1)+' 页</span>';
      el('results').innerHTML = list.slice(page*pageSize,(page+1)*pageSize).map(item => {
        const saved = favorites.includes(item.code);
        return '<article class="result-card"><div class="card-top"><div class="code"><button type="button" data-detail="'+item.code+'">'+format(item.code)+'</button></div><button type="button" class="save" data-save="'+item.code+'" aria-pressed="'+saved+'">'+(saved?'已收藏':'收藏')+'</button></div>'+(item.zh?'<p class="zh">'+escape(item.zh)+' · 中文类目参考</p>':'')+'<p class="description">'+escape(item.description)+'</p><p class="path">'+escape(item.parent)+'</p><div class="card-bottom"><div><span class="rate-label">普通基础税率 · General</span><span class="rate">'+escape(displayRate(item.general))+'</span></div><button type="button" class="details-button" data-detail="'+item.code+'">查看详情 →</button></div></article>';
      }).join('');
    }
    el('pager').hidden = !list.length || maxPage === 0;
    el('prev').disabled = page === 0;
    el('next').disabled = page === maxPage;
  }
  function toggleFavorite(code) {
    if (!byCode.has(code)) return;
    favorites = favorites.includes(code) ? favorites.filter(value => value !== code) : [...favorites,code];
    if (persistent) {
      try { localStorage.setItem(favoriteKey,JSON.stringify(favorites)); }
      catch (_) { persistent=false; el('storage-notice').hidden=false; el('storage-notice').textContent='当前浏览器无法继续保存收藏；本次打开期间仍可使用。'; }
    }
    render();
  }
  function detail(code) {
    const item = byCode.get(code);
    if (!item) return;
    el('detail-code').textContent = format(item.code);
    el('detail-body').innerHTML = (item.zh ? '<p class="zh">'+escape(item.zh)+' · 中文类目参考</p>' : '')+'<p class="description">'+escape(item.description)+'</p><p class="path">'+escape(item.parent)+'</p><h3>税则列示税率</h3><div class="detail-grid"><div class="detail-cell">普通基础税率 · General<strong>'+escape(displayRate(item.general))+'</strong></div><div class="detail-cell">优惠税率 · Special<strong>'+escape(item.special || '未列明')+'</strong></div><div class="detail-cell">其他税率 · Column 2<strong>'+escape(item.other || '未列明')+'</strong></div></div><p class="small">'+(item.inherited ? '本行基础税率沿用上级税目。' : '')+'优惠税率需满足对应原产地和优惠安排；不能因商品从中国出口就直接使用。Column 2 不是叠加税。'+(item.unit?'计量单位：'+escape(item.unit)+'。':'')+'</p><p class="notice">以上均为税则原文列示。加征税、豁免、反倾销税和反补贴税未在此离线版核算，须按原产地、申报日期及具体商品另行核验；不显示最终总税率。</p><a class="external" href="https://hts.usitc.gov/search?query='+encodeURIComponent(format(item.code))+'" target="_blank" rel="noopener noreferrer">联网前往 USITC 核验此税号 ↗</a><p class="small">'+escape(data.version)+' · 此文件中的数据不会自动更新。</p>';
    const dialog = el('detail');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open','');
  }
  el('search-form').addEventListener('submit',event => {event.preventDefault();search(el('query').value);});
  document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click',() => search(button.dataset.query)));
  el('search-tab').addEventListener('click',() => {tab='search';page=0;render();});
  el('favorites-tab').addEventListener('click',() => {tab='favorites';page=0;render();});
  el('results').addEventListener('click',event => {
    const button = event.target.closest('button');
    if (button && button.dataset.save) toggleFavorite(button.dataset.save);
    if (button && button.dataset.detail) detail(button.dataset.detail);
  });
  el('prev').addEventListener('click',() => {page--;render();el('result-head').scrollIntoView({block:'start'});});
  el('next').addEventListener('click',() => {page++;render();el('result-head').scrollIntoView({block:'start'});});
  el('close-detail').addEventListener('click',() => {const dialog=el('detail');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');});
})();
</script>
</body></html>`;

const output = new URL('../../探迹关税_离线查询.html', import.meta.url);
await writeFile(output, html.replace('__PAYLOAD__', () => payload), 'utf8');
console.log(JSON.stringify({ output: fileURLToPath(output), records: rows.length, bytes: Buffer.byteLength(html.replace('__PAYLOAD__', () => payload)) }, null, 2));
