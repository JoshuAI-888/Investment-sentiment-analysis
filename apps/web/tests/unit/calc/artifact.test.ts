import { describe, expect, it } from 'vitest';
import {
  ArtifactBuildError,
  buildArtifact,
  type ComputeContext,
  type StepValue,
} from '../../../src/calc/artifact';
import { dec } from '../../../src/calc/decimal';
import { args, assumption, input, method } from './fixtures';

/** `a - b`, in one honestly-emitted step. The baseline every case below deviates from. */
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

describe('F05 §4.2 — the steps are emitted BY the computation, not narrated after it', () => {
  it('records the step and returns its value in a single call', () => {
    // There is no `ctx.record(...)` and no `exactValue` field on a StepSpec. The evaluation and
    // the record are the same act, which is what makes divergence unrepresentable rather than
    // merely discouraged.
    const artifact = buildArtifact(args(subtract));

    expect(artifact.steps).toHaveLength(1);
    expect(artifact.steps[0]?.exactValue).toBe('6');
    expect(artifact.result?.exact).toBe('6');
  });

  it('records whatever `evaluate` returned, not what the expression appears to say', () => {
    // Proves the recorded exact value is the *evaluated* one rather than a re-reading of the
    // symbolic formula: here the two deliberately disagree, and the artifact reports the
    // computed value. A builder that re-derived the number from the expression would report 6.
    const artifact = buildArtifact(
      args((ctx) => ({
        value: ctx.step({
          key: 'difference',
          label: 'a minus b',
          expression: '{a} - {b}',
          operands: { a: ctx.input('a'), b: ctx.input('b') },
          unit: 'ranks',
          evaluate: (operand) => operand('a').plus(operand('b')),
        }),
      })),
    );
    expect(artifact.steps[0]?.exactValue).toBe('14');
    expect(artifact.result?.exact).toBe('14');
  });

  // CAN FAIL — the DoD's "a step list cannot be produced without the value", case 1 of 3.
  it('refuses a result that no step produced', () => {
    const forged = { stepKey: 'difference', unit: 'ranks', decimal: dec('999') } as unknown as StepValue;

    expect(() =>
      buildArtifact(
        args((ctx) => {
          // A full, plausible trace is recorded — and then a different number is returned. This
          // is precisely the divergence §4.2 exists to make impossible, and it is rejected on
          // identity: the returned object is not one the context minted.
          ctx.step({
            key: 'difference',
            label: 'a minus b',
            expression: '{a} - {b}',
            operands: { a: ctx.input('a'), b: ctx.input('b') },
            unit: 'ranks',
            evaluate: (operand) => operand('a').minus(operand('b')),
          });
          return { value: forged };
        }),
      ),
    ).toThrow(ArtifactBuildError);

    expect(() =>
      buildArtifact(
        args((ctx) => {
          ctx.step({
            key: 'difference',
            label: 'a minus b',
            expression: '{a} - {b}',
            operands: { a: ctx.input('a'), b: ctx.input('b') },
            unit: 'ranks',
            evaluate: (operand) => operand('a').minus(operand('b')),
          });
          return { value: forged };
        }),
      ),
    ).toThrow(/returned a value that no step produced/);
  });

  // CAN FAIL — case 2 of 3.
  it('refuses a value returned with no steps at all', () => {
    const forged = { stepKey: 'nothing', unit: 'ranks', decimal: dec('6') } as unknown as StepValue;
    expect(() => buildArtifact(args(() => ({ value: forged })))).toThrow(
      /no step produced/,
    );
  });

  // CAN FAIL — case 3 of 3.
  it('refuses a substituted formula that does not correspond to the operands', () => {
    expect(() =>
      buildArtifact(
        args((ctx) => ({
          value: ctx.step({
            key: 'difference',
            label: 'a minus b',
            // References a term that is not an operand, so the rendered substitution would show
            // a formula the value does not follow.
            expression: '{a} - {b} + {c}',
            operands: { a: ctx.input('a'), b: ctx.input('b') },
            unit: 'ranks',
            evaluate: (operand) => operand('a').minus(operand('b')),
          }),
        })),
      ),
    ).toThrow(/not one of its operands/);
  });

  it('substitutes the operand values into the expression the Inspector renders', () => {
    const artifact = buildArtifact(args(subtract));
    expect(artifact.steps[0]?.expression).toBe('{a} - {b}');
    expect(artifact.steps[0]?.substituted).toBe('10 - 4');
  });

  it('chains one step into the next, so the trace is connected end to end', () => {
    const artifact = buildArtifact(
      args((ctx) => {
        const first = ctx.step({
          key: 'difference',
          label: 'a minus b',
          expression: '{a} - {b}',
          operands: { a: ctx.input('a'), b: ctx.input('b') },
          unit: 'ranks',
          evaluate: (operand) => operand('a').minus(operand('b')),
        });
        return {
          value: ctx.step({
            key: 'doubled',
            label: 'twice the difference',
            expression: '{difference} * {two}',
            operands: { difference: first, two: '2' },
            unit: 'ranks',
            evaluate: (operand) => operand('difference').times(operand('two')),
          }),
        };
      }),
    );
    expect(artifact.steps.map((step) => step.key)).toEqual(['difference', 'doubled']);
    expect(artifact.steps[1]?.substituted).toBe('6 * 2');
    expect(artifact.result?.exact).toBe('12');
  });

  it('refuses two steps with the same key', () => {
    expect(() =>
      buildArtifact(
        args((ctx) => {
          const spec = {
            key: 'same',
            label: 'x',
            expression: '{a}',
            operands: { a: ctx.input('a') },
            unit: 'ranks',
            evaluate: (operand: (name: string) => ReturnType<typeof dec>) => operand('a'),
          };
          ctx.step(spec);
          return { value: ctx.step(spec) };
        }),
      ),
    ).toThrow(/Duplicate step key/);
  });

  it('refuses an operand that is neither a decimal nor an earlier step value', () => {
    expect(() =>
      buildArtifact(
        args((ctx) => ({
          value: ctx.step({
            key: 's',
            label: 'x',
            expression: '{a}',
            operands: { a: { decimal: dec('1') } as never },
            unit: 'ranks',
            evaluate: (operand) => operand('a'),
          }),
        })),
      ),
    ).toThrow(/neither a decimal/);
  });

  // CAN FAIL — a value legitimately minted by ctx.step(), then mutated afterward. This is not
  // forgery (the WeakSet identity check alone can't catch it): decimal.js instances are plain
  // mutable objects, so a method that reused an operand `Dec` and mutated it in place after
  // returning it from step() must not be able to change what the trace already recorded.
  it('is not fooled by mutating a legitimately-minted value after the fact', () => {
    const artifact = buildArtifact(
      args((ctx) => {
        const v = ctx.step({
          key: 'difference',
          label: 'a minus b',
          expression: '{a} - {b}',
          operands: { a: ctx.input('a'), b: ctx.input('b') },
          unit: 'ranks',
          evaluate: (operand) => operand('a').minus(operand('b')),
        });
        // Reach into the decimal.js instance handed back and mutate its internal digits — no
        // forged object, no `as unknown as StepValue`, just the value ctx.step() legitimately
        // produced, mutated after the fact.
        const mutable = v.decimal as unknown as { d?: number[] };
        if (mutable.d) mutable.d[0] = 999;
        return { value: v };
      }),
    );

    expect(artifact.steps[0]?.exactValue).toBe('6');
    expect(artifact.result?.exact).toBe('6');
  });

  // CAN FAIL — a second lane-review pass on the mutation fix above: a plain getter closes
  // assignment (`v.decimal = ...` throws in strict mode) but not redefinition.
  // `Object.defineProperty` on a still-configurable, legitimately-minted object replaces the
  // getter outright, reopening the exact divergence the fix above closed. `Object.freeze`
  // fixes it; this proves the freeze is what's doing the work, not the getter alone.
  it('is not fooled by redefining a legitimately-minted value\'s decimal via defineProperty', () => {
    const artifact = buildArtifact(
      args((ctx) => {
        const v = ctx.step({
          key: 'difference',
          label: 'a minus b',
          expression: '{a} - {b}',
          operands: { a: ctx.input('a'), b: ctx.input('b') },
          unit: 'ranks',
          evaluate: (operand) => operand('a').minus(operand('b')),
        });
        expect(() => Object.defineProperty(v, 'decimal', { value: dec('999') })).toThrow();
        return { value: v };
      }),
    );

    expect(artifact.steps[0]?.exactValue).toBe('6');
    expect(artifact.result?.exact).toBe('6');
  });
});

describe('F05 §4.2 — the ugliest inputs', () => {
  it('refuses a division by zero rather than rendering Infinity', () => {
    expect(() =>
      buildArtifact(
        args((ctx) => ({
          value: ctx.step({
            key: 'ratio',
            label: 'a over zero',
            expression: '{a} / {zero}',
            operands: { a: ctx.input('a'), zero: '0' },
            unit: 'ratio',
            evaluate: (operand) => operand('a').div(operand('zero')),
          }),
        })),
      ),
    ).toThrow(/non-finite value has no/);
  });

  it('refuses an input the method never declared, and names the ones it did', () => {
    expect(() => buildArtifact(args((ctx) => ({ value: ctx.input('missing') as never })))).toThrow(
      /Declared: a, b/,
    );
  });

  it('refuses an assumption the registry does not declare', () => {
    expect(() =>
      buildArtifact(args((ctx) => ({ value: ctx.assumption('nope') as never }))),
    ).toThrow(/sole runtime description/);
  });

  it('refuses to use a non-decimal input in arithmetic', () => {
    const built = args(subtract, {
      inputs: [input('a', 'finbert@0f1e2d3', { dataType: 'identity' }), input('b', '4')],
    });
    expect(() => buildArtifact(built)).toThrow(/is a identity, not a decimal/);
  });
});

// F06's addition to F05's context: a non-arithmetic identity read, and a non-throwing presence
// check. Both are needed by methods that gate on a declared fact (a methodology version, an
// omitted composite component) without pulling it into arithmetic.
describe('F06 — ctx.identity() and ctx.hasInput()', () => {
  it('reads a declared identity input as raw text', () => {
    const artifact = buildArtifact(
      args(
        (ctx) => ({
          value: ctx.step({
            key: 'echo',
            label: 'echo a',
            expression: '{a}',
            operands: { a: ctx.input('a') },
            unit: 'ranks',
            evaluate: (operand) => operand('a'),
          }),
        }),
        { inputs: [input('a', '10'), input('tag', 'v1', { dataType: 'identity', unit: null })] },
      ),
    );
    expect(artifact.steps[0]?.exactValue).toBe('10');
  });

  it('throws for an undeclared identity key, naming what was declared', () => {
    expect(() =>
      buildArtifact(args((ctx) => ({ value: ctx.identity('missing') as never }))),
    ).toThrow(/Declared: a, b/);
  });

  it('refuses to read a decimal input as an identity', () => {
    expect(() =>
      buildArtifact(args((ctx) => ({ value: ctx.identity('a') as never }))),
    ).toThrow(/is a decimal, not an identity/);
  });

  it('hasInput is true for a declared key and false for anything else, and never throws', () => {
    expect(() =>
      buildArtifact(
        args((ctx) => {
          if (!ctx.hasInput('a') || ctx.hasInput('ghost')) {
            throw new Error('hasInput disagreed with what was declared');
          }
          return {
            value: ctx.step({
              key: 's',
              label: 'x',
              expression: '{a}',
              operands: { a: ctx.input('a') },
              unit: 'ranks',
              evaluate: (operand) => operand('a'),
            }),
          };
        }),
      ),
    ).not.toThrow();
  });
});

describe('F05 §6.3 — abstention is a value, not an absent one', () => {
  const abstaining = (ctx: ComputeContext) =>
    ctx.abstain({ reason: 'below_sample_threshold', message: 'Too few observations to say.' });

  it('produces an artifact with no result and a stated reason', () => {
    const artifact = buildArtifact(args(abstaining as never));

    expect(artifact.result).toBeNull();
    expect(artifact.eligibility).toBe('insufficient_data');
    expect(artifact.abstention).toEqual({
      reason: 'below_sample_threshold',
      message: 'Too few observations to say.',
    });
    // Still hashed, so an abstention replays like any other outcome.
    expect(artifact.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps `not_applicable` to its own eligibility rather than to insufficient data', () => {
    // They are different statements. "We do not have enough" is not "this does not apply", and
    // collapsing them tells a reader nothing about what to do next.
    const artifact = buildArtifact(
      args(((ctx: ComputeContext) =>
        ctx.abstain({ reason: 'not_applicable', message: 'No prior rank exists.' })) as never),
    );
    expect(artifact.eligibility).toBe('not_applicable');
    expect(artifact.abstention?.message).toBe('No prior rank exists.');
  });

  it('gives two different abstention reasons two different result hashes', () => {
    const a = buildArtifact(args(abstaining as never));
    const b = buildArtifact(
      args(((ctx: ComputeContext) =>
        ctx.abstain({ reason: 'not_applicable', message: 'x' })) as never),
    );
    expect(a.resultHash).not.toBe(b.resultHash);
  });

  it('keeps the steps recorded before the abstention', () => {
    const artifact = buildArtifact(
      args(((ctx: ComputeContext) => {
        ctx.step({
          key: 'partial',
          label: 'as far as it got',
          expression: '{a}',
          operands: { a: ctx.input('a') },
          unit: 'ranks',
          evaluate: (operand) => operand('a'),
        });
        return ctx.abstain({ reason: 'below_sample_threshold', message: 'stopped here' });
      }) as never),
    );
    expect(artifact.steps).toHaveLength(1);
    expect(artifact.result).toBeNull();
  });
});

describe('F-07 — one artifact per invocation, points[] for a series', () => {
  const series = (ctx: ComputeContext) => {
    let last = ctx.step({
      key: 'p0',
      label: 'point 0',
      expression: '{a}',
      operands: { a: ctx.input('a') },
      unit: 'ranks',
      evaluate: (operand) => operand('a'),
    });
    ctx.point({ observationKey: '2026-08-28', value: last });

    last = ctx.step({
      key: 'p1',
      label: 'point 1',
      expression: '{prev} - {b}',
      operands: { prev: last, b: ctx.input('b') },
      unit: 'ranks',
      evaluate: (operand) => operand('prev').minus(operand('b')),
    });
    ctx.point({ observationKey: '2026-08-29', value: last });

    return { value: last };
  };

  it('carries the points inside one artifact, addressed by index', () => {
    const artifact = buildArtifact(args(series));

    expect(artifact.points).toEqual([
      { pointIndex: 0, observationKey: '2026-08-28', exactValue: '10', displayValue: '10' },
      { pointIndex: 1, observationKey: '2026-08-29', exactValue: '6', displayValue: '6' },
    ]);
    expect(artifact.calculationId).toBe(args(series).calculationId);
  });

  it('leaves points null for a scalar, rather than an empty array', () => {
    // A `[]` reads as "a series with no points". `null` reads as "not a series", which is what
    // a scalar is.
    expect(buildArtifact(args(subtract)).points).toBeNull();
  });

  // CAN FAIL — a points table is a derivation table (F-07), not a place to put numbers.
  it('refuses a point whose value no step produced', () => {
    const forged = { stepKey: 'x', unit: 'ranks', decimal: dec('1') } as unknown as StepValue;
    expect(() =>
      buildArtifact(
        args((ctx) => {
          const value = ctx.step({
            key: 's',
            label: 'x',
            expression: '{a}',
            operands: { a: ctx.input('a') },
            unit: 'ranks',
            evaluate: (operand) => operand('a'),
          });
          ctx.point({ observationKey: 'k', value: forged });
          return { value };
        }),
      ),
    ).toThrow(/no step produced/);
  });
});

describe('F05 §4.3 — the artifact carries both hashes', () => {
  it('changes the input hash when any input value changes', () => {
    const a = buildArtifact(args(subtract));
    const b = buildArtifact(args(subtract, { inputs: [input('a', '11'), input('b', '4')] }));
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it('changes the input hash when an identity input changes and nothing else does', () => {
    // §5's integration case in miniature: *"the scorer identity is inside the hashed inputs, so
    // swapping the pinned revision alone produces result_mismatch"*. The mechanism is that
    // `inputs` is hashed wholesale, so any declared identity — a scorer revision, a provider
    // endpoint version — is inside the hash by construction rather than by remembering to add it.
    const withScorer = (revision: string) =>
      args(subtract, {
        inputs: [
          input('a', '10'),
          input('b', '4'),
          input('scorer', revision, { dataType: 'identity', unit: null }),
        ],
      });

    expect(buildArtifact(withScorer('finbert@aaaaaaa')).inputHash).not.toBe(
      buildArtifact(withScorer('finbert@bbbbbbb')).inputHash,
    );
    // ...and the value is untouched, which is what makes the mismatch attributable to identity.
    expect(buildArtifact(withScorer('finbert@aaaaaaa')).result?.exact).toBe('6');
  });

  // CAN FAIL — lane-review finding 8. `canonical.ts`'s own type tag is shape-based (does a
  // string look like decimal grammar), not `dataType`-aware — it has no way to be, since
  // `canonicalizeValue` is a generic recursive serializer with no knowledge of
  // `CalculationInputValue`'s schema. An `identity` value `'007'` and a `decimal` value `'7'`
  // therefore canonicalize their `value` field IDENTICALLY in isolation. What actually
  // disambiguates them is that `dataType` itself is a sibling field inside the same object being
  // hashed — a different `dataType` string is a different canonical fragment in the *enclosing*
  // object, so the two inputs still produce different `inputHash`es. This test is the guarantee
  // that matters, made explicit rather than assumed from the isolated string-tagging behaviour.
  it('an identity input and a decimal input with the same numeric-looking text still hash differently', () => {
    // `unit` held constant on purpose — varying it alongside `dataType` would let this pass
    // for the wrong reason (a differing `unit` field alone is enough to change the hash) and
    // stop isolating the one thing this test exists to prove: `dataType` itself is what
    // disambiguates, even when every other field ties. A second re-review of finding 8's fix
    // caught this — the first version of this test varied both.
    const withDataType = (dataType: 'identity' | 'decimal') =>
      args(subtract, {
        inputs: [
          input('a', '10'),
          input('b', '4'),
          input('c', '7', { dataType, unit: 'ranks' }),
        ],
      });

    const asIdentity = buildArtifact(withDataType('identity'));
    const asDecimal = buildArtifact(withDataType('decimal'));
    expect(asIdentity.inputHash).not.toBe(asDecimal.inputHash);
  });

  it('changes the input hash when an assumption changes', () => {
    const a = buildArtifact(args(subtract));
    const b = buildArtifact(args(subtract, { assumptions: [assumption('k', '3')] }));
    expect(a.inputHash).not.toBe(b.inputHash);
  });

  it('does not change the input hash when the declaration order changes', () => {
    // The *set* of inputs is the fact; the order a method happened to declare them in is not.
    // Canonicalization keeps arrays order-significant on purpose, so the builder sorts by key
    // before hashing — deliberately, rather than by assuming it.
    const a = buildArtifact(args(subtract));
    const b = buildArtifact(args(subtract, { inputs: [input('b', '4'), input('a', '10')] }));
    expect(a.inputHash).toBe(b.inputHash);
  });

  it('still records the inputs in the order the method declared them', () => {
    // Sorting is a hashing concern. The Inspector reads them in the order the method presented
    // them, which is the order that makes the derivation legible.
    const artifact = buildArtifact(args(subtract, { inputs: [input('b', '4'), input('a', '10')] }));
    expect(artifact.inputs.map((i) => i.key)).toEqual(['b', 'a']);
  });
});

describe('F05 §4.8 §5 — precision is carried alongside the display value', () => {
  it('keeps the exact value and the rounded display value separately', () => {
    const ratio = (ctx: ComputeContext) => ({
      value: ctx.step({
        key: 'ratio',
        label: 'a over 3',
        expression: '{a} / {three}',
        operands: { a: ctx.input('a'), three: '3' },
        unit: 'ratio',
        evaluate: (operand) => operand('a').div(operand('three')),
      }),
    });

    const artifact = buildArtifact(
      args(ratio, { method: method(ratio, { unit: 'ratio', roundingRule: 'pct_2dp_half_even' }) }),
    );
    expect(artifact.result?.exact).toMatch(/^3\.3{33}$/);
    expect(artifact.result?.display).toBe('3.33');
    expect(artifact.result?.roundingRule).toBe('pct_2dp_half_even');
  });
});
