import { describe, expect, it, vi } from 'vitest';

import {
  classifyAndCommitPersistedSource,
  type RniSemanticCommitRequest,
} from '../../../../src/rni/composition';
import type { RniSecurityMention, RniSourceItem } from '../../../../src/rni/contracts';
import type {
  RniClassificationPolicy,
  RniClassifierInferencePort,
  RniPersistedClassificationRequest,
} from '../../../../src/rni/observations';

const ids = {
  run: '00000000-0000-4000-8000-000000007001',
  source: '00000000-0000-4000-8000-000000007002',
  nvda: '00000000-0000-4000-8000-000000007003',
  amd: '00000000-0000-4000-8000-000000007004',
  nvdaMention: '00000000-0000-4000-8000-000000007005',
  amdMention: '00000000-0000-4000-8000-000000007006',
  classifierBatch: '00000000-0000-4000-8000-000000007007',
  nvdaObservation: '00000000-0000-4000-8000-000000007008',
  amdObservation: '00000000-0000-4000-8000-000000007009',
  nvdaClaim: '00000000-0000-4000-8000-000000007010',
  amdClaim: '00000000-0000-4000-8000-000000007011',
  nvdaCitation: '00000000-0000-4000-8000-000000007012',
  amdCitation: '00000000-0000-4000-8000-000000007013',
  executionTheme: '00000000-0000-4000-8000-000000007014',
  competitionTheme: '00000000-0000-4000-8000-000000007015',
} as const;

const content = 'NVDA has execution momentum; AMD is still catching up.';
const source: RniSourceItem = {
  id: ids.source,
  platform: 'reddit',
  sourceKind: 'post',
  externalId: 'i07-semantic-source',
  canonicalUrl: 'https://www.reddit.com/r/stocks/comments/i07semantic/topic/',
  originalUrl: 'https://www.reddit.com/r/stocks/comments/i07semantic/topic/?context=3',
  subredditOrScope: 'r/stocks',
  authorHandleHash: null,
  title: 'Semiconductor comparison',
  boundedContent: content,
  contentSha256: 'a'.repeat(64),
  captureMode: 'full_post',
  publishedAt: '2026-09-05T00:00:00.000Z',
  discoveredAt: '2026-09-05T00:05:00.000Z',
  observedAt: '2026-09-05T00:05:00.000Z',
  searchQueryId: null,
  providerRequestId: 'i07-semantic-source',
  metadata: {},
  rightsPolicyVersion: 'rni-source-policy-v1',
  createdAt: '2026-09-05T00:05:01.000Z',
};

const mentions: readonly RniSecurityMention[] = [
  {
    id: ids.nvdaMention,
    sourceItemId: ids.source,
    securityId: ids.nvda,
    mentionText: 'NVDA',
    startOffset: 0,
    endOffset: 4,
    resolutionMethod: 'exact_ticker',
    resolutionConfidence: '1',
    modelRunId: null,
  },
  {
    id: ids.amdMention,
    sourceItemId: ids.source,
    securityId: ids.amd,
    mentionText: 'AMD',
    startOffset: 29,
    endOffset: 32,
    resolutionMethod: 'exact_ticker',
    resolutionConfidence: '1',
    modelRunId: null,
  },
];

const policy: RniClassificationPolicy = {
  version: 'rni-classification-policy-v1',
  schemaVersion: 'rni-semantic-schema-v1',
  neutralMaxAbsoluteScore: '0.1',
  strongMinAbsoluteScore: '0.8',
  binaryLabelThreshold: '0.5',
};

const request: RniPersistedClassificationRequest = {
  sourceItemId: ids.source,
  mentions,
  taxonomy: {
    version: 'rni-themes-v1',
    categories: [
      {
        definitionId: ids.executionTheme,
        stableKey: 'execution',
        label: 'Execution quality',
        description: 'Claims about execution.',
        enabled: true,
        classificationThreshold: '0.7',
      },
      {
        definitionId: ids.competitionTheme,
        stableKey: 'competitive_positioning',
        label: 'Competitive positioning',
        description: 'Claims about competition.',
        enabled: true,
        classificationThreshold: '0.7',
      },
    ],
  },
  classificationPolicy: policy,
  classifierRunId: ids.classifierBatch,
  promptVersion: 'rni-classifier-v1',
  modelId: 'fixture-model',
  createdAt: '2026-09-05T00:06:00.000Z',
};

const dimensionKeys = [
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
] as const;

function classifiedOutput(input: {
  claimText: string;
  stableKey: 'execution' | 'competitive_positioning';
  stance: 'bullish' | 'bearish';
  score: string;
  supportStart: number;
  supportEnd: number;
}) {
  return {
    stance: input.stance,
    stanceScore: input.score,
    relevance: '0.95',
    claimSummary: input.claimText,
    timeHorizon: null,
    dimensions: dimensionKeys.map((dimension) =>
      dimension === 'company_fundamentals'
        ? {
            dimension,
            stance: input.stance,
            score: input.score,
            rationale: 'The source-bound claim supports this dimension.',
            supportStart: input.supportStart,
            supportEnd: input.supportEnd,
          }
        : {
            dimension,
            stance: 'insufficient' as const,
            score: null,
            rationale: 'No source-bound support for this dimension.',
            supportStart: null,
            supportEnd: null,
          },
    ),
    claims: [
      {
        dimension: 'company_fundamentals' as const,
        claimText: input.claimText,
        claimType: 'opinion' as const,
        epistemicStatus: 'source_claim' as const,
        supportStart: input.supportStart,
        supportEnd: input.supportEnd,
      },
    ],
    themes: [
      {
        stableKey: input.stableKey,
        stance: input.stance,
        score: input.score,
        classificationConfidence: '0.9',
        supportStart: input.supportStart,
        supportEnd: input.supportEnd,
      },
    ],
    noise: {
      supportStart: input.supportStart,
      supportEnd: input.supportEnd,
      isSarcastic: false,
      sarcasmProbability: '0.1',
      isMeme: false,
      memeProbability: '0.1',
      isSpam: false,
      spamProbability: '0.1',
      informationValue: '0.9',
      assertionStrength: '0.8',
      evidenceQuality: '0.8',
      uncertainty: '0.2',
      exclusionReason: null,
    },
  };
}

const outputs: Readonly<Record<string, unknown>> = {
  [ids.nvda]: classifiedOutput({
    claimText: 'NVDA is presented as executing well.',
    stableKey: 'execution',
    stance: 'bullish',
    score: '0.65',
    supportStart: 0,
    supportEnd: 27,
  }),
  [ids.amd]: classifiedOutput({
    claimText: 'AMD is presented as trailing NVDA.',
    stableKey: 'competitive_positioning',
    stance: 'bearish',
    score: '-0.45',
    supportStart: 29,
    supportEnd: content.length,
  }),
};

const observationIdFactory = ({ securityId }: { readonly securityId: string }) =>
  securityId === ids.nvda ? ids.nvdaObservation : ids.amdObservation;

describe('I07 semantic composition boundary', () => {
  it('classifies every security independently before one atomic semantic commit', async () => {
    const events: string[] = [];
    const inference: RniClassifierInferencePort = {
      infer: vi.fn(async ({ targetSecurityId }) => {
        events.push(`infer:${targetSecurityId}`);
        return outputs[targetSecurityId];
      }),
    };
    const commitClassification = vi.fn(async (input: RniSemanticCommitRequest) => {
      events.push('commit');
      expect(input.runId).toBe(ids.run);
      expect(input.sourceItemId).toBe(ids.source);
      expect(input.classification.observations).toHaveLength(2);
      expect(new Set(input.classification.observations.map(({ securityId }) => securityId))).toEqual(
        new Set([ids.nvda, ids.amd]),
      );
      expect(input.classification.claims).toHaveLength(2);
      return {
        disposition: 'inserted' as const,
        observationIds: [ids.nvdaObservation, ids.amdObservation],
        claimIds: [ids.nvdaClaim, ids.amdClaim],
        citationIds: [ids.nvdaCitation, ids.amdCitation],
      };
    });

    const result = await classifyAndCommitPersistedSource(
      { runId: ids.run, classification: request },
      {
        evidence: {
          getEvidence: vi.fn(async () => {
            events.push('read-evidence');
            return source;
          }),
        },
        inference,
        observationIdFactory,
        persistence: { commitClassification },
      },
    );

    expect(events[0]).toBe('read-evidence');
    expect(events.at(-1)).toBe('commit');
    expect(inference.infer).toHaveBeenCalledTimes(2);
    expect(commitClassification).toHaveBeenCalledOnce();
    expect(result.classification.observations.map(({ stance }) => stance).sort()).toEqual([
      'bearish',
      'bullish',
    ]);
    expect(result.persistence.disposition).toBe('inserted');
  });

  it('never writes a partial semantic result when one security classification fails', async () => {
    const commitClassification = vi.fn();
    const inference: RniClassifierInferencePort = {
      infer: vi.fn(async ({ targetSecurityId }) => {
        if (targetSecurityId === ids.amd) throw new Error('bounded model failure');
        return outputs[targetSecurityId];
      }),
    };

    await expect(
      classifyAndCommitPersistedSource(
        { runId: ids.run, classification: request },
        {
          evidence: { getEvidence: async () => source },
          inference,
          observationIdFactory,
          persistence: { commitClassification },
        },
      ),
    ).rejects.toThrow('bounded model failure');
    expect(commitClassification).not.toHaveBeenCalled();
  });

  it('rejects a non-durable run identity before reading evidence or invoking a model', async () => {
    const getEvidence = vi.fn();
    const infer = vi.fn();
    const commitClassification = vi.fn();

    await expect(
      classifyAndCommitPersistedSource(
        { runId: 'not-a-run-id', classification: request },
        {
          evidence: { getEvidence },
          inference: { infer },
          observationIdFactory,
          persistence: { commitClassification },
        },
      ),
    ).rejects.toThrow();
    expect(getEvidence).not.toHaveBeenCalled();
    expect(infer).not.toHaveBeenCalled();
    expect(commitClassification).not.toHaveBeenCalled();
  });
});
