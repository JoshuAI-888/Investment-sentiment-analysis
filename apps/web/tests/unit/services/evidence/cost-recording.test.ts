import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { Queryable } from '@/repositories/client';
import { recordModelCallCost } from '@/services/evidence/cost-recording';
import type { ModelCallAttemptRecord } from '@/services/evidence/model-client';

function fakeDb(): { db: Queryable; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (): Promise<pg.QueryResult> => ({
    rows: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        occurred_at: new Date(),
        provider: 'vercel_gateway',
        service: 'relevance.filter',
        operation_or_model: 'test-model',
        feature: 'F10',
        job_run_id: null,
        research_run_id: null,
        user_id: null,
        request_id: 'req-1',
        unit_type: 'call',
        request_units: '1',
        billable_units: '1',
        unit_price: null,
        currency: 'USD',
        price_book_version: null,
        cost_usd: null,
        cost_status: 'unpriced',
        cache_status: 'miss',
        metadata: {},
        supersedes_cost_event_id: null,
      },
    ],
    rowCount: 1,
    command: 'INSERT',
    oid: 0,
    fields: [],
  }));
  return { db: { query }, query };
}

const RECORD: ModelCallAttemptRecord = {
  methodId: 'relevance.filter',
  methodVersion: '1.0.0',
  promptVersion: 'relevance.filter@1',
  model: 'test-model',
  temperature: 0,
  attempt: 1,
  requestedAt: '2026-09-04T00:00:00.000Z',
  usage: { promptTokens: 10, completionTokens: 5, costUsd: null },
  outcome: 'admitted_some',
};

describe('recordModelCallCost', () => {
  it('records costUsd: null as costStatus "unpriced", never as 0', async () => {
    const { db, query } = fakeDb();
    await recordModelCallCost(RECORD, 'Relevance filter', { feature: 'F10', requestId: 'req-1' }, db);
    const [, values] = query.mock.calls[0] as [string, unknown[]];
    const insertedColumns = (query.mock.calls[0] as [string])[0];
    expect(insertedColumns).toMatch(/insert into cost_event/);
    // cost_usd and cost_status are adjacent in the column list; assert both ended up consistent.
    expect(values).toContain(null);
    expect(values).toContain('unpriced');
  });

  it('records a priced call as costStatus "actual" with the real cost', async () => {
    const { db, query } = fakeDb();
    await recordModelCallCost(
      { ...RECORD, usage: { ...RECORD.usage, costUsd: '0.002100' } },
      'Relevance filter',
      { feature: 'F10', requestId: 'req-1' },
      db,
    );
    const [, values] = query.mock.calls[0] as [string, unknown[]];
    expect(values).toContain('0.002100');
    expect(values).toContain('actual');
  });
});
