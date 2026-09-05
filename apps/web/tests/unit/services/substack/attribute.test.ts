import { describe, expect, it } from 'vitest';
import type { Security } from '@/contracts/security';
import { attributeText } from '@/services/substack/attribute';

function security(overrides: Partial<Security> = {}): Security {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    exchange: 'NASDAQ',
    sector: 'Consumer Discretionary',
    industry: 'Automobiles',
    cik: null,
    currency: 'USD',
    active: true,
    aliases: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Security;
}

const NVDA = security({
  id: '22222222-2222-2222-2222-222222222222',
  symbol: 'NVDA',
  name: 'NVIDIA Corporation',
});

describe('attributeText', () => {
  it('attributes on an outright company-name mention', () => {
    const result = attributeText('Tesla had a strong quarter.', [security()]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.symbol).toBe('TSLA');
    expect(result.matches[0]?.basis.kind).toBe('company_name');
    expect(result.pending).toEqual([]);
  });

  it('attributes a post to every security it names, not just the first', () => {
    const result = attributeText('Tesla and NVIDIA both reported.', [security(), NVDA]);
    expect(result.matches.map((m) => m.symbol).sort()).toEqual(['NVDA', 'TSLA']);
  });

  it('attributes nothing when no security is named', () => {
    const result = attributeText('A general note on interest rates.', [security(), NVDA]);
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  // The policy this module exists to encode: an ambiguous token is never attributed here, even
  // when corroborated. Whether "AI" is about the company is a semantic judgment §4.4 says a
  // lexicon cannot make — attributing it at collection time would fabricate the match.
  it('never attributes a corroborated ambiguous token — it records it as pending', () => {
    const ai = security({
      id: '33333333-3333-3333-3333-333333333333',
      symbol: 'AI',
      name: 'C3.ai, Inc.',
    });
    // detectMention returns {kind:'ambiguous', token:'AI', corroborated:true} for this text —
    // asserted unconditionally, so the case cannot silently stop exercising the pending path.
    const result = attributeText('C3.ai, Inc. is interesting, and AI is everywhere.', [ai]);
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([
      { securityId: '33333333-3333-3333-3333-333333333333', symbol: 'AI', token: 'AI' },
    ]);
  });

  it('does attribute an ambiguous-symbol security when a cashtag names it outright', () => {
    // $AI is unambiguous where a bare "AI" is not, so this must NOT land in `pending` — proving
    // the ambiguity policy keys on the verdict, not on the symbol being in AMBIGUOUS_TOKENS.
    const ai = security({
      id: '33333333-3333-3333-3333-333333333333',
      symbol: 'AI',
      name: 'C3.ai, Inc.',
    });
    const result = attributeText('I like $AI a lot.', [ai]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.basis).toEqual({ kind: 'cashtag', matched: '$AI' });
    expect(result.pending).toEqual([]);
  });

  it('drops an uncorroborated ambiguous token entirely — not even pending', () => {
    const ai = security({
      id: '33333333-3333-3333-3333-333333333333',
      symbol: 'AI',
      name: 'C3.ai, Inc.',
    });
    const result = attributeText('AI is transforming every industry.', [ai]);
    expect(result.matches).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it('returns empty results for an empty security master rather than throwing', () => {
    expect(attributeText('Tesla and NVIDIA.', [])).toEqual({ matches: [], pending: [] });
  });
});
