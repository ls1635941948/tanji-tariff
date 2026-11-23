import { readFile } from 'node:fs/promises';
import { buildDataset, parseRatePct } from '../vendor/tariff-resolver/core/dataset.js';
import { resolveDuty } from '../vendor/tariff-resolver/core/resolve.js';
import { assessDuty } from './duty-assessment.mjs';

const HTS_URL = 'https://hts.usitc.gov/';
const AD_CVD_URL = 'https://access.trade.gov/adcvd';
const disclaimer = '基础税率来自美国官方税则快照。加征条款仅为筛查候选，不判定叠加或最终应缴税额；反倾销、反补贴及监管要求需另行核验。';

// Chinese aliases are navigation aids, not official translations or classifications.
// Each maps to a known HS heading. The English USITC text remains authoritative.
export const CHINESE_ALIASES = [
  { words: ['塑料建筑用品', '塑料建筑材料', '建筑塑料', '塑料建材'], prefixes: ['3925'], label: '塑料建筑用品' },
  { words: ['其他塑料建筑用品'], prefixes: ['392590'], label: '其他塑料建筑用品' },
  { words: ['塑料制品', '其他塑料'], prefixes: ['3926'], label: '其他塑料制品' },
  { words: ['塑料袋', '塑料包装袋'], prefixes: ['392321', '392329'], label: '塑料包装袋' },
  { words: ['塑料餐具', '塑料厨房'], prefixes: ['392410'], label: '塑料餐具及厨房用品' },
  { words: ['塑料', '塑胶'], prefixes: ['39'], label: '塑料及其制品' },
  { words: ['家具', '家俱'], prefixes: ['9403'], label: '其他家具及其零件' },
  { words: ['椅子', '座椅'], prefixes: ['9401'], label: '坐具及其零件' },
  { words: ['灯具', '灯饰', '照明'], prefixes: ['9405'], label: '灯具及照明装置' },
  { words: ['玩具'], prefixes: ['9503'], label: '玩具' },
  { words: ['鞋子', '鞋靴', '鞋'], prefixes: ['64'], label: '鞋靴及其零件' },
  { words: ['针织服装', '针织衣服'], prefixes: ['61'], label: '针织或钩编服装' },
  { words: ['服装', '衣服'], prefixes: ['61', '62'], label: '服装' },
  { words: ['箱包', '手提包', '背包', '旅行箱'], prefixes: ['4202'], label: '箱包及类似容器' },
  { words: ['电池'], prefixes: ['8506', '8507'], label: '电池或蓄电池' },
  { words: ['锂电池', '锂离子电池'], prefixes: ['850760'], label: '锂离子蓄电池' },
  { words: ['太阳能电池', '光伏电池'], prefixes: ['854142', '854143'], label: '光伏电池' },
  { words: ['充电器', '电源适配器', '变流器', '逆变器'], prefixes: ['850440'], label: '静止式变流器' },
  { words: ['电动机', '电机'], prefixes: ['8501'], label: '电动机及发电机' },
  { words: ['变压器'], prefixes: ['8504'], label: '变压器、变流器及电感器' },
  { words: ['电线', '电缆'], prefixes: ['8544'], label: '绝缘电线、电缆及其他电导体' },
  { words: ['钢铁'], prefixes: ['72', '73'], label: '钢铁及其制品' },
  { words: ['螺丝', '螺栓', '螺母'], prefixes: ['7318'], label: '钢铁紧固件' },
  { words: ['铝制品', '铝材', '铝'], prefixes: ['76'], label: '铝及其制品' },
  { words: ['轴承'], prefixes: ['8482'], label: '滚动轴承' },
  { words: ['阀门', '阀'], prefixes: ['8481'], label: '阀门及类似装置' },
  { words: ['水泵', '液泵', '泵'], prefixes: ['8413'], label: '液体泵' },
  { words: ['汽配', '汽车零件', '汽车配件'], prefixes: ['8708'], label: '机动车辆零件及附件' },
  { words: ['自行车'], prefixes: ['8712'], label: '自行车及其他非机动脚踏车' },
  { words: ['陶瓷餐具', '瓷器'], prefixes: ['6911', '6912'], label: '陶瓷餐具及家用器具' },
  { words: ['玻璃杯', '玻璃器皿'], prefixes: ['7013'], label: '玻璃器皿' },
  { words: ['纸箱', '纸盒'], prefixes: ['4819'], label: '纸制包装容器' },
  { words: ['橡胶'], prefixes: ['40'], label: '橡胶及其制品' },
];

const digits = code => String(code ?? '').replace(/\D/g, '');
const plainText = text => String(text ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
let dataset;
let meta;
let dutyRules;
let searchable = [];
let byCode = new Map();
let searchIndex = new Map();
let loading;

function inheritRateFootnotes(rows) {
  const stack = [];
  return rows.map(row => {
    const indent = Number(row.indent || 0);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    let footnotes = [...(row.footnotes || [])];
    if (!row.general && digits(row.htsno).length >= 9) {
      const rateParent = [...stack].reverse().find(frame => frame.row.general);
      if (rateParent) {
        const own = new Set(footnotes.map(note => `${note.value}|${(note.columns || []).join(',')}`));
        for (const note of rateParent.row.footnotes || []) {
          const key = `${note.value}|${(note.columns || []).join(',')}`;
          if (!own.has(key)) {
            footnotes.push({ ...note, inheritedFrom: rateParent.row.htsno });
            own.add(key);
          }
        }
      }
    }
    const augmented = { ...row, footnotes };
    stack.push({ indent, row: augmented });
    return augmented;
  });
}

// The upstream reader recognizes individual references. Expand explicitly printed
// full-heading ranges for its private input, retaining the original footnote text
// for display rather than inventing a rewritten official note.
function resolverFootnotes(row) {
  // Column 2 and preferential-rate-only notes do not apply to the current
  // Column 1 General lookup. Keep original notes intact for source display.
  const notes = (row.footnotes || []).filter(note => !Array.isArray(note.columns) || !note.columns.length || !note.columns.every(column => ['other', 'special'].includes(String(column).toLowerCase())));
  const expanded = new Set();
  for (const note of notes) {
    for (const match of String(note.value || '').matchAll(/(99\d{2}\.\d{2}\.\d{2})\s*(?:[-–—]|through|to)\s*(99\d{2}\.\d{2}\.\d{2})/gi)) {
      const start = digits(match[1]);
      const end = digits(match[2]);
      if (start.length !== end.length || start > end) continue;
      for (const heading of dataset.ch99) {
        const code = digits(heading.htsno);
        if (code.length === start.length && code >= start && code <= end) expanded.add(heading.htsno);
      }
    }
  }
  return expanded.size ? [...notes, { value: [...expanded].join('; '), derivedReferenceExpansion: true }] : notes;
}

async function loadState() {
  const [rawText, overridesText, dutyRulesText] = await Promise.all([
    readFile(new URL('../data/hts-full.json', import.meta.url), 'utf8'),
    readFile(new URL('../vendor/tariff-resolver/status_overrides.json', import.meta.url), 'utf8'),
    readFile(new URL('../data/reviewed-duty-rules.json', import.meta.url), 'utf8'),
  ]);
  const raw = JSON.parse(rawText);
  const overrides = JSON.parse(overridesText);
  const nextDutyRules = JSON.parse(dutyRulesText);
  if (!Array.isArray(nextDutyRules.rules)) throw new Error('Reviewed duty rules are malformed');
  if (!Array.isArray(raw.rows) || raw.rows.length < 25000) throw new Error('Official HTS snapshot is incomplete');
  const nextDataset = buildDataset({ ...raw, rows: inheritRateFootnotes(raw.rows) }, overrides);
  const { rows, ...metadata } = raw;
  const nextByCode = new Map(nextDataset.rateLines.map(row => [digits(row.htsno), row]));
  const childPrefixes = new Set(nextDataset.rateLines.filter(row => digits(row.htsno).length === 10).map(row => digits(row.htsno).slice(0, 8)));
  const nextSearchable = nextDataset.rateLines.filter(row => digits(row.htsno).length === 10 || !childPrefixes.has(digits(row.htsno)));
  const nextSearchIndex = new Map(nextSearchable.map(row => [row.htsno, plainText(row.path).toLowerCase()]));
  return { nextDataset, metadata, nextByCode, nextSearchable, nextSearchIndex, nextDutyRules };
}

function adoptState(state) {
  dataset = state.nextDataset;
  meta = state.metadata;
  dutyRules = state.nextDutyRules;
  byCode = state.nextByCode;
  searchable = state.nextSearchable;
  searchIndex = state.nextSearchIndex;
}

export async function initTariffs() {
  if (dataset) return getStatus();
  if (loading) return loading;
  loading = (async () => {
    adoptState(await loadState());
    return getStatus();
  })();
  try { return await loading; }
  catch (error) { dataset = undefined; loading = undefined; throw error; }
}

// Called only after a successful download. The previous in-memory snapshot remains
// available to queries while the replacement is read and validated.
export async function refreshTariffs() {
  const state = await loadState();
  adoptState(state);
  return getStatus();
}

function publicMeta() {
  return {
    version: meta.version, edition: meta.version, revision: meta.revision,
    fetchedAt: meta.fetched_at, updatedAt: meta.fetched_at,
    releasedAt: meta.released_at, source: meta.source,
    versionSource: meta.version_source, license: meta.license,
    licenseSource: meta.license_source, rowCount: meta.row_count,
    mode: 'official_snapshot', historicalLookup: false,
  };
}

export function getStatus() {
  if (!dataset) return { ready: false, mode: 'official_snapshot' };
  return {
    ready: true, ...publicMeta(), recordCount: searchable.length,
    rateLineCount: searchable.length, allRateLineCount: dataset.rateLines.length,
    chapter99Count: dataset.ch99.length,
    origin: { code: 'CN', name: '中国' }, destination: { code: 'US', name: '美国' },
    language: 'en', chineseSearch: 'common_heading_aliases',
    additionalDutiesMode: 'reviewed_scenarios_and_candidates', adcvdMode: 'external_review',
    reviewedDutyCodes: dutyRules.rules.flatMap(rule => rule.codes),
    disclaimer,
  };
}

function chineseHeading(code) {
  const normalized = digits(code);
  const choices = CHINESE_ALIASES.flatMap(alias => alias.prefixes.map(prefix => ({ prefix, label: alias.label })));
  choices.sort((a, b) => b.prefix.length - a.prefix.length);
  return choices.find(choice => normalized.startsWith(choice.prefix))?.label || '';
}

function summarize(row) {
  const general = plainText(row.eff_general);
  const special = plainText(row.eff_special);
  const other = plainText(row.eff_other);
  const path = plainText(row.path);
  const parentDescription = path.split(' > ').slice(0, -1).join(' > ');
  return {
    code: row.htsno, digits: digits(row.htsno),
    description: plainText(row.description), descriptionZh: chineseHeading(row.htsno),
    chineseLabelKind: 'heading_reference', path, parentDescription,
    generalRate: general || null, general: general || null,
    specialRate: special || null, special: special || null,
    otherRate: other || null, other: other || null,
    baseRatePct: parseRatePct(general), rateInherited: row.rate_inherited,
    dutyAssessment: assessDuty({ code: row.htsno, baseRatePct: parseRatePct(general), version: meta.version, fetchedAt: meta.fetched_at }, dutyRules),
    unit: row.units || [], units: row.units || [],
    officialUrl: `${HTS_URL}search?query=${encodeURIComponent(row.htsno)}`,
  };
}

export async function searchTariffs({ query = '', limit = 30, offset = 0 } = {}) {
  await initTariffs();
  const q = String(query).trim().slice(0, 120);
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  let matches = [];
  let matchType = 'empty';
  let notes = [];
  let queryTranslated = q;
  if (/^[\d.\s-]+$/.test(q) && digits(q)) {
    const prefix = digits(q);
    matchType = 'code_prefix';
    matches = searchable.filter(row => digits(row.htsno).startsWith(prefix));
    if (prefix.length < 8) notes.push('当前为HS前缀搜索，请选择美国HTS细分编码确认商品归类。');
    if (prefix.length > 10) notes.push('美国HTS统计编码为10位，请核对输入的编码。');
    if (prefix.length === 10 && !matches.length) notes.push('未找到该美国HTS编码；中国10位编码不能直接当作美国编码使用，可尝试前6位。');
  } else if (/[\u3400-\u9fff]/u.test(q)) {
    matchType = 'chinese_alias';
    let matched = CHINESE_ALIASES.filter(alias => alias.words.some(word => q.includes(word)));
    const longest = Math.max(0, ...matched.flatMap(alias => alias.words.filter(word => q.includes(word)).map(word => word.length)));
    matched = matched.filter(alias => alias.words.some(word => q.includes(word) && word.length === longest));
    const prefixes = [...new Set(matched.flatMap(alias => alias.prefixes))];
    queryTranslated = prefixes.length ? prefixes.map(prefix => `HS ${prefix}`).join(' / ') : '';
    matches = searchable.filter(row => prefixes.some(prefix => digits(row.htsno).startsWith(prefix)));
    notes.push('中文搜索仅匹配常用品类关键词，中文名称为品类参考；最终归类请核对英文官方描述。');
    if (!prefixes.length) notes.push('该中文关键词暂未收录，请输入HS编码或英文品名。');
  } else if (q) {
    matchType = 'english_keywords';
    const words = q.toLowerCase().match(/[a-z0-9]+/g) || [];
    if (words.length) {
      matches = searchable.map((row, order) => {
        const text = searchIndex.get(row.htsno);
        if (!words.every(word => text.includes(word))) return null;
        const leaf = plainText(row.description).toLowerCase();
        const score = (text.includes(q.toLowerCase()) ? 8 : 0) + words.filter(word => leaf.includes(word)).length * 2;
        return { row, score, order };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.order - b.order).map(item => item.row);
    }
  }
  return {
    query: q, total: matches.length, offset: start, limit: pageSize,
    hasMore: start + pageSize < matches.length,
    items: matches.slice(start, start + pageSize).map(summarize),
    matchType, queryTranslated, notes, data: publicMeta(), dataVersion: meta.version,
  };
}

export async function getOfflineSnapshot() {
  await initTariffs();
  return {
    ...publicMeta(), mode: 'downloaded_official_snapshot',
    chineseAliases: CHINESE_ALIASES,
    additionalDutiesMode: 'unavailable_offline',
    items: searchable.map(row => {
      const item = summarize(row);
      return {
        code: item.digits, formattedCode: item.code,
        description: item.description, descriptionZh: item.descriptionZh,
        chineseLabelKind: 'heading_reference',
        general: item.general, special: item.special, other: item.other,
        parentDescription: item.parentDescription, path: item.path,
        unit: item.unit, rateInherited: item.rateInherited,
        ...(item.dutyAssessment.status === 'conditional_reference' ? { dutyAssessment: item.dutyAssessment } : {}),
      };
    }),
  };
}

export async function getTariffDetail(code) {
  await initTariffs();
  const normalized = digits(code);
  // Do not silently resolve a six-digit heading or a Chinese code to the first US line.
  const row = byCode.get(normalized);
  if (!row || ![8, 10].includes(normalized.length)) return null;
  const result = resolveDuty({ ...dataset, rateLines: [{ ...row, footnotes: resolverFootnotes(row) }] }, { hts: row.htsno, origin: 'CN' });
  if (result.error) throw new Error(result.error.message);
  const layers = result.layers.map(layer => ({
    code: layer.heading, heading: layer.heading,
    rateText: plainText(layer.rate_text), rate: plainText(layer.rate_text),
    adderPct: layer.adder_pct, description: plainText(layer.rule_verbatim),
    text: plainText(layer.rule_verbatim), compilerNote: layer.compiler_note,
    status: 'needs_verification', match: layer.match, confidence: layer.confidence,
    sourceUrl: `${HTS_URL}search?query=${encodeURIComponent(layer.heading)}`,
  }));
  const adCvd = { status: 'unknown', label: '需按商品范围核验', url: AD_CVD_URL,
    note: 'HTS税则不包含反倾销和反补贴税。编码仅用于案件筛查，是否适用以案件商品范围及相关裁定为准。' };
  const summary = summarize(row);
  return {
    ...summary, ancestors: summary.path.split(' > ').slice(0, -1),
    layers, additionalDuties: layers.map(layer => ({ ...layer, status: 'requires_review' })),
    candidateCount: layers.length,
    possiblyExpired: result.possibly_expired.map(layer => ({
      code: layer.heading, rateText: plainText(layer.rate_text),
      description: plainText(layer.rule_verbatim), status: layer.status,
      reason: layer.reason, sourceUrl: layer.source, asOf: layer.as_of,
      note: '开源项目历史状态标注，仍需查看官方最新信息。',
    })),
    footnotes: (row.footnotes || []).map(note => ({ ...note, value: plainText(note.value) })),
    adCvd, adcvd: adCvd,
    certification: { status: 'unknown', label: '需按产品核验', note: '本版未接入认证与进口监管要求数据库。' },
    origin: 'CN', destination: 'US',
    sourceUrl: summary.officialUrl, dataVersion: meta.version,
    data: publicMeta(), disclaimer,
    warnings: result.warnings,
    totalRate: null,
    totalRateNote: '不自动汇总加征候选；基础税率不等于最终进口总税率。',
  };
}
