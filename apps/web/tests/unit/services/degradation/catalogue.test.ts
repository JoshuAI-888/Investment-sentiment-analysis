import { describe, expect, it } from 'vitest';
import {
  DEGRADATION_CATALOGUE,
  SEVERITY_ORDER,
  catalogueBySeverity,
  findDegradationEntry,
} from '../../../../src/services/degradation/catalogue';

/** The actual current provider roster (D-39 corrected — Reddit-Data-API sourcing is dropped for
 * the legacy product; RNI's own Reddit path is out of this feature's scope). */
const EXPECTED_PROVIDERS = [
  'Substack',
  'Market data (FMP)',
  'F20 scorer',
  'X',
  'FMP (fundamentals)',
  'Marketaux',
  'ApeWisdom',
  'LLM (relevance / entity-collision)',
  'SEC / FRED',
];

describe('DEGRADATION_CATALOGUE — F18 §4.3', () => {
  it('covers exactly the actual current provider roster, no more and no fewer', () => {
    const names = DEGRADATION_CATALOGUE.map((entry) => entry.provider).sort();
    expect(names).toEqual([...EXPECTED_PROVIDERS].sort());
  });

  it('carries no Reddit row — D-39 dropped Reddit-Data-API sourcing for the legacy product entirely', () => {
    const hasReddit = DEGRADATION_CATALOGUE.some((entry) => /reddit/i.test(entry.provider));
    expect(hasReddit).toBe(false);
  });

  it('every entry has a non-empty behaviour, user-visible state, severity and at least one runbook step', () => {
    for (const entry of DEGRADATION_CATALOGUE) {
      expect(entry.behavior.length).toBeGreaterThan(0);
      expect(entry.userVisibleState.length).toBeGreaterThan(0);
      expect(entry.severityReason.length).toBeGreaterThan(0);
      expect(['critical', 'high', 'medium', 'low']).toContain(entry.severity);
      expect(entry.runbook.length).toBeGreaterThan(0);
      for (const step of entry.runbook) expect(step.length).toBeGreaterThan(0);
    }
  });

  it('ranks the three permanent-corpus-loss collectors (market data, Substack, ApeWisdom) as critical — the highest severity', () => {
    expect(findDegradationEntry('Substack')?.severity).toBe('critical');
    expect(findDegradationEntry('Market data (FMP)')?.severity).toBe('critical');
    // Self-review correction: ApeWisdom is D-12/D-30's "demoted cross-check" only in a world
    // where the Reddit Data API is the primary attention source. D-39 dropped that source for
    // the legacy product entirely, so `services/attention/collector.ts`'s ApeWisdom call is, in
    // this codebase today, the only running attention collector — critical, not low, exactly
    // like the other two corpus-writing collectors above.
    expect(findDegradationEntry('ApeWisdom')?.severity).toBe('critical');
  });

  it('ranks the F20 scorer high, not critical — D-13\'s decoupling makes its outage latency, not corpus loss', () => {
    expect(findDegradationEntry('F20 scorer')?.severity).toBe('high');
  });

  it('never marks a purely-enrichment source (no collection obligation of its own) above medium severity', () => {
    for (const name of ['Marketaux', 'LLM (relevance / entity-collision)', 'SEC / FRED']) {
      const entry = findDegradationEntry(name);
      expect(entry).toBeDefined();
      expect(SEVERITY_ORDER[entry!.severity]).toBeGreaterThanOrEqual(SEVERITY_ORDER.medium);
    }
  });
});

describe('catalogueBySeverity', () => {
  it('sorts most severe first', () => {
    const sorted = catalogueBySeverity();
    for (let i = 1; i < sorted.length; i += 1) {
      expect(SEVERITY_ORDER[sorted[i - 1]!.severity]).toBeLessThanOrEqual(SEVERITY_ORDER[sorted[i]!.severity]);
    }
  });

  it('does not mutate the source catalogue array', () => {
    const before = DEGRADATION_CATALOGUE.map((entry) => entry.provider);
    catalogueBySeverity();
    expect(DEGRADATION_CATALOGUE.map((entry) => entry.provider)).toEqual(before);
  });
});

describe('findDegradationEntry', () => {
  it('returns undefined for a provider not in the catalogue', () => {
    expect(findDegradationEntry('Stocktwits')).toBeUndefined();
    expect(findDegradationEntry('nonexistent')).toBeUndefined();
  });
});
