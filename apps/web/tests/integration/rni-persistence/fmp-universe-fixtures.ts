import type { RniUniverseSnapshotCandidate } from '../../../src/rni/contracts';

export type RniUniverseFixtureIssue =
  | 'empty'
  | 'duplicate_member'
  | 'missing_nvda'
  | 'over_ceiling'
  | 'ambiguous_resolution'
  | 'unresolved_member';

export type RniFmpUniverseFixture = {
  readonly name: string;
  readonly candidate: unknown;
  readonly expectedIssue: RniUniverseFixtureIssue | null;
  readonly resolutionOverrides: Readonly<Record<string, 'ambiguous' | 'unresolved'>>;
};

const PAYLOAD_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function member(index: number): RniUniverseSnapshotCandidate['members'][number] {
  const suffix = String(index).padStart(3, '0');
  return {
    ticker: `ZZ${suffix}`,
    companyName: `Fixture constituent ${suffix}`,
    exchange: 'NYSE',
    fmpSymbol: `ZZ${suffix}`,
  };
}

function members(count: number): RniUniverseSnapshotCandidate['members'] {
  if (count < 1) return [];
  return [
    {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      exchange: 'NASDAQ',
      fmpSymbol: 'NVDA',
    },
    ...Array.from({ length: count - 1 }, (_, index) => member(index + 1)),
  ];
}

function candidate(
  candidateMembers: RniUniverseSnapshotCandidate['members'],
): RniUniverseSnapshotCandidate {
  return {
    source: 'fmp_sp500_constituent',
    retrievedAt: '2026-09-05T00:00:00.000Z',
    payloadSha256: PAYLOAD_HASH,
    members: candidateMembers,
  };
}

export const validFmpUniverseFixture: RniFmpUniverseFixture = {
  name: 'valid-501-member-snapshot',
  candidate: candidate(members(501)),
  expectedIssue: null,
  resolutionOverrides: {},
};

const validMembers = members(501);

export const invalidFmpUniverseFixtures: readonly RniFmpUniverseFixture[] = [
  {
    name: 'empty-snapshot',
    candidate: candidate([]),
    expectedIssue: 'empty',
    resolutionOverrides: {},
  },
  {
    name: 'duplicate-member',
    candidate: candidate([...validMembers, validMembers[1]!]),
    expectedIssue: 'duplicate_member',
    resolutionOverrides: {},
  },
  {
    name: 'missing-nvda',
    candidate: candidate(validMembers.filter((entry) => entry.ticker !== 'NVDA')),
    expectedIssue: 'missing_nvda',
    resolutionOverrides: {},
  },
  {
    name: 'over-600-ceiling',
    candidate: candidate(members(601)),
    expectedIssue: 'over_ceiling',
    resolutionOverrides: {},
  },
  {
    name: 'ambiguous-member-resolution',
    candidate: candidate(validMembers),
    expectedIssue: 'ambiguous_resolution',
    resolutionOverrides: { ZZ001: 'ambiguous' },
  },
  {
    name: 'unresolved-member',
    candidate: candidate(validMembers),
    expectedIssue: 'unresolved_member',
    resolutionOverrides: { ZZ002: 'unresolved' },
  },
] as const;

export const allFmpUniverseFixtures = [
  validFmpUniverseFixture,
  ...invalidFmpUniverseFixtures,
] as const;
