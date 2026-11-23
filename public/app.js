const $ = (id) => document.getElementById(id);
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const textOnly = (value = '') => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
const safeUrl = (value, fallback = 'https://hts.usitc.gov/') => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : fallback; } catch { return fallback; } };
const codeKey = value => String(value || '').replace(/\D/g, '');
const normalizeFavorites = items => [...new Map(items.filter(item => item && typeof item.code === 'string' && codeKey(item.code)).map(item => [codeKey(item.code), {...item, code: codeKey(item.code)}])).values()];
const state = {items:[],total:0,query:'',offset:0,limit:30,loading:false,request:0,detailRequest:0,status:null,tab:'query',controller:null};
const readStore = (key, fallback) => { try { const data = JSON.parse(localStorage.getItem(key)); return data ?? fallback; } catch { return fallback; } };
const writeStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { showToast('当前浏览器未允许保存，收藏仅在本次打开时保留'); } };
let history = readStore('tanji.tariff.history.v1', []);
if (!Array.isArray(history)) history = [];
let favorites = readStore('tanji.tariff.favorites.v1', []);
if (!Array.isArray(favorites)) favorites = [];
favorites = normalizeFavorites(favorites);
let toastTimeout;
let installPrompt = null;

function updateConnectivity(data) {
  const offline = !navigator.onLine || data?.offline === true || ['offline_snapshot','offline_cache'].includes(data?.mode);
  $('offline-banner').hidden = !offline;
  if (offline) $('offline-banner').querySelector('p').textContent = '离线模式 · 当前使用设备保存的税则快照，联网后可更新。';
}

function showToast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 2600); }
function formatCode(code) { const plain = String(code || '').replace(/\D/g,''); return plain.length >= 8 ? [plain.slice(0,4),plain.slice(4,6),plain.slice(6,8),plain.slice(8)].filter(Boolean).join('.') : String(code || ''); }
function generalRate(item) { const value = item?.general ?? item?.generalRate ?? item?.mfn ?? ''; return textOnly(value); }
function rateLabel(value) { if (!value) return '详见下级税号'; if (/^free$/i.test(value)) return '0%'; return value; }
function referenceAssessment(item) {
  const assessment = item?.dutyAssessment;
  return assessment?.status === 'conditional_reference' && typeof assessment.referenceRatePct === 'number' && Number.isFinite(assessment.referenceRatePct) && assessment.referenceRatePct >= 0 ? assessment : null;
}
function percentLabel(value) { return typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString('en-US', {useGrouping:false,maximumFractionDigits:6})}%` : '待核验'; }
function assessmentDate(assessment) { return textOnly(assessment?.reviewedAt || ''); }
function assessmentLink(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } }
function assessmentHtml(item) {
  const assessment = referenceAssessment(item);
  if (!assessment) {
    const note = textOnly(item?.dutyAssessment?.note || '基础税率不含可能适用的加征税与其他税费。请按原产地、商品范围、进口日期及豁免条件核验。');
    return `<section class="duty-assessment assessment-pending" data-assessment-status="needs_review" aria-label="综合税率待核验"><div class="assessment-heading"><h3>综合税率</h3><strong>待核验</strong></div><p>${escapeHtml(note)}</p></section>`;
  }
  const components = Array.isArray(assessment.components) ? assessment.components : [];
  const conditions = Array.isArray(assessment.conditions) ? assessment.conditions.map(textOnly).filter(Boolean) : [];
  const sources = Array.isArray(assessment.sources) ? assessment.sources.filter(source => assessmentLink(source?.url)) : [];
  const expression = components.length && components.every(component => typeof component.ratePct === 'number' && Number.isFinite(component.ratePct)) ? components.map(component => percentLabel(component.ratePct)).join(' + ') : '';
  const reviewedAt = assessmentDate(assessment);
  return `<section class="duty-assessment assessment-reference" data-assessment-status="conditional_reference" aria-label="一般情形参考税率"><div class="assessment-heading"><h3>一般情形参考</h3><strong>${escapeHtml(percentLabel(assessment.referenceRatePct))}</strong></div><p class="assessment-check">须核对适用条件</p>${assessment.scenario?`<p class="assessment-scenario">${escapeHtml(textOnly(assessment.scenario))}</p>`:''}${expression?`<p class="assessment-expression" aria-label="参考税率构成">${escapeHtml(expression)}</p>`:''}${components.length?`<div class="assessment-components">${components.map(component=>{const link=assessmentLink(component.sourceUrl);return `<div><span>${escapeHtml(textOnly(component.label || '税率组成'))}${component.heading?`<small>${link?`<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(component.heading)} ↗</a>`:escapeHtml(component.heading)}</small>`:''}</span><strong>${escapeHtml(percentLabel(component.ratePct))}</strong></div>`;}).join('')}</div>`:''}<div class="assessment-conditions"><h4>适用条件</h4>${conditions.length?`<ul>${conditions.map(condition=>`<li>${escapeHtml(condition)}</li>`).join('')}</ul>`:'<p>请核对原产地、进口日期、商品范围与豁免条件。</p>'}</div>${assessment.note?`<p class="assessment-note">${escapeHtml(textOnly(assessment.note))}</p>`:''}${reviewedAt?`<p class="assessment-reviewed">核验日期：${escapeHtml(reviewedAt)}</p>`:''}${sources.length?`<div class="assessment-sources"><h4>核验来源</h4>${sources.map(source=>`<a href="${escapeHtml(assessmentLink(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(textOnly(source.title || new URL(source.url).hostname))} ↗</a>`).join('')}</div>`:''}</section>`;
}
function formatVersion(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [value.edition || value.year, value.revision ? `Revision ${value.revision}` : '', value.label || ''].filter(Boolean).join(' · ');
}
function sourceVersion(status = state.status) { if (!status) return ''; return formatVersion(status.dataVersion || status.version) || [status.edition || status.year || '', status.revision ? `Revision ${status.revision}` : ''].filter(Boolean).join(' · '); }

async function api(path, signal) {
  const response = await fetch(path, {signal, headers:{Accept:'application/json'},cache:'no-store'});
  let data;
  try { data = await response.json(); } catch { throw new Error('暂时无法读取查询服务，请稍后重试。'); }
  if (!response.ok) throw new Error(data.message || data.error || '查询服务暂时无法连接，请稍后重试。');
  updateConnectivity(data);
  return data;
}

function renderHistory() {
  $('history-section').hidden = history.length === 0;
  $('history-list').innerHTML = history.map(query => `<button class="history-chip" type="button" data-query="${escapeHtml(query)}">${escapeHtml(query)}</button>`).join('');
}
function rememberQuery(query) { history = [query, ...history.filter(item => item !== query)].slice(0,6); writeStore('tanji.tariff.history.v1', history); renderHistory(); }
function setTab(tab) {
  state.tab = tab;
  const queryActive = tab === 'query';
  $('query-tab').classList.toggle('active',queryActive); $('favorites-tab').classList.toggle('active',!queryActive);
  $('query-tab').setAttribute('aria-selected',String(queryActive)); $('favorites-tab').setAttribute('aria-selected',String(!queryActive));
  $('query-panel').hidden = !queryActive; $('favorites-panel').hidden = queryActive;
  if (!queryActive) renderFavorites();
}
const starSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.6l6.3-.9z"/></svg>';
function cardHtml(item, favoriteView = false) {
  const code = codeKey(item.code || item.htsno);
  const rate = generalRate(item);
  const assessment = referenceAssessment(item);
  const saved = favorites.some(savedItem => savedItem.code === code);
  const description = textOnly(item.description || item.descriptionEn || '商品细分税号');
  const descriptionZh = textOnly(item.descriptionZh || '');
  const plain = code.replace(/\D/g,'');
  const kind = plain.length >= 10 ? '10 位税号' : plain.length >= 8 ? '8 位税目' : '税目分类';
  const savedDate = item.savedAt && !Number.isNaN(new Date(item.savedAt).getTime()) ? new Date(item.savedAt).toLocaleDateString('zh-CN', {year:'numeric',month:'2-digit',day:'2-digit'}) : '';
  const savedVersion = formatVersion(item.savedDataVersion);
  const reviewedAt = assessmentDate(assessment);
  const snapshotNote = savedDate || savedVersion ? [`保存于 ${savedDate || savedVersion}`, savedDate && savedVersion ? savedVersion : '', assessment && reviewedAt ? `参考核验 ${reviewedAt}` : ''].filter(Boolean).join(' · ') : '收藏记录，打开详情核对当前快照';
  const referenceLabel = favoriteView ? '保存时一般情形参考' : '一般情形参考';
  const primary = assessment ? `<span class="card-reference-label">${referenceLabel}</span><strong class="card-reference-value">${escapeHtml(percentLabel(assessment.referenceRatePct))}</strong><span class="card-reference-check">须核对适用条件</span>` : '<span class="card-review-status">综合税率待核验</span>';
  const condition = assessment ? (!favoriteView && reviewedAt ? `参考核验 ${escapeHtml(reviewedAt)}` : '参考条件见税号详情') : '加征条款与适用条件需另行核验';
  return `<article class="result-card" data-assessment-status="${assessment?'conditional_reference':'needs_review'}"><button class="result-main" type="button" data-code="${escapeHtml(code)}" aria-label="查看 ${escapeHtml(code)} 的税率详情"><span class="result-code">${escapeHtml(formatCode(code))}<span class="code-kind">${kind}</span></span><div class="result-name" lang="en">${escapeHtml(description)}</div>${descriptionZh ? `<div class="result-name-en"><span class="chinese-reference-label">中文品类参考</span>${escapeHtml(descriptionZh)}</div>` : ''}${item.parentDescription ? `<div class="result-parent">${escapeHtml(textOnly(item.parentDescription))}</div>` : ''}${favoriteView ? `<div class="favorite-snapshot-note">${escapeHtml(snapshotNote)}</div>` : ''}</button><div class="result-rate"><div class="card-assessment">${primary}</div><p class="card-base-rate">${favoriteView?'保存时基础税率':'基础税率'} <strong>${escapeHtml(rateLabel(rate))}</strong><span>不含加征</span></p><p class="card-rate-condition">${condition}</p><div class="result-bottom"><button class="favorite-button ${saved?'saved':''}" type="button" data-favorite="${escapeHtml(code)}" aria-label="${saved?'取消收藏':'收藏'} ${escapeHtml(code)}" aria-pressed="${saved}">${starSvg}</button><button class="icon-button result-arrow" type="button" data-code="${escapeHtml(code)}" aria-label="查看 ${escapeHtml(code)} 详情"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg></button></div></div></article>`;
}
function renderResults() {
  $('results-list').innerHTML = state.items.map(item => cardHtml(item)).join('');
  $('results-meta').hidden = !state.query || !state.items.length;
  const total = Number.isFinite(state.total) ? state.total : state.items.length;
  $('results-count').textContent = `已显示 ${state.items.length} / ${total.toLocaleString('zh-CN')} 条`;
  $('load-more').hidden = state.items.length >= total || !state.items.length || state.loading;
}
function renderFavorites() {
  $('favorites-count').textContent = String(favorites.length);
  $('favorites-empty').hidden = favorites.length > 0;
  $('favorites-list').innerHTML = favorites.map(item => cardHtml(item, true)).join('');
}
function toggleFavorite(code, item) {
  code = codeKey(code);
  const index = favorites.findIndex(candidate => candidate.code === code);
  if (index !== -1) { favorites.splice(index,1); showToast('已取消收藏'); }
  else {
    const found = item || state.items.find(candidate => codeKey(candidate.code) === code);
    if (!found) return;
    favorites.unshift({...found,code,savedAt:new Date().toISOString(),savedDataVersion:formatVersion(found.dataVersion) || sourceVersion(found.data) || sourceVersion()});
    if (favorites.length > 100) favorites.length = 100;
    showToast('已收藏到这台设备');
  }
  writeStore('tanji.tariff.favorites.v1', favorites); renderResults(); renderFavorites();
  const detailFavorite = $('detail-favorite');
  if (detailFavorite?.dataset.favorite === code) { const saved = favorites.some(candidate => candidate.code === code); detailFavorite.classList.toggle('saved',saved); detailFavorite.setAttribute('aria-label',saved?'取消收藏该税号':'收藏该税号'); detailFavorite.setAttribute('aria-pressed',String(saved)); }
}

function renderLoading(append) {
  $('welcome-state').hidden = true;
  $('query-status').innerHTML = append ? '' : '<div class="loading-state" aria-label="正在查询税则"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
  if (!append) { $('results-list').innerHTML = ''; $('results-meta').hidden = true; }
  $('load-more').hidden = !append;
  $('load-more').disabled = append;
  if (append) $('load-more').textContent = '正在读取更多…';
}
async function search(query, append = false) {
  query = String(query || '').trim();
  if (!query) { $('search-input').focus(); return; }
  if (query.length > 100) { showToast('请输入 100 个字符以内的关键词'); return; }
  state.controller?.abort();
  const controller = new AbortController(); state.controller = controller;
  const request = ++state.request;
  if (!append) { state.query=query; state.items=[]; state.offset=0; }
  state.loading=true; $('search-input').value = query; $('search-submit').disabled=true;
  setTab('query'); renderLoading(append);
  try {
    const offset = append ? state.items.length : 0;
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&limit=${state.limit}&offset=${offset}`,controller.signal);
    if (request !== state.request) return;
    const sourceItems = Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
    const queryVersion = formatVersion(data.dataVersion) || sourceVersion(data.data) || sourceVersion();
    const items = sourceItems.map(item => ({...item,code:codeKey(item.code || item.htsno),dataVersion:item.dataVersion || queryVersion}));
    state.items = append ? [...state.items,...items] : items;
    state.total = Number(data.total ?? state.items.length); state.offset = offset;
    state.loading=false; $('query-status').innerHTML='';
    rememberQuery(query); renderResults();
    const url = new URL(location.href); url.searchParams.set('q',query); window.history.replaceState(null,'',url);
    if (!state.items.length) $('query-status').innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><h2>没有找到匹配的税号</h2><p>试试前 6 位 HS 编码，或更简短的英文品名。各国 8 位、10 位编码并不完全相同。</p><button class="soft-button" type="button" data-query="392590">试查 392590</button></div>`;
    if (!append && state.tab === 'query') {
      $('search-input').blur();
      requestAnimationFrame(() => document.querySelector('.workspace').scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'start'}));
    }
  } catch (error) {
    if (error.name === 'AbortError' || request !== state.request) return;
    state.loading=false;
    if (append) { renderResults(); showToast(error.message || '读取更多结果失败，请重试'); }
    else $('query-status').innerHTML = `<div class="query-error"><span class="empty-icon" aria-hidden="true">↻</span><h2>暂时没有连上查询服务</h2><p>${escapeHtml(error.message || '请检查网络连接后再试。')}</p><button class="soft-button" type="button" data-query="${escapeHtml(query)}">重新查询</button></div>`;
  } finally {
    if (request === state.request) { state.loading=false; $('search-submit').disabled=false; $('load-more').disabled=false; $('load-more').innerHTML='查看更多结果<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>'; }
  }
}

function openDialog(dialog) { if (!dialog.open) dialog.showModal(); document.body.style.overflow = 'hidden'; }
function closeDialog(dialog) { dialog.close(); if (!document.querySelector('dialog[open]')) document.body.style.overflow=''; }
function candidateHtml(candidate) {
  const heading = candidate.heading || candidate.code || candidate.htsno || 'Chapter 99';
  const adder = candidate.adderPct ?? candidate.adder_pct;
  const numericAdder = typeof adder === 'number' && Number.isFinite(adder);
  const rawRate = textOnly(candidate.rate || candidate.rateText || candidate.rate_text || '');
  const rate = numericAdder ? `+ ${adder}%` : rawRate;
  const compactRate = numericAdder || /^\+?\s*\d+(?:\.\d+)?\s*%$/.test(rawRate);
  const rule = textOnly(candidate.text || candidate.rule || candidate.rule_verbatim || candidate.description || '适用条件需参照官方条款核验。');
  return `<div class="duty-candidate"><div class="candidate-head"><span class="candidate-heading">${escapeHtml(heading)}</span>${rate?`<span class="candidate-rate ${compactRate?'':'long-candidate-rate'}">${escapeHtml(rate)}</span>`:''}</div><p class="candidate-text" lang="en">${escapeHtml(rule)}</p>${candidate.sourceUrl?`<a class="detail-link" href="${escapeHtml(safeUrl(candidate.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看条款原文 ↗</a>`:''}</div>`;
}
function renderDetail(detail) {
  const code = codeKey(detail.code || detail.htsno);
  const description = textOnly(detail.description || detail.descriptionEn || '商品税号详情');
  const zh = textOnly(detail.descriptionZh || '');
  const general = generalRate(detail);
  const saved = favorites.some(candidate => candidate.code === code);
  const ancestors = Array.isArray(detail.ancestors) ? detail.ancestors : [];
  const candidateData = detail.additionalDuties || detail.layers || [];
  const candidates = Array.isArray(candidateData) ? candidateData : [];
  const offline = detail.offline === true || ['offline_snapshot','offline_cache'].includes(detail.mode) || !navigator.onLine;
  const unavailable = detail.additionalDutiesUnavailable === true;
  const adcvd = detail.adcvd || {};
  const adcvdUrl = safeUrl(adcvd.url,'https://access.trade.gov/adcvd');
  const special = textOnly(detail.special || '');
  const units = Array.isArray(detail.units) ? detail.units.join(' / ') : textOnly(detail.units || detail.unit || '');
  $('detail-content').innerHTML = `<div class="detail-heading"><div><div class="detail-code">${escapeHtml(formatCode(code))}</div><h2 id="detail-title" class="detail-title" lang="en">${escapeHtml(description)}</h2></div><button id="detail-favorite" class="favorite-button ${saved?'saved':''}" type="button" data-favorite="${escapeHtml(code)}" aria-label="${saved?'取消收藏该税号':'收藏该税号'}" aria-pressed="${saved}">${starSvg}</button></div>${zh?`<p class="detail-en"><span class="chinese-reference-label">中文品类参考</span>${escapeHtml(zh)}</p>`:''}<span class="detail-chip">美国 HTS · 中国原产</span>${assessmentHtml(detail)}${ancestors.length?`<div class="detail-ancestry">${ancestors.map(item=>`<p>${item.code?`<strong>${escapeHtml(formatCode(item.code))}</strong>`:''}${escapeHtml(textOnly(typeof item === 'string' ? item : item.description || ''))}</p>`).join('')}</div>`:''}<div class="detail-tax"><div><div class="detail-tax-label">基础税率</div><div class="detail-tax-note">Column 1 · General<br>不含额外加征与其他税费</div></div><div class="detail-tax-rate ${!general?'no-rate':rateLabel(general).length>9?'long-rate':''}">${escapeHtml(rateLabel(general))}</div></div>${special?`<section class="detail-section"><h3>优惠税率 / Special</h3><p lang="en">${escapeHtml(special)}</p><p>须符合对应优惠安排的原产地等条件，不代表中国原产商品自动适用。</p></section>`:''}<section class="detail-section"><div class="detail-section-head"><h3>附加关税核验</h3><span class="review-badge">待核验</span></div><p>${candidates.length?'以下为关联的候选条款线索，可能包含历史条款或仅按原产地匹配的条款。是否适用、是否叠加及豁免条件，需要按完整税号、原产地与生效时间逐项核实。':'需进一步核对 Chapter 99 加征条款及豁免条件。未列出候选条款不代表没有附加关税。'}</p>${candidates.slice(0,4).map(candidateHtml).join('')}${candidates.length>4?`<details class="more-candidates"><summary>查看其余 ${candidates.length-4} 条候选线索</summary>${candidates.slice(4).map(candidateHtml).join('')}</details>`:''}<a class="detail-link" href="https://hts.usitc.gov/" target="_blank" rel="noopener noreferrer">前往 USITC 核验 Chapter 99 ↗</a></section><section class="detail-section"><div class="detail-section-head"><h3>反倾销 / 反补贴</h3><span class="review-badge">待核验</span></div><p>${escapeHtml(textOnly(adcvd.message || '是否适用需按案件商品范围及生产商 / 出口商核验，不能仅凭 HS 编码确定。'))}</p><a class="detail-link" href="${escapeHtml(adcvdUrl)}" target="_blank" rel="noopener noreferrer">查看美国商务部 AD/CVD 案件 ↗</a></section><section class="detail-section"><div class="detail-section-head"><h3>准入与认证</h3><span class="review-badge">待核验</span></div><p>认证要求取决于商品材质、用途与美国主管机构要求，请结合具体产品核对。</p>${units?`<p>税则计量单位：${escapeHtml(units)}</p>`:''}</section><div class="detail-source"><p>来源：美国国际贸易委员会 USITC<br>${escapeHtml(formatVersion(detail.dataVersion) || sourceVersion() || '以官方公布版本为准')}<br>本页未计算最终综合税负。</p><a class="official-button" href="${escapeHtml(safeUrl(detail.sourceUrl || `https://hts.usitc.gov/search?query=${encodeURIComponent(code)}`))}" target="_blank" rel="noopener noreferrer">查看官方税号与完整条款 <span aria-hidden="true">↗</span></a></div>`;
  const footnotes = Array.isArray(detail.footnotes) ? detail.footnotes : [];
  if (footnotes.length) {
    const notes=document.createElement('details');notes.className='footnotes-section';
    notes.innerHTML=`<summary>税则脚注与引用 <span>${footnotes.length}</span></summary><p class="footnotes-intro">以下为官方税则脚注原文，引用不代表已自动判定适用。</p>${footnotes.map(note=>`<div class="footnote-item">${note.inheritedFrom?`<span class="footnote-inherited">继承自 ${escapeHtml(formatCode(note.inheritedFrom))}</span>`:''}<p>${escapeHtml(textOnly(note.value || note.text || ''))}</p></div>`).join('')}`;
    $('detail-content').querySelector('.detail-source').before(notes);
  }
  if (offline) {
    const note=document.createElement('p');note.className='offline-detail-note';note.textContent=unavailable?'离线状态，联网后查询加征条款。当前仅展示设备保存的基础税则快照。':'离线缓存 · 基础税率与候选条款来自上次保存的快照，联网后可重新查询核对。';
    $('detail-content').prepend(note);
  }
  if (unavailable) {
    const sections=[...$('detail-content').querySelectorAll('.detail-section')];
    const additional=sections.find(section=>section.querySelector('h3')?.textContent==='附加关税核验');
    if(additional)additional.innerHTML='<div class="detail-section-head"><h3>附加关税核验</h3><span class="review-badge">待联网查询</span></div><p>离线状态，联网后查询加征条款。当前基础税率不包含额外加征，不能据此确定最终综合税负。</p><a class="detail-link" href="https://hts.usitc.gov/" target="_blank" rel="noopener noreferrer">前往 USITC 核验 Chapter 99 ↗</a>';
  }
  $('detail-favorite')._detail = detail;
}
async function openDetail(code) {
  const request=++state.detailRequest;
  $('detail-content').innerHTML='<h2 id="detail-title" class="sr-only">正在读取税号详情</h2><div class="loading-state" aria-label="正在读取税号详情"><div class="skeleton"></div><div class="skeleton"></div></div>';
  openDialog($('detail-dialog')); $('detail-dialog').scrollTop=0;
  try { const detail = await api(`/api/tariff/${encodeURIComponent(code)}`); if(request === state.detailRequest) renderDetail(detail); }
  catch(error) { if(request===state.detailRequest) $('detail-content').innerHTML=`<div class="query-error"><h2 id="detail-title">暂时无法读取税号详情</h2><p>${escapeHtml(error.message)}</p><button class="soft-button" type="button" data-code="${escapeHtml(code)}">重试</button></div>`; }
}

async function loadStatus() {
  try {
    const status=await api('/api/status'); state.status=status;
    if('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.ready.then(registration=>registration.active?.postMessage({type:'SYNC_DATA',version:status.version || status.edition,fetchedAt:status.fetchedAt || status.updatedAt})).catch(()=>{});
    const version=sourceVersion(status);
    const count=Number(status.recordCount || status.records || 0);
    const date=String(status.updatedAt || status.snapshotDate || '').slice(0,10);
    $('data-version').textContent=[String(status.source || '').startsWith('http') ? 'USITC 美国官方税则' : status.source || 'USITC 美国官方税则',version,count?`${count.toLocaleString('zh-CN')} 条税则`:'' ,date?`数据获取 ${date}`:''].filter(Boolean).join(' · ');
  } catch { $('data-version').textContent='USITC 美国官方税则 · 数据版本暂时无法读取'; }
}

function installApp() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('native-install').hidden=!installPrompt;
  $('install-context').innerHTML=standalone?'<div class="install-context-notice">你正在使用桌面版探迹关税，已添加成功。</div>':/MicroMessenger/i.test(navigator.userAgent)?'<div class="install-context-notice">请先点击微信右上角「···」，选择在浏览器中打开，再添加到主屏幕。</div>':!window.isSecureContext?'<div class="install-context-notice">当前是本地网络预览。正式添加为独立应用需要使用 HTTPS 网址打开；你仍可把本页保存为浏览器书签。</div>':'';
  openDialog($('install-dialog'));
}
window.addEventListener('beforeinstallprompt',event=>{ event.preventDefault();installPrompt=event;$('native-install').hidden=false; });
window.addEventListener('appinstalled',()=>{ installPrompt=null;$('native-install').hidden=true;showToast('已添加到手机桌面'); });
$('native-install').addEventListener('click',async()=>{ if(!installPrompt)return; await installPrompt.prompt(); const choice=await installPrompt.userChoice; installPrompt=null;$('native-install').hidden=true;if(choice.outcome==='accepted')closeDialog($('install-dialog')); });
$('install-button').addEventListener('click',installApp);
$('search-form').addEventListener('submit',event=>{event.preventDefault();search($('search-input').value);});
$('load-more').addEventListener('click',()=>search(state.query,true));
$('query-tab').addEventListener('click',()=>setTab('query'));$('favorites-tab').addEventListener('click',()=>setTab('favorites'));$('back-to-query').addEventListener('click',()=>{setTab('query');$('search-input').focus();});
$('clear-history').addEventListener('click',()=>{history=[];writeStore('tanji.tariff.history.v1',history);renderHistory();});
document.addEventListener('click',event=>{
  const queryButton=event.target.closest('[data-query]'); if(queryButton){search(queryButton.dataset.query);return;}
  const favorite=event.target.closest('[data-favorite]'); if(favorite){toggleFavorite(favorite.dataset.favorite,favorite._detail);return;}
  const detailButton=event.target.closest('[data-code]');if(detailButton){openDetail(detailButton.dataset.code);return;}
  const close=event.target.closest('[data-close]');if(close)closeDialog($(close.dataset.close));
});
for(const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog(dialog);}});
  dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.style.overflow='';});
}
for(const tab of [$('query-tab'),$('favorites-tab')]) tab.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();const next=state.tab==='query'?'favorites':'query';setTab(next);$(next==='query'?'query-tab':'favorites-tab').focus();}});
window.addEventListener('storage',event=>{if(event.key==='tanji.tariff.favorites.v1'){const incoming=readStore(event.key,[]);if(Array.isArray(incoming))favorites=normalizeFavorites(incoming);renderFavorites();renderResults();}});
window.addEventListener('offline',()=>updateConnectivity({offline:true}));
window.addEventListener('online',()=>{updateConnectivity({offline:false});loadStatus();});
function markOfflineReady(data) {
  const count=Number(data.recordCount || 0);
  $('offline-save-status').hidden=false;
  $('offline-save-status').textContent=`✓ 离线基础税则已保存${count?` · ${count.toLocaleString('zh-CN')} 条`:''}`;
  $('install-offline-status').textContent='当前浏览器的离线基础税则已保存。添加后首次打开 App，也请等候保存完成；加征条款需联网核验。';
}
if('serviceWorker' in navigator && window.isSecureContext) {
  $('offline-save-status').hidden=false;
  $('offline-save-status').textContent='正在准备离线基础税则，首次请保持联网片刻…';
  navigator.serviceWorker.addEventListener('message',event=>{
    if(event.data?.type==='OFFLINE_READY' || event.data?.type==='OFFLINE_STATUS' && event.data.ready)markOfflineReady(event.data);
    if(event.data?.type==='OFFLINE_FAILED') {
      $('offline-save-status').textContent='离线数据未保存，请保持联网并刷新重试。当前可联网查询。';
      $('install-offline-status').textContent='离线数据尚未保存。请保持联网并刷新，等显示「离线基础税则已保存」后再离线使用。';
    }
  });
  navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(registration=>{
    registration.active?.postMessage({type:'OFFLINE_STATUS'});
  }).catch(()=>{
    $('offline-save-status').textContent='离线数据暂未保存，当前可联网查询。';
  });
}

renderHistory();renderFavorites();updateConnectivity();loadStatus();
const initialQuery=new URL(location.href).searchParams.get('q');if(initialQuery)search(initialQuery);
