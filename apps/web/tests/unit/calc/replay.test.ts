import { describe, expect, it } from 'vitest';
import { buildArtifact, type ComputeContext } from '../../../src/calc/artifact';
import { MethodRegistry } from '../../../src/calc/registry';
import { replay } from '../../../src/calc/replay';
import { args, descriptor } from './fixtures';

/** The shipped arithmetic: `a - b`. */
const subtract = (ctx: ComputeContext) => ({
  value: ctx.step({
    key: 'difference',
    label: 'a minus b',
    expression: '{a} - {b}',
    operands: { a: ctx.input('a'), b: ctx.input('b') },
    unit: 'ranks',
    evaluate: (operand) => operand('a').minus(operand('b')),
  }),
});

/** The same method, edited — and the version *not* bumped. The §4.6 scenario, exactly. */
const subtractEdited = (ctx: ComputeContext) => ({
  value: ctx.step({
    key: 'difference',
    label: 'a minus b',
    expression: '{a} - {b}',
    operands: { a: ctx.input('a'), b: ctx.input('b') },
    unit: 'ranks',
    evaluate: (operand) => operand('a').minus(operand('b')).plus('1'),
  }),
});

const registryWith = (compute: typeof subtract) =>
  new MethodRegistry([{ ...descriptor({ unit: 'ranks' }), compute }]);

const artifact = () => buildArtifact(args(subtract));

describe('F05 §4.6 — replay outcomes', () => {
  it('returns `match` for a clean artifact', () => {
    const verdict = replay(artifact(), registryWith(subtract));
    expect(verdict.outcome).toBe('match');
    expect(verdict.differences).toEqual([]);
    expect(verdict.resultHashActual).toBe(verdict.resultHashExpected);
  });

  // CAN FAIL — the DoD item: a changed method with no version bump.
  it('returns `result_mismatch` when the code changed without a version bump', () => {
    const verdict = replay(artifact(), registryWith(subtractEdited));

    expect(verdict.outcome).toBe('result_mismatch');
    expect(verdict.resultHashActual).not.toBe(verdict.resultHashExpected);
    // The inputs are unchanged, which is what makes the mismatch attributable to the code.
    expect(verdict.inputHashActual).toBe(verdict.inputHashExpected);
    expect(verdict.differences.map((d) => d.field)).toContain('result.exact');
    expect(verdict.explanation).toMatch(/edited without its version being bumped/);
  });

  it('names the step that changed, not merely that something did', () => {
    const verdict = replay(artifact(), registryWith(subtractEdited));
    expect(verdict.differences.map((d) => d.field)).toContain('steps[0].exactValue');
    expect(verdict.differences.find((d) => d.field === 'steps[0].exactValue')).toMatchObject({
      expected: '6',
      actual: '7',
    });
  });

  it('returns `method_missing` when the recorded version is gone', () => {
    const other = new MethodRegistry([
      { ...descriptor({ version: '2.0.0', unit: 'ranks' }), compute: subtract },
    ]);
    const verdict = replay(artifact(), other);

    expect(verdict.outcome).toBe('method_missing');
    // Not silently replayed against the neighbouring version — that would report `match` for a
    // calculation nothing can actually reproduce.
    expect(verdict.explanation).toMatch(/no longer in the registry/);
    expect(verdict.explanation).toMatch(/remain readable/);
  });

  // CAN FAIL — "and **never** mutates the stored artifact".
  it('never mutates the artifact it was given', () => {
    const original = artifact();
    const before = JSON.stringify(original);

    replay(original, registryWith(subtract));
    replay(original, registryWith(subtractEdited));

    expect(JSON.stringify(original)).toBe(before);
  });

  it('re-runs against the frozen inputs, not against anything current', () => {
    // The point of the whole mechanism: a replay that re-fetched would be testing whether the
    // world changed, when the question is whether the code changed.
    const stored = artifact();
    let sawInputs: string[] = [];

    const nosy = (ctx: ComputeContext) => {
      sawInputs = [ctx.input('a').toFixed(), ctx.input('b').toFixed()];
      return subtract(ctx);
    };

    replay(stored, registryWith(nosy));
    expect(sawInputs).toEqual(['10', '4']);
  });

  it('detects a changed trace even when the number is unchanged', () => {
    // A method reworded into a different derivation that lands on the same value is still a
    // different method, and an Inspector showing the old trace beside the new number is wrong.
    const relabelled = (ctx: ComputeContext) => ({
      value: ctx.step({
        key: 'difference',
        label: 'a minus b',
        expression: '{a} + {negB}',
        operands: { a: ctx.input('a'), negB: '-4' },
        unit: 'ranks',
        evaluate: (operand) => operand('a').plus(operand('negB')),
      }),
    });

    const verdict = replay(artifact(), registryWith(relabelled));
    expect(verdict.outcome).toBe('result_mismatch');
    expect(verdict.resultHashActual).toBe(verdict.resultHashExpected);
    expect(verdict.differences.map((d) => d.field)).toContain('steps[0].substituted');
  });

  it('replays an abstention, and mismatches when the reason changes', () => {
    const abstains = (reason: 'below_sample_threshold' | 'not_applicable') => (ctx: ComputeContext) =>
      ctx.abstain({ reason, message: 'because' });

    const stored = buildArtifact(args(abstains('below_sample_threshold') as never));

    expect(replay(stored, registryWith(abstains('below_sample_threshold') as never)).outcome).toBe(
      'match',
    );
    const changed = replay(stored, registryWith(abstains('not_applicable') as never));
    expect(changed.outcome).toBe('result_mismatch');
    expect(changed.differences.map((d) => d.field)).toContain('abstention.reason');
  });

  it('mismatches when a step is dropped from the trace', () => {
    const twoSteps = (ctx: ComputeContext) => {
      ctx.step({
        key: 'first',
        label: 'a',
        expression: '{a}',
        operands: { a: ctx.input('a') },
        unit: 'ranks',
        evaluate: (operand) => operand('a'),
      });
      return subtract(ctx);
    };

    const stored = buildArtifact(args(twoSteps));
    const verdict = replay(stored, registryWith(subtract));
    expect(verdict.outcome).toBe('result_mismatch');
    expect(verdict.differences.map((d) => d.field)).toContain('steps.count');
  });
});
