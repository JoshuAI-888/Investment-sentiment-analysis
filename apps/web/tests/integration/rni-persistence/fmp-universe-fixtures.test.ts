import { describe, expect, it } from 'vitest';
import { RNI_UNIVERSE_MAX_SYMBOLS, rniUniverseSnapshotCandidate } from '../../../src/rni/contracts';
import {
  allFmpUniverseFixtures,
  invalidFmpUniverseFixtures,
  validFmpUniverseFixture,
} from './fmp-universe-fixtures';

describe('RNI D08 FMP universe fixtures for integration migration 0024', () => {
  it('provides a valid unique snapshot above 500 members with NVDA', () => {
    const parsed = rniUniverseSnapshotCandidate.parse(validFmpUniverseFixture.candidate);
    expect(parsed.members).toHaveLength(501);
    expect(new Set(parsed.members.map((member) => member.ticker)).size).toBe(501);
    expect(parsed.members.some((member) => member.ticker === 'NVDA')).toBe(true);
    expect(parsed.members.length).toBeLessThanOrEqual(RNI_UNIVERSE_MAX_SYMBOLS);
  });

  it('provides every invalid activation category required by the DATA handoff', () => {
    expect(invalidFmpUniverseFixtures.map((fixture) => fixture.expectedIssue)).toEqual([
      'empty',
      'duplicate_member',
      'missing_nvda',
      'over_ceiling',
      'ambiguous_resolution',
      'unresolved_member',
    ]);
    expect(allFmpUniverseFixtures).toHaveLength(7);
  });

  it('proves the frozen schema rejects the structural empty, missing-NVDA, and ceiling cases', () => {
    for (const issue of ['empty', 'missing_nvda', 'over_ceiling'] as const) {
      const fixture = invalidFmpUniverseFixtures.find((entry) => entry.expectedIssue === issue)!;
      expect(rniUniverseSnapshotCandidate.safeParse(fixture.candidate).success, fixture.name).toBe(
        false,
      );
    }
  });

  it('pins CR-DATA-004: duplicate and resolution failures need integration validation', () => {
    for (const issue of [
      'duplicate_member',
      'ambiguous_resolution',
      'unresolved_member',
    ] as const) {
      const fixture = invalidFmpUniverseFixtures.find((entry) => entry.expectedIssue === issue)!;
      expect(rniUniverseSnapshotCandidate.safeParse(fixture.candidate).success, fixture.name).toBe(
        true,
      );
    }
  });
});
