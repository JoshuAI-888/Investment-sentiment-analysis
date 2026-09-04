import {
  RNI_CITED_SYNTHESIS_CODE_VERSION,
  type RniCitationPublicationLineage,
  type RniChallengerAssessment,
  type RniCitedSynthesisRequest,
  type RniClaimAssessment,
  type RniSynthesisEvidenceReader,
} from '../../../../src/rni/agents';
import { convergePlatformFacts } from '../../../../src/rni/convergence';
import type { RniCitation, RniSourceItem } from '../../../../src/rni/contracts';
import {
  convergenceRequest,
  dimensions,
  nonPublishablePlatform,
  platformInput,
  RUN_ID,
  SECURITY_ID,
} from '../convergence/fixtures';

export { RUN_ID, SECURITY_ID };

export const SUMMARY_ID = '00000000-0000-4000-8000-000000000801';
export const MODEL_RUN_ID = '00000000-0000-4000-8000-000000000802';
export const REDDIT_CLAIM_ID = '00000000-0000-4000-8000-000000000811';
export const X_CLAIM_ID = '00000000-0000-4000-8000-000000000812';
export const REDDIT_CITATION_ID = '00000000-0000-4000-8000-000000000821';
export const X_CITATION_ID = '00000000-0000-4000-8000-000000000822';
export const COUNTER_CITATION_ID = '00000000-0000-4000-8000-000000000823';
export const REDDIT_VERIFICATION_CITATION_ID = '00000000-0000-4000-8000-000000000824';
export const X_VERIFICATION_CITATION_ID = '00000000-0000-4000-8000-000000000825';
export const REDDIT_SOURCE_ID = '00000000-0000-4000-8000-000000000831';
export const X_SOURCE_ID = '00000000-0000-4000-8000-000000000832';
export const COUNTER_SOURCE_ID = '00000000-0000-4000-8000-000000000833';
export const REDDIT_VERIFICATION_SOURCE_ID = '00000000-0000-4000-8000-000000000834';
export const X_VERIFICATION_SOURCE_ID = '00000000-0000-4000-8000-000000000835';

function source(input: {
  id: string;
  platform: 'reddit' | 'x';
  content: string;
  url: string;
  hashCharacter: string;
}): RniSourceItem {
  return {
    id: input.id,
    platform: input.platform,
    sourceKind: input.platform === 'reddit' ? 'post' : 'x_post',
    externalId: input.id,
    canonicalUrl: input.url,
    originalUrl: input.url,
    subredditOrScope: input.platform === 'reddit' ? 'stocks' : 'rni-query',
    authorHandleHash: null,
    title: null,
    boundedContent: input.content,
    contentSha256: input.hashCharacter.repeat(64),
    captureMode: 'full_post',
    publishedAt: '2026-09-05T10:00:00Z',
    discoveredAt: '2026-09-05T10:05:00Z',
    observedAt: '2026-09-05T10:05:00Z',
    searchQueryId: null,
    providerRequestId: `request-${input.id}`,
    metadata: {},
    rightsPolicyVersion: 'rights-v1',
    createdAt: '2026-09-05T10:05:00Z',
  };
}

export const REDDIT_SOURCE = source({
  id: REDDIT_SOURCE_ID,
  platform: 'reddit',
  content: 'NVDA data-center demand may be a positive catalyst next quarter.',
  url: 'https://www.reddit.com/r/stocks/comments/example/nvda_catalyst/',
  hashCharacter: 'a',
});
export const X_SOURCE = source({
  id: X_SOURCE_ID,
  platform: 'x',
  content: 'NVDA product execution remains constructive into the launch.',
  url: 'https://x.com/i/web/status/1000000000000000001',
  hashCharacter: 'b',
});
export const COUNTER_SOURCE = source({
  id: COUNTER_SOURCE_ID,
  platform: 'x',
  content: 'NVDA launch timing may slip because qualification is incomplete.',
  url: 'https://x.com/i/web/status/1000000000000000002',
  hashCharacter: 'c',
});
export const REDDIT_VERIFICATION_SOURCE = source({
  id: REDDIT_VERIFICATION_SOURCE_ID,
  platform: 'reddit',
  content: 'A separate persisted report confirms accelerating data-center orders.',
  url: 'https://www.reddit.com/r/stocks/comments/example/nvda_orders/',
  hashCharacter: 'd',
});
export const X_VERIFICATION_SOURCE = source({
  id: X_VERIFICATION_SOURCE_ID,
  platform: 'x',
  content: 'A separate persisted source confirms the product launch remains on schedule.',
  url: 'https://x.com/i/web/status/1000000000000000003',
  hashCharacter: 'e',
});

export const REDDIT_CITATION: RniCitation = {
  id: REDDIT_CITATION_ID,
  sourceItemId: REDDIT_SOURCE_ID,
  platform: 'reddit',
  url: REDDIT_SOURCE.originalUrl,
  evidenceText: 'data-center demand may be a positive catalyst',
};
export const X_CITATION: RniCitation = {
  id: X_CITATION_ID,
  sourceItemId: X_SOURCE_ID,
  platform: 'x',
  url: X_SOURCE.originalUrl,
  evidenceText: 'product execution remains constructive',
};
export const COUNTER_CITATION: RniCitation = {
  id: COUNTER_CITATION_ID,
  sourceItemId: COUNTER_SOURCE_ID,
  platform: 'x',
  url: COUNTER_SOURCE.originalUrl,
  evidenceText: 'launch timing may slip',
};
export const REDDIT_VERIFICATION_CITATION: RniCitation = {
  id: REDDIT_VERIFICATION_CITATION_ID,
  sourceItemId: REDDIT_VERIFICATION_SOURCE_ID,
  platform: 'reddit',
  url: REDDIT_VERIFICATION_SOURCE.originalUrl,
  evidenceText: 'confirms accelerating data-center orders',
};
export const X_VERIFICATION_CITATION: RniCitation = {
  id: X_VERIFICATION_CITATION_ID,
  sourceItemId: X_VERIFICATION_SOURCE_ID,
  platform: 'x',
  url: X_VERIFICATION_SOURCE.originalUrl,
  evidenceText: 'confirms the product launch remains on schedule',
};

export function evidenceReader(overrides: {
  citations?: ReadonlyMap<string, RniCitation>;
  sources?: ReadonlyMap<string, RniSourceItem>;
  lineage?: ReadonlyMap<string, RniCitationPublicationLineage>;
} = {}): RniSynthesisEvidenceReader {
  const citations = new Map([
      [REDDIT_CITATION_ID, REDDIT_CITATION],
      [X_CITATION_ID, X_CITATION],
      [COUNTER_CITATION_ID, COUNTER_CITATION],
      [REDDIT_VERIFICATION_CITATION_ID, REDDIT_VERIFICATION_CITATION],
      [X_VERIFICATION_CITATION_ID, X_VERIFICATION_CITATION],
    ]);
  for (const [id, citation] of overrides.citations ?? []) citations.set(id, citation);
  const sources = new Map([
      [REDDIT_SOURCE_ID, REDDIT_SOURCE],
      [X_SOURCE_ID, X_SOURCE],
      [COUNTER_SOURCE_ID, COUNTER_SOURCE],
      [REDDIT_VERIFICATION_SOURCE_ID, REDDIT_VERIFICATION_SOURCE],
      [X_VERIFICATION_SOURCE_ID, X_VERIFICATION_SOURCE],
    ]);
  for (const [id, persisted] of overrides.sources ?? []) sources.set(id, persisted);
  const lineage = new Map<string, RniCitationPublicationLineage>([
      [
        REDDIT_CITATION_ID,
        {
          citationId: REDDIT_CITATION_ID,
          runId: RUN_ID,
          securityId: SECURITY_ID,
          evidenceRole: 'social_claim' as const,
          analyticsArtifactHash: 'a'.repeat(64),
        },
      ],
      [
        X_CITATION_ID,
        {
          citationId: X_CITATION_ID,
          runId: RUN_ID,
          securityId: SECURITY_ID,
          evidenceRole: 'social_claim' as const,
          analyticsArtifactHash: 'b'.repeat(64),
        },
      ],
      [
        COUNTER_CITATION_ID,
        {
          citationId: COUNTER_CITATION_ID,
          runId: RUN_ID,
          securityId: SECURITY_ID,
          evidenceRole: 'counterevidence' as const,
          analyticsArtifactHash: null,
        },
      ],
      [
        REDDIT_VERIFICATION_CITATION_ID,
        {
          citationId: REDDIT_VERIFICATION_CITATION_ID,
          runId: RUN_ID,
          securityId: SECURITY_ID,
          evidenceRole: 'independent_verification' as const,
          analyticsArtifactHash: null,
        },
      ],
      [
        X_VERIFICATION_CITATION_ID,
        {
          citationId: X_VERIFICATION_CITATION_ID,
          runId: RUN_ID,
          securityId: SECURITY_ID,
          evidenceRole: 'independent_verification' as const,
          analyticsArtifactHash: null,
        },
      ],
    ]);
  for (const [id, persisted] of overrides.lineage ?? []) lineage.set(id, persisted);
  return {
    getCitationLineage: async (citationId) => {
      const persisted = lineage.get(citationId);
      if (persisted === undefined) throw new Error('citation lineage not found');
      return persisted;
    },
    getCitation: async (citationId) => {
      const citation = citations.get(citationId);
      if (citation === undefined) throw new Error('citation not found');
      return citation;
    },
    getEvidence: async (sourceItemId) => {
      const persisted = sources.get(sourceItemId);
      if (persisted === undefined) throw new Error('source not found');
      return persisted;
    },
  };
}

export function synthesisRequest(
  overrides: Partial<RniCitedSynthesisRequest> = {},
): RniCitedSynthesisRequest {
  return {
    codeVersion: RNI_CITED_SYNTHESIS_CODE_VERSION,
    policyVersion: 'rni-verification-policy-v1',
    summaryId: SUMMARY_ID,
    modelRunId: MODEL_RUN_ID,
    modelId: 'injected-eval-model',
    promptVersion: 'rni-synthesis-test-v1',
    createdAt: '2026-09-05T12:05:00Z',
    convergenceArtifact: convergePlatformFacts(convergenceRequest()),
    claims: [
      {
        id: REDDIT_CLAIM_ID,
        runId: RUN_ID,
        securityId: SECURITY_ID,
        platform: 'reddit',
        kind: 'catalyst',
        claimText: 'Data-center demand could support the next quarter.',
        sourceCitationIds: [REDDIT_CITATION_ID],
        verificationCutoffAt: '2026-09-05T12:00:00Z',
      },
      {
        id: X_CLAIM_ID,
        runId: RUN_ID,
        securityId: SECURITY_ID,
        platform: 'x',
        kind: 'catalyst',
        claimText: 'Product execution could support the launch.',
        sourceCitationIds: [X_CITATION_ID],
        verificationCutoffAt: '2026-09-05T12:00:00Z',
      },
    ],
    platformCitationIds: { reddit: [REDDIT_CITATION_ID], x: [X_CITATION_ID] },
    citationIds: [
      REDDIT_CITATION_ID,
      X_CITATION_ID,
      COUNTER_CITATION_ID,
      REDDIT_VERIFICATION_CITATION_ID,
      X_VERIFICATION_CITATION_ID,
    ],
    ...overrides,
  };
}

export function divergentSynthesisRequest(): RniCitedSynthesisRequest {
  return synthesisRequest({
    convergenceArtifact: convergePlatformFacts(
      convergenceRequest({
        x: platformInput('x', {
          stance: 'bearish',
          stanceScore: '-0.5',
          dimensions: dimensions('bearish', '-0.5'),
        }),
      }),
    ),
  });
}

export function pendingSynthesisRequest(): RniCitedSynthesisRequest {
  return synthesisRequest({
    convergenceArtifact: convergePlatformFacts(
      convergenceRequest({ x: nonPublishablePlatform('x', 'running') }),
    ),
  });
}

export function unavailableSynthesisRequest(): RniCitedSynthesisRequest {
  return synthesisRequest({
    convergenceArtifact: convergePlatformFacts(
      convergenceRequest({
        reddit: nonPublishablePlatform('reddit', 'unavailable'),
        x: nonPublishablePlatform('x', 'failed'),
      }),
    ),
    claims: [],
    platformCitationIds: { reddit: [], x: [] },
    citationIds: [],
  });
}

export const SUPPORTED_ASSESSMENTS: readonly RniClaimAssessment[] = [
  {
    claimId: REDDIT_CLAIM_ID,
    verdict: 'supported',
    supportingCitationIds: [REDDIT_VERIFICATION_CITATION_ID],
    contradictingCitationIds: [],
  },
  {
    claimId: X_CLAIM_ID,
    verdict: 'supported',
    supportingCitationIds: [X_VERIFICATION_CITATION_ID],
    contradictingCitationIds: [],
  },
];

export const NO_MATERIAL_CHALLENGE: RniChallengerAssessment = {
  verdict: 'no_supported_challenge_found',
  challengedClaimId: null,
  citationIds: [],
};
