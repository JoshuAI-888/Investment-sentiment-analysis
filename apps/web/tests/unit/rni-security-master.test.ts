import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fmpSecurityMasterSnapshot } from '../../src/repositories/security';

function profiles(count = 501) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: index === 0 ? 'NVDA' : `T${String(index).padStart(3, '0')}`,
    name: index === 0 ? 'NVIDIA Corporation' : `Company ${index}`,
    exchange: 'NASDAQ',
    sector: index === 0 ? 'Technology' : null,
    industry: index === 0 ? 'Semiconductors' : null,
    cik: index === 0 ? '0001045810' : null,
    currency: 'USD',
  }));
}

function snapshot(securities = profiles(), payloadSha256?: string) {
  return {
    source: 'fmp_profile_export' as const,
    sourceEndpoint: '/stable/profile' as const,
    retrievedAt: '2026-09-05T00:00:00.000Z',
    payloadSha256:
      payloadSha256 ?? createHash('sha256').update(JSON.stringify(securities)).digest('hex'),
    securities,
  };
}

describe('FMP security-master bootstrap snapshot', () => {
  it('accepts an exact hash-bound 501-security export containing NVDA', () => {
    expect(fmpSecurityMasterSnapshot.parse(snapshot()).securities).toHaveLength(501);
  });

  it('rejects a 500-security partial export', () => {
    expect(fmpSecurityMasterSnapshot.safeParse(snapshot(profiles(500))).success).toBe(false);
  });

  it('rejects a payload hash that does not bind the exact ordered export', () => {
    expect(fmpSecurityMasterSnapshot.safeParse(snapshot(profiles(), 'a'.repeat(64))).success).toBe(
      false,
    );
  });

  it('rejects duplicate symbols and an export without NVDA', () => {
    const duplicate = profiles();
    duplicate[500] = { ...duplicate[0]! };
    const withoutNvda = profiles();
    withoutNvda[0] = {
      ...withoutNvda[0]!,
      symbol: 'T000',
      name: 'Company 0',
      sector: null,
      industry: null,
      cik: null,
    };

    expect(fmpSecurityMasterSnapshot.safeParse(snapshot(duplicate)).success).toBe(false);
    expect(fmpSecurityMasterSnapshot.safeParse(snapshot(withoutNvda)).success).toBe(false);
  });
});
