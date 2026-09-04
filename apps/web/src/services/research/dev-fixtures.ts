/**
 * A minimal, self-contained fixture wiring for `PROVIDER_MODE=fixture` — the mode CI and local
 * development run in (`05-TEST-STRATEGY.md` §2). Stands in for F10's evidence-gathering service
 * and a real "list this security's metrics" query, **neither of which exists yet**
 * (`ports.ts`'s docstring; reported under `CONTRACTS`). This is what lets `POST /api/research`
 * demonstrate the full state machine end to end today rather than only in unit tests, without
 * pretending any of it is real retrieval or a real model call.
 *
 * Deliberately generic — it does not read the requested security at all beyond echoing its id
 * back into the pack, and it carries no metrics, so the eight deterministic checks never have a
 * numeric token to fail on. **This is not a corpus fixture** in the `apps/web/fixtures/<provider>/`
 * sense (`05-TEST-STRATEGY.md` §2); it is a placeholder for two whole missing integrations, named
 * as such rather than dressed up as one.
 */
import type {
  EvidenceGatheringPort,
  EvidenceGatheringResult,
  EvidenceQuery,
  MetricRef,
  MetricsLookupPort,
  ModelClient,
} from './ports';
import { createFixtureModelClient } from './model-client';
import type { SynthesisOutput } from './synthesis';

function fixtureItem(id: string, securityId: string, availableAt: Date, ingestedAt: Date) {
  return {
    id,
    securityId,
    evidenceType: 'social_result' as const,
    provider: 'reddit',
    title: 'Placeholder evidence item (F10 not yet integrated)',
    snippet: 'This item stands in for real evidence retrieval, which F10 owns.',
    sourceUrl: null,
    publisher: null,
    authorRef: null,
    stanceLabel: 'neutral' as const,
    stanceScore: '0',
    relevanceScore: '0.5',
    publishedAt: availableAt,
    availableAt,
    ingestedAt,
    lastCheckedAt: null,
    availability: 'available' as const,
    licenseClass: 'standard',
    coverageClass: 'sampled',
    rawHash: 'f'.repeat(64),
    metadata: {},
  };
}

export function createDevFixtureEvidencePort(): EvidenceGatheringPort {
  return {
    gather(query: EvidenceQuery): Promise<EvidenceGatheringResult> {
      const idA = `00000000-0000-0000-0000-0000000000${query.securityId.slice(0, 2)}`.slice(0, 36);
      const idB = `00000000-0000-0000-0000-0000000001${query.securityId.slice(0, 2)}`.slice(0, 36);
      const idC = `00000000-0000-0000-0000-0000000002${query.securityId.slice(0, 2)}`.slice(0, 36);
      const items = [
        { id: idA, at: new Date(query.window.from.getTime() + 1000) },
        { id: idB, at: new Date(query.window.to.getTime() - 2000) },
        { id: idC, at: new Date(query.window.to.getTime() - 1000) },
      ];
      return Promise.resolve({
        pack: {
          id: '00000000-0000-0000-0000-000000000fff',
          securityId: query.securityId,
          retrievalQuery: `security_id = ${query.securityId} (dev fixture)`,
          retrievalWindow: query.window,
          items: items.map(({ id, at }) => ({
            item: fixtureItem(id, query.securityId, at, at),
            axis: 'reddit' as const,
            relevant: true,
            relevanceMethodVersion: 'dev-fixture@1',
            stanceConfidence: null,
            flags: [],
            excludedReason: null,
          })),
          frames: [
            {
              axis: 'reddit' as const,
              frameStatement: 'observed sample of comments from the subreddits polled — not a sample of retail investors.',
              window: query.window,
              retrievedCount: items.length,
              usedCount: items.length,
            },
          ],
          createdAt: new Date(),
        },
        fanOutMs: 0,
        fanOutTimedOut: false,
        classificationMs: 0,
        classificationTimedOut: false,
        classifiedCount: items.length,
      } as unknown as EvidenceGatheringResult);
    },
  };
}

export function createDevFixtureMetricsPort(): MetricsLookupPort {
  return {
    forSecurity(): Promise<readonly MetricRef[]> {
      return Promise.resolve([]);
    },
  };
}

function devFixtureSynthesisOutput(): SynthesisOutput {
  return {
    summary: [
      {
        text: 'No real evidence integration is wired yet — this is a placeholder synthesis.',
        kind: 'interpretation',
        evidenceIds: [],
        metricIds: [],
        assertsStanceForAxis: null,
      },
    ],
    themes: [],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [
      {
        text: 'This route will produce a real answer once F10 lands.',
        kind: 'hypothesis',
        evidenceIds: [],
        metricIds: [],
        assertsStanceForAxis: null,
      },
    ],
    statedFreshnessAsOf: new Date().toISOString(),
  } as unknown as SynthesisOutput;
}

/** `verify` always reports the placeholder claims as supported — there is nothing substantive to contradict. */
export function createDevFixtureModelClient(onUsage?: Parameters<typeof createFixtureModelClient>[1]): ModelClient {
  return createFixtureModelClient((task) => {
    if (task === 'synthesis') return devFixtureSynthesisOutput();
    return { verdicts: [{ claimIndex: 0, supported: true, rationale: 'placeholder' }] };
  }, onUsage);
}
