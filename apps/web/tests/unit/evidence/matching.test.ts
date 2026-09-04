import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_TICKERS, deterministicMatch } from '@/services/evidence/matching';

const SECURITY = { symbol: 'AAPL', name: 'Apple Inc.', aliases: ['Apple'] };

describe('deterministicMatch', () => {
  it('matches a cashtag and treats it as corroborated', () => {
    const result = deterministicMatch('Just bought some $AAPL calls', SECURITY);
    expect(result).toEqual({ matched: true, matchedVia: 'cashtag', ambiguous: false, corroborated: true });
  });

  it('matches the company name', () => {
    const result = deterministicMatch('Apple Inc. reported earnings today', SECURITY);
    expect(result.matched).toBe(true);
    expect(result.matchedVia).toBe('company_name');
    expect(result.corroborated).toBe(true);
  });

  it('matches a bare non-ambiguous symbol as self-corroborating', () => {
    const result = deterministicMatch('AAPL is up 3% today', SECURITY);
    expect(result).toEqual({ matched: true, matchedVia: 'symbol', ambiguous: false, corroborated: true });
  });

  it('does not match inside a longer alphanumeric token', () => {
    const result = deterministicMatch('AAPLE is a typo, not the stock', SECURITY);
    expect(result.matched).toBe(false);
  });

  it('reports no match when nothing in the text refers to the security', () => {
    const result = deterministicMatch('The weather in Cupertino was nice', SECURITY);
    expect(result).toEqual({ matched: false, matchedVia: 'none', ambiguous: false, corroborated: false });
  });

  it('matches via an alias', () => {
    const result = deterministicMatch('Apple unveiled a new chip', { symbol: 'AAPL', name: 'Apple Incorporated', aliases: ['Apple'] });
    expect(result.matched).toBe(true);
    expect(result.matchedVia).toBe('alias');
  });

  describe('the ticker-collision guard, on every ambiguous token in the fixture matrix', () => {
    const CASES: { symbol: string; name: string; text: string }[] = [
      { symbol: 'AI', name: 'C3.ai, Inc.', text: 'AI stock popped after the print' },
      { symbol: 'ON', name: 'ON Semiconductor Corporation', text: 'ON guidance beat estimates' },
      { symbol: 'IT', name: 'Gartner, Inc.', text: 'IT spending is up this quarter' },
      { symbol: 'ALL', name: 'The Allstate Corporation', text: 'ALL raised its dividend' },
    ];

    it.each(CASES)('flags $symbol as ambiguous and uncorroborated on a bare mention', ({ symbol, name, text }) => {
      expect(AMBIGUOUS_TICKERS.has(symbol)).toBe(true);
      const result = deterministicMatch(text, { symbol, name, aliases: [] });
      expect(result).toEqual({ matched: true, matchedVia: 'symbol', ambiguous: true, corroborated: false });
    });

    it.each(CASES)('is corroborated for $symbol once a cashtag is present', ({ symbol, name, text }) => {
      const result = deterministicMatch(`${text} $${symbol}`, { symbol, name, aliases: [] });
      expect(result.corroborated).toBe(true);
      expect(result.matchedVia).toBe('cashtag');
    });

    it.each(CASES)('is corroborated for $symbol once the company name is present', ({ symbol, name, text }) => {
      const result = deterministicMatch(`${text}. ${name} reports next week.`, { symbol, name, aliases: [] });
      expect(result.corroborated).toBe(true);
      expect(result.matchedVia).toBe('company_name');
    });

    it('does not flag an unambiguous symbol as ambiguous, even if it reads like a word', () => {
      // MSFT is not in AMBIGUOUS_TICKERS — sanity check that the set is the only source of truth.
      const result = deterministicMatch('MSFT beat on revenue', { symbol: 'MSFT', name: 'Microsoft Corporation', aliases: [] });
      expect(result.ambiguous).toBe(false);
      expect(result.corroborated).toBe(true);
    });
  });
});
