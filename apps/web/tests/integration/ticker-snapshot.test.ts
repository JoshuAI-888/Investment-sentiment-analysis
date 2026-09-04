import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { insertMarketSnapshot, insertPriceReturnSnapshot } from '../../src/repositories/market';
import { insertAttentionSnapshot } from '../../src/repositories/attention';
import { insertEvidenceItem, type NewEvidenceItem } from '../../src/repositories/evidence';
import { assembleTickerSnapshot } from '../../src/services/ticker/snapshot';

const url = databaseUrl();
const AUDIT = { actorId: 'owner', actorRole: 'admin', reason: 'test', requestId: 'req-1', correlationId: 'corr-1' };

/**
 * Every fixture row below pins its own `observedAt`/`ingestedAt`/`availableAt` explicitly rather
 * than leaving any of them to default to the real wall clock, and `ASOF` is chosen comfortably
 * after all of them — the specific, repeatedly-found defect class this codebase's own history
 * names (`docs/MEMORY.md` B-08/B-11: "the wall-clock-vs-hardcoded-asOf test defect", seen at
 * least 5 times). A test whose `asOf` is a fixed past instant while an insert's `ingestedAt`
 * defaults to real "now" passes only until the real clock catches up to that fixed instant.
 */
const ASOF = new Date('2026-09-06T00:00:00.000Z');
const INGESTED_AT = new Date('2026-09-02T12:00:00.000Z');

/**
 * `attention.mention_delta`/`social.stance_*`/`news.sentiment` all carry a 6-hour
 * `stalenessMinutes` (`analytics/registry.ts`) — `computeArtifact` marks an artifact `stale`
 * once its freshest input's `observedAt` is further from `asOf` than that. Tests that want an
 * `ok` (not `stale`) reading on those methods use this closer pairing instead of the
 * far-future `ASOF`/`INGESTED_AT` pair above, which exists to avoid the wall-clock-vs-fixed-asOf
 * defect class, not to prove freshness.
 */
const FRESH_OBSERVED_AT = new Date('2026-09-02T00:00:00.000Z');
const FRESH_INGESTED_AT = new Date('2026-09-02T01:00:00.000Z');
const FRESH_ASOF = new Date('2026-09-02T04:00:00.000Z');

/**
 * F09's full read path, end to end: resolution, the four axes, divergence, the evidence drawer
 * and coverage-gap rendering, assembled entirely from stored rows — no adapter import anywhere
 * in this module's graph (F09 DoD item 1).
 */
describe.skipIf(url === undefined)('F09 — assembleTickerSnapshot', () => {
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

  async function insertSecurity(
    overrides: { symbol?: string; exchange?: string; assetType?: 'equity' | 'etf'; active?: boolean; cik?: string } = {},
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, sector, active, cik)
       values ($1, $2, $3, $4, 'USD', 'Consumer', $5, $6) returning id`,
      [
        overrides.symbol ?? 'GME',
        'GameStop',
        overrides.exchange ?? 'NYSE',
        overrides.assetType ?? 'equity',
        overrides.active ?? true,
        overrides.cik ?? null,
      ],
    );
    return rows[0]?.id as string;
  }

  async function activeConfigVersion(): Promise<void> {
    const draft = await insertConfigVersion({
      environment: 'production',
      createdBy: 'owner',
      changeReason: 'test',
      checksum: 'sum-1',
    });
    await activateConfigVersion('production', draft.id, AUDIT);
  }

  function evidenceRow(securityId: string, overrides: Partial<NewEvidenceItem> = {}): NewEvidenceItem {
    return {
      securityId,
      evidenceType: 'social_result',
      provider: 'reddit',
      title: 'a post about the security',
      snippet: 'the stored snippet as retrieved',
      sourceUrl: 'https://reddit.example/x',
      publisher: null,
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.80',
      relevanceScore: '0.90',
      publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      availableAt: new Date('2026-09-01T00:00:00.000Z'),
      ingestedAt: INGESTED_AT,
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'own_collected',
      coverageClass: 'licensed_sample',
      rawHash: `h-${Math.random().toString(36).slice(2)}`,
      metadata: {},
      ...overrides,
    };
  }

  // ── Resolution (§4.1) ─────────────────────────────────────────────────────────────────────────

  describe('resolution', () => {
    it('refuses not_found for a symbol with no active security on record', async () => {
      const snapshot = await assembleTickerSnapshot('ZZZZ', { asOf: ASOF });
      expect(snapshot.resolved).toBe(false);
      if (!snapshot.resolved) expect(snapshot.refusal.reason).toBe('not_found');
    });

    it('refuses ambiguous when the same symbol is active on two exchanges — never guesses which one', async () => {
      await insertSecurity({ symbol: 'DUP', exchange: 'NYSE' });
      await insertSecurity({ symbol: 'DUP', exchange: 'NASDAQ' });
      const snapshot = await assembleTickerSnapshot('DUP', { asOf: ASOF });
      expect(snapshot.resolved).toBe(false);
      if (!snapshot.resolved) {
        expect(snapshot.refusal.reason).toBe('ambiguous');
        expect(snapshot.refusal.message).toContain('NYSE');
        expect(snapshot.refusal.message).toContain('NASDAQ');
      }
    });

    it('refuses ineligible for a security marked unsupported in security_profile_snapshot, without silently resolving it', async () => {
      const securityId = await insertSecurity({ symbol: 'BLOCKED' });
      await pool.query(
        `insert into security_profile_snapshot
           (security_id, provider, eligibility_state, observed_at, ingested_at, raw_hash)
         values ($1, 'fmp', 'unsupported', $2, $2, 'h')`,
        [securityId, INGESTED_AT],
      );
      const snapshot = await assembleTickerSnapshot('BLOCKED', { asOf: ASOF });
      expect(snapshot.resolved).toBe(false);
      if (!snapshot.resolved) expect(snapshot.refusal.reason).toBe('ineligible');
    });

    it('resolves an ETF the same as an equity — asset type does not change eligibility', async () => {
      await insertSecurity({ symbol: 'SPY', assetType: 'etf' });
      const snapshot = await assembleTickerSnapshot('SPY', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (snapshot.resolved) expect(snapshot.header.assetType).toBe('etf');
    });
  });

  // ── No data at all (the ugliest input) ───────────────────────────────────────────────────────

  describe('no data at all', () => {
    it('renders every axis as an honest empty/abstained state — never a fabricated number', async () => {
      await insertSecurity({ symbol: 'EMPTY' });
      const snapshot = await assembleTickerSnapshot('EMPTY', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;

      expect(snapshot.header.price).toBeNull();
      expect(snapshot.attention.mentions).toBeNull();
      expect(snapshot.attention.chartSegments).toEqual([]);
      expect(snapshot.stance.map((frame) => frame.axis).sort()).toEqual(['reddit', 'substack', 'x']);
      for (const frame of snapshot.stance) {
        expect(frame.metric).toBeNull();
        expect(frame.disclosure.length).toBeGreaterThan(0);
      }
      expect(snapshot.news.metric).toBeNull();
      expect(snapshot.price.returns).toEqual([]);
      expect(snapshot.price.regime).toBeNull();
      expect(snapshot.divergence.available).toBe(false);
      expect(snapshot.evidence.items).toEqual([]);
      expect(snapshot.evidence.retrievedCount).toBe(0);
    });

    it('with no active config_version, still resolves and states why nothing computed', async () => {
      await insertSecurity({ symbol: 'NOCONFIG' });
      const snapshot = await assembleTickerSnapshot('NOCONFIG', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      expect(snapshot.divergence.available).toBe(false);
      if (!snapshot.divergence.available) {
        expect(snapshot.divergence.reason).toContain('config_version');
      }
      expect(snapshot.methodology).toEqual([]);
    });

    /**
     * Round-4 lane-review finding 4: F09 §2 lists "insider and filings links (cut-line items 3
     * and 2)" as In scope; nothing derived or disclosed them until now. `security.cik` needs no
     * provider call — a real CIK on record must produce real, correctly zero-padded SEC EDGAR
     * URLs, and no CIK must produce an honest `null` rather than a broken link.
     */
    it('derives SEC filings and insider-transaction links from security.cik, zero-padded to 10 digits', async () => {
      await insertSecurity({ symbol: 'CIKED', cik: '320193' });
      const withCik = await assembleTickerSnapshot('CIKED', { asOf: ASOF });
      expect(withCik.resolved).toBe(true);
      if (withCik.resolved) {
        expect(withCik.header.filingsHref).toBe(
          'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=&dateb=&owner=include&count=40',
        );
        expect(withCik.header.insiderTransactionsHref).toBe(
          'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=4&dateb=&owner=include&count=40',
        );
      }

      await insertSecurity({ symbol: 'NOCIK' });
      const withoutCik = await assembleTickerSnapshot('NOCIK', { asOf: ASOF });
      expect(withoutCik.resolved).toBe(true);
      if (withoutCik.resolved) {
        expect(withoutCik.header.filingsHref).toBeNull();
        expect(withoutCik.header.insiderTransactionsHref).toBeNull();
      }
    });
  });

  // ── Full data ────────────────────────────────────────────────────────────────────────────────

  describe('a fully-populated security', () => {
    it('computes every axis, and the divergence state, from stored data with no provider call in the read path', async () => {
      const securityId = await insertSecurity({ symbol: 'FULL' });
      await activeConfigVersion();
      // Close to the data's own observedAt — attention.mention_delta/social.stance_reddit/
      // news.sentiment all carry a 6-hour `stalenessMinutes` (see `FRESH_ASOF`'s own doc note).
      const asOf = FRESH_ASOF;

      await insertMarketSnapshot({
        securityId,
        price: '25.00',
        changePercent: '2.00',
        session: 'eod',
        provider: 'fmp',
        observedAt: FRESH_OBSERVED_AT,
        ingestedAt: FRESH_INGESTED_AT,
        rawHash: 'm1',
      });

      // 50 EOD closes, all positive and increasing — enough for every technical method's exact
      // window (21/21/15/20/50), regardless of which slice each one reads. These abstain
      // `not_applicable` on the quote_kind gate before staleness is ever considered (see the
      // assertions below), so their own age relative to `asOf` does not matter here.
      for (let i = 0; i < 50; i += 1) {
        const day = new Date('2026-07-01T00:00:00.000Z');
        day.setUTCDate(day.getUTCDate() + i);
        await insertMarketSnapshot({
          securityId,
          price: String(10 + i * 0.1),
          changePercent: '0.1',
          session: 'eod',
          provider: 'fmp',
          observedAt: day,
          ingestedAt: FRESH_INGESTED_AT,
          rawHash: `bar-${String(i)}`,
        });
      }

      await insertPriceReturnSnapshot({
        securityId,
        asOfDate: '2026-09-02',
        horizonCalendarDays: 7,
        asOfPrice: '25.00',
        asOfPriceDate: '2026-09-02',
        baselinePrice: '20.00',
        baselinePriceDate: '2026-08-26',
        totalReturn: '0.25',
        adjustmentStatus: 'adjusted',
        qualityStatus: 'ok',
        provider: 'fmp',
        methodVersion: 'price-return-v1',
        computedAt: FRESH_INGESTED_AT,
      });

      await insertAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        rank: 5,
        rankPrior: 20,
        mentions: 100,
        mentionsPrior: 50,
        engagement: 500,
        windowHours: 24,
        coverageClass: 'pov_index',
        providerMethodologyVersion: 'v1',
        observedAt: FRESH_OBSERVED_AT,
        ingestedAt: FRESH_INGESTED_AT,
        rawHash: 'a1',
      });

      // 5 classified Reddit items — exactly `min_items`, enough for a real (not abstained) stance.
      // Each needs a distinct `sourceUrl`/`title` — `evidenceForSecurity` dedupes by normalized
      // url+title (`02-ARCHITECTURE-CONTRACTS.md` §4.4), and five identical URLs would collapse
      // to one item, silently starving the sample below `min_items`.
      for (let i = 0; i < 5; i += 1) {
        await insertEvidenceItem(
          evidenceRow(securityId, {
            rawHash: `reddit-${String(i)}`,
            title: `a post about the security, #${String(i)}`,
            sourceUrl: `https://reddit.example/x/${String(i)}`,
            publishedAt: FRESH_OBSERVED_AT,
            availableAt: FRESH_OBSERVED_AT,
            ingestedAt: FRESH_INGESTED_AT,
          }),
        );
      }
      // 3 classified news items — exactly `min_articles`.
      for (let i = 0; i < 3; i += 1) {
        await insertEvidenceItem(
          evidenceRow(securityId, {
            evidenceType: 'news',
            provider: 'marketaux',
            title: `a news article about the security, #${String(i)}`,
            sourceUrl: `https://news.example/a/${String(i)}`,
            publishedAt: FRESH_OBSERVED_AT,
            availableAt: FRESH_OBSERVED_AT,
            ingestedAt: FRESH_INGESTED_AT,
            rawHash: `news-${String(i)}`,
          }),
        );
      }

      const snapshot = await assembleTickerSnapshot('FULL', { asOf });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;

      expect(snapshot.header.price).toBe('25.00');
      expect(snapshot.attention.mentions).toBe(100);
      expect(snapshot.attention.rank).toBe(5);
      expect(snapshot.attention.mentionDelta?.eligibility).toBe('ok');
      expect(snapshot.attention.mentionDelta?.display).toBe('50');
      expect(snapshot.attention.rankChange?.eligibility).toBe('ok');

      const reddit = snapshot.stance.find((frame) => frame.axis === 'reddit');
      expect(reddit?.metric?.eligibility).toBe('ok');
      expect(reddit?.usedCount).toBe(5);
      expect(reddit?.retrievedCount).toBe(5);
      // Round-1 lane-review finding 8, regression-guarded (round 2 found it otherwise unasserted
      // anywhere): must come from METHOD_REGISTRY's own limitations[] for social.stance_reddit,
      // not the computed artifact's own warnings[] — the contract's own doc names the former.
      expect(reddit?.selectionBiasNotes.length).toBeGreaterThan(0);
      const x = snapshot.stance.find((frame) => frame.axis === 'x');
      expect(x?.metric?.eligibility).toBe('insufficient_data');
      expect(x?.usedCount).toBe(0);
      // An insufficient_data abstention still carries a real, non-null metric object (only a
      // missing config_version makes selectionBiasNotes gate to []) — so this frame's notes are
      // populated the same way reddit's are, from METHOD_REGISTRY's limitations[] for its axis.
      expect(x?.selectionBiasNotes.length).toBeGreaterThan(0);

      expect(snapshot.news.metric?.eligibility).toBe('ok');
      expect(snapshot.news.articleCount).toBe(3);

      expect(snapshot.price.returns).toHaveLength(1);
      expect(snapshot.price.returns[0]).toMatchObject({ horizonCalendarDays: 7, totalReturn: '0.25' });
      // Every technical method abstains not_applicable — market_snapshot carries no
      // adjusted-vs-unadjusted flag (this feature's own CONTRACTS finding).
      expect(snapshot.price.regime?.eligibility).toBe('not_applicable');
      expect(snapshot.price.volatility20?.eligibility).toBe('not_applicable');
      expect(snapshot.price.rsi14?.eligibility).toBe('not_applicable');
      expect(snapshot.price.movingAverage20?.eligibility).toBe('not_applicable');
      expect(snapshot.price.movingAverage50?.eligibility).toBe('not_applicable');
      // Round-3 lane-review finding 2: `n` used to be the 51 bars this fixture's history query
      // fetched, for every technical regardless of its own window — contradicting the window
      // label right next to it. `n` is now `min(fetched, window)`, so each technical's own window
      // size (21/21/15/20/50) is distinguishable here from the 51-bar page size and from each
      // other. `projectAxisMetric` sets `n` from its caller regardless of eligibility, so this
      // holds even though every one of these abstains `not_applicable` above.
      expect(snapshot.price.regime?.n).toBe(21);
      expect(snapshot.price.volatility20?.n).toBe(21);
      expect(snapshot.price.rsi14?.n).toBe(15);
      expect(snapshot.price.movingAverage20?.n).toBe(20);
      expect(snapshot.price.movingAverage50?.n).toBe(50);

      // attention up (+100-50), stance positive (all bullish), price up (+0.25) => confirming_interest.
      expect(snapshot.divergence.available).toBe(true);
      if (snapshot.divergence.available) {
        expect(snapshot.divergence.state).toBe('confirming_interest');
        expect(snapshot.divergence.disclosure).toBe(
          'This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.',
        );
        // Round-4 lane-review finding 2: the social leg is Reddit's sampled frame alone, never a
        // blend of all three D-14 platforms — this must say so, not just the artifact's internal
        // `providerField: 'derived:sign(social.stance_reddit)'`.
        expect(snapshot.divergence.socialAxisDisclosure).toContain("Reddit's sampled frame alone");
        // Round-4 lane-review finding 3: the artifact's three synthesized inputs used to all
        // carry `observedAt: null`, making it structurally incapable of ever being marked stale.
        // This fixture's data is all within the staleness window, so this pins the non-stale case
        // — regression coverage for the fix, not proof of the stale branch (that would need data
        // older than `market.divergence_state`'s registered `stalenessMinutes`, which none of
        // this feature's other fixtures currently construct either).
        expect(snapshot.divergence.observedAt).not.toBeNull();
        expect(snapshot.divergence.stale).toBe(false);
      }

      expect(snapshot.evidence.usedCount).toBe(8);
      expect(snapshot.evidence.retrievedCount).toBeGreaterThanOrEqual(8);

      expect(snapshot.methodology.length).toBeGreaterThan(0);
      const stanceEntry = snapshot.methodology.find((entry) => entry.methodId === 'social.stance_reddit');
      expect(stanceEntry?.limitations.some((limitation) => limitation.includes('reddit.com'))).toBe(true);
      // Round-4 lane-review finding 2: was 'attention, stance and price axes', overstating that
      // all three D-14 social frames feed this state rather than Reddit's alone.
      const divergenceEntry = snapshot.methodology.find((entry) => entry.methodId === 'market.divergence_state');
      expect(divergenceEntry?.source).toBe('attention, Reddit stance and price axes');
    });

    it('renders a thin-sample security honestly — mention_delta ok, rank_change insufficient_data below the min_mentions floor', async () => {
      const securityId = await insertSecurity({ symbol: 'THIN' });
      await activeConfigVersion();
      await insertAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        rank: 90,
        rankPrior: 95,
        mentions: 3,
        mentionsPrior: 1,
        engagement: 2,
        windowHours: 24,
        coverageClass: 'pov_index',
        providerMethodologyVersion: 'v1',
        observedAt: FRESH_OBSERVED_AT,
        ingestedAt: FRESH_INGESTED_AT,
        rawHash: 'a-thin',
      });

      const snapshot = await assembleTickerSnapshot('THIN', { asOf: FRESH_ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      expect(snapshot.attention.mentionDelta?.eligibility).toBe('ok');
      expect(snapshot.attention.rankChange?.eligibility).toBe('insufficient_data');
    });

    it('renders a stale marker when the freshest attention observation is older than the method refresh window', async () => {
      const securityId = await insertSecurity({ symbol: 'STALE' });
      await activeConfigVersion();
      await insertAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        rank: 5,
        rankPrior: 20,
        mentions: 100,
        mentionsPrior: 50,
        engagement: 500,
        windowHours: 24,
        coverageClass: 'pov_index',
        providerMethodologyVersion: 'v1',
        // stalenessMinutes for attention.mention_delta is 360 (6 h); ASOF is several days later.
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
        ingestedAt: INGESTED_AT,
        rawHash: 'a-stale',
      });

      const snapshot = await assembleTickerSnapshot('STALE', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      expect(snapshot.attention.mentionDelta?.eligibility).toBe('stale');
    });

    it('renders a null relevance/snippet honestly rather than crashing', async () => {
      const securityId = await insertSecurity({ symbol: 'NULLFIELD' });
      await activeConfigVersion();
      await insertEvidenceItem(
        evidenceRow(securityId, {
          snippet: null,
          relevanceScore: null,
          stanceLabel: null,
          stanceScore: null,
          rawHash: 'null-field',
        }),
      );

      const snapshot = await assembleTickerSnapshot('NULLFIELD', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      expect(snapshot.evidence.items).toHaveLength(1);
      expect(snapshot.evidence.items[0]?.snippet).toBeNull();
      expect(snapshot.evidence.items[0]?.relevance).toBeNull();
      // Never classified => not counted toward any stance frame's usedCount.
      const reddit = snapshot.stance.find((frame) => frame.axis === 'reddit');
      expect(reddit?.usedCount).toBe(0);
      expect(reddit?.retrievedCount).toBe(1);
    });

    it('marks an item unreachable honestly — the stored snippet and the link both still render (F-19)', async () => {
      const securityId = await insertSecurity({ symbol: 'DEAD' });
      await activeConfigVersion();
      await insertEvidenceItem(
        evidenceRow(securityId, {
          availability: 'unreachable',
          lastCheckedAt: new Date('2026-09-02T00:00:00.000Z'),
          rawHash: 'dead-link',
        }),
      );

      const snapshot = await assembleTickerSnapshot('DEAD', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      const item = snapshot.evidence.items[0];
      expect(item?.availability).toBe('unreachable');
      expect(item?.snippet).toBe('the stored snippet as retrieved');
      expect(item?.unreachableNote).toContain('source no longer reachable');
      expect(item?.url).not.toBeNull();
    });
  });

  // ── Coverage gaps rendered as holes (F22 §4.4, first real render) ───────────────────────────────

  describe('a coverage gap crossing the chart window', () => {
    it('splits the attention chart into segments at the gap, and discloses it — never interpolates across it', async () => {
      const securityId = await insertSecurity({ symbol: 'GAPPY' });
      await pool.query(
        `insert into collector_start (axis, started_at, note) values ('reddit', '2026-08-01T00:00:00Z', 'test')`,
      );
      await pool.query(
        `insert into coverage_gap (axis, gap_from, gap_to, reason)
         values ('reddit', '2026-08-15T00:00:00Z', '2026-08-20T00:00:00Z', 'collector_down')`,
      );

      await insertAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        rank: 10,
        rankPrior: 10,
        mentions: 10,
        mentionsPrior: 10,
        engagement: 10,
        windowHours: 24,
        coverageClass: 'pov_index',
        providerMethodologyVersion: 'v1',
        observedAt: new Date('2026-08-10T00:00:00.000Z'),
        ingestedAt: INGESTED_AT,
        rawHash: 'before-gap',
      });
      await insertAttentionSnapshot({
        securityId,
        source: 'apewisdom',
        rank: 8,
        rankPrior: 10,
        mentions: 20,
        mentionsPrior: 10,
        engagement: 20,
        windowHours: 24,
        coverageClass: 'pov_index',
        providerMethodologyVersion: 'v1',
        observedAt: new Date('2026-08-25T00:00:00.000Z'),
        ingestedAt: INGESTED_AT,
        rawHash: 'after-gap',
      });

      const snapshot = await assembleTickerSnapshot('GAPPY', { asOf: ASOF });
      expect(snapshot.resolved).toBe(true);
      if (!snapshot.resolved) return;
      expect(snapshot.attention.gapCount).toBe(1);
      expect(snapshot.attention.chartSegments).toHaveLength(2);
      expect(snapshot.attention.chartSegments[0]).toHaveLength(1);
      expect(snapshot.attention.chartSegments[1]).toHaveLength(1);
      expect(snapshot.attention.coverageDisclosure).toContain('coverage begins 2026-08-01');
    });
  });
});
