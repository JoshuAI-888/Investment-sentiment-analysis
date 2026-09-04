import { describe, expect, it } from 'vitest';
import { AMBIGUOUS_TOKENS, detectMention } from '@/services/evidence/candidates';

const NVDA = { symbol: 'NVDA', companyName: 'NVIDIA Corporation', aliases: ['Nvidia'] };
const C3AI = { symbol: 'AI', companyName: 'C3.ai, Inc.', aliases: ['C3 AI'] };
const ON_SEMI = { symbol: 'ON', companyName: 'ON Semiconductor Corporation' };
const GTLB = { symbol: 'IT', companyName: 'Gartner, Inc.' }; // arbitrary stand-in for an 'IT' ticker
const ALLE = { symbol: 'ALL', companyName: 'Allstate Corporation' };

describe('detectMention — F10 §4.2 deterministic candidacy', () => {
  it('matches a cashtag exactly, case-insensitively', () => {
    expect(detectMention('Big move for $NVDA today', NVDA)).toEqual({ kind: 'cashtag', matched: '$NVDA' });
    expect(detectMention('$nvda mooning', NVDA)).toEqual({ kind: 'cashtag', matched: '$NVDA' });
  });

  it('matches an exact, non-ambiguous symbol as a bare word', () => {
    expect(detectMention('NVDA beat earnings estimates', NVDA)).toEqual({ kind: 'symbol', matched: 'NVDA' });
  });

  it('does not match a symbol embedded in a longer word', () => {
    expect(detectMention('NVDAX is a different fund entirely', NVDA)).toEqual({ kind: 'none' });
  });

  it('matches a company name when the symbol is absent', () => {
    expect(detectMention('NVIDIA Corporation announced a new chip', NVDA)).toEqual({
      kind: 'company_name',
      matched: 'NVIDIA Corporation',
    });
  });

  it('matches a configured alias', () => {
    expect(detectMention('Nvidia just crushed it', NVDA)).toEqual({ kind: 'company_name', matched: 'Nvidia' });
  });

  it('finds nothing when the text names neither the symbol nor the company', () => {
    expect(detectMention('The market rallied broadly today', NVDA)).toEqual({ kind: 'none' });
  });

  it('every ambiguous token is exercised: AI, ON, IT, ALL', () => {
    expect(AMBIGUOUS_TOKENS).toEqual(['AI', 'ON', 'IT', 'ALL']);
  });

  describe('ambiguous token: AI (C3.ai)', () => {
    it('lowercase "ai" inside ordinary prose is not even a candidate', () => {
      expect(detectMention('We should use ai to solve this', C3AI)).toEqual({ kind: 'none' });
    });

    it('bare "AI" with no corroborating company reference is a candidate, uncorroborated', () => {
      expect(detectMention('AI stocks are volatile this week', C3AI)).toEqual({
        kind: 'ambiguous',
        token: 'AI',
        corroborated: false,
      });
    });

    it('"AI" corroborated by the company name is a candidate, corroborated', () => {
      expect(detectMention('C3.ai, Inc. announced AI platform growth', C3AI)).toEqual({
        kind: 'ambiguous',
        token: 'AI',
        corroborated: true,
      });
    });

    it('a cashtag pre-empts the ambiguity branch entirely', () => {
      expect(detectMention('$AI is up 4% today', C3AI)).toEqual({ kind: 'cashtag', matched: '$AI' });
    });
  });

  describe('ambiguous token: ON (ON Semiconductor)', () => {
    it('lowercase "on" is not a candidate', () => {
      expect(detectMention('Depends on the market', ON_SEMI)).toEqual({ kind: 'none' });
    });

    it('bare "ON" uncorroborated', () => {
      expect(detectMention('ON is trading sideways', ON_SEMI)).toEqual({
        kind: 'ambiguous',
        token: 'ON',
        corroborated: false,
      });
    });

    it('bare "ON" corroborated by the company name', () => {
      expect(detectMention('ON Semiconductor Corporation guided lower; ON fell', ON_SEMI)).toEqual({
        kind: 'ambiguous',
        token: 'ON',
        corroborated: true,
      });
    });
  });

  describe('ambiguous token: IT (Gartner stand-in)', () => {
    it('lowercase "it" is not a candidate', () => {
      expect(detectMention('It rallied hard today', GTLB)).toEqual({ kind: 'none' });
    });

    it('bare "IT" uncorroborated', () => {
      expect(detectMention('IT spending headlines today', GTLB)).toEqual({
        kind: 'ambiguous',
        token: 'IT',
        corroborated: false,
      });
    });

    it('bare "IT" corroborated by the company name', () => {
      expect(detectMention('Gartner, Inc. survey: IT budgets rising', GTLB)).toEqual({
        kind: 'ambiguous',
        token: 'IT',
        corroborated: true,
      });
    });
  });

  describe('ambiguous token: ALL (Allstate)', () => {
    it('lowercase "all" is not a candidate', () => {
      expect(detectMention('all markets closed higher', ALLE)).toEqual({ kind: 'none' });
    });

    it('bare "ALL" uncorroborated', () => {
      expect(detectMention('ALL is a name I keep seeing', ALLE)).toEqual({
        kind: 'ambiguous',
        token: 'ALL',
        corroborated: false,
      });
    });

    it('bare "ALL" corroborated by the company name', () => {
      expect(detectMention('Allstate Corporation Q2 results: ALL beats estimates', ALLE)).toEqual({
        kind: 'ambiguous',
        token: 'ALL',
        corroborated: true,
      });
    });
  });

  it('normalizes whitespace and case for company-name matching', () => {
    expect(detectMention('breaking:   NVIDIA   corporation   raises guidance', NVDA)).toEqual({
      kind: 'company_name',
      matched: 'NVIDIA Corporation',
    });
  });
});
