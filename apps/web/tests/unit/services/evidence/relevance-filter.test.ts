import { describe, expect, it } from 'vitest';
import { FixtureModelBackend } from '@/services/evidence/model-client';
import { runRelevanceFilter, type RelevanceCandidate } from '@/services/evidence/relevance-filter';
import { RELEVANCE_FILTER_METHOD } from '@/services/evidence/method-registry';

const CONTEXT = { symbol: 'GME', companyName: 'GameStop Corp.' };

const candidates: RelevanceCandidate[] = [
  { itemId: 'i1', text: 'GME to the moon, diamond hands', axis: 'reddit' },
  { itemId: 'i2', text: 'Buy my GME options course, link in bio', axis: 'reddit' },
];

describe('runRelevanceFilter — F10 §4.4 relevance.filter', () => {
  it('never calls the backend for an empty candidate list', async () => {
    const backend = new FixtureModelBackend([{ kind: 'throw' }]);
    const outcome = await runRelevanceFilter([], CONTEXT, { backend, model: 'test-model' });
    expect(outcome.admitted.size).toBe(0);
    expect(outcome.records).toHaveLength(0);
  });

  it('admits a genuinely relevant item and excludes a promotional one, with its flag', async () => {
    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'i1', relevant: true, rationale: 'Directly about GME price action' },
          { itemId: 'i2', relevant: false, rationale: 'Promotional spam', flag: 'promotional' },
        ],
      },
    ]);
    const outcome = await runRelevanceFilter(candidates, CONTEXT, { backend, model: 'test-model' });
    expect(outcome.admitted.get('i1')).toMatchObject({ relevant: true });
    expect(outcome.admitted.get('i2')).toMatchObject({ relevant: false, flag: 'promotional' });
  });

  it('stamps every attempt with the registered method id and version', async () => {
    const backend = new FixtureModelBackend([
      { kind: 'json', body: [{ itemId: 'i1', relevant: true, rationale: 'x' }, { itemId: 'i2', relevant: true, rationale: 'y' }] },
    ]);
    const outcome = await runRelevanceFilter(candidates, CONTEXT, { backend, model: 'test-model' });
    expect(outcome.records[0]).toMatchObject({
      methodId: RELEVANCE_FILTER_METHOD.methodId,
      methodVersion: RELEVANCE_FILTER_METHOD.version,
      promptVersion: RELEVANCE_FILTER_METHOD.promptVersion,
    });
  });

  it('rejects rather than coerces when the rationale exceeds the 200-char bound', async () => {
    const backend = new FixtureModelBackend([
      {
        kind: 'json',
        body: [
          { itemId: 'i1', relevant: true, rationale: 'x'.repeat(201) },
          { itemId: 'i2', relevant: true, rationale: 'ok' },
        ],
      },
    ]);
    const outcome = await runRelevanceFilter(candidates, CONTEXT, { backend, model: 'test-model' });
    expect(outcome.rejected.has('i1')).toBe(true);
    expect(outcome.admitted.get('i2')).toMatchObject({ relevant: true });
  });
});
