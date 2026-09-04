import { describe, expect, it, vi } from 'vitest';
import type { EvidenceForSecurityResult } from '@/repositories/evidence';

const evidenceForSecurityMock = vi.fn<() => Promise<EvidenceForSecurityResult>>();
vi.mock('@/repositories/evidence', () => ({ evidenceForSecurity: evidenceForSecurityMock }));

const { runResearchStateMachine, DEFAULT_STAGE_BUDGETS_MS } = await import('@/services/research/state-machine');
const { AAPL, makeEvidenceItem } = await import('./fixtures');

import type { ModelClient, ModelClassifyInput, ModelClientResult, ModelCallMeta } from '@/services/llm/ports';
import type { ResearchModelClient, ResearchModelResult, ResearchModelCallMeta } from '@/services/research/model-tasks';
import type { MetricsGatherer, MetricFact } from '@/services/research/metrics';
import type { RunEvent } from '@/services/research/state-machine';

const classifyMeta: ModelCallMeta = {
  modelId: 'fast-fake', route: 'fixture', promptVersion: 'x', temperature: '0',
  tokensIn: null, tokensOut: null, costUsd: null, requestId: 'r', latencyMs: 0, requestedAt: '2026-09-01T00:00:00.000Z',
};
const researchMeta: ResearchModelCallMeta = { ...classifyMeta, modelId: 'openai/gpt-fake' };

/** Always relevant, never a collision guard case. */
function relevantClassifyClient(): ModelClient {
  return {
    classify: async <T,>(input: ModelClassifyInput): Promise<ModelClientResult<T>> => {
      if (input.task === 'relevance') {
        return { ok: true, data: { itemId: 'x', relevant: true, relevanceScore: 0.9, reason: 'fake' } as T, meta: classifyMeta };
      }
      return { ok: true, data: { itemId: 'x', confirmed: true, reason: 'fake' } as T, meta: classifyMeta };
    },
  };
}

function delayedClassifyClient(delayMs: number): ModelClient {
  return {
    classify: async <T,>(input: ModelClassifyInput): Promise<ModelClientResult<T>> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return relevantClassifyClient().classify<T>(input, undefined as never);
    },
  };
}

function metricsGathererResolving(metrics: readonly MetricFact[], delayMs = 0): MetricsGatherer {
  return async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return metrics;
  };
}

const oneMetric: MetricFact = {
  metricId: 'attention.rank_change',
  calculationId: 'calc-1',
  label: 'Rank change',
  display: '3',
  unit: '',
  n: 1,
  window: '24 h',
  observedAt: new Date('2026-08-31T00:00:00.000Z'),
};

function synthesisClientReturning(output: unknown): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> => ({ ok: true, data: output as T, meta: researchMeta }),
  };
}
function synthesisClientErroring(kind: 'timeout' | 'schema_invalid'): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> =>
      kind === 'timeout'
        ? { ok: false, error: { kind: 'timeout' }, meta: researchMeta }
        : { ok: false, error: { kind: 'schema_invalid', issues: ['bad'], raw: '{}' }, meta: researchMeta },
  };
}
function delayedSynthesisClient(output: unknown, delayMs: number): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ok: true, data: output as T, meta: researchMeta };
    },
  };
}

const CLEAN_OUTPUT = {
  summary: 'Apple reported quarterly results in line with expectations.',
  statedFreshness: '2026-08-31',
  themes: [
    {
      title: 'Recent coverage',
      singleSource: false,
      claims: [
        {
          claimId: 'c1',
          text: 'Apple attention rank moved by 3 positions.',
          kind: 'fact',
          evidenceIds: [] as string[],
          metricIds: ['attention.rank_change'],
          relatedTickers: ['AAPL'],
          assertedDate: null,
        },
      ],
    },
  ],
  bullishCase: [],
  bearishCase: [],
  whatChanged: [],
  whatToMonitor: [],
};

function verifyClientSupportingAll(): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> => ({
      ok: true,
      data: { results: [{ claimId: 'c1', verdict: 'supported', reason: 'matches the metric' }] } as T,
      meta: researchMeta,
    }),
  };
}
function verifyClientContradicting(): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> => ({
      ok: true,
      data: { results: [{ claimId: 'c1', verdict: 'contradicted', reason: 'the metric moved the other way' }] } as T,
      meta: researchMeta,
    }),
  };
}
/** F11 §7 PR review step 2: "Force a verifier timeout; confirm verification_failed and that numbers still render." */
function delayedVerifyClient(delayMs: number): ResearchModelClient {
  return {
    run: async <T,>(): Promise<ResearchModelResult<T>> => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return verifyClientSupportingAll().run<T>({ task: 'verify', promptVersion: 'v', system: 's', prompt: 'p', maxOutputTokens: 1 }, undefined as never);
    },
  };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  const events: RunEvent[] = [];
  return {
    runId: 'run-1',
    question: 'What is going on with AAPL?',
    securityId: '00000000-0000-4000-8000-000000000001',
    security: AAPL,
    classifyModelClient: relevantClassifyClient(),
    synthesisModelClient: synthesisClientReturning(CLEAN_OUTPUT),
    verifyModelClient: verifyClientSupportingAll(),
    metricsGatherer: metricsGathererResolving([oneMetric]),
    emit: async (event: RunEvent) => {
      events.push(event);
    },
    clock: () => new Date('2026-09-01T00:00:00.000Z'),
    budgets: DEFAULT_STAGE_BUDGETS_MS,
    synthesisMaxOutputTokens: 1000,
    verifyMaxOutputTokens: 1000,
    followupMaxOutputTokens: 200,
    generateFollowupRewrite: false,
    ...overrides,
  } as Parameters<typeof runResearchStateMachine>[0] & { __events: RunEvent[] };
}

function labelsOf(events: RunEvent[]): string[] {
  return events.filter((e) => e.eventType === 'state').map((e) => e.label);
}

describe('runResearchStateMachine', () => {
  it('completes end to end: emits gathering -> analyzing -> synthesizing -> verifying -> complete, and every claim resolves', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const events: RunEvent[] = [];
    const deps = baseDeps({ emit: async (e: RunEvent) => events.push(e) });

    const outcome = await runResearchStateMachine(deps);

    expect(outcome.kind).toBe('complete');
    expect(labelsOf(events)).toEqual(['gathering', 'analyzing', 'synthesizing', 'verifying', 'complete']);
    if (outcome.kind === 'complete') {
      expect(outcome.claims).toHaveLength(1);
      expect(outcome.claims[0]?.verificationStatus).toBe('verified');
    }
  });

  it('abstains when there is genuinely no evidence and no metric', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const events: RunEvent[] = [];
    const deps = baseDeps({ metricsGatherer: metricsGathererResolving([]), emit: async (e: RunEvent) => events.push(e) });

    const outcome = await runResearchStateMachine(deps);

    expect(outcome.kind).toBe('abstained');
    expect(labelsOf(events)).toContain('abstained');
  });

  it('degrades (prose withheld, metrics stand) on a synthesis timeout', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const deps = baseDeps({
      synthesisModelClient: delayedSynthesisClient(CLEAN_OUTPUT, 50),
      budgets: { ...DEFAULT_STAGE_BUDGETS_MS, synthesis: 5 },
    });

    const outcome = await runResearchStateMachine(deps);

    expect(outcome.kind).toBe('degraded');
    if (outcome.kind === 'degraded') expect(outcome.metrics).toEqual([oneMetric]);
  });

  it('degrades on a synthesis schema-invalid response — never coerced into prose', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const deps = baseDeps({ synthesisModelClient: synthesisClientErroring('schema_invalid') });

    const outcome = await runResearchStateMachine(deps);
    expect(outcome.kind).toBe('degraded');
  });

  it('lands on verification_failed, prose withheld, when the model verifier contradicts a claim', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const events: RunEvent[] = [];
    const deps = baseDeps({ verifyModelClient: verifyClientContradicting(), emit: async (e: RunEvent) => events.push(e) });

    const outcome = await runResearchStateMachine(deps);

    expect(outcome.kind).toBe('verification_failed');
    expect(labelsOf(events)).toContain('verification_failed');
    if (outcome.kind === 'verification_failed') {
      expect(outcome.claims[0]?.verificationStatus).toBe('withheld');
    }
  });

  it('a verifier timeout lands on verification_failed with prose withheld — and the metrics that were already computed still render (F11 §7 PR review step 2)', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const events: RunEvent[] = [];
    const deps = baseDeps({
      verifyModelClient: delayedVerifyClient(50),
      budgets: { ...DEFAULT_STAGE_BUDGETS_MS, verification: 5 },
      emit: async (e: RunEvent) => events.push(e),
    });

    const outcome = await runResearchStateMachine(deps);

    expect(outcome.kind).toBe('verification_failed');
    expect(labelsOf(events)).toContain('verification_failed');
    if (outcome.kind === 'verification_failed') {
      expect(outcome.metrics).toEqual([oneMetric]);
      expect(outcome.claims.every((claim) => claim.verificationStatus === 'withheld')).toBe(true);
    }
  });

  it('hard-fails (not degrades) when deterministic analysis (F06 metrics) exceeds its 1 s budget — local computation has no partial-result path', async () => {
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [], scannedCount: 0, distinctCount: 0, truncated: false });
    const deps = baseDeps({
      metricsGatherer: metricsGathererResolving([oneMetric], 50),
      budgets: { ...DEFAULT_STAGE_BUDGETS_MS, deterministicAnalysis: 5 },
    });

    const outcome = await runResearchStateMachine(deps);
    expect(outcome.kind).toBe('failed');
  });

  it('proceeds with zero evidence and records a gap event when the fan-out stage overruns its budget', async () => {
    evidenceForSecurityMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ items: [], scannedCount: 5, distinctCount: 5, truncated: false }), 50)),
    );
    const events: RunEvent[] = [];
    const deps = baseDeps({ budgets: { ...DEFAULT_STAGE_BUDGETS_MS, fanOut: 5 }, emit: async (e: RunEvent) => events.push(e) });

    const outcome = await runResearchStateMachine(deps);

    expect(events.some((e) => e.eventType === 'gap' && e.label === 'fan_out_overrun')).toBe(true);
    // Metrics alone are enough not to abstain.
    expect(outcome.kind).not.toBe('abstained');
  });

  it('proceeds with an empty pack and records a gap event when classification overruns its budget', async () => {
    const socialItem = makeEvidenceItem({ evidenceType: 'social_result', provider: 'x', title: 'AAPL is moving', snippet: 'Apple Inc. shares moved today.' });
    const socialItemWithDedupeKey = { ...socialItem, dedupeKey: `no-url:${socialItem.rawHash}|aapl is moving` };
    evidenceForSecurityMock.mockResolvedValueOnce({ items: [socialItemWithDedupeKey], scannedCount: 1, distinctCount: 1, truncated: false });
    const events: RunEvent[] = [];
    const deps = baseDeps({
      classifyModelClient: delayedClassifyClient(50),
      budgets: { ...DEFAULT_STAGE_BUDGETS_MS, classification: 5 },
      emit: async (e: RunEvent) => events.push(e),
    });

    const outcome = await runResearchStateMachine(deps);

    expect(events.some((e) => e.eventType === 'gap' && e.label === 'classification_overrun')).toBe(true);
    expect(outcome.kind).not.toBe('abstained'); // metrics still present
  });
});
