import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { databaseUrl, makePool, resetSchema, truncateAll } from './helpers/db';
import { closePool, getPool } from '../../src/repositories/client';
import { activateConfigVersion, insertConfigVersion } from '../../src/repositories/versions';
import { insertEvidenceItem, type NewEvidenceItem } from '../../src/repositories/evidence';
import { getTickerSentiment } from '../../src/services/mcp/tools/get-ticker-sentiment';
import { renderMetricCard, MetricCardNotFoundError } from '../../src/services/mcp/resources/metric-card';
import { renderEvidenceList } from '../../src/services/mcp/resources/evidence-list';
import { renderInspector } from '../../src/services/mcp/resources/inspector';
import { readResource } from '../../src/services/mcp/server';

const url = databaseUrl();
const AUDIT = { actorId: 'owner', actorRole: 'admin', reason: 'test', requestId: 'req-1', correlationId: 'corr-1' };
const INGESTED_AT = new Date('2026-09-02T12:00:00.000Z');

/**
 * F21 §4.4's own compliance-mechanism claim, tested as one: "Each carries the disclosure text
 * **in markup**, not in a field the model may paraphrase. A component that renders a value
 * without its `n`, window and disclosure is a build failure." §7 review step 3: "Read each
 * `ui://` component's markup and confirm the disclosure is *in the markup*, not passed in."
 *
 * These assertions grep the rendered HTML **string**, not a parsed prop object — the failure
 * mode this test exists to catch is a component that accepts a `disclosure` field the caller
 * could omit or overwrite, which a prop-level assertion would not detect but a markup-text
 * assertion does.
 */
describe.skipIf(url === undefined)('F21 §4.4 — ui:// resources render their own disclosure in markup', () => {
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

  async function insertSecurity(symbol = 'CARD'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into security (symbol, name, exchange, asset_type, currency, sector, active)
       values ($1, 'Test Co', 'NYSE', 'equity', 'USD', 'Consumer', true) returning id`,
      [symbol],
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
      title: `post ${String(index)}`,
      snippet: `snippet ${String(index)}`,
      sourceUrl: `https://reddit.example/${String(index)}`,
      publisher: null,
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.60',
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

  describe('ui://metric-card', () => {
    it('renders the §6.4 disclosure, n and window in the HTML text, even when n/window are omitted from the request', async () => {
      await insertSecurity('CARD');
      await activeConfigVersion();
      const sentiment = await getTickerSentiment({ symbol: 'CARD' });
      expect(sentiment.ok).toBe(true);
      if (!sentiment.ok) return;
      const calculationId = sentiment.calculationIds[0];
      expect(calculationId).toBeDefined();
      if (calculationId === undefined) return;

      const html = await renderMetricCard({ calculationId });
      expect(html).toContain('data-role="n"');
      expect(html).toContain('data-role="window"');
      expect(html).toContain('data-role="tier-d-disclosure"');
      expect(html).toContain('This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.');
      // The label is present even though no n/window hint was supplied — "not supplied" is an
      // honest value, but the *line itself* is never silently absent.
      expect(html).toContain('not supplied');
    });

    it('renders n and window values when supplied, and the disclosure is unaffected by them', async () => {
      await insertSecurity('CARD2');
      await activeConfigVersion();
      const sentiment = await getTickerSentiment({ symbol: 'CARD2' });
      expect(sentiment.ok).toBe(true);
      if (!sentiment.ok) return;
      const calculationId = sentiment.calculationIds[0];
      if (calculationId === undefined) return;

      const html = await renderMetricCard({ calculationId, n: 12, window: '24 h' });
      expect(html).toContain('Sample size (n): 12');
      expect(html).toContain('Window: 24 h');
      expect(html).toContain('This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast.');
    });

    it('throws rather than rendering a card for an unresolvable calculationId', async () => {
      await expect(renderMetricCard({ calculationId: '00000000-0000-4000-8000-000000000099' })).rejects.toBeInstanceOf(MetricCardNotFoundError);
    });

    it('is reachable through the JSON-RPC resources/read dispatcher (server.ts), not only by direct import', async () => {
      await insertSecurity('CARD3');
      await activeConfigVersion();
      const sentiment = await getTickerSentiment({ symbol: 'CARD3' });
      if (!sentiment.ok) return;
      const calculationId = sentiment.calculationIds[0];
      if (calculationId === undefined) return;

      const resource = await readResource(`ui://metric-card?calculationId=${calculationId}&n=5&window=${encodeURIComponent('24 h')}`);
      expect(resource.mimeType).toBe('text/html');
      expect(resource.text).toContain('This is a description of what is currently observable.');
      expect(resource.text).toContain('Sample size (n): 5');
    });
  });

  describe('ui://evidence-list', () => {
    it('renders n and the bounded-list disclosure in markup, and every item shows its availability/stance', async () => {
      const securityId = await insertSecurity('EVID');
      for (let i = 0; i < 5; i += 1) await insertEvidenceItem(evidenceRow(securityId, i));

      const html = await renderEvidenceList({ symbol: 'EVID', direction: 'supporting' });
      expect(html).toContain('data-role="n"');
      expect(html).toContain('Sample size (n): 5');
      expect(html).toContain('This list is bounded and stance-classified');
      expect(html).toContain('data-availability="available"');
      expect(html).toContain('data-role="snippet"');
    });
  });

  describe('ui://inspector', () => {
    it('renders inputs, steps, exact decimal, rounding rule and both hashes in markup', async () => {
      await insertSecurity('INSP');
      await activeConfigVersion();
      const sentiment = await getTickerSentiment({ symbol: 'INSP' });
      if (!sentiment.ok) return;
      const calculationId = sentiment.calculationIds[0];
      if (calculationId === undefined) return;

      const html = await renderInspector(calculationId);
      expect(html).toContain('data-role="input-hash"');
      expect(html).toContain('data-role="result-hash"');
      expect(html).toContain('data-role="steps"');
      expect(html).toContain('data-role="inputs"');
      expect(html).toMatch(/data-role="rounding-rule"|data-role="abstention"/);
    });
  });
});
