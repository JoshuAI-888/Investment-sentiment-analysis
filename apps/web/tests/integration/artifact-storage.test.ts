import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { buildArtifact, type ComputeContext } from '../../src/calc/artifact';
import { persistArtifact } from '../../src/services/calculations';
import { computeRankChange } from '../../src/services/attention-rank-change';
import { ROW_BYTES } from '../../scripts/checks/storage-projection';

const url = databaseUrl();

/**
 * F05 §2 and §5: *"the storage projection re-measured against real artifacts"*, at the Wave 1
 * shape of 100 symbols.
 *
 * `scripts/checks/storage-projection.ts` shipped with F03 and its per-row byte figures were
 * F-07's estimates — *"deliberately conservative — F-07 used ~150 for narrow rows"*. Estimates
 * are what F05 is asked to replace, and the reason is that the projection is the only instrument
 * anybody has for whether the corpus fits: an estimate that drifted quietly would be believed
 * right up to the month the database filled.
 *
 * So this measures `pg_column_size` against artifacts built by the real method and written by
 * the real repository, and fails if the projection's constants have become **under**-estimates.
 * It deliberately does not fail on over-estimation: a projection that over-states is
 * conservative, and pinning both ends would turn a Postgres version bump into a red build.
 *
 * `pg_column_size` is the on-disk size of the row including TOAST compression, and excluding
 * per-page overhead and indexes. Indexes are accounted for separately by `INDEX_OVERHEAD`.
 */
describe.skipIf(url === undefined)('F05 — storage measured against real artifacts', () => {
  let pool: pg.Pool;
  let measured: {
    snapshot: number;
    input: number;
    step: number;
    point: number;
  };

  /** The Wave 1 universe: D-27's 100 symbols. */
  const SYMBOLS = 100;
  /** A 180-day series, per F-07's worked example. */
  const SERIES_POINTS = 180;

  const reading = {
    filter: 'all-stocks',
    sourceUrl: 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1',
    observedAt: '2026-08-30T11:55:00.000Z',
    availableAt: '2026-08-30T11:55:00.000Z',
    ingestedAt: '2026-08-30T11:56:00.000Z',
    rawPayloadId: null,
    methodologyVersion: 'v1',
  };

  const pad = (n: number) => String(n).padStart(12, '0');

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    await truncateAll(pool);
    getPool(url);

    // 100 real artifacts, one per symbol, through the real method and the real repository.
    for (let index = 0; index < SYMBOLS; index += 1) {
      const artifact = computeRankChange({
        entry: {
          rank: (index % 90) + 2,
          ticker: `SYM${index}`,
          name: `Company number ${index} Incorporated`,
          mentions: String(200 + index),
          upvotes: String(400 + index),
          rank24hAgo: String((index % 90) + 5),
          mentions24hAgo: String(150 + index),
        },
        reading,
        priorMethodologyVersion: reading.methodologyVersion,
        securityId: `20000000-0000-4000-8000-${pad(index)}`,
        asOf: '2026-08-30T12:00:00.000Z',
        configVersion: '1',
        calculationId: `30000000-0000-4000-8000-${pad(index)}`,
        computedAt: '2026-08-30T12:00:01.000Z',
      });
      await persistArtifact(artifact);
    }

    // One series artifact, so a point inside `points[]` can be priced separately from a row.
    const template = computeRankChange({
      entry: {
        rank: 2,
        ticker: 'SER',
        name: 'Series Co',
        mentions: '900',
        upvotes: '900',
        rank24hAgo: '3',
        mentions24hAgo: '800',
      },
      reading,
      priorMethodologyVersion: reading.methodologyVersion,
      securityId: '20000000-0000-0000-0000-999999999999',
      asOf: '2026-08-30T12:00:00.000Z',
      configVersion: '1',
      calculationId: '40000000-0000-4000-8000-000000000001',
      computedAt: '2026-08-30T12:00:01.000Z',
    });

    // 180 genuinely distinct calendar dates, not 28 cycled six times — a real 180-point series
    // never repeats an observation date, and pglz compresses six-times-repeated text far better
    // than it compresses 180 unique ones (lane-review finding 5).
    const seriesDates = Array.from({ length: SERIES_POINTS }, (_, index) =>
      new Date(Date.UTC(2024, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
    );

    const series = (ctx: ComputeContext) => {
      let last = ctx.step({
        key: 'p0',
        label: 'point 0',
        expression: '{a} / {b}',
        operands: { a: ctx.input('rank_now'), b: ctx.input('rank_prior') },
        unit: 'ranks',
        // Division against the pinned working precision (decimal.ts) forces a genuinely
        // irregular, many-digit exact value — not the small single/double-digit integer the
        // previous fixture produced by repeated subtraction of a constant. `.mod()` keeps the
        // magnitude bounded rather than compounding toward zero or infinity over 180 steps,
        // which is closer to what a real bounded metric's series actually looks like.
        evaluate: (operand) => operand('a').dividedBy(operand('b')).mod('10000'),
      });
      ctx.point({ observationKey: seriesDates[0] as string, value: last });

      for (let index = 1; index < SERIES_POINTS; index += 1) {
        last = ctx.step({
          key: `p${index}`,
          label: `point ${index}`,
          expression: '{prev} / {b}',
          operands: { prev: last, b: ctx.input('rank_prior') },
          unit: 'ranks',
          evaluate: (operand) =>
            operand('prev').dividedBy(operand('b')).plus(operand('prev')).mod('10000'),
        });
        ctx.point({
          observationKey: seriesDates[index] as string,
          value: last,
        });
      }
      return { value: last };
    };

    await persistArtifact(
      buildArtifact({
        method: {
          methodId: 'test.series',
          version: '1.0.0',
          unit: 'ranks',
          roundingRule: 'int_0dp_half_even',
          workingPrecision: 34,
          compute: series,
        },
        subject: template.subject,
        asOf: template.asOf,
        inputs: template.inputs,
        assumptions: template.assumptions,
        configVersion: '1',
        scenario: { kind: 'official' },
        calculationId: '40000000-0000-4000-8000-000000000001',
        computedAt: template.computedAt,
      }),
    );

    const measure = async (sql: string): Promise<number> => {
      const { rows } = await pool.query<{ value: string | null }>(sql);
      return Number(rows[0]?.value ?? '0');
    };

    const pointsColumn = await measure(
      `select avg(pg_column_size(points))::text as value
         from calculation_snapshot where points is not null`,
    );

    measured = {
      snapshot: await measure(
        `select avg(pg_column_size(t.*))::text as value
           from calculation_snapshot t where points is null`,
      ),
      input: await measure(
        'select avg(pg_column_size(t.*))::text as value from calculation_input t',
      ),
      step: await measure('select avg(pg_column_size(t.*))::text as value from calculation_step t'),
      point: pointsColumn / SERIES_POINTS,
    };

    process.stdout.write(
      `\n  measured artifact bytes (${SYMBOLS} symbols, pg_column_size):\n` +
        `    calculationSnapshot ${measured.snapshot.toFixed(1)} (projection uses ${ROW_BYTES.calculationSnapshot})\n` +
        `    calculationInput    ${measured.input.toFixed(1)} (projection uses ${ROW_BYTES.calculationInput})\n` +
        `    calculationStep     ${measured.step.toFixed(1)} (projection uses ${ROW_BYTES.calculationStep})\n` +
        `    seriesPoint         ${measured.point.toFixed(1)} (projection uses ${ROW_BYTES.seriesPoint})\n\n`,
    );
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await closePool();
  });

  it('wrote 100 symbols’ worth of real artifacts to measure', async () => {
    // Without this the assertions below pass vacuously the day the setup stops writing.
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from calculation_snapshot',
    );
    expect(rows[0]?.count).toBe(String(SYMBOLS + 1));
  });

  // Thunks rather than values: `measured` is filled in `beforeAll`, and `it.each` evaluates its
  // table at collection time. The return annotations are required — the accessors are inferred
  // through `measured`, which the setup writes to, and TS will not infer that cycle.
  const cases: readonly (readonly [string, () => number, () => number])[] = [
    ['calculationSnapshot', (): number => measured.snapshot, (): number => ROW_BYTES.calculationSnapshot],
    ['calculationInput', (): number => measured.input, (): number => ROW_BYTES.calculationInput],
    ['calculationStep', (): number => measured.step, (): number => ROW_BYTES.calculationStep],
    ['seriesPoint', (): number => measured.point, (): number => ROW_BYTES.seriesPoint],
  ];

  it.each(cases)('the projection does not under-state %s', (_name, actual, projected) => {
    expect(actual()).toBeLessThanOrEqual(projected());
  });

  it('is not so conservative that the projection stops meaning anything', () => {
    // An over-estimate is safe; a 10× over-estimate is a number that says nothing about the
    // system. This is the bound that makes the projection a measurement rather than a ceiling
    // somebody picked.
    expect(measured.snapshot * 4).toBeGreaterThan(ROW_BYTES.calculationSnapshot);
    expect(measured.input * 4).toBeGreaterThan(ROW_BYTES.calculationInput);
    expect(measured.step * 4).toBeGreaterThan(ROW_BYTES.calculationStep);
    expect(measured.point * 4).toBeGreaterThan(ROW_BYTES.seriesPoint);
  });

  it('confirms F-07’s ruling with real rows: a series is one artifact, not one per point', async () => {
    // The arithmetic F-07 turned on, measured rather than argued. A 180-point series stored as
    // one artifact costs a header plus a points array; stored as 180 artifacts it would cost 180
    // headers, each with its own inputs.
    const { rows } = await pool.query<{ value: string }>(
      `select pg_column_size(t.*)::text as value
         from calculation_snapshot t where points is not null`,
    );
    const asOneArtifact = Number(rows[0]?.value);
    const asArtifactPerPoint =
      SERIES_POINTS *
      (measured.snapshot + measured.input * 5 + measured.step * 2);

    expect(asArtifactPerPoint / asOneArtifact).toBeGreaterThan(10);
  });
});
