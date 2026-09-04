import { describe, expect, it } from 'vitest';
import { matchBoardEntriesToSecurities, type MatchableSecurity } from '../../../../src/services/attention/match';
import type { ApeWisdomEntry } from '../../../../src/adapters/apewisdom';

function entry(overrides: Partial<ApeWisdomEntry> = {}): ApeWisdomEntry {
  return {
    rank: 1,
    ticker: 'GME',
    name: 'GameStop Corp.',
    mentions: '100',
    upvotes: '200',
    rank24hAgo: '2',
    mentions24hAgo: '90',
    ...overrides,
  };
}

function security(overrides: Partial<MatchableSecurity> = {}): MatchableSecurity {
  return { id: 'sec-1', symbol: 'GME', active: true, ...overrides };
}

describe('matchBoardEntriesToSecurities — F08 §4.1 / §8', () => {
  it('matches an entry to a security with the same symbol', () => {
    const { matched } = matchBoardEntriesToSecurities([entry()], [security()]);
    expect(matched).toEqual([{ entry: entry(), securityId: 'sec-1', symbol: 'GME' }]);
  });

  it('matches case-insensitively, but keeps the security master\'s own casing', () => {
    const { matched } = matchBoardEntriesToSecurities(
      [entry({ ticker: 'gme' })],
      [security({ symbol: 'GME' })],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.symbol).toBe('GME');
  });

  it('drops an entry matching no active security — never guesses (F08 §8)', () => {
    const { matched } = matchBoardEntriesToSecurities(
      [entry({ ticker: 'AI' })],
      [security({ symbol: 'GME' })],
    );
    expect(matched).toHaveLength(0);
  });

  it('drops an entry matching an inactive security', () => {
    const { matched } = matchBoardEntriesToSecurities(
      [entry()],
      [security({ active: false })],
    );
    expect(matched).toHaveLength(0);
  });

  it('matches multiple entries against multiple securities independently', () => {
    const { matched } = matchBoardEntriesToSecurities(
      [entry({ ticker: 'GME' }), entry({ ticker: 'AMC', rank: 2 }), entry({ ticker: 'UNKNOWN', rank: 3 })],
      [security({ id: 'sec-1', symbol: 'GME' }), security({ id: 'sec-2', symbol: 'AMC' })],
    );
    expect(matched.map((m) => m.symbol).sort()).toEqual(['AMC', 'GME']);
  });

  // Round-23 lane-review finding 1. Nothing in ApeWisdom's documented shape rules out the same
  // ticker appearing twice on one board response (an extraction bug, or two share classes
  // normalising to the one symbol this deployment tracks). Without this, both entries would be
  // written for the identical (security_id, source, observed_at) and `insertAttentionSnapshot`
  // would have no way to tell the second apart from a genuine mid-run revision — permanently
  // shadowing whichever entry inserted first, by an accident of list order.
  it('keeps only the first (best-ranked) entry for a ticker duplicated on one board response, and reports the rest', () => {
    const { matched, duplicateTickers } = matchBoardEntriesToSecurities(
      [entry({ ticker: 'GME', rank: 5 }), entry({ ticker: 'GME', rank: 42, mentions: '9' })],
      [security({ id: 'sec-1', symbol: 'GME' })],
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.entry.rank).toBe(5);
    expect(duplicateTickers).toEqual(['GME']);
  });

  it('reports no duplicates when every matched ticker appears once', () => {
    const { duplicateTickers } = matchBoardEntriesToSecurities([entry({ ticker: 'GME' })], [security()]);
    expect(duplicateTickers).toEqual([]);
  });
});
