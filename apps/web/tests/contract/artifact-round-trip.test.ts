import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../../src/repositories/migrate';
import { closePool, getPool } from '../../src/repositories/client';
import { buildArtifact, type ComputeContext } from '../../src/calc/artifact';
import { replay } from '../../src/calc/replay';
import { MethodRegistry } from '../../src/calc/registry';
import { loadArtifact, persistArtifact } from '../../src/services/calculations';
import { args, descriptor, input } from '../unit/calc/fixtures';

pg.types.setTypeParser(1700, (value) => value);
pg.types.setTypeParser(20, (value) => value);

const url = process.env['DATABASE_URL'];

/**
 * F05 §5, Contract level: *"artifact ↔ database round-trip preserves exact decimals
 * byte-for-byte; `points[]` survives serialization"*.
 *
 * This is the contract F03's serialization-parity test proves for a column and this one proves
 * for a whole artifact. The failure it guards against is silent by construction: an artifact
 * whose exact value came back as `0.30000000000000004` still renders, still hashes, and only
 * announces itself as a `result_mismatch` months later, in a record nobody can reproduce.
 */
describe.skipIf(url === undefined || url === '')('artifact ↔ database round trip', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    await pool.query('drop schema public cascade; create schema public;');
    await migrate(pool);
    getPool(url);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await closePool();
  });

  /** A method whose exact value is deliberately longer than a double can carry. */
  const divide = (ctx: ComputeContext) => ({
    value: ctx.step({
      key: 'ratio',
      label: 'a over b',
      expression: '{a} / {b}',
      operands: { a: ctx.input('a'), b: ctx.input('b') },
      unit: 'ratio',
      evaluate: (operand) => operand('a').div(operand('b')),
    }),
  });

  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('preserves a 34-digit exact value byte for byte', async () => {
    const built = buildArtifact(
      args(divide, {
        calculationId: uuid(1),
        inputs: [input('a', '1'), input('b', '3')],
        method: {
          methodId: 'test.ratio',
          version: '1.0.0',
          unit: 'ratio',
          roundingRule: 'pct_2dp_half_even',
          workingPrecision: 34,
          compute: divide,
        },
      }),
    );

    await persistArtifact(built);
    const loaded = await loadArtifact(uuid(1));

    expect(loaded?.result?.exact).toBe(built.result?.exact);
    expect(loaded?.result?.exact).toMatch(/^0\.3{34}$/);
    expect(loaded?.result?.display).toBe('0.33');
  });

  it.each(
    ['0.1', '100.00', '0.30000000000000004', '1234567890.123456789', '-0.05', '0'].map(
      (value, index) => [value, index] as const,
    ),
  )(
    'preserves the decimal %s through a step',
    async (value, index) => {
      const passthrough = (ctx: ComputeContext) => ({
        value: ctx.step({
          key: 'identity',
          label: 'the value itself',
          expression: '{v}',
          operands: { v: ctx.input('v') },
          unit: 'ratio',
          evaluate: (operand) => operand('v'),
        }),
      });

      const id = uuid(100 + index);
      const built = buildArtifact(
        args(passthrough, {
          calculationId: id,
          // Through a declared input, not a literal operand: `calculation_snapshot`'s identity
          // index includes `input_hash`, so six artifacts differing only in a literal would be
          // one artifact as far as the schema is concerned — correctly.
          inputs: [input('v', value)],
          method: {
            methodId: 'test.identity',
            version: '1.0.0',
            unit: 'ratio',
            roundingRule: 'ratio_6dp_half_even',
            workingPrecision: 34,
            compute: passthrough,
          },
        }),
      );

      await persistArtifact(built);
      const loaded = await loadArtifact(id);

      expect(loaded?.steps[0]?.exactValue).toBe(built.steps[0]?.exactValue);
      expect(loaded?.result?.exact).toBe(built.result?.exact);
      // No JSON number anywhere on the way through: a JSON number is an IEEE 754 double the
      // moment it is parsed, and the result hash would then depend on the parser.
      expect(typeof loaded?.result?.exact).toBe('string');
    },
  );

  it('survives the round trip well enough to still replay as `match`', async () => {
    // The strongest available statement of "byte for byte": the hashes are recomputed from the
    // loaded inputs and assumptions, so anything the database changed shows up here.
    // The registry entry must agree with the method the artifact was built under, right down to
    // the rounding rule — changing that alone is a numeric change and would replay as a
    // mismatch, which is correct behaviour and not what this test is measuring.
    const registry = new MethodRegistry([
      {
        ...descriptor({ id: 'test.ratio', unit: 'ratio', roundingRule: 'ratio_6dp_half_even' }),
        compute: divide,
      },
    ]);
    const built = buildArtifact(
      args(divide, {
        calculationId: uuid(2),
        inputs: [input('a', '1'), input('b', '7')],
        method: {
          methodId: 'test.ratio',
          version: '1.0.0',
          unit: 'ratio',
          roundingRule: 'ratio_6dp_half_even',
          workingPrecision: 34,
          compute: divide,
        },
      }),
    );

    await persistArtifact(built);
    const loaded = await loadArtifact(uuid(2));
    expect(loaded).not.toBeNull();

    const verdict = replay(loaded as NonNullable<typeof loaded>, registry);
    expect(verdict.outcome).toBe('match');
    expect(verdict.inputHashActual).toBe(built.inputHash);
  });

  it('round-trips points[] for a series artifact', async () => {
    // F-07: one artifact, a points table inside it, a chart point addressed {id, pointIndex}.
    const series = (ctx: ComputeContext) => {
      let last = ctx.step({
        key: 'p0',
        label: 'point 0',
        expression: '{a} / {b}',
        operands: { a: ctx.input('a'), b: ctx.input('b') },
        unit: 'ratio',
        evaluate: (operand) => operand('a').div(operand('b')),
      });
      ctx.point({ observationKey: '2026-08-28', value: last });

      last = ctx.step({
        key: 'p1',
        label: 'point 1',
        expression: '{prev} / {b}',
        operands: { prev: last, b: ctx.input('b') },
        unit: 'ratio',
        evaluate: (operand) => operand('prev').div(operand('b')),
      });
      ctx.point({ observationKey: '2026-08-29', value: last });

      return { value: last };
    };

    const built = buildArtifact(
      args(series, {
        calculationId: uuid(3),
        inputs: [input('a', '1'), input('b', '3')],
        method: {
          methodId: 'test.series',
          version: '1.0.0',
          unit: 'ratio',
          roundingRule: 'ratio_6dp_half_even',
          workingPrecision: 34,
          compute: series,
        },
      }),
    );

    await persistArtifact(built);
    const loaded = await loadArtifact(uuid(3));

    expect(loaded?.points).toEqual(built.points);
    expect(loaded?.points?.[0]?.exactValue).toMatch(/^0\.3{34}$/);
    expect(loaded?.points?.[1]?.observationKey).toBe('2026-08-29');
    // Addressable as {calculationId, pointIndex}, which is the whole of F-07's ruling.
    expect(loaded?.points?.map((p) => p.pointIndex)).toEqual([0, 1]);
  });

  it('round-trips an abstention with its reason, rather than a blank', async () => {
    const abstaining = (ctx: ComputeContext) =>
      ctx.abstain({
        reason: 'below_sample_threshold',
        message: 'Only 3 observations in the window; at least 25 are required.',
      });

    const built = buildArtifact(args(abstaining as never, { calculationId: uuid(4) }));

    await persistArtifact(built);
    const loaded = await loadArtifact(uuid(4));

    expect(loaded?.result).toBeNull();
    expect(loaded?.eligibility).toBe('insufficient_data');
    expect(loaded?.abstention).toEqual(built.abstention);
  });

  it('round-trips every input with its provenance intact', async () => {
    const loaded = await loadArtifact(uuid(1));
    const original = buildArtifact(
      args(divide, {
        calculationId: uuid(1),
        inputs: [input('a', '1'), input('b', '3')],
        method: {
          methodId: 'test.ratio',
          version: '1.0.0',
          unit: 'ratio',
          roundingRule: 'pct_2dp_half_even',
          workingPrecision: 34,
          compute: divide,
        },
      }),
    );

    expect(loaded?.inputs).toEqual(original.inputs);
    expect(loaded?.assumptions).toEqual(original.assumptions);
    expect(loaded?.steps).toEqual(original.steps);
  });

  it('returns null for an id that does not exist, rather than an empty artifact', async () => {
    await expect(loadArtifact(uuid(999))).resolves.toBeNull();
  });
});
