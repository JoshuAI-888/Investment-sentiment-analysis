import { describe, expect, it, vi } from 'vitest';
import { rniSecurityObservation } from '@/rni/contracts';
import * as publicObservations from '@/rni/observations';
import {
  classifyPersistedSecurityObservations,
  type RniClassifierInferencePort,
} from '@/rni/observations';
import {
  comparativeMentions,
  comparativeSource,
  rniFixtureIds,
} from '@/rni/testing/reference-fixtures';

const themeDefinitionId = '00000000-0000-4000-8000-000000000721';
const observationIds: Readonly<Record<string, string>> = {
  [rniFixtureIds.nvda]: rniFixtureIds.nvdaObservation,
  [rniFixtureIds.amd]: rniFixtureIds.amdObservation,
};

const dimensionKeys = [
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
] as const;

function proposal(targetSecurityId: string) {
  const isNvda = targetSecurityId === rniFixtureIds.nvda;
  const supportStart = isNvda ? 0 : 29;
  const supportEnd = isNvda ? 27 : comparativeSource.boundedContent.length;
  const stance = isNvda ? ('bullish' as const) : ('bearish' as const);
  const score = isNvda ? '0.65' : '-0.45';
  const claimText = isNvda
    ? 'NVDA is presented as executing well.'
    : 'AMD is presented as trailing NVDA.';
  return {
    stance,
    stanceScore: score,
    relevance: '0.95',
    claimSummary: claimText,
    timeHorizon: null,
    dimensions: dimensionKeys.map((dimension) =>
      dimension === 'company_fundamentals'
        ? {
            dimension,
            stance,
            score,
            rationale: 'The source comparison supports this assignment.',
            supportStart,
            supportEnd,
          }
        : {
            dimension,
            stance: 'insufficient' as const,
            score: null,
            rationale: 'No source-bound support.',
            supportStart: null,
            supportEnd: null,
          },
    ),
    claims: [
      {
        dimension: 'company_fundamentals' as const,
        claimText,
        claimType: 'opinion' as const,
        epistemicStatus: 'source_claim' as const,
        supportStart,
        supportEnd,
      },
    ],
    themes: [
      {
        stableKey: 'execution',
        stance,
        score,
        classificationConfidence: '0.9',
        supportStart,
        supportEnd,
      },
    ],
    noise: {
      supportStart,
      supportEnd,
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

describe('RNI semantic classifier frozen boundary', () => {
  it('returns one frozen four-dimension observation per security with source-bound citation proposals', async () => {
    const inference: RniClassifierInferencePort = {
      infer: vi.fn(async ({ targetSecurityId }) => proposal(targetSecurityId)),
    };
    const getEvidence = vi.fn(async () => comparativeSource);
    const result = await classifyPersistedSecurityObservations(
      {
        sourceItemId: comparativeSource.id,
        mentions: comparativeMentions,
        taxonomy: {
          version: 'rni-themes-v1',
          categories: [
            {
              definitionId: themeDefinitionId,
              stableKey: 'execution',
              label: 'Execution',
              description: 'Execution quality claims.',
              enabled: true,
              classificationThreshold: '0.7',
            },
          ],
        },
        classificationPolicy: {
          version: 'rni-classification-policy-v1',
          schemaVersion: 'rni-semantic-schema-v1',
          neutralMaxAbsoluteScore: '0.1',
          strongMinAbsoluteScore: '0.8',
          binaryLabelThreshold: '0.5',
        },
        classifierRunId: rniFixtureIds.classifierRun,
        promptVersion: 'rni-classifier-v1',
        modelId: 'fixture-model',
        createdAt: '2026-09-05T00:06:00.000Z',
      },
      {
        evidence: { getEvidence },
        inference,
        observationIdFactory: ({ securityId }) => observationIds[securityId]!,
      },
    );

    expect(result.observations.map((observation) => rniSecurityObservation.parse(observation)))
      .toHaveLength(2);
    expect(result.observations).toMatchObject([
      { securityId: rniFixtureIds.nvda, stance: 'bullish' },
      { securityId: rniFixtureIds.amd, stance: 'bearish' },
    ]);
    expect(result.observations.every(({ dimensions }) => dimensions.length === 4)).toBe(true);
    expect(result.citationProposals).toHaveLength(2);
    expect(result.citationProposals.every((citation) =>
      citation.url === comparativeSource.originalUrl &&
      comparativeSource.boundedContent.slice(citation.startOffset, citation.endOffset) ===
        citation.evidenceText,
    )).toBe(true);
    expect(getEvidence).toHaveBeenCalledWith(comparativeSource.id);
    expect(inference.infer).toHaveBeenCalledTimes(2);
  });

  it('publishes no raw-content classifier entry or DATA persistence adapter', () => {
    expect(publicObservations).toHaveProperty('classifyPersistedSecurityObservations');
    expect(publicObservations).not.toHaveProperty('classifySecurityObservations');
    expect(publicObservations).not.toHaveProperty('persistClassifiedObservations');
  });
});
