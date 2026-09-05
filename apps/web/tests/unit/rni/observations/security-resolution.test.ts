import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RniSecurityMention } from '@/rni/contracts';
import {
  resolvePersistedSourceSecurities,
  resolveSecurityMentions,
  type RniBareTickerAmbiguityPolicy,
  type RniMentionIdFactory,
  type RniRelationshipIdFactory,
  type RniRelationshipInferencePort,
  type RniSecurityResolutionCandidate,
} from '@/rni/observations';
import { inferComparativeRelations } from '@/rni/observations/relationships';

const sourceItemId = '00000000-0000-4000-8000-000000000501';
const nvdaId = '00000000-0000-4000-8000-000000000502';
const amdId = '00000000-0000-4000-8000-000000000503';
const aiId = '00000000-0000-4000-8000-000000000504';
const ambiguityPolicy: RniBareTickerAmbiguityPolicy = {
  version: 'rni-test-ambiguity-v1',
  bareTickerSymbols: ['A', 'AI', 'IT', 'ON'],
};

function security(
  overrides: Partial<RniSecurityResolutionCandidate> = {},
): RniSecurityResolutionCandidate {
  return {
    id: nvdaId,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    aliases: ['NVIDIA'],
    active: true,
    ...overrides,
  };
}

const nvda = security();
const amd = security({
  id: amdId,
  symbol: 'AMD',
  name: 'Advanced Micro Devices, Inc.',
  aliases: ['Advanced Micro Devices'],
});
const ai = security({
  id: aiId,
  symbol: 'AI',
  name: 'C3.ai, Inc.',
  aliases: ['C3.ai'],
});

const mentionIdFactory: RniMentionIdFactory = () => randomUUID();
const relationshipIdFactory: RniRelationshipIdFactory = () => randomUUID();

function mention(
  securityId: string,
  mentionText: string,
  startOffset: number,
  endOffset: number,
): RniSecurityMention {
  return {
    id: randomUUID(),
    sourceItemId,
    securityId,
    mentionText,
    startOffset,
    endOffset,
    resolutionMethod: 'exact_ticker',
    resolutionConfidence: '1',
    modelRunId: null,
  };
}

function inference(output: unknown): RniRelationshipInferencePort {
  return { infer: vi.fn(async () => output) };
}

describe('deterministic RNI security mention resolution', () => {
  it('resolves every exact ticker in the NVDA/AMD comparative source with exact offsets', () => {
    const content = 'NVDA has execution momentum; AMD is still catching up.';
    const result = resolveSecurityMentions(
      { sourceItemId, boundedContent: content, candidates: [nvda, amd], ambiguityPolicy },
      mentionIdFactory,
    );

    expect(result.mentions).toMatchObject([
      {
        sourceItemId,
        securityId: nvdaId,
        mentionText: 'NVDA',
        startOffset: 0,
        endOffset: 4,
        resolutionMethod: 'exact_ticker',
      },
      {
        sourceItemId,
        securityId: amdId,
        mentionText: 'AMD',
        startOffset: 29,
        endOffset: 32,
        resolutionMethod: 'exact_ticker',
      },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('accepts lowercase cashtags but does not treat lowercase bare prose as a ticker', () => {
    const content = '$nvda over amd, not plain nvda.';
    const result = resolveSecurityMentions(
      { sourceItemId, boundedContent: content, candidates: [nvda, amd], ambiguityPolicy },
      mentionIdFactory,
    );

    expect(result.mentions).toMatchObject([
      { securityId: nvdaId, mentionText: '$nvda', startOffset: 0, endOffset: 5 },
    ]);
  });

  it('resolves exact company aliases case-insensitively', () => {
    const content = 'nvidia leads Advanced Micro Devices on execution.';
    const result = resolveSecurityMentions(
      { sourceItemId, boundedContent: content, candidates: [nvda, amd], ambiguityPolicy },
      mentionIdFactory,
    );

    expect(result.mentions).toMatchObject([
      { securityId: nvdaId, mentionText: 'nvidia', resolutionMethod: 'company_alias' },
      {
        securityId: amdId,
        mentionText: 'Advanced Micro Devices',
        resolutionMethod: 'company_alias',
      },
    ]);
  });

  it('abstains on a configured common-word ticker unless it is cashtagged', () => {
    const bare = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: 'AI is moving quickly.',
        candidates: [ai],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );
    const tagged = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: '$ai is moving quickly.',
        candidates: [ai],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );

    expect(bare.mentions).toEqual([]);
    expect(bare.unresolved).toEqual([
      {
        mentionText: 'AI',
        startOffset: 0,
        endOffset: 2,
        reason: 'cashtag_required',
        candidateSecurityIds: [aiId],
      },
    ]);
    expect(tagged.mentions).toMatchObject([{ securityId: aiId, mentionText: '$ai' }]);
  });

  it('uses the required governed ambiguity policy for A and IT instead of a partial default', () => {
    const a = security({
      id: '00000000-0000-4000-8000-000000000506',
      symbol: 'A',
      name: 'Agilent Technologies, Inc.',
      aliases: ['Agilent'],
    });
    const it = security({
      id: '00000000-0000-4000-8000-000000000507',
      symbol: 'IT',
      name: 'Gartner, Inc.',
      aliases: ['Gartner'],
    });
    const result = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: 'A company said IT is improving.',
        candidates: [a, it],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );

    expect(result.mentions).toEqual([]);
    expect(result.unresolved).toMatchObject([
      { mentionText: 'A', reason: 'cashtag_required' },
      { mentionText: 'IT', reason: 'cashtag_required' },
    ]);
  });

  it('fails closed when the governed ambiguity policy is absent', () => {
    const requestWithoutPolicy = {
      sourceItemId,
      boundedContent: 'NVDA remains strong.',
      candidates: [nvda],
    } as unknown as Parameters<typeof resolveSecurityMentions>[0];

    expect(() => resolveSecurityMentions(requestWithoutPolicy, mentionIdFactory)).toThrow();
  });

  it('abstains when the same symbol maps to multiple active securities', () => {
    const otherAi = security({
      id: '00000000-0000-4000-8000-000000000505',
      symbol: 'AI',
      name: 'Artificial Intelligence Holdings',
      exchange: 'NYSE',
      aliases: [],
    });
    const result = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: '$AI rallies.',
        candidates: [ai, otherAi],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );

    expect(result.mentions).toEqual([]);
    expect(result.unresolved).toMatchObject([
      {
        mentionText: '$AI',
        reason: 'ambiguous_match',
        candidateSecurityIds: [aiId, otherAi.id],
      },
    ]);
  });

  it('ignores inactive candidates and emits no guessed mention', () => {
    const result = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: 'NVDA remains strong.',
        candidates: [security({ active: false })],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );
    expect(result).toEqual({ mentions: [], unresolved: [] });
  });

  it('prefers the longest overlapping alias for one security', () => {
    const result = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: 'Advanced Micro Devices is catching up.',
        candidates: [security({ ...amd, aliases: ['Advanced Micro Devices', 'Micro Devices'] })],
        ambiguityPolicy,
      },
      mentionIdFactory,
    );
    expect(result.mentions).toMatchObject([
      { securityId: amdId, mentionText: 'Advanced Micro Devices' },
    ]);
  });

  it('preserves repeated non-overlapping mentions as distinct occurrences', () => {
    const factory = vi.fn<RniMentionIdFactory>(() => randomUUID());
    const result = resolveSecurityMentions(
      {
        sourceItemId,
        boundedContent: 'NVDA versus NVDA peers.',
        candidates: [nvda],
        ambiguityPolicy,
      },
      factory,
    );
    expect(result.mentions.map((item) => item.startOffset)).toEqual([0, 12]);
    expect(factory.mock.calls.map(([input]) => input.occurrence)).toEqual([0, 1]);
  });
});

describe('RNI comparative relationship validation', () => {
  const content = 'NVDA has execution momentum; AMD is still catching up.';
  const mentions = [mention(nvdaId, 'NVDA', 0, 4), mention(amdId, 'AMD', 29, 32)];

  it('normalizes inverse preference and binds exact evidence from the source', async () => {
    const relations = await inferComparativeRelations({
      sourceItemId,
      boundedContent: content,
      mentions,
      candidates: [nvda, amd],
      inference: inference({
        relationships: [
          {
            subjectSecurityId: amdId,
            relation: 'less_preferred_than',
            objectSecurityId: nvdaId,
            evidenceStart: 0,
            evidenceEnd: content.length,
          },
        ],
      }),
      idFactory: relationshipIdFactory,
    });

    expect(relations).toMatchObject([
      {
        sourceItemId,
        subjectSecurityId: nvdaId,
        relation: 'preferred_over',
        objectSecurityId: amdId,
        evidenceText: content,
      },
    ]);
  });

  it('deduplicates inverse and symmetric equivalents deterministically', async () => {
    const relations = await inferComparativeRelations({
      sourceItemId,
      boundedContent: content,
      mentions,
      candidates: [nvda, amd],
      inference: inference({
        relationships: [
          {
            subjectSecurityId: nvdaId,
            relation: 'preferred_over',
            objectSecurityId: amdId,
            evidenceStart: 0,
            evidenceEnd: content.length,
          },
          {
            subjectSecurityId: amdId,
            relation: 'less_preferred_than',
            objectSecurityId: nvdaId,
            evidenceStart: 0,
            evidenceEnd: 32,
          },
        ],
      }),
      idFactory: relationshipIdFactory,
    });
    expect(relations).toHaveLength(1);
    expect(relations[0]?.evidenceText).toBe(content.slice(0, 32));
  });

  it('rejects invented security IDs and out-of-bounds evidence', async () => {
    const base = {
      sourceItemId,
      boundedContent: content,
      mentions,
      candidates: [nvda, amd],
      idFactory: relationshipIdFactory,
    };
    await expect(
      inferComparativeRelations({
        ...base,
        inference: inference({
          relationships: [
            {
              subjectSecurityId: nvdaId,
              relation: 'preferred_over',
              objectSecurityId: randomUUID(),
              evidenceStart: 0,
              evidenceEnd: content.length,
            },
          ],
        }),
      }),
    ).rejects.toThrow('referenced an unresolved security');
    await expect(
      inferComparativeRelations({
        ...base,
        inference: inference({
          relationships: [
            {
              subjectSecurityId: nvdaId,
              relation: 'preferred_over',
              objectSecurityId: amdId,
              evidenceStart: 0,
              evidenceEnd: content.length + 1,
            },
          ],
        }),
      }),
    ).rejects.toThrow('span exceeds bounded source content');
    await expect(
      inferComparativeRelations({
        ...base,
        inference: inference({
          relationships: [
            {
              subjectSecurityId: nvdaId,
              relation: 'preferred_over',
              objectSecurityId: amdId,
              evidenceStart: 0,
              evidenceEnd: 4,
            },
          ],
        }),
      }),
    ).rejects.toThrow('evidence must cover both resolved security mentions');
  });

  it('rejects non-strict inference output and cross-source mentions', async () => {
    const infer = inference({ relationships: [], extra: 'not allowed' });
    await expect(
      inferComparativeRelations({
        sourceItemId,
        boundedContent: content,
        mentions,
        candidates: [nvda, amd],
        inference: infer,
        idFactory: relationshipIdFactory,
      }),
    ).rejects.toThrow();
    await expect(
      inferComparativeRelations({
        sourceItemId,
        boundedContent: content,
        mentions: [{ ...mentions[0]!, sourceItemId: randomUUID() }, mentions[1]!],
        candidates: [nvda, amd],
        inference: inference({ relationships: [] }),
        idFactory: relationshipIdFactory,
      }),
    ).rejects.toThrow('mention from another source');
  });

  it('does not invoke relationship inference until two distinct securities resolve', async () => {
    const model = inference({ relationships: [] });
    const result = await resolvePersistedSourceSecurities(
      { sourceItemId, candidates: [nvda, amd], ambiguityPolicy },
      {
        evidence: {
          getEvidence: vi.fn(async () => ({
            id: sourceItemId,
            platform: 'reddit' as const,
            sourceKind: 'post' as const,
            externalId: 'fixture-single',
            canonicalUrl: 'https://www.reddit.com/r/stocks/comments/fixture-single/',
            originalUrl: 'https://www.reddit.com/r/stocks/comments/fixture-single/',
            subredditOrScope: 'r/stocks',
            authorHandleHash: null,
            title: null,
            boundedContent: 'NVDA remains strong.',
            contentSha256:
              'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
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
        mentionIdFactory,
        relationshipIdFactory,
        relationshipInference: model,
      },
    );
    expect(result.relationshipInferenceInvoked).toBe(false);
    expect(result.relationships).toEqual([]);
    expect(model.infer).not.toHaveBeenCalled();
  });
});
