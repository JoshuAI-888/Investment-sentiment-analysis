import { describe, expect, it } from 'vitest';
import { decideTriggerWindow, evaluateSpikeVerdict } from '../../../../src/services/jobs/trigger';

/**
 * F16 §5 "Trigger (D-15)" test plan / §6 DoD: "a crossing fixture fires exactly one window; a
 * non-crossing fixture fires none and still writes a verdict artifact... a window that would
 * breach an X ceiling is refused and writes a CoverageGap, never a shortened window."
 *
 * **Why these are pure-function tests against hand-built inputs, not the real `price.regime`
 * pipeline end to end.** `trigger.ts`'s own top doc names a real, disclosed gap found while
 * building this: `services/dashboard/inputs.ts#priceRegimeInputs` declares `quote_kind:
 * 'close_unadjusted'` (honestly — `adapters/market.ts#DailyBar` does not carry FMP's `adjClose`
 * field at all), and `computePriceRegime` refuses to compute over anything but
 * `adjusted_close` — so a real artifact built from today's actual market adapter data always
 * abstains (`eligibility: 'not_applicable'`) and can never exercise the `fired: true` branch.
 * That is a genuine, separate, already-flagged limitation (F04/F07 `CONTRACTS`), not something
 * these tests should paper over by mislabelling test data as `adjusted_close`. What these tests
 * prove instead is that the *decision logic downstream of eligibility* — "given this eligibility
 * and this r_5 value, does it fire" — is correct on its own terms, independent of whether
 * today's real pipeline can currently reach the eligible branch. The full pipeline (artifact
 * persistence, the ceiling check, the CoverageGap write) is covered by
 * `tests/integration/dispatch.test.ts`, which cannot run in this session (no Postgres) but is
 * written for CI.
 */
describe('evaluateSpikeVerdict', () => {
  it('fires when |r_5| crosses the threshold', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'ok', r5ExactValue: '0.08' }, '0.05');
    expect(verdict.fired).toBe(true);
  });

  it('fires on a negative move whose magnitude crosses the threshold', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'ok', r5ExactValue: '-0.09' }, '0.05');
    expect(verdict.fired).toBe(true);
  });

  it('does not fire when |r_5| does not cross the threshold', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'ok', r5ExactValue: '0.01' }, '0.05');
    expect(verdict.fired).toBe(false);
  });

  it('fires exactly at the threshold boundary (>=, not >)', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'ok', r5ExactValue: '0.05' }, '0.05');
    expect(verdict.fired).toBe(true);
  });

  it('never fires on an abstained artifact, regardless of what r_5 would have said', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'not_applicable', r5ExactValue: '0.99' }, '0.05');
    expect(verdict.fired).toBe(false);
    expect(verdict.reason).toContain('abstained');
  });

  it('never fires when eligible but the artifact carried no r_5 step', () => {
    const verdict = evaluateSpikeVerdict({ eligibility: 'ok', r5ExactValue: null }, '0.05');
    expect(verdict.fired).toBe(false);
  });
});

describe('decideTriggerWindow (D-15 / D-32)', () => {
  it('refuses when the per-event ceiling is zero (D-32 default) — never truncates', () => {
    const decision = decideTriggerWindow({ monthlyReadCeiling: 0, dailyReadCeiling: 0, perEventReadCeiling: 0 }, 100);
    expect(decision.kind).toBe('refused');
    if (decision.kind === 'refused') {
      expect(decision.requestedReads).toBe(100); // the full request, not a smaller one
    }
  });

  it('dispatches when the requested reads fit within the per-event ceiling', () => {
    const decision = decideTriggerWindow({ monthlyReadCeiling: 30_000, dailyReadCeiling: 1430, perEventReadCeiling: 100 }, 100);
    expect(decision).toEqual({ kind: 'dispatch', requestedReads: 100 });
  });

  it('refuses when the requested reads exceed the per-event ceiling, without shrinking the request', () => {
    const decision = decideTriggerWindow({ monthlyReadCeiling: 30_000, dailyReadCeiling: 1430, perEventReadCeiling: 50 }, 100);
    expect(decision.kind).toBe('refused');
    if (decision.kind === 'refused') {
      expect(decision.requestedReads).toBe(100);
    }
  });
});
