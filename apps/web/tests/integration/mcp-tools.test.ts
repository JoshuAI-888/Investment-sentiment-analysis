import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { insertMarketSnapshot } from '../../src/repositories/market';
import { insertEvidenceItem, type NewEvidenceItem } from '../../src/repositories/evidence';
import { loadArtifact } from '../../src/services/calculations';
import { evaluateMarketSpike } from '../../src/services/jobs/trigger';
import { getTickerSentiment } from '../../src/services/mcp/tools/get-ticker-sentiment';
import { comparePlatforms } from '../../src/services/mcp/tools/compare-platforms';
import { openCalculation } from '../../src/services/mcp/tools/open-calculation';
import { getCoverage } from '../../src/services/mcp/tools/get-coverage';
import { listSupportingEvidence, listContradictingEvidence } from '../../src/services/mcp/tools/list-evidence';
import { explainSpike } from '../../src/services/mcp/tools/explain-spike';
import { getHistoricalWindow } from '../../src/services/mcp/tools/get-historical-window';
import { MAX_EVIDENCE_ITEMS } from '../../src/services/mcp/evidence-view';
import { mcpToolResultEnvelope } from '../../src/services/mcp/contract';
import { McpToolError } from '../../src/services/mcp/tools/errors';

const url = databaseUrl();
const AUDIT = { actorId: 'owner', actorRole: 'admin', reason: 'test', requestId: 'req-1', correlationId: 'corr-1' };

const INGESTED_AT = new Date('2026-09-02T12:00:00.000Z');

/**
 * F21's own §5/§7 priorities, executed against a real Postgres — not merely asserted from
 * reading the source in order:
 *
 * 1. **The corpus-leak test (§5, §7 step 1) — written first, per the spec's own instruction.**
 * 2. Every numeric carries a `calculationId` that resolves (`open_calculation`).
 * 3. `get_historical_window` returns a coverage floor; `get_coverage` reports real gaps.
 * 4. `explain_spike` composes a real trigger verdict + bounded evidence + price context, with no
 *    prose anywhere in its output.
 */
describe.skipIf(url === undefined)('F21 — MCP tool surface (integration)', () => {
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
    await closePool();
    await pool?.end();
  });

  async function insertSecurity(overrides: { symbol?: string; exchange?: string } = {}): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, sector, active)
       values ($1, $2, $3, 'equity', 'USD', 'Consumer', true) returning id`,
      [overrides.symbol ?? 'GME', 'GameStop', overrides.exchange ?? 'NYSE'],
    );
    return rows[0]?.id as string;
  }

  async function activeConfigVersion(): Promise<void> {
    const draft = await insertConfigVersion({ environment: 'production', createdBy: 'owner', changeReason: 'test', checksum: `sum-${String(Math.random())}` });
    await activateConfigVersion('production', draft.id, AUDIT);
  }

  function evidenceRow(securityId: string, index: number, overrides: Partial<NewEvidenceItem> = {}): NewEvidenceItem {
    return {
      securityId,
      evidenceType: 'social_result',
      provider: 'reddit',
      title: `post ${String(index)} about the security`,
      snippet: `the stored snippet as retrieved, item ${String(index)}`,
      sourceUrl: `https://reddit.example/${String(index)}`,
      publisher: null,
      authorRef: null,
      stanceLabel: index % 3 === 0 ? 'bearish' : 'bullish',
      stanceScore: index % 3 === 0 ? '-0.60' : '0.60',
      relevanceScore: '0.90',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      availableAt: new Date('2026-09-01T00:00:00.000Z'),
      ingestedAt: INGESTED_AT,
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'own_collected',
      coverageClass: 'licensed_sample',
      rawHash: `h-${String(index)}-${Math.random().toString(36).slice(2)}`,
      metadata: {},
      ...overrides,
    };
  }

  async function insertCollectorStart(axis: 'reddit' | 'x' | 'substack' | 'market', startedAt: Date): Promise<void> {
    await pool.query(
      `insert into collector_start (axis, started_at, note) values ($1, $2, 'test seed')`,
      [axis, startedAt],
    );
  }

  /** Every read-only MCP tool refuses by *throwing* `McpToolError` — `services/mcp/server.ts#callTool` is what converts that into `{ ok: false }` for a JSON-RPC caller. This test suite calls the tool functions directly (finer-grained failure messages on assertion), so it asserts the throw itself. */
  async function expectRefusal(call: () => Promise<unknown>): Promise<McpToolError> {
    try {
      await call();
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      return error as McpToolError;
    }
    throw new Error('expected the call to throw McpToolError, but it resolved');
  }

  // ── §5/§7 step 1 — the corpus-leak test ─────────────────────────────────────────────────────

  describe('corpus-leak discipline', () => {
    it('list_supporting_evidence never returns more than MAX_EVIDENCE_ITEMS, however many classified rows exist', async () => {
      const securityId = await insertSecurity({ symbol: 'LEAK' });
      const overCount = MAX_EVIDENCE_ITEMS + 15;
      for (let i = 0; i < overCount; i += 1) {
        await insertEvidenceItem(evidenceRow(securityId, i, { stanceLabel: 'bullish', stanceScore: '0.60' }));
      }

      const envelope = await listSupportingEvidence({ symbol: 'LEAK' });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { items: unknown[]; truncated: boolean; retrievedCount: number };
      expect(data.items.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
      expect(data.truncated).toBe(true);
      expect(data.retrievedCount).toBeGreaterThan(MAX_EVIDENCE_ITEMS);
      // The envelope's own `n` must match what was actually returned, not what exists on record —
      // a caller reading `n` alone must never be able to infer a bigger number is hiding.
      expect(envelope.n).toBe(data.items.length);
    });

    it('list_contradicting_evidence is bounded the same way, and never includes an unclassified (raw, un-triaged) item', async () => {
      const securityId = await insertSecurity({ symbol: 'LEAK2' });
      for (let i = 0; i < MAX_EVIDENCE_ITEMS + 5; i += 1) {
        await insertEvidenceItem(evidenceRow(securityId, i, { stanceLabel: 'bullish', stanceScore: '0.60' }));
      }
      // Unclassified rows (no stance/relevance yet) must never leak into a "classified items" tool.
      await insertEvidenceItem(
        evidenceRow(securityId, 9999, { stanceLabel: null, stanceScore: null, relevanceScore: null, title: 'RAW UNCLASSIFIED ITEM' }),
      );
      for (let i = 0; i < 4; i += 1) {
        await insertEvidenceItem(evidenceRow(securityId, 1000 + i, { stanceLabel: 'bearish', stanceScore: '-0.60' }));
      }

      const envelope = await listContradictingEvidence({ symbol: 'LEAK2' });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { items: { title: string }[] };
      expect(data.items.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
      expect(data.items.some((item) => item.title === 'RAW UNCLASSIFIED ITEM')).toBe(false);
    });

    it('explain_spike bounds its evidence list the same way, never a raw dump around the trigger', async () => {
      const securityId = await insertSecurity({ symbol: 'SPIKE' });
      await activeConfigVersion();
      const config = await pool.query<{ id: string }>("select id from config_version where environment = 'production' and status = 'active'");
      const configVersion = config.rows[0]?.id as string;

      // `marketSnapshotHistory` is PIT-bound by `ingestedAt` (the only "when we learned it"
      // column `market_snapshot` carries) — `asOfInstant` below must be after both rows'
      // `ingestedAt`, not just after their `observedAt`, or the trigger sees no history at all.
      const priorIngestedAt = new Date('2026-09-01T00:30:00Z');
      const currentIngestedAt = new Date('2026-09-02T00:30:00Z');
      const triggerAsOfInstant = new Date('2026-09-02T01:00:00Z');
      await insertMarketSnapshot({ securityId, price: '10.00', changePercent: '0', session: 'eod', provider: 'fmp', observedAt: new Date('2026-09-01T00:00:00Z'), ingestedAt: priorIngestedAt, rawHash: 'prior' });
      await insertMarketSnapshot({ securityId, price: '20.00', changePercent: '100', session: 'eod', provider: 'fmp', observedAt: new Date('2026-09-02T00:00:00Z'), ingestedAt: currentIngestedAt, rawHash: 'spike' });
      const verdict = await evaluateMarketSpike({ id: securityId, symbol: 'SPIKE' }, configVersion, triggerAsOfInstant, getPool());
      expect(verdict.fired).toBe(true);

      for (let i = 0; i < MAX_EVIDENCE_ITEMS + 10; i += 1) {
        await insertEvidenceItem(evidenceRow(securityId, i));
      }

      const envelope = await explainSpike({ symbol: 'SPIKE' });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { items: unknown[]; trigger: { fired: boolean; calculationId: string } | null };
      expect(data.items.length).toBeLessThanOrEqual(MAX_EVIDENCE_ITEMS);
      expect(data.trigger?.fired).toBe(true);
      expect(data.trigger?.calculationId).toBe(verdict.calculationId);
    });
  });

  // ── §6 DoD item 3 — every numeric carries a resolvable calculationId ────────────────────────

  describe('calculationId resolution', () => {
    it('get_ticker_sentiment: every calculationId in the envelope resolves via loadArtifact', async () => {
      await insertSecurity({ symbol: 'RES' });
      await activeConfigVersion();
      const envelope = await getTickerSentiment({ symbol: 'RES' });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      expect(envelope.calculationIds.length).toBeGreaterThan(0);
      for (const id of envelope.calculationIds) {
        const artifact = await loadArtifact(id);
        expect(artifact).not.toBeNull();
      }
      expect(() => mcpToolResultEnvelope.parse(envelope)).not.toThrow();
    });

    it('compare_platforms: every stance calculationId resolves, and the three axes are never blended into one field', async () => {
      const securityId = await insertSecurity({ symbol: 'CMP' });
      await activeConfigVersion();
      for (let i = 0; i < 6; i += 1) {
        await insertEvidenceItem(evidenceRow(securityId, i, { provider: 'reddit' }));
      }
      const envelope = await comparePlatforms({ symbol: 'CMP' });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { platforms: { axis: string }[]; neverBlended: boolean };
      expect(data.platforms.map((p) => p.axis).sort()).toEqual(['reddit', 'substack', 'x']);
      expect(data.neverBlended).toBe(true);
      for (const id of envelope.calculationIds) {
        expect(await loadArtifact(id)).not.toBeNull();
      }
    });

    it('open_calculation resolves a real artifact and its inputHash/resultHash come straight from the persisted row', async () => {
      await insertSecurity({ symbol: 'OPEN' });
      await activeConfigVersion();
      const sentiment = await getTickerSentiment({ symbol: 'OPEN' });
      expect(sentiment.ok).toBe(true);
      if (!sentiment.ok) return;
      const someId = sentiment.calculationIds[0];
      expect(someId).toBeDefined();
      if (someId === undefined) return;

      const envelope = await openCalculation({ calculationId: someId });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      const data = envelope.data as { calculationId: string; inputHash: string; resultHash: string };
      expect(data.calculationId).toBe(someId);
      expect(data.inputHash.length).toBeGreaterThan(0);
      expect(data.resultHash.length).toBeGreaterThan(0);
    });

    it('open_calculation refuses an unresolvable id rather than fabricating a result', async () => {
      const error = await expectRefusal(() => openCalculation({ calculationId: '00000000-0000-4000-8000-000000000099' }));
      expect(error.code).toBe('unresolvable_calculation');
    });
  });

  // ── Coverage floor / real gaps ───────────────────────────────────────────────────────────────

  describe('coverage', () => {
    it('get_coverage reports the real collector start date, not a fabricated one, and no coverage before a start is recorded', async () => {
      const before = await getCoverage({ axis: 'reddit' });
      expect(before.ok).toBe(true);
      if (before.ok) {
        const data = before.data as { axes: { startedAt: string | null }[] };
        expect(data.axes[0]?.startedAt).toBeNull();
      }

      await insertCollectorStart('reddit', new Date('2026-08-01T00:00:00Z'));
      const after = await getCoverage({ axis: 'reddit' });
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      const data = after.data as { axes: { startedAt: string | null }[] };
      expect(data.axes[0]?.startedAt).toBe('2026-08-01T00:00:00.000Z');
      expect(after.coverage[0]?.disclosure).toContain('2026-08-01');
    });

    it('get_historical_window carries the coverage floor for the axis its methodId belongs to', async () => {
      await insertSecurity({ symbol: 'HIST' });
      await insertCollectorStart('reddit', new Date('2026-08-01T00:00:00Z'));

      const envelope = await getHistoricalWindow({
        symbol: 'HIST',
        methodId: 'social.stance_reddit',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
      });
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) return;
      expect(envelope.coverage[0]?.axis).toBe('reddit');
      expect(envelope.coverage[0]?.startedAt).toBe('2026-08-01T00:00:00.000Z');
    });
  });

  // ── Refusals ─────────────────────────────────────────────────────────────────────────────────

  describe('refusals', () => {
    it('get_ticker_sentiment refuses not_found rather than fabricating an empty-but-ok result', async () => {
      const error = await expectRefusal(() => getTickerSentiment({ symbol: 'NOPE' }));
      expect(error.code).toBe('not_found');
    });
  });
});
