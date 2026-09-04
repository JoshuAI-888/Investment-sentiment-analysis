import { describe, expect, it, vi } from 'vitest';
import type { SecuritySearchResult } from '@/repositories/security';

const searchSecuritiesMock = vi.fn<() => Promise<SecuritySearchResult[]>>();
vi.mock('@/repositories/security', () => ({ searchSecurities: searchSecuritiesMock }));

const { resolveTickerSymbol } = await import('@/services/ticker/resolve');

function result(overrides: Partial<SecuritySearchResult> = {}): SecuritySearchResult {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    symbol: 'GME',
    name: 'GameStop',
    exchange: 'NYSE',
    assetType: 'equity',
    eligibilityState: null,
    ...overrides,
  };
}

const NOW = new Date('2026-09-01T00:00:00.000Z');

describe('resolveTickerSymbol', () => {
  it('refuses an empty symbol without querying the database', async () => {
    const outcome = await resolveTickerSymbol('  ', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toBe('not_found');
    expect(searchSecuritiesMock).not.toHaveBeenCalled();
  });

  it('refuses not_found when nothing matches exactly', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([]);
    const outcome = await resolveTickerSymbol('ZZZZ', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toBe('not_found');
  });

  it('refuses not_found when only a prefix match exists, not an exact one', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ symbol: 'GMEX' })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(false);
  });

  it('resolves case-insensitively', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ symbol: 'GME' })]);
    const outcome = await resolveTickerSymbol('gme', NOW);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.security.symbol).toBe('GME');
  });

  it('refuses ambiguous when the same symbol resolves on more than one exchange', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([
      result({ id: 'a', exchange: 'NYSE' }),
      result({ id: 'b', exchange: 'NASDAQ' }),
    ]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.refusal.reason).toBe('ambiguous');
      expect(outcome.refusal.message).toContain('NYSE');
      expect(outcome.refusal.message).toContain('NASDAQ');
    }
  });

  it('refuses ineligible for an unsupported security rather than resolving it', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ eligibilityState: 'unsupported' })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toBe('ineligible');
  });

  it('refuses ineligible for a rights_blocked security', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ eligibilityState: 'rights_blocked' })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toBe('ineligible');
  });

  // Round-3 lane-review finding 3: `inactive` is a fifth, real member of
  // `contracts/security.ts#eligibilityState` (migration 0002) that this module used to let
  // through unrefused — a delisted security's last stored price would render as if current.
  it('refuses ineligible for an inactive security rather than rendering its last stored price as current', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ eligibilityState: 'inactive' })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.reason).toBe('ineligible');
  });

  it('resolves a partial-eligibility security rather than refusing it', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ eligibilityState: 'partial' })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(true);
  });

  it('resolves a security with no profile snapshot yet (null eligibilityState)', async () => {
    searchSecuritiesMock.mockResolvedValueOnce([result({ eligibilityState: null })]);
    const outcome = await resolveTickerSymbol('GME', NOW);
    expect(outcome.ok).toBe(true);
  });
});
