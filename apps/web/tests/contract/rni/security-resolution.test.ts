import { describe, expect, it, vi } from 'vitest';
import * as publicObservations from '@/rni/observations';
import {
  comparativeMentions,
  comparativeRelation,
  comparativeSource,
  rniFixtureIds,
} from '@/rni/testing/reference-fixtures';
import {
  resolvePersistedSourceSecurities,
  type RniBareTickerAmbiguityPolicy,
  type RniRelationshipInferencePort,
  type RniSecurityResolutionCandidate,
} from '@/rni/observations';

const ambiguityPolicy: RniBareTickerAmbiguityPolicy = {
  version: 'rni-test-ambiguity-v1',
  bareTickerSymbols: ['A', 'AI', 'IT', 'ON'],
};

const securities: readonly RniSecurityResolutionCandidate[] = [
  {
    id: rniFixtureIds.nvda,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    aliases: ['NVIDIA'],
    active: true,
  },
  {
    id: rniFixtureIds.amd,
    symbol: 'AMD',
    name: 'Advanced Micro Devices, Inc.',
    exchange: 'NASDAQ',
    aliases: ['Advanced Micro Devices'],
    active: true,
  },
];

describe('RNI multi-security frozen-contract fixture', () => {
  it('resolves the canonical NVDA/AMD mentions and one cited preference relation', async () => {
    const relationshipInference: RniRelationshipInferencePort = {
      infer: vi.fn(async () => ({
        relationships: [
          {
            subjectSecurityId: rniFixtureIds.nvda,
            relation: 'preferred_over',
            objectSecurityId: rniFixtureIds.amd,
            evidenceStart: 0,
            evidenceEnd: comparativeSource.boundedContent.length,
          },
        ],
      })),
    };
    const getEvidence = vi.fn(async () => comparativeSource);
    const result = await resolvePersistedSourceSecurities(
      {
        sourceItemId: comparativeSource.id,
        candidates: securities,
        ambiguityPolicy,
      },
      {
        evidence: { getEvidence },
        mentionIdFactory: ({ securityId }) =>
          securityId === rniFixtureIds.nvda
            ? rniFixtureIds.nvdaMention
            : rniFixtureIds.amdMention,
        relationshipIdFactory: () => rniFixtureIds.relation,
        relationshipInference,
      },
    );

    expect(result).toEqual({
      mentions: comparativeMentions,
      unresolved: [],
      relationships: [comparativeRelation],
      relationshipInferenceInvoked: true,
    });
    expect(getEvidence).toHaveBeenCalledWith(comparativeSource.id);
    expect(relationshipInference.infer).toHaveBeenCalledWith({
      sourceItemId: comparativeSource.id,
      boundedContent: comparativeSource.boundedContent,
      mentions: comparativeMentions,
      candidates: securities,
    });
  });

  it('exposes committed-evidence interpretation as the only public model-capable entry', () => {
    expect(publicObservations).toHaveProperty('resolvePersistedSourceSecurities');
    expect(publicObservations).not.toHaveProperty('resolveSourceSecurities');
    expect(publicObservations).not.toHaveProperty('inferComparativeRelations');
  });

  it('fails before inference when the source identity is not a committed UUID', async () => {
    const relationshipInference: RniRelationshipInferencePort = {
      infer: vi.fn(async () => ({ relationships: [] })),
    };
    await expect(
      resolvePersistedSourceSecurities(
        {
          sourceItemId: 'caller-proposed-or-missing-id',
          candidates: securities,
          ambiguityPolicy,
        },
        {
          evidence: { getEvidence: vi.fn(async () => comparativeSource) },
          mentionIdFactory: () => rniFixtureIds.nvdaMention,
          relationshipIdFactory: () => rniFixtureIds.relation,
          relationshipInference,
        },
      ),
    ).rejects.toThrow();
    expect(relationshipInference.infer).not.toHaveBeenCalled();
  });
});
