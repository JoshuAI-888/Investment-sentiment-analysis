import { describe, expect, it } from 'vitest';
import { resolveVerification, runModelVerification } from '@/services/research/verify';
import type { VerifyContext } from '@/services/research/deterministic-checks';
import type { ResearchModelClient, ResearchModelResult } from '@/services/research/model-tasks';
import { AAPL, makeClaim, makeIncludedItem, makeMetric, makePack, makeSynthesisOutput, makeTheme } from './fixtures';

const okMeta = {
  modelId: 'anthropic/claude-fake',
  route: 'fixture',
  promptVersion: 'verify-v1',
  temperature: '0',
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  requestId: 'r1',
  latencyMs: 1,
  requestedAt: '2026-09-01T00:00:00.000Z',
};

function cleanContext(): { ctx: VerifyContext; claimId: string } {
  const included = makeIncludedItem({ availableAt: new Date('2026-08-30T00:00:00.000Z'), publishedAt: new Date('2026-08-30T00:00:00.000Z') });
  const metric = makeMetric({ display: '3', observedAt: new Date('2026-08-31T00:00:00.000Z') });
  const claim = makeClaim({
    text: 'Apple attention rank moved by 3 positions.',
    evidenceIds: [included.stableId],
    metricIds: [metric.metricId],
  });
  const output = makeSynthesisOutput({ statedFreshness: '2026-08-30', themes: [makeTheme([claim])] });
  const pack = makePack([included], { retrievalWindow: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' } });
  return { ctx: { output, pack, metrics: [metric], subjectSymbol: AAPL.symbol }, claimId: claim.claimId };
}

describe('resolveVerification', () => {
  it('a deterministic check failure withholds prose regardless of what the model pass would have said', () => {
    const { ctx, claimId } = cleanContext();
    const brokenCtx: VerifyContext = { ...ctx, output: { ...ctx.output, themes: [makeTheme([makeClaim({ claimId, evidenceIds: ['00000000-0000-4000-8000-000000000999'] })])] } };
    const outcome = resolveVerification('run-1', brokenCtx, { kind: 'ok', results: [{ claimId, verdict: 'supported', reason: 'looks fine' }] });
    expect(outcome.kind).toBe('verification_failed');
    expect(outcome.claims.every((claim) => claim.verificationStatus === 'withheld')).toBe(true);
  });

  it('a null model-verification result (never ran) withholds prose', () => {
    const { ctx } = cleanContext();
    const outcome = resolveVerification('run-1', ctx, null);
    expect(outcome.kind).toBe('verification_failed');
    if (outcome.kind === 'verification_failed') expect(outcome.reason).toContain('did not run');
  });

  it('a model-verification error/timeout withholds prose', () => {
    const { ctx } = cleanContext();
    const outcome = resolveVerification('run-1', ctx, { kind: 'error', detail: 'timeout' });
    expect(outcome.kind).toBe('verification_failed');
    if (outcome.kind === 'verification_failed') expect(outcome.reason).toContain('timeout');
  });

  it('every claim supported by the model, on top of clean deterministic checks, publishes', () => {
    const { ctx, claimId } = cleanContext();
    const outcome = resolveVerification('run-1', ctx, { kind: 'ok', results: [{ claimId, verdict: 'supported', reason: 'matches the cited evidence' }] });
    expect(outcome.kind).toBe('verified');
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.claims[0]?.verificationStatus).toBe('verified');
  });

  it('a single contradicted claim withholds the whole run\'s prose, but the ledger preserves the actual verdict in verifierNotes', () => {
    const { ctx, claimId } = cleanContext();
    const outcome = resolveVerification('run-1', ctx, { kind: 'ok', results: [{ claimId, verdict: 'contradicted', reason: 'the cited article says the opposite' }] });
    expect(outcome.kind).toBe('verification_failed');
    expect(outcome.claims[0]?.verificationStatus).toBe('withheld');
    expect(outcome.claims[0]?.verifierNotes).toContain('contradicted');
  });

  it('a claim the model never returned a verdict for is treated as withheld, not silently passed', () => {
    const { ctx } = cleanContext();
    const outcome = resolveVerification('run-1', ctx, { kind: 'ok', results: [] });
    expect(outcome.kind).toBe('verification_failed');
    expect(outcome.claims[0]?.verificationStatus).toBe('withheld');
  });
});

describe('runModelVerification', () => {
  it('returns a typed error, never throws, when the client reports a schema-invalid response', async () => {
    const client: ResearchModelClient = {
      run: async <T,>(): Promise<ResearchModelResult<T>> => ({
        ok: false,
        error: { kind: 'schema_invalid', issues: ['bad'], raw: '{}' },
        meta: okMeta,
      }),
    };
    const result = await runModelVerification({ runId: 'r', output: makeSynthesisOutput(), client, maxOutputTokens: 100 });
    expect(result.kind).toBe('error');
  });

  it('returns ok with the model\'s per-claim results on a valid response', async () => {
    const client: ResearchModelClient = {
      run: async <T,>(): Promise<ResearchModelResult<T>> => ({
        ok: true,
        data: { results: [{ claimId: 'c1', verdict: 'supported', reason: 'fine' }] } as T,
        meta: okMeta,
      }),
    };
    const result = await runModelVerification({ runId: 'r', output: makeSynthesisOutput(), client, maxOutputTokens: 100 });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.results).toEqual([{ claimId: 'c1', verdict: 'supported', reason: 'fine' }]);
  });
});
