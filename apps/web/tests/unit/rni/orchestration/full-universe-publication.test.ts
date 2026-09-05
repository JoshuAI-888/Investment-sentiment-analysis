import { describe, expect, it } from 'vitest';

import { hashRniModelInput } from '@/rni/agents/model-input';
import {
  buildRniFullUniversePublication,
  rniFullUniversePublication,
  type RniFullUniversePublication,
  type RniFullUniversePublicationInput,
} from '@/rni/orchestration/full-universe-publication';

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = (character: string): string => character.repeat(64);

const members = [
  { ordinal: 1, securityId: uuid(1) },
  { ordinal: 2, securityId: uuid(2) },
  { ordinal: 3, securityId: uuid(3) },
] as const;

const identity = {
  runId: uuid(100),
  planHash: hash('a'),
  runManifestHash: hash('b'),
  universeVersion: '42',
  assessmentCutoffAt: '2026-09-05T12:00:00.000Z',
  memberSetHash: hash('c'),
} as const;

const fixture = (
  statuses: readonly ('complete' | 'partial' | 'insufficient')[] = [
    'complete',
    'complete',
    'complete',
  ],
): RniFullUniversePublicationInput => ({
  manifest: { ...identity, members: [...members] },
  platforms: {
    reddit: {
      ...identity,
      platform: 'reddit',
      sliceId: uuid(101),
      status: 'complete',
      outcomeHash: hash('d'),
    },
    x: {
      ...identity,
      platform: 'x',
      sliceId: uuid(102),
      status: 'complete',
      outcomeHash: hash('e'),
    },
  },
  items: members.map((member, index) => ({
    ...identity,
    ...member,
    citedSynthesisId: uuid(200 + index),
    citedSynthesisResultHash: hash(String(index + 1)),
    convergenceArtifactId: uuid(300 + index),
    convergenceArtifactHash: hash(String(index + 4)),
    status: statuses[index]!,
  })),
});

const rehashSavedAggregate = (
  aggregate: RniFullUniversePublication,
): RniFullUniversePublication => {
  const { aggregateHash: _oldHash, ...withoutHash } = aggregate;
  return { ...withoutHash, aggregateHash: hashRniModelInput(withoutHash) };
};

describe('D-RNI-33 full-universe aggregate release', () => {
  it('derives complete only from two complete slices and all-complete members', () => {
    const aggregate = buildRniFullUniversePublication(fixture());
    expect(aggregate).toMatchObject({
      version: 'rni-full-universe-publication-v1',
      scopeKind: 'full_universe',
      expectedMemberCount: 3,
      counts: { complete: 3, partial: 0, insufficient: 0 },
      status: 'complete',
    });
    expect(aggregate.members.map(({ securityId }) => securityId)).toEqual(
      members.map(({ securityId }) => securityId),
    );
    expect(aggregate).not.toHaveProperty('stance');
    expect(aggregate).not.toHaveProperty('attention');
  });

  it('derives partial from a member gap or a terminal non-complete platform slice', () => {
    expect(
      buildRniFullUniversePublication(fixture(['complete', 'partial', 'complete'])),
    ).toMatchObject({
      counts: { complete: 2, partial: 1, insufficient: 0 },
      status: 'partial',
    });
    const platformPartial = fixture();
    platformPartial.platforms.x.status = 'failed';
    expect(buildRniFullUniversePublication(platformPartial).status).toBe('partial');
  });

  it('derives insufficient only when every member is insufficient', () => {
    expect(
      buildRniFullUniversePublication(fixture(['insufficient', 'insufficient', 'insufficient'])),
    ).toMatchObject({
      counts: { complete: 0, partial: 0, insufficient: 3 },
      status: 'insufficient',
    });
  });

  it('normalizes reordered manifest members and items by immutable ordinal', () => {
    const baseline = buildRniFullUniversePublication(fixture());
    const reordered = fixture();
    reordered.manifest.members.reverse();
    reordered.items.reverse();
    expect(buildRniFullUniversePublication(reordered)).toEqual(baseline);
  });

  it('rejects an omitted or extra item instead of publishing a partial member set', () => {
    const omitted = fixture();
    omitted.items.pop();
    expect(() => buildRniFullUniversePublication(omitted)).toThrow(
      'items do not exactly cover the manifest member count',
    );

    const extra = fixture();
    extra.items.push({
      ...extra.items[0]!,
      ordinal: 4,
      securityId: uuid(4),
      citedSynthesisId: uuid(204),
      convergenceArtifactId: uuid(304),
    });
    expect(() => buildRniFullUniversePublication(extra)).toThrow(`unexpected security ${uuid(4)}`);
  });

  it('rejects duplicate manifest or item identities', () => {
    const duplicateItemSecurity = fixture();
    duplicateItemSecurity.items[1] = {
      ...duplicateItemSecurity.items[1]!,
      securityId: members[0].securityId,
    };
    expect(() => buildRniFullUniversePublication(duplicateItemSecurity)).toThrow(
      'items repeat a security',
    );

    const duplicateItemOrdinal = fixture();
    duplicateItemOrdinal.items[1] = { ...duplicateItemOrdinal.items[1]!, ordinal: 1 };
    expect(() => buildRniFullUniversePublication(duplicateItemOrdinal)).toThrow(
      'items repeat an ordinal',
    );

    const duplicateSynthesis = fixture();
    duplicateSynthesis.items[1] = {
      ...duplicateSynthesis.items[1]!,
      citedSynthesisId: duplicateSynthesis.items[0]!.citedSynthesisId,
    };
    expect(() => buildRniFullUniversePublication(duplicateSynthesis)).toThrow(
      'items repeat a cited-synthesis identity',
    );

    const duplicateConvergence = fixture();
    duplicateConvergence.items[1] = {
      ...duplicateConvergence.items[1]!,
      convergenceArtifactId: duplicateConvergence.items[0]!.convergenceArtifactId,
    };
    expect(() => buildRniFullUniversePublication(duplicateConvergence)).toThrow(
      'items repeat a convergence-artifact identity',
    );

    const duplicateManifestSecurity = fixture();
    duplicateManifestSecurity.manifest.members[1] = {
      ...duplicateManifestSecurity.manifest.members[1]!,
      securityId: members[0].securityId,
    };
    expect(() => buildRniFullUniversePublication(duplicateManifestSecurity)).toThrow(
      'manifest repeats a security',
    );

    const duplicateManifestOrdinal = fixture();
    duplicateManifestOrdinal.manifest.members[1] = {
      ...duplicateManifestOrdinal.manifest.members[1]!,
      ordinal: 1,
    };
    expect(() => buildRniFullUniversePublication(duplicateManifestOrdinal)).toThrow(
      'manifest repeats an ordinal',
    );
  });

  it('rejects crossed ordinal and security membership', () => {
    const crossedOrdinal = fixture();
    crossedOrdinal.items[1] = { ...crossedOrdinal.items[1]!, ordinal: 3 };
    crossedOrdinal.items[2] = { ...crossedOrdinal.items[2]!, ordinal: 2 };
    expect(() => buildRniFullUniversePublication(crossedOrdinal)).toThrow(
      'crossed manifest ordinal',
    );

    const crossedSecurity = fixture();
    crossedSecurity.items[1] = {
      ...crossedSecurity.items[1]!,
      securityId: uuid(400),
    };
    expect(() => buildRniFullUniversePublication(crossedSecurity)).toThrow(
      `unexpected security ${uuid(400)}`,
    );
  });

  it.each([
    ['runId', uuid(999)],
    ['planHash', hash('f')],
    ['runManifestHash', hash('0')],
    ['universeVersion', '99'],
    ['assessmentCutoffAt', '2026-09-05T12:00:01.000Z'],
    ['memberSetHash', hash('9')],
  ] as const)('rejects crossed item %s identity', (field, value) => {
    const input = fixture();
    input.items[0] = { ...input.items[0]!, [field]: value };
    expect(() => buildRniFullUniversePublication(input)).toThrow(
      'crossed run, plan, manifest, universe, cutoff, or member-set identity',
    );
  });

  it('rejects crossed platform identity, duplicate slices, and malformed artifact hashes', () => {
    const crossed = fixture();
    crossed.platforms.x.planHash = hash('f');
    expect(() => buildRniFullUniversePublication(crossed)).toThrow(
      'crossed run, plan, manifest, universe, cutoff, or member-set identity',
    );

    const duplicateSlices = fixture();
    duplicateSlices.platforms.x.sliceId = duplicateSlices.platforms.reddit.sliceId;
    expect(() => buildRniFullUniversePublication(duplicateSlices)).toThrow(
      'distinct platform-slice identities',
    );

    const malformed = fixture();
    malformed.items[0]!.convergenceArtifactHash = 'not-a-hash';
    expect(() => buildRniFullUniversePublication(malformed)).toThrow();
  });

  it('rejects non-terminal slices and unrecognized input fields', () => {
    const running = fixture() as unknown as Record<string, unknown>;
    (running.platforms as RniFullUniversePublicationInput['platforms']).reddit.status =
      'running' as 'complete';
    expect(() =>
      buildRniFullUniversePublication(running as RniFullUniversePublicationInput),
    ).toThrow();

    const extra = fixture() as RniFullUniversePublicationInput & { pooledStance: string };
    extra.pooledStance = 'bullish';
    expect(() => buildRniFullUniversePublication(extra)).toThrow('Unrecognized key');
  });

  it('produces a deterministic canonical hash and changes it for any accepted mutation', () => {
    const first = buildRniFullUniversePublication(fixture());
    const second = buildRniFullUniversePublication(fixture());
    expect(second.aggregateHash).toBe(first.aggregateHash);
    const { aggregateHash, ...aggregate } = first;
    expect(aggregateHash).toBe(hashRniModelInput(aggregate));

    const changed = fixture();
    changed.items[0]!.citedSynthesisResultHash = hash('f');
    expect(buildRniFullUniversePublication(changed).aggregateHash).not.toBe(first.aggregateHash);
  });

  it('rejects a saved aggregate whose canonical hash was tampered', () => {
    const aggregate = buildRniFullUniversePublication(fixture());
    expect(() =>
      rniFullUniversePublication.parse({ ...aggregate, aggregateHash: hash('f') }),
    ).toThrow('Aggregate hash');
  });

  it.each([
    'expected count',
    'status counts',
    'derived status',
    'member order',
    'member security',
    'member ordinal',
    'cited synthesis',
    'convergence artifact',
    'member index hash',
    'platform slice',
  ] as const)('rejects a coherently rehashed saved aggregate with crossed %s', (mutation) => {
    const aggregate = structuredClone(buildRniFullUniversePublication(fixture()));
    if (mutation === 'expected count') aggregate.expectedMemberCount = 2;
    if (mutation === 'status counts') aggregate.counts.complete = 2;
    if (mutation === 'derived status') aggregate.status = 'partial';
    if (mutation === 'member order') aggregate.members.reverse();
    if (mutation === 'member security') {
      aggregate.members[1]!.securityId = aggregate.members[0]!.securityId;
    }
    if (mutation === 'member ordinal') aggregate.members[1]!.ordinal = 1;
    if (mutation === 'cited synthesis') {
      aggregate.members[1]!.citedSynthesisId = aggregate.members[0]!.citedSynthesisId;
    }
    if (mutation === 'convergence artifact') {
      aggregate.members[1]!.convergenceArtifactId = aggregate.members[0]!.convergenceArtifactId;
    }
    if (mutation === 'member index hash') aggregate.memberIndexHash = hash('f');
    if (mutation === 'platform slice') {
      aggregate.platforms.x.sliceId = aggregate.platforms.reddit.sliceId;
    }

    expect(() => rniFullUniversePublication.parse(rehashSavedAggregate(aggregate))).toThrow();
  });
});
