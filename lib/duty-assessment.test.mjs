import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessDuty } from './duty-assessment.mjs';
import { getTariffDetail, searchTariffs } from './tariff.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/reviewed-duty-rules.json', import.meta.url), 'utf8'));
const scenario = { code: '7308903000', baseRatePct: 0, version: '2026 HTS Revision 23', fetchedAt: '2026-11-23T03:37:10.353Z' };

test('reviewed exact-code scenario includes steel and China duties while final liability remains undetermined', async () => {
  const detail = await getTariffDetail('7308903000');
  assert.equal(detail.general, 'Free');
  assert.equal(detail.dutyAssessment.status, 'conditional_reference');
  assert.equal(detail.dutyAssessment.referenceRatePct, 75);
  assert.deepEqual(detail.dutyAssessment.components.map(item => item.ratePct), [0, 50, 25]);
  assert.ok(detail.dutyAssessment.components.some(item => item.heading === '9903.82.02'));
  assert.ok(detail.dutyAssessment.components.some(item => item.heading === '9903.88.02'));
  assert.equal(detail.totalRate, null);
  assert.equal(detail.adcvd.status, 'unknown');
  const results = await searchTariffs({ query: '730890' });
  assert.equal(results.items.find(item => item.digits === '7308903000').dutyAssessment.referenceRatePct, 75);
  assert.ok(results.items.filter(item => item.digits !== '7308903000').every(item => item.dutyAssessment.referenceRatePct === null));
});

test('unreviewed country, code, base rate or snapshot cannot inherit a reviewed reference', () => {
  for (const change of [{ origin: 'GB' }, { destination: 'CA' }, { code: '7308906000' }, { baseRatePct: 5 }, { version: '2026 HTS Revision 24' }, { fetchedAt: '2026-11-24' }]) {
    const assessment = assessDuty({ ...scenario, ...change }, catalog);
    assert.equal(assessment.status, 'needs_review');
    assert.equal(assessment.referenceRatePct, null);
  }
});

test('incompatible valuation bases cannot be summed into a reference rate', () => {
  const altered = structuredClone(catalog);
  altered.rules[0].components[1].basis = 'steel_content_value';
  assert.equal(assessDuty(scenario, altered).referenceRatePct, null);
});

test('Column 2 Russia footnote is retained as source evidence without entering China General candidates', async () => {
  const detail = await getTariffDetail('7308903000');
  assert.ok(detail.footnotes.some(note => note.columns?.includes('other') && /9903\.90\.09/.test(note.value)));
  assert.ok(!detail.additionalDuties.some(item => item.heading === '9903.90.09' && item.match === 'footnote'));
});
