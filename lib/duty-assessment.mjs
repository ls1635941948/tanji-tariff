// Apply only a reviewed, exact-code scenario. Heuristic Chapter 99 candidates
// never enter this calculation. A new snapshot needs a fresh policy review.
export function assessDuty({ code, baseRatePct, version, fetchedAt, origin = 'CN', destination = 'US' }, catalog) {
  const fallback = { status: 'needs_review', referenceRatePct: null, note: '尚未完成额外加征核验，基础税率不能作为综合税率。' };
  const normalized = String(code || '').replace(/\D/g, '');
  const rule = catalog?.rules?.find(item => item.codes.includes(normalized) && item.origin === origin && item.destination === destination);
  if (!rule) return fallback;
  if (version !== rule.snapshotVersion || String(fetchedAt || '').slice(0, 10) !== rule.reviewedAt) {
    return { ...fallback, note: '税则快照与已核对政策的日期或版本不同，需要重新核验加征税。' };
  }
  if (baseRatePct !== rule.baseRatePct || !Array.isArray(rule.components) || !rule.components.length) return fallback;
  if (!rule.components.every(component => Number.isFinite(component.ratePct) && component.ratePct >= 0 && component.basis === 'full_customs_value')) return fallback;
  const referenceRatePct = rule.components.reduce((total, component) => total + component.ratePct, 0);
  if (referenceRatePct !== rule.referenceRatePct || rule.components[0].ratePct !== baseRatePct) return fallback;
  return {
    status: 'conditional_reference', referenceRatePct,
    reviewedAt: rule.reviewedAt, scenario: rule.scenario,
    components: rule.components.map(component => ({ ...component })),
    conditions: [...rule.conditions], sources: rule.sources.map(source => ({ ...source })),
    note: rule.note,
  };
}
