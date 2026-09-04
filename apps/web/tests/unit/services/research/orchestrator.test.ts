import { describe, expect, it } from 'vitest';
import { runResearch, type RunResearchDeps } from '../../../../src/services/research/orchestrator';
import {
  createFakeClock,
  createFixtureEvidencePort,
  createFixtureMetricsPort,
  createHangingMetricsPort,
  createInMemoryResearchRepository,
} from '../../../../src/services/research/testing';
import { createFixtureModelClient } from '../../../../src/services/research/model-client';
import type { EvidencePack } from '../../../../src/contracts/evidence-pack';
import type { MetricRef } from '../../../../src/services/research/ports';
import type { SynthesisOutput } from '../../../../src/services/research/synthesis';

const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';

function evidenceItem(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    securityId: '44444444-4444-4444-4444-444444444444',
    evidenceType: 'social_result',
    provider: 'reddit',
    title: `NVDA thread ${id}`,
    snippet: 'body',
    sourceUrl: null,
    publisher: null,
    authorRef: null,
    stanceLabel: 'bullish',
    stanceScore: '0.8',
    relevanceScore: '0.9',
    publishedAt: new Date('2026-08-20T00:00:00Z'),
    availableAt: new Date('2026-08-20T00:00:00Z'),
    ingestedAt: new Date('2026-08-21T00:00:00Z'),
    lastCheckedAt: null,
    availability: 'available',
    licenseClass: 'standard',
    coverageClass: 'sampled',
    rawHash: 'a'.repeat(64),
    metadata: {},
    ...overrides,
  };
}

function fullPack(): EvidencePack {
  return {
    id: 'pack-1',
    securityId: '44444444-4444-4444-4444-444444444444',
    retrievalQuery: 'security_id = 44444444-4444-4444-4444-444444444444',
    retrievalWindow: { from: new Date('2026-08-19T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') },
    items: [
      { item: evidenceItem(ID_1), axis: 'reddit', relevant: true, relevanceMethodVersion: 'v1', stanceConfidence: '0.7', flags: [], excludedReason: null },
      {
        item: evidenceItem(ID_2, { availableAt: new Date('2026-08-22T00:00:00Z'), ingestedAt: new Date('2026-08-23T00:00:00Z') }),
        axis: 'reddit',
        relevant: true,
        relevanceMethodVersion: 'v1',
        stanceConfidence: '0.7',
        flags: [],
        excludedReason: null,
      },
      {
        item: evidenceItem(ID_3, { provider: 'x', availableAt: new Date('2026-08-24T00:00:00Z'), ingestedAt: new Date('2026-08-25T00:00:00Z') }),
        axis: 'x',
        relevant: true,
        relevanceMethodVersion: 'v1',
        stanceConfidence: '0.6',
        flags: [],
        excludedReason: null,
      },
    ],
    frames: [
      { axis: 'reddit', frameStatement: 's', window: { from: new Date('2026-08-19T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') }, retrievedCount: 10, usedCount: 2 },
      { axis: 'x', frameStatement: 's', window: { from: new Date('2026-08-19T00:00:00Z'), to: new Date('2026-08-27T00:00:00Z') }, retrievedCount: 5, usedCount: 1 },
    ],
    createdAt: new Date('2026-08-27T00:00:00Z'),
  } as EvidencePack;
}

const METRIC: MetricRef = {
  metricId: 'm-1',
  methodId: 'attention.rank_change',
  displayValue: '+5',
  unit: 'rank',
  observedAt: new Date('2026-08-26T00:00:00Z'),
};

function goodSynthesisOutput(): SynthesisOutput {
  return {
    summary: [{ text: 'NVDA mentions rose by +5 this week.', kind: 'calculation', evidenceIds: [ID_1], metricIds: ['m-1'], assertsStanceForAxis: null }],
    themes: [
      {
        title: 'Rising attention',
        claims: [{ text: 'Reddit discussion increased.', kind: 'fact', evidenceIds: [ID_1, ID_2], metricIds: [], assertsStanceForAxis: null }],
        singleSource: false,
      },
    ],
    bullishCase: [{ text: 'Multiple threads discuss NVDA positively.', kind: 'interpretation', evidenceIds: [ID_1], metricIds: [], assertsStanceForAxis: null }],
    bearishCase: [{ text: 'No bearish evidence found in this window.', kind: 'interpretation', evidenceIds: [], metricIds: [], assertsStanceForAxis: null }],
    whatChanged: [{ text: 'Reddit mentions increased this week.', kind: 'fact', evidenceIds: [ID_2], metricIds: [], assertsStanceForAxis: null }],
    whatToMonitor: [{ text: 'Watch for continued mentions on X.', kind: 'hypothesis', evidenceIds: [ID_3], metricIds: [], assertsStanceForAxis: null }],
    statedFreshnessAsOf: '2026-08-20T00:00:00.000Z',
  } as SynthesisOutput;
}

function allSupportedVerdict(claimCount: number) {
  return {
    verdicts: Array.from({ length: claimCount }, (_, index) => ({ claimIndex: index, supported: true, rationale: 'follows from cited evidence' })),
  };
}

function baseDeps(overrides: Partial<RunResearchDeps> = {}): RunResearchDeps {
  return {
    repo: createInMemoryResearchRepository(),
    evidence: createFixtureEvidencePort(() => ({ pack: fullPack(), fanOutTimedOut: false, classificationTimedOut: false, classifiedCount: 3 })),
    metrics: createFixtureMetricsPort([METRIC]),
    model: createFixtureModelClient((task) => (task === 'synthesis' ? goodSynthesisOutput() : allSupportedVerdict(7))),
    clock: createFakeClock(new Date('2026-08-27T00:00:00Z')),
    checkBudget: () => Promise.resolve({ allowed: true, spentUsd: '0', ceilingUsd: '350' }),
    ...overrides,
  };
}

const INPUT = { userId: 'user-1', securityId: '44444444-4444-4444-4444-444444444444', securitySymbol: 'NVDA', question: 'What is happening with NVDA?' };

describe('runResearch — happy path', () => {
  it('reaches complete with prose, a populated claim ledger and follow-ups', async () => {
    const deps = baseDeps();
    const outcome = await runResearch(INPUT, deps);
    expect(outcome.outcome).toBe('ok');
    if (outcome.outcome !== 'ok') return;

    expect(outcome.run.status).toBe('complete');
    const result = outcome.run.result as { prose: unknown; metrics: unknown; followups: unknown };
    expect(result.prose).not.toBeNull();
    expect((result.followups as unknown[]).length).toBeGreaterThan(0);

    const claims = await deps.repo.listClaims(outcome.run.id);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((claim) => claim.verificationStatus === 'verified')).toBe(true);
  });

  it('emits the first progress event immediately, before any stage takes real wall-clock time', async () => {
    const deps = baseDeps();
    const startedAt = Date.now();
    const outcome = await runResearch(INPUT, deps);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    const events = await deps.repo.listEvents(outcome.run.id);
    expect(events[0]?.label).toBe('queued');
    expect(events[0]?.sequence).toBe(0);
  });

  it('streams deterministic metrics under the analyzing stage, before the synthesizing stage begins', async () => {
    const deps = baseDeps();
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    const events = await deps.repo.listEvents(outcome.run.id);

    const metricIndex = events.findIndex((event) => (event.payload as { kind?: string }).kind === 'metric');
    const synthesizingIndex = events.findIndex((event) => event.label === 'synthesizing');
    expect(metricIndex).toBeGreaterThanOrEqual(0);
    expect(metricIndex).toBeLessThan(synthesizingIndex);
  });
});

describe('runResearch — budget refusal', () => {
  it('refuses before creating any run, and states why', async () => {
    const deps = baseDeps({ checkBudget: () => Promise.resolve({ allowed: false, spentUsd: '350', ceilingUsd: '350', message: 'ceiling reached' }) });
    const outcome = await runResearch(INPUT, deps);
    expect(outcome).toEqual({ outcome: 'refused', reason: 'budget', message: 'ceiling reached' });
  });
});

describe('runResearch — abstention', () => {
  it('abstains when fewer than the usable-evidence floor is available, and never calls the model', async () => {
    let modelCalled = false;
    const thinPack: EvidencePack = {
      ...fullPack(),
      items: fullPack().items.slice(0, 1),
    };
    const deps = baseDeps({
      evidence: createFixtureEvidencePort(() => ({ pack: thinPack, fanOutTimedOut: false, classificationTimedOut: false, classifiedCount: 1 })),
      model: createFixtureModelClient(() => {
        modelCalled = true;
        return goodSynthesisOutput();
      }),
    });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('abstained');
    expect((outcome.run.result as { prose: unknown } | null)?.prose ?? null).toBeNull();
    expect(modelCalled).toBe(false);
  });
});

describe('runResearch — failure paths', () => {
  it('fails the run when evidence gathering throws', async () => {
    const deps = baseDeps({
      evidence: { gather: () => Promise.reject(new Error('provider outage')) },
    });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('failed');
    expect(outcome.run.result).toBeNull();
  });

  it('hard-fails the run when deterministic analysis exceeds its 1s budget', async () => {
    const deps = baseDeps({ metrics: createHangingMetricsPort() });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('failed');
  });
});

describe('runResearch — degraded (synthesis overrun)', () => {
  it('demotes to degraded, keeps metrics, and withholds prose', async () => {
    const deps = baseDeps({
      model: {
        classify: () => Promise.reject(new Error('unused')),
        synthesize: () => new Promise<never>(() => undefined),
        verify: () => Promise.reject(new Error('unused')),
      },
    });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('degraded');
    const result = outcome.run.result as { prose: unknown; metrics: unknown[] };
    expect(result.prose).toBeNull();
    expect(result.metrics.length).toBeGreaterThan(0);
  });
});

describe('runResearch — verification_failed', () => {
  it('withholds prose when a deterministic check fails, and records the offending claim as contradicted', async () => {
    const badOutput: SynthesisOutput = {
      ...goodSynthesisOutput(),
      whatToMonitor: [{ text: 'Also watch $AMD closely.', kind: 'hypothesis', evidenceIds: [ID_3], metricIds: [], assertsStanceForAxis: null }],
    };
    const deps = baseDeps({ model: createFixtureModelClient((task) => (task === 'synthesis' ? badOutput : allSupportedVerdict(7))) });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('verification_failed');
    expect((outcome.run.result as { prose: unknown } | null)?.prose ?? null).toBeNull();

    const claims = await deps.repo.listClaims(outcome.run.id);
    const flagged = claims.find((claim) => claim.claimText.includes('$AMD'));
    expect(flagged?.verificationStatus).toBe('contradicted');
  });

  it('withholds prose when the model verification pass reports a claim unsupported', async () => {
    const deps = baseDeps({
      model: createFixtureModelClient((task) => {
        if (task !== 'verify') return goodSynthesisOutput();
        const verdict = allSupportedVerdict(7);
        verdict.verdicts[0] = { claimIndex: 0, supported: false, rationale: 'does not follow' };
        return verdict;
      }),
    });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('verification_failed');
    expect((outcome.run.result as { prose: unknown } | null)?.prose ?? null).toBeNull();
  });

  it('withholds prose when the model verification pass times out', async () => {
    const deps = baseDeps({
      model: {
        classify: () => Promise.reject(new Error('unused')),
        synthesize: (() => Promise.resolve(goodSynthesisOutput())) as RunResearchDeps['model']['synthesize'],
        verify: () => new Promise<never>(() => undefined),
      },
    });
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');
    expect(outcome.run.status).toBe('verification_failed');
    expect((outcome.run.result as { prose: unknown } | null)?.prose ?? null).toBeNull();
  });
});

describe('runResearch — unverified prose can reach a user by no code path', () => {
  it('every non-complete outcome persists a null prose', async () => {
    const scenarios: Array<Partial<RunResearchDeps>> = [
      { checkBudget: () => Promise.resolve({ allowed: false, spentUsd: '1', ceilingUsd: '1', message: 'no' }) },
      { evidence: { gather: () => Promise.reject(new Error('down')) } },
      { metrics: createHangingMetricsPort() },
      { model: { classify: () => Promise.reject(new Error('x')), synthesize: () => new Promise<never>(() => undefined), verify: () => Promise.reject(new Error('x')) } },
    ];

    for (const overrides of scenarios) {
      const outcome = await runResearch(INPUT, baseDeps(overrides));
      if (outcome.outcome === 'refused') continue;
      const prose = (outcome.run.result as { prose: unknown } | null)?.prose ?? null;
      expect(prose).toBeNull();
    }
  });
});
