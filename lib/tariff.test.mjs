import test from 'node:test';
import assert from 'node:assert/strict';
import { initTariffs, searchTariffs, getTariffDetail, getOfflineSnapshot } from './tariff.mjs';
import { buildDataset, parseRatePct } from '../vendor/tariff-resolver/core/dataset.js';
import { parseRevision, validateRows } from '../scripts/update-data.mjs';

test('bundled snapshot contains the complete official schedule and an explicit revision', async () => {
  const status = await initTariffs();
  assert.equal(status.ready, true);
  assert.match(status.version, /^20\d{2} HTS Revision \d+$/);
  assert.ok(status.rowCount > 25000);
  assert.ok(status.recordCount > 15000);
  assert.equal(status.mode, 'official_snapshot');
  assert.equal(status.historicalLookup, false);
  assert.match(status.source, /^https:\/\/hts\.usitc\.gov\//);
});

test('HS prefix returns real US detail without silently assigning a prefix as a full code', async () => {
  const result = await searchTariffs({ query: '392590' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].digits, '3925900000');
  assert.equal(result.items[0].general, '5.3%');
  assert.match(result.items[0].path, /Builders' ware of plastics/);
  assert.equal(await getTariffDetail('392590'), null);
  assert.equal(await getTariffDetail('3925909999'), null);
});

test('periods are normalized but a longer or nonexistent Chinese code does not fall back', async () => {
  const detail = await getTariffDetail('3925.90.00.00');
  assert.equal(detail.code, '3925.90.00.00');
  assert.equal((await searchTariffs({ query: '3925909999' })).total, 0);
  assert.equal((await searchTariffs({ query: '3925900000000' })).total, 0);
});

test('Chinese aliases choose the most specific phrase and disclose their limited scope', async () => {
  const result = await searchTariffs({ query: '其他塑料建筑用品' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].digits, '3925900000');
  assert.equal(result.items[0].chineseLabelKind, 'heading_reference');
  assert.match(result.notes.join(''), /品类参考/);
  const unknown = await searchTariffs({ query: '从未收录的神奇商品' });
  assert.equal(unknown.total, 0);
  assert.ok(unknown.notes.some(note => note.includes('暂未收录')));
});

test('keyword search and pagination return distinct real results and constrain page size', async () => {
  const first = await searchTariffs({ query: '8504', limit: 2, offset: 0 });
  const second = await searchTariffs({ query: '8504', limit: 2, offset: 2 });
  assert.ok(first.total > 4);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.notEqual(first.items[0].code, second.items[0].code);
  const english = await searchTariffs({ query: 'builders plastics' });
  assert.ok(english.items.length > 0);
  assert.ok(english.items.every(item => /builders/i.test(item.path) && /plastics/i.test(item.path)));
  assert.equal((await searchTariffs({ query: '84', limit: 99999 })).limit, 100);
});

test('all additional duties remain candidates, and AD/CVD is never represented as absent', async () => {
  const detail = await getTariffDetail('3925900000');
  assert.equal(detail.totalRate, null);
  assert.equal(detail.adcvd.status, 'unknown');
  assert.equal(detail.certification.status, 'unknown');
  assert.ok(detail.layers.length > 0);
  assert.ok(detail.layers.every(layer => layer.status === 'needs_verification'));
  assert.ok(detail.additionalDuties.every(layer => layer.status === 'requires_review'));
  assert.ok(detail.warnings.includes('do_not_sum_layers'));
  assert.ok(detail.warnings.includes('excludes_ad_cvd'));
});

test('statistical suffix retains the exact rate-parent footnotes and expands printed heading ranges', async () => {
  const detail = await getTariffDetail('0201105010');
  assert.ok(detail.rateInherited);
  assert.ok(detail.footnotes.some(note => note.inheritedFrom === '0201.10.50' && /9904\.02\.01/.test(note.value)));
  assert.ok(detail.layers.some(layer => layer.heading === '9904.02.01' && layer.match === 'footnote'));
  assert.ok(detail.layers.some(layer => layer.heading === '9904.02.10' && layer.match === 'footnote'));
  assert.ok(detail.layers.some(layer => layer.heading === '9904.02.27' && layer.match === 'footnote'));
  assert.ok(detail.layers.some(layer => layer.heading === '9904.02.37' && layer.match === 'footnote'));
});

test('updater rejects partial schedules and an unverifiable official revision before replacing data', () => {
  assert.throws(() => validateRows([]), /Incomplete/);
  assert.throws(() => validateRows(Array.from({ length: 25000 }, () => ({ htsno: '0101', description: 'Incomplete fixture' }))), /missing chapters/);
  assert.throws(() => parseRevision('<html>Service unavailable</html>'), /Could not verify/);
  const revision = parseRevision('2026 HTS Revision 23 was published on November 10, 2026');
  assert.equal(revision.version, '2026 HTS Revision 23');
  assert.equal(revision.released_at, '2026-11-10');
});

test('parent duty inheritance is restricted to statistical suffixes and compound rates are not percentages', () => {
  const ds = buildDataset({ fetched_at: 'test', source: 'fixture', license: 'test', rows: [
    { htsno: '1234', indent: '0', description: 'Parent', general: '8%', special: '', other: '', units: [] },
    { htsno: '1234.56.00', indent: '1', description: 'Structural heading', general: '', units: [] },
    { htsno: '1234.56.00.10', indent: '2', description: 'Suffix', general: '', units: [] },
  ] });
  assert.equal(ds.rateLines[0].eff_general, '');
  assert.equal(ds.rateLines[1].eff_general, '8%');
  assert.equal(ds.rateLines[1].rate_inherited, true);
  assert.equal(parseRatePct('12.4¢/kg + 5%'), null);
  assert.equal(parseRatePct('Free'), 0);
});

test('offline snapshot contains every searchable code with inherited duty and source attribution', async () => {
  const snapshot = await getOfflineSnapshot();
  const status = await initTariffs();
  assert.equal(snapshot.items.length, status.recordCount);
  assert.ok(snapshot.items.every(item => /^\d{8}(\d{2})?$/.test(item.code)));
  assert.equal(snapshot.items.find(item => item.code === '3925900000').general, '5.3%');
  assert.equal(snapshot.additionalDutiesMode, 'unavailable_offline');
  assert.ok(snapshot.chineseAliases.length > 20);
});
