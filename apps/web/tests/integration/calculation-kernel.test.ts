import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalculationInspector } from '../../src/ui/CalculationInspector';
import { INSPECTOR_SECTIONS } from '../../src/ui/inspector-links';
import { InspectorPage } from '../../app/(app)/calculations/[calculationId]/InspectorPage';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { harness } from '../unit/adapters/fakes';
import { fetchApeWisdomRanking } from '../../src/adapters/apewisdom';
import { closePool, getPool } from '../../src/repositories/client';
import { MethodRegistry } from '../../src/calc/registry';
import type { ComputeContext } from '../../src/calc/artifact';
import {
  computeArtifact,
  loadArtifact,
  persistArtifact,
  runReplay,
  METHOD_REGISTRY,
} from '../../src/services/calculations';
import { computeRankChange } from '../../src/services/attention-rank-change';
import { loadInspectorView } from '../../src/services/inspector';
import {
  effectiveRetentionClass,
  findLatestValidationRun,
  referencesRequiringPermanence,
} from '../../src/repositories/artifacts';
import { purgeExpired } from '../../src/repositories/retention';

const url = databaseUrl();

const READING = {
  filter: 'all-stocks',
  sourceUrl: 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1',
  observedAt: '2026-08-30T11:55:00.000Z',
  availableAt: '2026-08-30T11:55:00.000Z',
  ingestedAt: '2026-08-30T11:56:00.000Z',
  rawPayloadId: null,
  methodologyVersion: 'v1',
};

const AS_OF = '2026-08-30T12:00:00.000Z';
const COMPUTED_AT = '2026-08-30T12:00:01.000Z';
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * The clock the retention job is run at, well past the 90-day window.
 *
 * Ageing the rows instead would mean an UPDATE on `calculation_snapshot`, which migration `0012`
 * rejects unconditionally — so moving the clock is not a convenience here, it is the only way to
 * test retention without weakening the thing being tested.
 */
const PURGE_CLOCK = new Date('2027-06-01T00:00:00.000Z');

/**
 * F05 §5, Integration: the Wave 1 walking slice, end to end, and the two ways it is supposed to
 * break.
 *
 * **What runs here and what does not.** The slice traverses the real adapter code path in
 * `PROVIDER_MODE=fixture` — the committed ApeWisdom payload, the wrapper, the `ProviderResult`
 * contract — then the mapping, the builder, Postgres and replay. It does **not** traverse the
 * pinned scorer (F20) or the Reddit collector, because neither has a client in `src/` yet:
 * F04's persistence half and F20's queue half are Wave 2. `attention.mention_rate` is therefore
 * not computable today and is reported as deferred rather than stubbed — a stubbed provider is
 * a lie the tests would believe.
 *
 * The scorer-identity property §5 names *is* covered, on the input that exists: the board
 * identity is a hashed input that enters no arithmetic, and swapping it alone is a mismatch.
 */
describe.skipIf(url === undefined)('F05 — the calculation kernel end to end', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = makePool();
    await resetSchema(pool);
    getPool(url);
  }, 60_000);

  beforeEach(async () => {
    await truncateAll(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await closePool();
  });

  /** The committed ApeWisdom fixture, through the adapter's own code path. */
  async function boardEntries() {
    const result = await fetchApeWisdomRanking(
      { filter: 'all-stocks' },
      'fixture',
      harness().deps,
    );
    if (!result.ok) throw new Error(`fixture read failed: ${JSON.stringify(result.error)}`);
    return result.data;
  }

  it('runs the slice: fixture payload → adapter → artifact → Postgres → replay `match`', async () => {
    const entries = await boardEntries();
    const aapl = entries.find((entry) => entry.ticker === 'AAPL');
    expect(aapl).toBeDefined();

    const artifact = computeRankChange({
      entry: aapl as NonNullable<typeof aapl>,
      reading: READING,
      priorMethodologyVersion: READING.methodologyVersion,
      securityId: 'sec-aapl',
      asOf: AS_OF,
      configVersion: '1',
      calculationId: uuid(1),
      computedAt: COMPUTED_AT,
    });

    expect(artifact.result?.exact).toBe('1');
    expect(artifact.result?.display).toBe('1');

    await persistArtifact(artifact);

    const loaded = await loadArtifact(uuid(1));
    expect(loaded?.result?.exact).toBe('1');
    expect(loaded?.steps).toHaveLength(2);

    const replayed = await runReplay({ calculationId: uuid(1), requestedBy: 'test' });
    expect(replayed?.verdict.outcome).toBe('match');

    // §4.8 §7: the Inspector renders the *last recorded* outcome. It exists now because a
    // validation action was taken, not because a page was opened.
    const recorded = await findLatestValidationRun(uuid(1));
    expect(recorded?.status).toBe('pass');
    expect(recorded?.triggerType).toBe('user_replay');

    // lane-review finding 7: runReplay writes its own audit_event now, ahead of F02 — the
    // authorization check still needs F02's identity system, but there's no reason the audit
    // trail should wait for it too.
    const { rows: audit } = await pool.query<{ actor_id: string; result: string }>(
      `select actor_id, result from audit_event where action = 'replay' and object_id = $1`,
      [uuid(1)],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_id).toBe('test');
    expect(audit[0]?.result).toBe('success');
  });

  it('records an abstention as an artifact, not as a missing row', async () => {
    const entries = await boardEntries();
    const gme = entries.find((entry) => entry.ticker === 'GME');

    const artifact = computeRankChange({
      entry: { ...(gme as NonNullable<typeof gme>), mentions: '4' },
      reading: READING,
      priorMethodologyVersion: READING.methodologyVersion,
      securityId: 'sec-gme',
      asOf: AS_OF,
      configVersion: '1',
      calculationId: uuid(2),
      computedAt: COMPUTED_AT,
    });

    await persistArtifact(artifact);
    const loaded = await loadArtifact(uuid(2));

    expect(loaded?.result).toBeNull();
    expect(loaded?.eligibility).toBe('insufficient_data');
    expect(loaded?.abstention?.message).toContain('At least 25');

    const { rows } = await pool.query<{ status: string }>(
      'select status from calculation_snapshot where id = $1',
      [uuid(2)],
    );
    expect(rows[0]?.status).toBe('insufficient_data');
  });

  describe('§4.6 — a method edited without a version bump', () => {
    /** The shipped arithmetic, with one term changed and the version left alone. */
    const tampered = (ctx: ComputeContext) => ({
      value: ctx.step({
        key: 'rank_delta',
        label: 'Ranks gained since the previous observation',
        expression: '{rank_prior} - {rank_now}',
        operands: { rank_prior: ctx.input('rank_prior'), rank_now: ctx.input('rank_now') },
        unit: 'ranks',
        evaluate: (operand) => operand('rank_prior').minus(operand('rank_now')).plus('7'),
      }),
    });

    const tamperedRegistry = () =>
      new MethodRegistry([
        {
          ...METHOD_REGISTRY.latest('attention.rank_change'),
          compute: tampered,
        },
      ]);

    async function storeCleanArtifact(id: string) {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL');
      const artifact = computeRankChange({
        entry: aapl as NonNullable<typeof aapl>,
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: 'sec-aapl',
        asOf: AS_OF,
        configVersion: '1',
        calculationId: id,
        computedAt: COMPUTED_AT,
      });
      await persistArtifact(artifact);
      return artifact;
    }

    // CAN FAIL — the DoD item, and the whole point of the mechanism.
    it('produces `result_mismatch` and does not rewrite the stored artifact', async () => {
      await storeCleanArtifact(uuid(3));

      const before = await snapshotOf(pool, uuid(3));

      const replayed = await runReplay(
        { calculationId: uuid(3), requestedBy: 'test', registry: tamperedRegistry() },
        pool,
      );

      expect(replayed?.verdict.outcome).toBe('result_mismatch');
      expect(replayed?.verdict.differences.map((d) => d.field)).toContain('result.exact');

      const after = await snapshotOf(pool, uuid(3));
      expect(after).toEqual(before);

      // History is never repaired in place — and could not be, even by a caller that wanted to.
      await expect(
        pool.query(`update calculation_snapshot set result_hash = 'x' where id = $1`, [uuid(3)]),
      ).rejects.toThrow(/append-only/);
    });

    it('records the mismatch rather than only returning it', async () => {
      await storeCleanArtifact(uuid(4));
      await runReplay(
        { calculationId: uuid(4), requestedBy: 'admin', registry: tamperedRegistry() },
        pool,
      );

      const recorded = await findLatestValidationRun(uuid(4));
      expect(recorded?.status).toBe('mismatch');
      expect(JSON.stringify(recorded?.differences)).toContain('result.exact');
    });

    it('reports `method_missing` when the recorded version is gone, and stays readable', async () => {
      await storeCleanArtifact(uuid(5));

      const replayed = await runReplay(
        { calculationId: uuid(5), requestedBy: 'test', registry: new MethodRegistry([]) },
        pool,
      );

      expect(replayed?.verdict.outcome).toBe('method_missing');
      expect((await findLatestValidationRun(uuid(5)))?.status).toBe('method_unavailable');
      // The artifact is still there and still readable, which is the behaviour the table names.
      expect((await loadArtifact(uuid(5)))?.result?.exact).toBe('1');
    });
  });

  // CAN FAIL — lane-review finding 6: a stored input's provenance timestamp carrying real
  // sub-millisecond precision must canonicalize the same after a DB round trip as it did before
  // one, or a genuinely-unchanged input reports a permanent, false `result_mismatch` on replay.
  describe('§4.3 / §4.6 — a provenance timestamp survives the DB round trip at full precision', () => {
    const microStep = (ctx: ComputeContext) => ({
      value: ctx.step({
        key: 's',
        label: 'the one input, unchanged',
        expression: '{a}',
        operands: { a: ctx.input('a') },
        unit: 'ranks',
        evaluate: (operand) => operand('a'),
      }),
    });

    // A real, schema-valid descriptor (spread from the shipped one, same as `tamperedRegistry`
    // above) rather than a hand-built `MethodDescriptor` — the zod shape has more fields than
    // this test needs to know about. Only `compute` differs.
    const microRegistry = () =>
      new MethodRegistry([
        { ...METHOD_REGISTRY.latest('attention.rank_change'), compute: microStep },
      ]);

    async function storeWithMicrosecondObservedAt(id: string, observedAt: string) {
      const registry = microRegistry();
      const entry = registry.latest('attention.rank_change');
      const artifact = computeArtifact({
        methodId: entry.id,
        methodVersion: entry.version,
        subject: { kind: 'security', id: 'sec-1', label: 'EXMPL' },
        asOf: AS_OF,
        inputs: [
          {
            key: 'a',
            value: '10',
            unit: 'ranks',
            dataType: 'decimal',
            source: 'apewisdom',
            quality: 'ok',
            freshness: 'fresh',
            provenance: {
              provider: 'apewisdom',
              providerField: 'a',
              sourceUrl: 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1',
              // The precision this whole test is about — real microseconds, not `.000`.
              observedAt,
              availableAt: observedAt,
              ingestedAt: observedAt,
              rawPayloadId: null,
              licenseClass: 'attribution_required',
              redactionClass: 'public',
            },
          },
        ],
        assumptions: [],
        configVersion: '1',
        scenario: { kind: 'official' },
        calculationId: id,
        computedAt: COMPUTED_AT,
        registry,
      });
      await persistArtifact(artifact);
      return { artifact, registry };
    }

    it('replays as `match`, not `result_mismatch`, when the stored timestamp has real microseconds', async () => {
      const { registry } = await storeWithMicrosecondObservedAt(uuid(6), '2026-08-30T11:55:00.123456Z');

      const reloaded = await loadArtifact(uuid(6));
      // The whole point: what comes back out has to canonicalize identically to what went in,
      // or the input hash below would not match and replay would report `result_mismatch`.
      expect(reloaded?.inputs[0]?.provenance.observedAt).toBe('2026-08-30T11:55:00.123456Z');

      const replayed = await runReplay({ calculationId: uuid(6), requestedBy: 'test', registry });
      expect(replayed?.verdict.outcome).toBe('match');
    });

    it('still replays as `match` for the ordinary all-zeros case, unchanged by the fix', async () => {
      const { registry } = await storeWithMicrosecondObservedAt(uuid(7), '2026-08-30T11:55:00.000Z');
      const replayed = await runReplay({ calculationId: uuid(7), requestedBy: 'test', registry });
      expect(replayed?.verdict.outcome).toBe('match');
    });
  });

  describe('§5 — the instrument identity is inside the hashed inputs', () => {
    it('gives two different board identities two different artifacts, neither overwriting the other', async () => {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL') as NonNullable<
        Awaited<ReturnType<typeof boardEntries>>[number]
      >;

      const onAllStocks = computeRankChange({
        entry: aapl,
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: 'sec-aapl',
        asOf: AS_OF,
        configVersion: '1',
        calculationId: uuid(6),
        computedAt: COMPUTED_AT,
      });
      const onWsb = computeRankChange({
        entry: aapl,
        reading: { ...READING, filter: 'wallstreetbets' },
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: 'sec-aapl',
        asOf: AS_OF,
        configVersion: '1',
        calculationId: uuid(7),
        computedAt: COMPUTED_AT,
      });

      // Identical numbers, identical result — and a different identity, so a different artifact.
      expect(onWsb.result?.exact).toBe(onAllStocks.result?.exact);
      expect(onWsb.inputHash).not.toBe(onAllStocks.inputHash);

      await persistArtifact(onAllStocks);
      await persistArtifact(onWsb);

      const { rows } = await pool.query<{ count: string }>(
        'select count(*)::text as count from calculation_snapshot',
      );
      expect(rows[0]?.count).toBe('2');
    });

    // CAN FAIL — "swapping the pinned revision alone produces `result_mismatch`".
    it('mismatches when only the instrument identity is swapped under a stored record', async () => {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL') as NonNullable<
        Awaited<ReturnType<typeof boardEntries>>[number]
      >;

      const stored = computeRankChange({
        entry: aapl,
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: 'sec-aapl',
        asOf: AS_OF,
        configVersion: '1',
        calculationId: uuid(8),
        computedAt: COMPUTED_AT,
      });
      await persistArtifact(stored);

      const loaded = await loadArtifact(uuid(8));
      expect(loaded).not.toBeNull();

      // The corpus re-read under a different pinned instrument. Every number is identical; only
      // the identity moved. That is still a different calculation, and it says so.
      const reScored = {
        ...(loaded as NonNullable<typeof loaded>),
        inputs: (loaded as NonNullable<typeof loaded>).inputs.map((input) =>
          input.key === 'source_identity' ? { ...input, value: 'apewisdom:wallstreetbets' } : input,
        ),
      };

      const { replay } = await import('../../src/calc/replay');
      const verdict = replay(reScored, METHOD_REGISTRY);

      expect(verdict.outcome).toBe('result_mismatch');
      expect(verdict.differences.map((d) => d.field)).toContain('inputHash');
      // ...and the value is untouched, which is what makes the mismatch attributable to identity.
      expect(verdict.differences.map((d) => d.field)).not.toContain('result.exact');
    });
  });

  describe('§4.8 — the Inspector renders all seven sections, generically', () => {
    /**
     * A real `security` row, because the Inspector resolves the subject's symbol from it rather
     * than from a label frozen into the artifact — F03 §5: a symbol is reassignable, so the id is
     * the identity and the ticker is an attribute with history.
     */
    async function securityId(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `insert into security (symbol, name, exchange, asset_type, currency)
         values ('AAPL', 'Apple Inc.', 'NASDAQ', 'equity', 'USD')
         on conflict do nothing
         returning id`,
      );
      if (rows[0] !== undefined) return rows[0].id;
      const existing = await pool.query<{ id: string }>(
        `select id from security where symbol = 'AAPL'`,
      );
      return existing.rows[0]?.id as string;
    }

    async function view(id: string, entryOverrides: Record<string, string> = {}) {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL') as NonNullable<
        Awaited<ReturnType<typeof boardEntries>>[number]
      >;
      const artifact = computeRankChange({
        entry: { ...aapl, ...entryOverrides },
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: await securityId(),
        asOf: AS_OF,
        configVersion: '1',
        calculationId: id,
        computedAt: COMPUTED_AT,
      });
      await persistArtifact(artifact);
      return loadInspectorView(id);
    }

    it('supplies every section with data for a computed artifact', async () => {
      const inspector = await view(uuid(20));

      // 1 — Summary
      expect(inspector?.title).toBe('Attention rank change (24 h)');
      expect(inspector?.subjectLabel).toBe('AAPL');
      expect(inspector?.eligibility).toBe('ok');
      expect(inspector?.display).toBe('1');
      // 2 — Formula, from the registry rather than from the page
      expect(inspector?.symbolicFormula).toContain('rank_change =');
      // 3 — Inputs and provenance
      expect(inspector?.inputs.map((i) => i.key)).toEqual([
        'rank_now',
        'rank_prior',
        'mentions_now',
        'mentions_prior',
        'source_identity',
        // F06 §4.1's methodology-boundary amendment (v1.1.0, now `registry.latest(...)`).
        'methodology_version_now',
        'methodology_version_prior',
      ]);
      expect(inspector?.inputs[0]?.providerField).toBe('rank');
      // Six-digit microsecond text, not the three-digit millisecond form `READING` was written
      // with — the read path now formats to the same fixed precision `canonical.ts` hashes at
      // (lane-review finding 6), rather than truncating through a JS `Date` on the way out.
      expect(inspector?.inputs[0]?.observedAt).toBe('2026-08-30T11:55:00.000000Z');
      // 4 — Trace
      expect(inspector?.steps.map((s) => s.key)).toEqual(['rank_delta', 'bounded_rank_delta']);
      expect(inspector?.steps[0]?.substituted).toBe('3 - 2');
      // 5 — Precision
      expect(inspector?.exact).toBe('1');
      expect(inspector?.roundingRule).toBe('int_0dp_half_even');
      expect(inspector?.roundingRuleDescription).toContain('round half to even');
      expect(inspector?.inputHash).toMatch(/^[0-9a-f]{64}$/);
      // 6 — Assumptions, with the registry's limitations
      expect(inspector?.assumptions.map((a) => a.key)).toEqual(['board_size', 'min_mentions']);
      expect(inspector?.assumptions.find((a) => a.key === 'min_mentions')?.editable).toBe(true);
      expect(inspector?.assumptions.find((a) => a.key === 'board_size')?.editable).toBe(false);
      expect(inspector?.limitations.some((l) => /selection bias/i.test(l))).toBe(true);
      // 7 — Validation: nothing yet, because opening a page runs nothing.
      expect(inspector?.validation).toBeNull();
    });

    it('shows the last recorded validation outcome, and only after one was run', async () => {
      await view(uuid(21));
      expect((await loadInspectorView(uuid(21)))?.validation).toBeNull();

      await runReplay({ calculationId: uuid(21), requestedBy: 'operator' });

      const inspector = await loadInspectorView(uuid(21));
      expect(inspector?.validation?.outcome).toBe('match');
      expect(inspector?.validation?.requestedBy).toBe('operator');
      expect(inspector?.validation?.explanation).toContain('the same value');
    });

    // CAN FAIL — §5's E2E case and §7.5's review step: a `not_applicable` artifact renders its
    // reason rather than a blank.
    it('renders a reason rather than a blank for a not_applicable artifact', async () => {
      const inspector = await view(uuid(22), { rank24hAgo: '0' });

      expect(inspector?.eligibility).toBe('not_applicable');
      expect(inspector?.display).toBeNull();
      expect(inspector?.exact).toBeNull();
      expect(inspector?.abstentionReason).toContain('not on the attention board');
      // Every other section still renders — the formula, the inputs, the assumptions and the
      // limitations are exactly what a reader needs in order to understand why there is no value.
      expect(inspector?.symbolicFormula).toContain('rank_change =');
      expect(inspector?.inputs).toHaveLength(7);
      expect(inspector?.limitations.length).toBeGreaterThan(0);
      expect(inspector?.steps).toEqual([]);
    });

    it('stays readable when the method version is gone from the registry', async () => {
      await view(uuid(23));
      const inspector = await loadInspectorView(uuid(23), { registry: new MethodRegistry([]) });

      expect(inspector?.display).toBe('1');
      expect(inspector?.title).toBe('attention.rank_change');
      expect(inspector?.symbolicFormula).toContain('no longer carries this method version');
      // The limitations block never renders empty as though there were none.
      expect(inspector?.limitations).toHaveLength(1);
      expect(inspector?.limitations[0]).toContain('not available from the registry');
    });

    it('returns null for an unknown id, which is a different state from an abstention', async () => {
      await expect(loadInspectorView(uuid(24))).resolves.toBeNull();
    });

    it('says why a record is being kept permanently', async () => {
      await view(uuid(25));
      await pool.query(
        `insert into calculation_issue
           (calculation_id, reporter_user_id, issue_type, description, status)
         values ($1, 'u1', 'units', 'Ranks or places?', 'new')`,
        [uuid(25)],
      );

      const inspector = await loadInspectorView(uuid(25));
      expect(inspector?.retentionStored).toBe('standard');
      expect(inspector?.retentionEffective).toBe('permanent');
      expect(inspector?.retentionReasons[0]).toContain('Ranks or places?');
    });

    // CAN FAIL — lane-review finding 3: every prior "renders all seven sections" assertion
    // grepped the component's SOURCE TEXT and never actually rendered it. This one does — a
    // real view from a real artifact, through react-dom/server, against the rendered HTML.
    it('actually renders — not just names — all seven sections for a real artifact', async () => {
      const inspector = await view(uuid(26));
      if (inspector === null) throw new Error('expected an inspector view');

      const html = renderToStaticMarkup(createElement(CalculationInspector, { view: inspector }));

      for (const section of INSPECTOR_SECTIONS) {
        // `Section` renders `data-inspector-section`, not a literal `id` — deliberately, since
        // this component renders twice on one page (the full page and the intercepted drawer,
        // F05 §4.8), and HTML ids must be unique where a data attribute need not be.
        expect(html, `section '${section}' did not render`).toContain(
          `data-inspector-section="${section}"`,
        );
      }
    });

    // CAN FAIL — lane-review finding 7: the inert "Run a validation" button was wired to
    // `/api/calculations/{id}/export` over GET, an unrelated route. It must never point there,
    // whether or not F02 has landed yet to make the button reachable.
    it('wires the disabled validation button at its own route over POST, never at export/GET', async () => {
      const inspector = await view(uuid(31));
      if (inspector === null) throw new Error('expected an inspector view');
      const html = renderToStaticMarkup(createElement(CalculationInspector, { view: inspector }));

      expect(html).toContain(`action="/api/calculations/${uuid(31)}/validate"`);
      expect(html).toContain('method="post"');
      expect(html).not.toContain('/export');
      expect(html).toContain('data-action="run-validation"');
    });

    it('actually renders a not_applicable artifact, reason included, without throwing', async () => {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL') as NonNullable<
        Awaited<ReturnType<typeof boardEntries>>[number]
      >;
      const artifact = computeRankChange({
        entry: { ...aapl, rank24hAgo: '0' },
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: await securityId(),
        asOf: AS_OF,
        configVersion: '1',
        calculationId: uuid(27),
        computedAt: COMPUTED_AT,
      });
      await persistArtifact(artifact);
      const inspector = await loadInspectorView(uuid(27));
      if (inspector === null) throw new Error('expected an inspector view');
      expect(inspector.eligibility).toBe('not_applicable');

      const html = renderToStaticMarkup(createElement(CalculationInspector, { view: inspector }));
      expect(html).toContain(inspector.abstentionReason ?? '__missing__');
    });
  });

  describe('§4.8 — InspectorPage renders a real, distinct state for each failure (finding 4)', () => {
    const savedDatabaseUrl = process.env['DATABASE_URL'];

    afterEach(() => {
      if (savedDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = savedDatabaseUrl;
    });

    it('renders the "no database configured" notice only when DATABASE_URL is genuinely unset', async () => {
      delete process.env['DATABASE_URL'];
      const html = renderToStaticMarkup(
        await InspectorPage({ calculationId: uuid(28), pointIndex: null }),
      );
      expect(html).toContain('data-state="fixture"');
      expect(html).toContain('no database configured');
    });

    it('renders a distinct, honest failure state for a real fault, not the "no database" notice', async () => {
      // DATABASE_URL stays set (this describe's outer beforeAll already configured a real
      // connection) — this is a malformed identifier, which Postgres rejects as invalid input
      // for `uuid`, a genuine fault reached with a database that IS configured and responding.
      const html = renderToStaticMarkup(
        await InspectorPage({ calculationId: 'not-a-real-uuid', pointIndex: null }),
      );
      expect(html).toContain('data-state="error"');
      expect(html).not.toContain('no database configured');
      expect(html).not.toContain('Nothing is being hidden');
    });

    it('still renders the ordinary not-found notice for a real, well-formed, absent id', async () => {
      const html = renderToStaticMarkup(
        await InspectorPage({ calculationId: uuid(29), pointIndex: null }),
      );
      expect(html).toContain('data-state="not-found"');
    });
  });

  describe('§4.7 — retention classes and permanence', () => {
    async function storeArtifact(id: string, retentionClass: 'standard' | 'permanent' = 'standard') {
      const entries = await boardEntries();
      const aapl = entries.find((entry) => entry.ticker === 'AAPL') as NonNullable<
        Awaited<ReturnType<typeof boardEntries>>[number]
      >;
      const artifact = computeRankChange({
        entry: { ...aapl, mentions: String(500 + Number(id.slice(-2))) },
        reading: READING,
        priorMethodologyVersion: READING.methodologyVersion,
        securityId: `sec-${id.slice(-4)}`,
        asOf: AS_OF,
        configVersion: '1',
        calculationId: id,
        computedAt: COMPUTED_AT,
      });
      await persistArtifact({ ...artifact, retentionClass });
      return id;
    }

    it('sets a retention class on every artifact, defaulting to standard', async () => {
      await storeArtifact(uuid(10));
      const retention = await effectiveRetentionClass(uuid(10));
      expect(retention).toEqual({ stored: 'standard', effective: 'standard', references: [] });
    });

    it('purges an expired standard artifact, with an audit event', async () => {
      await storeArtifact(uuid(11));
      const { deleted } = await purgeExpired('calculation_snapshot', PURGE_CLOCK);

      expect(deleted).toBe(1);
      expect(await loadArtifact(uuid(11))).toBeNull();

      const { rows } = await pool.query<{ count: string }>(
        `select count(*)::text as count from audit_event
          where action = 'purge' and object_type = 'calculation_snapshot'`,
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('keeps an artifact whose retention_class was written as permanent', async () => {
      await storeArtifact(uuid(12), 'permanent');
      await purgeExpired('calculation_snapshot', PURGE_CLOCK);
      expect(await loadArtifact(uuid(12))).not.toBeNull();
    });

    // CAN FAIL — the DoD item: "a claim/share/issue reference promotes an artifact to permanent".
    it('a claim reference makes an expired artifact permanent', async () => {
      await storeArtifact(uuid(13));

      const { rows: run } = await pool.query<{ id: string }>(
        `insert into research_run
           (user_id, question, status, coverage_status, input_cutoff, prompt_version)
         values ('u1', 'why', 'complete', 'ok', now(), 'v1') returning id`,
      );
      await pool.query(
        `insert into claim_ledger
           (run_id, claim_text, claim_type, materiality, metric_ids, verification_status)
         values ($1, 'It moved one rank.', 'calculation', 'material', array[$2], 'verified')`,
        [run[0]?.id, uuid(13)],
      );

      const retention = await effectiveRetentionClass(uuid(13));
      expect(retention?.stored).toBe('standard');
      expect(retention?.effective).toBe('permanent');
      expect(retention?.references.map((r) => r.kind)).toEqual(['claim']);

      const { deleted } = await purgeExpired('calculation_snapshot', PURGE_CLOCK);
      expect(deleted).toBe(0);
      expect(await loadArtifact(uuid(13))).not.toBeNull();
    });

    it('a share grant makes an expired artifact permanent, revoked or not', async () => {
      // §4.7 says "share grant"; this asserts that a REVOKED one protects too, which is the
      // deviation `repositories/artifacts.ts` documents. Two reasons, and the second is decisive:
      // revocation removes visibility rather than the record (§4.5's rule for a retracted run),
      // and the revoked row still holds a foreign key — so the narrow reading does not delete the
      // artifact, it fails on the constraint.
      await storeArtifact(uuid(14));
      await storeArtifact(uuid(15));

      await pool.query(
        `insert into calculation_share (source_calculation_id, shared_snapshot_id, created_by)
         values ($1, $1, 'u1')`,
        [uuid(14)],
      );
      await pool.query(
        `insert into calculation_share
           (source_calculation_id, shared_snapshot_id, created_by, revoked_at, revoked_by)
         values ($1, $1, 'u1', now(), 'u1')`,
        [uuid(15)],
      );

      expect((await effectiveRetentionClass(uuid(14)))?.effective).toBe('permanent');
      expect((await effectiveRetentionClass(uuid(15)))?.effective).toBe('permanent');
      // The kinds differ, so the Inspector can still say which it is.
      expect((await effectiveRetentionClass(uuid(14)))?.references[0]?.kind).toBe('share');
      expect((await effectiveRetentionClass(uuid(15)))?.references[0]?.kind).toBe('revoked_share');

      const { deleted } = await purgeExpired('calculation_snapshot', PURGE_CLOCK);
      expect(deleted).toBe(0);
      expect(await loadArtifact(uuid(14))).not.toBeNull();
      expect(await loadArtifact(uuid(15))).not.toBeNull();
    });

    it('an issue makes an artifact permanent, and says whether it is still open', async () => {
      await storeArtifact(uuid(16));

      const { rows: issue } = await pool.query<{ id: string }>(
        `insert into calculation_issue
           (calculation_id, reporter_user_id, issue_type, description, status)
         values ($1, 'u1', 'formula', 'This looks wrong.', 'investigating') returning id`,
        [uuid(16)],
      );
      expect((await effectiveRetentionClass(uuid(16)))?.references[0]?.kind).toBe('open_issue');

      await pool.query(`update calculation_issue set status = 'resolved' where id = $1`, [
        issue[0]?.id,
      ]);
      // Still permanent. A resolved issue is the record of a dispute about a specific number, and
      // keeping "this was wrong, and here is why" pointing at nothing is worse than keeping it.
      const after = await effectiveRetentionClass(uuid(16));
      expect(after?.effective).toBe('permanent');
      expect(after?.references[0]?.kind).toBe('resolved_issue');

      expect((await purgeExpired('calculation_snapshot', PURGE_CLOCK)).deleted).toBe(0);
    });

    // CAN FAIL — lane-review finding 2: a validation run's FK to the snapshot was not excluded
    // from the purge's doomed-candidate set, so a replayed artifact past its retention window
    // aborted the ENTIRE purge batch on the foreign-key constraint, not just that one row.
    it('a validation run makes an expired artifact permanent, and does not break the batch', async () => {
      await storeArtifact(uuid(30));
      // A second, unrelated expired artifact in the same batch — this is what "aborts the whole
      // batch" actually costs: without the fix, this row would also survive the purge attempt.
      await storeArtifact(uuid(31));

      await runReplay({ calculationId: uuid(30), requestedBy: 'test' });
      expect(await findLatestValidationRun(uuid(30))).not.toBeNull();

      const retention = await effectiveRetentionClass(uuid(30));
      expect(retention?.effective).toBe('permanent');
      expect(retention?.references.map((r) => r.kind)).toEqual(['validation_run']);

      const { deleted } = await purgeExpired('calculation_snapshot', PURGE_CLOCK);

      expect(deleted).toBe(1); // only uuid(31) — the never-replayed one
      expect(await loadArtifact(uuid(30))).not.toBeNull();
      expect(await loadArtifact(uuid(31))).toBeNull();
    });

    it('an official/predecessor pointer from another snapshot makes this one permanent', async () => {
      await storeArtifact(uuid(32));
      // `calculation_snapshot` is append-only (migration 0012) — the only way to get a second
      // row pointing at the first via `predecessor_calculation_id` is to INSERT it that way,
      // never to UPDATE the pointer in afterward. Cloned via a column-named insert-select
      // rather than `persistArtifact`, which does not yet expose a way to set this column.
      // `input_hash` is perturbed because `calculation_snapshot_identity_unique` covers it —
      // correctly so, since a real successor is a recomputation with different inputs, never a
      // byte-identical duplicate of the row it supersedes.
      await pool.query(
        `insert into calculation_snapshot
           (id, metric_key, subject_type, subject_id, observation_key, scenario_type,
            official_calculation_id, owner_user_id, method_key, method_version, config_version,
            universe_version, assumption_profile_version, input_cutoff, status, exact_result,
            display_result, points, assumptions, warnings, input_hash, result_hash,
            predecessor_calculation_id, retention_class, computed_at, expires_at)
         select $1, metric_key, subject_type, subject_id, observation_key, scenario_type,
                official_calculation_id, owner_user_id, method_key, method_version, config_version,
                universe_version, assumption_profile_version, input_cutoff, status, exact_result,
                display_result, points, assumptions, warnings, input_hash || '-successor', result_hash,
                $2, retention_class, computed_at, expires_at
           from calculation_snapshot where id = $3`,
        [uuid(33), uuid(32), uuid(32)],
      );

      const retention = await effectiveRetentionClass(uuid(32));
      expect(retention?.effective).toBe('permanent');
      expect(retention?.references.map((r) => r.kind)).toEqual(['successor_reference']);

      const { deleted } = await purgeExpired('calculation_snapshot', PURGE_CLOCK);
      // uuid(33) has nothing pointing at IT, so it purges; uuid(32) is protected.
      expect(deleted).toBe(1);
      expect(await loadArtifact(uuid(32))).not.toBeNull();
      expect(await loadArtifact(uuid(33))).toBeNull();
    });

    it('says WHY an artifact is being kept, not merely that it is', async () => {
      await storeArtifact(uuid(17));
      await pool.query(
        `insert into calculation_issue
           (calculation_id, reporter_user_id, issue_type, description, status)
         values ($1, 'u1', 'units', 'Ranks or places?', 'new')`,
        [uuid(17)],
      );

      const references = await referencesRequiringPermanence(uuid(17));
      expect(references).toHaveLength(1);
      expect(references[0]?.detail).toContain('Ranks or places?');
    });
  });
});

/** Every stored column of an artifact and its children, as one comparable value. */
async function snapshotOf(pool: pg.Pool, id: string): Promise<unknown> {
  const [snapshot, inputs, steps] = await Promise.all([
    pool.query('select * from calculation_snapshot where id = $1', [id]),
    pool.query('select * from calculation_input where calculation_id = $1 order by sequence', [id]),
    pool.query('select * from calculation_step where calculation_id = $1 order by sequence', [id]),
  ]);
  return {
    snapshot: snapshot.rows,
    inputs: inputs.rows,
    steps: steps.rows,
  };
}
