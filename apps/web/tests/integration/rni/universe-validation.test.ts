import { describe, expect, it } from 'vitest';
import type { FmpSp500Constituent } from '../../../src/adapters/fmp-universe';
import {
  validateAndResolveFmpUniverse,
  type UniverseSecurity,
} from '../../../src/rni/universe/validate';

const RETRIEVED_AT = '2026-09-05T00:00:00.000Z';
const PAYLOAD_HASH = 'a'.repeat(64);

function fixture(count: number): {
  constituents: FmpSp500Constituent[];
  securities: UniverseSecurity[];
} {
  const constituents = Array.from({ length: count }, (_, index) => ({
    symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
    dateFirstAdded: '2020-01-01',
  }));
  const securities = constituents.map((member, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    symbol: member.symbol,
    name: member.name,
    exchange: 'NASDAQ',
    active: true,
  }));
  return { constituents, securities };
}

function validate(value: ReturnType<typeof fixture>) {
  return validateAndResolveFmpUniverse({
    ...value,
    retrievedAt: RETRIEVED_AT,
    payloadSha256: PAYLOAD_HASH,
  });
}

describe('FMP S&P 500 universe validation', () => {
  it('resolves a complete 501-member response against the existing security master', () => {
    const result = validate(fixture(501));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.members).toHaveLength(501);
    expect(result.snapshot.members[0]).toEqual({
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      fmpSymbol: 'NVDA',
    });
  });

  it.each([
    ['empty', fixture(0), 'partial_payload'],
    ['partial', fixture(499), 'partial_payload'],
    ['exactly 500', fixture(500), 'partial_payload'],
    ['over ceiling', fixture(601), 'over_ceiling'],
  ])('rejects a %s provider response', (_name, value, issue) => {
    const result = validate(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(({ code }) => code)).toContain(issue);
  });

  it('rejects duplicate provider symbols', () => {
    const value = fixture(501);
    value.constituents[500] = { ...value.constituents[500]!, symbol: 'NVDA' };
    const result = validate(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({ code: 'duplicate_symbol', symbols: ['NVDA'] });
  });

  it('rejects a response without NVDA', () => {
    const value = fixture(501);
    value.constituents[0] = { ...value.constituents[0]!, symbol: 'MISS' };
    value.securities[0] = { ...value.securities[0]!, symbol: 'MISS' };
    const result = validate(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(({ code }) => code)).toContain('missing_nvda');
  });

  it('rejects unresolved and ambiguous security-master matches', () => {
    const value = fixture(501);
    value.securities.splice(1, 1);
    value.securities.push({
      ...value.securities[2]!,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      symbol: value.constituents[2]!.symbol,
      name: value.constituents[2]!.name,
      exchange: 'NYSE',
    });
    const result = validate(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['unresolved_symbol', 'ambiguous_symbol']),
    );
  });

  it('rejects an impossible constituent first-added calendar date', () => {
    const value = fixture(501);
    value.constituents[0] = { ...value.constituents[0]!, dateFirstAdded: '2026-99-99' };
    const result = validate(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      code: 'invalid_first_added_at',
      symbols: ['NVDA'],
    });
  });
});
