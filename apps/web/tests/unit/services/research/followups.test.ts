import { describe, expect, it } from 'vitest';
import { templateFollowups, sameQuestionSet, rewriteFollowups } from '@/services/research/followups';
import type { ResearchModelClient, ResearchModelResult } from '@/services/research/model-tasks';
import { AAPL, makeIncludedItem, makeMetric, makePack } from './fixtures';

const okMeta = {
  modelId: 'openai/gpt-fake',
  route: 'fixture',
  promptVersion: 'followup-v1',
  temperature: '0',
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  requestId: 'r1',
  latencyMs: 1,
  requestedAt: '2026-09-01T00:00:00.000Z',
};

describe('templateFollowups', () => {
  it('never re-retrieves — it is built purely from the pack and metrics already in hand', () => {
    const included = makeIncludedItem({ provider: 'x' }, { axis: 'x' });
    const pack = makePack([included]);
    // Force a used-count on the x disclosure so the axis-specific template fires.
    const [reddit, x, substack] = pack.disclosures;
    const packWithUsage = { ...pack, disclosures: [reddit, { ...x, usedCount: 1 }, substack] as typeof pack.disclosures };
    const questions = templateFollowups({ subjectSymbol: AAPL.symbol, metrics: [], pack: packWithUsage });
    expect(questions.some((q) => q.id === 'axis_x')).toBe(true);
    expect(questions.every((q) => q.text.includes(AAPL.symbol))).toBe(true);
  });

  it('always offers the generic evidence follow-up and caps at five', () => {
    const questions = templateFollowups({ subjectSymbol: AAPL.symbol, metrics: [makeMetric(), makeMetric({ metricId: 'price.regime', label: 'Regime' })], pack: makePack([]) });
    expect(questions.length).toBeLessThanOrEqual(5);
    expect(questions.some((q) => q.id === 'evidence')).toBe(true);
  });
});

describe('sameQuestionSet', () => {
  it('accepts a rewrite that only rewords existing template ids', () => {
    const templates = [{ id: 'a', text: 'Original A' }, { id: 'b', text: 'Original B' }];
    expect(sameQuestionSet(templates, [{ id: 'a', text: 'Reworded A' }])).toBe(true);
  });

  it('rejects a rewrite that introduces an id no template offered', () => {
    const templates = [{ id: 'a', text: 'Original A' }];
    expect(sameQuestionSet(templates, [{ id: 'a', text: 'A' }, { id: 'made_up', text: 'New question' }])).toBe(false);
  });
});

describe('rewriteFollowups', () => {
  const templates = [{ id: 'a', text: 'Original A' }];

  it('falls back to the templates verbatim on a client error', async () => {
    const client: ResearchModelClient = {
      run: async <T,>(): Promise<ResearchModelResult<T>> => ({ ok: false, error: { kind: 'timeout' }, meta: okMeta }),
    };
    const result = await rewriteFollowups({ subjectSymbol: AAPL.symbol, templates, client, maxOutputTokens: 100 });
    expect(result).toEqual(templates);
  });

  it('falls back to the templates verbatim when the rewrite tries to introduce a new question', async () => {
    const client: ResearchModelClient = {
      run: async <T,>(): Promise<ResearchModelResult<T>> => ({
        ok: true,
        data: { questions: [{ id: 'a', text: 'A' }, { id: 'made_up', text: 'New' }] } as T,
        meta: okMeta,
      }),
    };
    const result = await rewriteFollowups({ subjectSymbol: AAPL.symbol, templates, client, maxOutputTokens: 100 });
    expect(result).toEqual(templates);
  });

  it('accepts a valid, in-bounds rewrite', async () => {
    const client: ResearchModelClient = {
      run: async <T,>(): Promise<ResearchModelResult<T>> => ({
        ok: true,
        data: { questions: [{ id: 'a', text: 'A nicer phrasing of A' }] } as T,
        meta: okMeta,
      }),
    };
    const result = await rewriteFollowups({ subjectSymbol: AAPL.symbol, templates, client, maxOutputTokens: 100 });
    expect(result).toEqual([{ id: 'a', text: 'A nicer phrasing of A' }]);
  });
});
