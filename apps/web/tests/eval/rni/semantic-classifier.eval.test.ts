import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RniPlatform, RniStance } from '@/rni/contracts';
import {
  classifyPersistedSecurityObservations,
  type RniClassifierInferencePort,
} from '@/rni/observations';

const dimensionKeys = [
  'company_fundamentals',
  'market_trading',
  'catalyst_event',
  'retail_narrative',
] as const;

type GoldSecurity = {
  symbol: string;
  stance: Exclude<RniStance, 'insufficient'>;
  score: string;
  dimension: (typeof dimensionKeys)[number];
  themeStance?: Exclude<RniStance, 'insufficient'>;
  sarcastic?: boolean;
  meme?: boolean;
  claimType?: 'opinion' | 'question' | 'joke';
};

const cases: readonly {
  name: string;
  platform: RniPlatform;
  text: string;
  securities: readonly GoldSecurity[];
}[] = [
  {
    name: 'multi-security opposing stance',
    platform: 'reddit',
    text: 'AVGO execution is stronger while NVDA momentum is fading.',
    securities: [
      { symbol: 'AVGO', stance: 'bullish', score: '0.6', dimension: 'company_fundamentals' },
      { symbol: 'NVDA', stance: 'bearish', score: '-0.6', dimension: 'company_fundamentals' },
    ],
  },
  {
    name: 'bullish company but bearish trading setup',
    platform: 'x',
    text: 'LULU company execution is improving, but LULU stock looks overbought.',
    securities: [{ symbol: 'LULU', stance: 'bearish', score: '-0.4', dimension: 'market_trading' }],
  },
  {
    name: 'theme positive while security is negative',
    platform: 'reddit',
    text: 'AMD benefits from the AI theme, but AMD is still losing share.',
    securities: [
      {
        symbol: 'AMD',
        stance: 'bearish',
        score: '-0.55',
        dimension: 'retail_narrative',
        themeStance: 'bullish',
      },
    ],
  },
  {
    name: 'sarcastic meme retains explicit semantics',
    platform: 'reddit',
    text: 'GME will definitely acquire the moon tomorrow, obviously.',
    securities: [
      {
        symbol: 'GME',
        stance: 'bullish',
        score: '0.4',
        dimension: 'retail_narrative',
        sarcastic: true,
        meme: true,
        claimType: 'joke',
      },
    ],
  },
  {
    name: 'quoted disagreement remains the source claim',
    platform: 'x',
    text: 'TSLA reply: “bull case is dead?” No, TSLA margins can recover.',
    securities: [
      { symbol: 'TSLA', stance: 'bullish', score: '0.5', dimension: 'company_fundamentals' },
    ],
  },
];

function buildOutput(gold: GoldSecurity, contentLength: number) {
  const claimText = `${gold.symbol} classified source claim.`;
  return {
    stance: gold.stance,
    stanceScore: gold.score,
    relevance: '0.9',
    claimSummary: claimText,
    timeHorizon: null,
    dimensions: dimensionKeys.map((dimension) =>
      dimension === gold.dimension
        ? {
            dimension,
            stance: gold.stance,
            score: gold.score,
            rationale: 'Gold source span supports this assignment.',
            supportStart: 0,
            supportEnd: contentLength,
          }
        : {
            dimension,
            stance: 'insufficient' as const,
            score: null,
            rationale: 'No source-bound evidence for this dimension.',
            supportStart: null,
            supportEnd: null,
          },
    ),
    claims: [
      {
        dimension: gold.dimension,
        claimText,
        claimType: gold.claimType ?? ('opinion' as const),
        epistemicStatus: 'source_claim' as const,
        supportStart: 0,
        supportEnd: contentLength,
      },
    ],
    themes:
      gold.themeStance === undefined
        ? []
        : [
            {
              stableKey: 'ai_adoption',
              stance: gold.themeStance,
              score: gold.themeStance === 'bullish' ? '0.6' : '-0.6',
              classificationConfidence: '0.9',
              supportStart: 0,
              supportEnd: contentLength,
            },
          ],
    noise: {
      supportStart: 0,
      supportEnd: contentLength,
      isSarcastic: gold.sarcastic ?? false,
      sarcasmProbability: gold.sarcastic ? '0.9' : '0.1',
      isMeme: gold.meme ?? false,
      memeProbability: gold.meme ? '0.9' : '0.1',
      isSpam: false,
      spamProbability: '0.1',
      informationValue: gold.meme ? '0.3' : '0.85',
      assertionStrength: '0.8',
      evidenceQuality: '0.7',
      uncertainty: gold.sarcastic ? '0.8' : '0.2',
      exclusionReason: null,
    },
  };
}

describe('RNI classifier synthetic semantic eval', () => {
  it('preserves every per-security gold label across comparison, dimension, theme and noise cases', async () => {
    let checkedSecurities = 0;
    for (const testCase of cases) {
      const sourceItemId = randomUUID();
      const securityById = new Map<string, GoldSecurity>(
        testCase.securities.map((security) => [randomUUID(), security] as const),
      );
      const mentions = [...securityById].map(([securityId, security]) => {
        const startOffset = testCase.text.indexOf(security.symbol);
        return {
          id: randomUUID(),
          sourceItemId,
          securityId,
          mentionText: security.symbol,
          startOffset,
          endOffset: startOffset + security.symbol.length,
          resolutionMethod: 'exact_ticker' as const,
          resolutionConfidence: '1',
          modelRunId: null,
        };
      });
      const inference: RniClassifierInferencePort = {
        infer: vi.fn(async ({ targetSecurityId }) =>
          buildOutput(securityById.get(targetSecurityId)!, testCase.text.length),
        ),
      };
      const result = await classifyPersistedSecurityObservations(
        {
          sourceItemId,
          mentions,
          taxonomy: {
            version: 'rni-themes-eval-v1',
            categories: [
              {
                definitionId: randomUUID(),
                stableKey: 'ai_adoption',
                label: 'AI adoption',
                description: 'AI adoption claims.',
                enabled: true,
                classificationThreshold: '0.7',
              },
            ],
          },
          classificationPolicy: {
            version: 'rni-classification-eval-v1',
            schemaVersion: 'rni-semantic-schema-v1',
            neutralMaxAbsoluteScore: '0.1',
            strongMinAbsoluteScore: '0.8',
            binaryLabelThreshold: '0.5',
          },
          classifierRunId: randomUUID(),
          promptVersion: 'rni-classifier-eval-v1',
          modelId: 'synthetic-gold-fixture',
          createdAt: '2026-09-05T00:00:00.000Z',
        },
        {
          evidence: {
            getEvidence: vi.fn(async () => ({
              id: sourceItemId,
              platform: testCase.platform,
              sourceKind: testCase.platform === 'x' ? ('x_post' as const) : ('post' as const),
              externalId: testCase.name,
              canonicalUrl: `https://example.com/${encodeURIComponent(testCase.name)}`,
              originalUrl: `https://example.com/${encodeURIComponent(testCase.name)}?original=1`,
              subredditOrScope: testCase.platform === 'x' ? 'configured-x' : 'r/stocks',
              authorHandleHash: null,
              title: null,
              boundedContent: testCase.text,
              contentSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              captureMode: 'full_post' as const,
              publishedAt: null,
              discoveredAt: '2026-09-05T00:00:00.000Z',
              observedAt: '2026-09-05T00:00:00.000Z',
              searchQueryId: null,
              providerRequestId: null,
              metadata: {},
              rightsPolicyVersion: 'rni-source-policy-v1',
              createdAt: '2026-09-05T00:00:00.000Z',
            })),
          },
          inference,
          observationIdFactory: () => randomUUID(),
        },
      );

      for (const observation of result.observations) {
        const expected = securityById.get(observation.securityId)!;
        expect(observation.stance).toBe(expected.stance);
        expect(observation.dimensions.find(({ dimension }) => dimension === expected.dimension))
          .toMatchObject({ stance: expected.stance, score: expected.score });
        const semantic = result.noise.find(({ securityId }) => securityId === observation.securityId)!;
        expect(semantic.isSarcastic).toBe(expected.sarcastic ?? false);
        expect(semantic.isMeme).toBe(expected.meme ?? false);
        checkedSecurities += 1;
      }
      expect(inference.infer).toHaveBeenCalledTimes(testCase.securities.length);
      expect(result.citationProposals.every(({ platform }) => platform === testCase.platform)).toBe(
        true,
      );
    }
    expect(checkedSecurities).toBe(6);
  });
});
