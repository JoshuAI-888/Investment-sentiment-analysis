import { describe, expect, it } from 'vitest';
import { METHOD_REGISTRY } from '../../../../src/services/calculations';
import { mustNotClaimFor, mustNotClaimLines, TIER_D_DISCLOSURE } from '../../../../src/services/mcp/must-not-claim';

/**
 * F21 §4.5 — the Tier D4 split. `01-PRODUCT-SPEC.md` §6.4: "**Every metric that has not passed
 * Tier D4** — which today is every metric[...]". This pins that today's real `METHOD_REGISTRY`
 * genuinely has no `tierD4Record` set anywhere, so the split resolves to the disclosure branch
 * for every real entry — not merely asserted, checked against the live registry.
 */

describe('F21 §4.5 — mustNotClaimFor', () => {
  it('every entry in the real, live METHOD_REGISTRY renders the §6.4 disclosure today (no Tier D4 record exists yet)', () => {
    for (const entry of METHOD_REGISTRY.all()) {
      const claim = mustNotClaimFor(entry);
      expect(claim.tier).toBe('undisclosed');
      expect(claim.lines).toEqual([TIER_D_DISCLOSURE]);
    }
  });

  it('a hypothetical Tier D4-promoted entry renders its record instead of the disclosure — decided by the registry, never a caller flag', () => {
    const claim = mustNotClaimFor({ tierD4Record: 'v1, IC=0.04, t=2.31, 2025-01-01..2026-01-01' });
    expect(claim.tier).toBe('d4');
    expect(claim.lines[0]).toContain('v1, IC=0.04');
    expect(claim.lines.join(' ')).not.toContain(TIER_D_DISCLOSURE);
  });

  it('mustNotClaimLines is never empty for any real registry entry', () => {
    for (const entry of METHOD_REGISTRY.all()) {
      expect(mustNotClaimLines(entry).length).toBeGreaterThan(0);
    }
  });
});
