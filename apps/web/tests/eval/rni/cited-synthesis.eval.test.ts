import { describe, expect, it, vi } from 'vitest';

import { synthesizeCitedNarrative } from '@/rni/agents';
import {
  COUNTER_CITATION_ID,
  divergentSynthesisRequest,
  evidenceReader,
  NO_MATERIAL_CHALLENGE,
  REDDIT_CITATION_ID,
  REDDIT_CLAIM_ID,
  SUPPORTED_ASSESSMENTS,
  synthesisRequest,
  X_CLAIM_ID,
  X_VERIFICATION_CITATION_ID,
} from '../../unit/rni/agents/fixtures';

const cases = [
  {
    name: 'supported aligned',
    request: synthesisRequest(),
    verification: SUPPORTED_ASSESSMENTS,
    challenger: NO_MATERIAL_CHALLENGE,
    expectedCombinedStatus: 'complete',
    expectedFact: 'align',
  },
  {
    name: 'supported divergent with strongest countercase',
    request: divergentSynthesisRequest(),
    verification: [
      {
        claimId: REDDIT_CLAIM_ID,
        verdict: 'contradicted',
        supportingCitationIds: [],
        contradictingCitationIds: [COUNTER_CITATION_ID],
      },
      {
        claimId: X_CLAIM_ID,
        verdict: 'supported',
        supportingCitationIds: [X_VERIFICATION_CITATION_ID],
        contradictingCitationIds: [],
      },
    ],
    challenger: {
      verdict: 'material_challenge',
      challengedClaimId: REDDIT_CLAIM_ID,
      citationIds: [COUNTER_CITATION_ID],
    },
    expectedCombinedStatus: 'complete',
    expectedFact: 'diverge',
  },
] as const;

describe('RNI cited-synthesis synthetic eval', () => {
  it.each(cases)(
    '$name remains platform-separated, citation-complete and exact',
    async ({ request, verification, challenger, expectedCombinedStatus, expectedFact }) => {
      const artifact = await synthesizeCitedNarrative(
        request,
        evidenceReader(),
        { verify: vi.fn(async () => ({ assessments: verification })) },
        { challenge: vi.fn(async () => challenger) },
      );
      expect(artifact.result.summary.status).toBe(expectedCombinedStatus);
      expect(artifact.result.summary.sections[2]?.text).toContain(expectedFact);
      expect(artifact.result.platformConclusions).toEqual(
        request.convergenceArtifact.result.platforms,
      );
      expect(
        artifact.result.statements.every(
          ({ origin, citationIds }) => origin === 'coverage_disclosure' || citationIds.length > 0,
        ),
      ).toBe(true);
      expect(artifact.result.summary.sections[0]?.citationIds).toContain(REDDIT_CITATION_ID);
    },
  );
});
