import { describe, expect, it } from 'vitest';
import { checkCalcCoverage } from '../../../scripts/checks/calc-coverage';

describe('check:calc-coverage', () => {
  it('passes on empty — the F01 stub state', () => {
    expect(checkCalcCoverage({ methods: [], metrics: [] })).toEqual([]);
  });

  it('passes when every rendered metric has a registered method with goldens', () => {
    const findings = checkCalcCoverage({
      methods: [{ id: 'attention.rank_change', goldens: ['golden/rank-change.json'] }],
      metrics: [
        { id: 'rank_change', methodId: 'attention.rank_change', renderedIn: 'app/dashboard' },
      ],
    });
    expect(findings).toEqual([]);
  });

  // CAN FAIL — case 1 of 3.
  it('fails on a metric with no registered method', () => {
    const findings = checkCalcCoverage({
      methods: [],
      metrics: [{ id: 'rank_change', methodId: null, renderedIn: 'app/dashboard' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no registered method');
  });

  // CAN FAIL — case 2 of 3.
  it('fails on a metric naming a method that is not in the registry', () => {
    const findings = checkCalcCoverage({
      methods: [{ id: 'attention.rank_change', goldens: ['g.json'] }],
      metrics: [{ id: 'rank_change', methodId: 'attention.rankChange', renderedIn: 'app/x' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('not in the registry');
  });

  // CAN FAIL — case 3 of 3.
  it('fails on a registered method with no goldens', () => {
    const findings = checkCalcCoverage({
      methods: [{ id: 'attention.rank_change', goldens: [] }],
      metrics: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('no golden fixtures');
  });

  it('reports every failure rather than the first', () => {
    const findings = checkCalcCoverage({
      methods: [{ id: 'a', goldens: [] }],
      metrics: [{ id: 'm', methodId: null, renderedIn: 'app/x' }],
    });
    expect(findings).toHaveLength(2);
  });
});
