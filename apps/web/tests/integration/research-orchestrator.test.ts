/**
 * F11's integration-level test plan item: "run persists and replays from events after a
 * simulated reload; a synthesis timeout yields `degraded` with metrics intact; a verifier
 * timeout yields `verification_failed` with prose withheld; retraction propagates to every
 * render surface."
 *
 * **What this suite can and cannot prove, stated plainly rather than left implicit.** Unlike
 * this repo's other `tests/integration/*` files, this one does not gate on `DATABASE_URL` —
 * there is nothing to skip, because `src/repositories/research.ts` does not exist yet
 * (`ports.ts`'s docstring; reported under this lane's `CONTRACTS` gap). What runs here is the
 * full orchestrator → verifier → claim-ledger → repository-port pipeline wired to the in-memory
 * `ResearchRepositoryPort` (`services/research/testing.ts`), which is a faithful integration
 * test of every module this lane owns *composed together*, but not of Postgres persistence,
 * transactions, or crash recovery. That gap is real and is called out in the build report.
 */
import { describe, expect, it } from 'vitest';
import { runResearch, type RunResearchDeps } from '../../src/services/research/orchestrator';
import {
  createFakeClock,
  createFixtureEvidencePort,
  createFixtureMetricsPort,
  createInMemoryAuditLog,
  createInMemoryResearchRepository,
} from '../../src/services/research/testing';
import { createFixtureModelClient } from '../../src/services/research/model-client';
import { replayStreamEvents } from '../../src/services/research/stream-events';
import { retractRun } from '../../src/services/research/retraction';
import type { EvidencePack } from '../../src/contracts/evidence-pack';
import type { MetricRef } from '../../src/services/research/ports';
import type { SynthesisOutput } from '../../src/services/research/synthesis';

const SECURITY_ID = '44444444-4444-4444-4444-444444444444';
const ID_1 = '11111111-1111-1111-1111-111111111111';
const ID_2 = '22222222-2222-2222-2222-222222222222';
const ID_3 = '33333333-3333-3333-3333-333333333333';

function evidenceItem(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    securityId: SECURITY_ID,
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
    securityId: SECURITY_ID,
    retrievalQuery: `security_id = ${SECURITY_ID}`,
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
  return { verdicts: Array.from({ length: claimCount }, (_, index) => ({ claimIndex: index, supported: true, rationale: 'follows' })) };
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

const INPUT = { userId: 'user-1', securityId: SECURITY_ID, securitySymbol: 'NVDA', question: 'What is happening with NVDA?' };

/**
 * **Naming correction (lane-review finding 3).** This does not prove "a run survives reload" in
 * the production sense — it reads back from the *same* in-memory repository instance within one
 * process, so it proves `replayStreamEvents` reconstructs order from stored rows correctly, not
 * that the data outlives a process restart (two consecutive requests on a real deploy can land on
 * different serverless instances entirely). That claim is DEFERRED in this lane's build report,
 * gated on `src/repositories/research.ts` existing — this suite is one layer down from it:
 * ordering/replay correctness, which the real repository will still need once it exists.
 */
describe('replayed events reconstruct a run\'s full stage sequence (not a claim that a run survives a real process restart — see this block\'s own comment)', () => {
  it('reconstructs the full stage sequence from persisted events alone, independent of the run object', async () => {
    const deps = baseDeps();
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');

    // "Simulated reload": a fresh read from the repository, exactly what `GET
    // /api/research/:runId/stream` does — no reference to anything the orchestrator call itself
    // still held in memory.
    const persistedEvents = await deps.repo.listEvents(outcome.run.id);
    const replayed = replayStreamEvents(persistedEvents);

    // Stage order, not an exact event count (the exact count is an implementation detail — e.g.
    // one event per claim under "complete" — that this test should not pin in place).
    const stageOrder = ['queued', 'gathering', 'analyzing', 'synthesizing', 'verifying', 'complete'];
    const firstIndexOf = (label: string) => persistedEvents.findIndex((event) => event.label === label);
    const indices = stageOrder.map(firstIndexOf);
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));

    // Sequence numbers are contiguous from 0 — the ordering guarantee a reload's replay depends on.
    expect(persistedEvents.map((event) => event.sequence)).toEqual(persistedEvents.map((_, index) => index));
    expect(replayed.map((event) => event.sequence)).toEqual(persistedEvents.map((event) => event.sequence));

    // The run row itself is independently readable through the same repository instance too —
    // within this process, a caller reaches the identical state whichever of the two it reads.
    const reloadedRun = await deps.repo.getRun(outcome.run.id);
    expect(reloadedRun?.status).toBe('complete');
  });
});

describe('a synthesis timeout yields degraded with metrics intact', () => {
  it('persists metrics via events and the run result, with prose withheld', async () => {
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

    const events = await deps.repo.listEvents(outcome.run.id);
    const metricEvents = events.filter((event) => (event.payload as { kind?: string }).kind === 'metric');
    expect(metricEvents.length).toBeGreaterThan(0);

    const result = outcome.run.result as { prose: unknown; metrics: unknown[] };
    expect(result.prose).toBeNull();
    expect(result.metrics.length).toBeGreaterThan(0);
  });
});

describe('a verifier timeout yields verification_failed with prose withheld', () => {
  it('persists a claim ledger with every claim withheld, and no prose in the run result', async () => {
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

    const claims = await deps.repo.listClaims(outcome.run.id);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((claim) => claim.verificationStatus === 'withheld')).toBe(true);
  });
});

describe('retraction propagates to every render surface this lane owns', () => {
  it('is visible on a fresh repository read, and deletes nothing', async () => {
    const deps = baseDeps();
    const outcome = await runResearch(INPUT, deps);
    if (outcome.outcome !== 'ok') throw new Error('expected ok');

    const claimsBefore = await deps.repo.listClaims(outcome.run.id);
    const eventsBefore = await deps.repo.listEvents(outcome.run.id);

    await retractRun(deps.repo, deps.clock, createInMemoryAuditLog(), {
      runId: outcome.run.id,
      reason: 'contained a stale figure',
      actor: 'admin-1',
      expectedStatus: outcome.run.status,
    });

    // "Every render surface" this lane owns is `repo.getRun` — the one read every route and any
    // future UI this feature grows must go through, so a retraction here is a retraction
    // everywhere those callers look. What this test cannot prove is a UI surface it does not
    // own actually calling this read path; that is named under this build's RISKS.
    const reread = await deps.repo.getRun(outcome.run.id);
    expect(reread?.status).toBe('retracted');
    expect(reread?.retractedReason).toBe('contained a stale figure');

    const claimsAfter = await deps.repo.listClaims(outcome.run.id);
    const eventsAfter = await deps.repo.listEvents(outcome.run.id);
    expect(claimsAfter).toHaveLength(claimsBefore.length);
    expect(eventsAfter.length).toBeGreaterThan(eventsBefore.length); // the retraction event was appended, nothing removed
  });
});
