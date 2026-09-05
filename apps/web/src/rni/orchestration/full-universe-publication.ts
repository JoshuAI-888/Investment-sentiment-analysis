import { z } from 'zod';

import { canonicalInstant } from '@/calc/canonical';
import { hashRniModelInput } from '@/rni/agents/model-input';

export const RNI_FULL_UNIVERSE_PUBLICATION_VERSION = 'rni-full-universe-publication-v1' as const;

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const universeVersion = z.string().regex(/^[1-9]\d*$/u);
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => canonicalInstant(value));
const memberStatus = z.enum(['complete', 'partial', 'insufficient']);
const terminalSliceStatus = z.enum(['complete', 'partial', 'failed', 'unavailable']);

const publicationIdentity = z
  .object({
    runId: uuid,
    planHash: digest,
    runManifestHash: digest,
    universeVersion,
    assessmentCutoffAt: instant,
    memberSetHash: digest,
  })
  .strict();

const expectedMember = z
  .object({
    ordinal: z.number().int().min(1).max(600),
    securityId: uuid,
  })
  .strict();

const publicationItem = publicationIdentity
  .extend({
    ordinal: z.number().int().min(1).max(600),
    securityId: uuid,
    citedSynthesisId: uuid,
    citedSynthesisResultHash: digest,
    convergenceArtifactId: uuid,
    convergenceArtifactHash: digest,
    status: memberStatus,
  })
  .strict();

const terminalPlatformSlice = publicationIdentity
  .extend({
    platform: z.enum(['reddit', 'x']),
    sliceId: uuid,
    status: terminalSliceStatus,
    outcomeHash: digest,
  })
  .strict();

export const rniFullUniversePublicationInput = z
  .object({
    manifest: publicationIdentity
      .extend({
        members: z.array(expectedMember).min(1).max(600),
      })
      .strict(),
    platforms: z
      .object({
        reddit: terminalPlatformSlice.extend({ platform: z.literal('reddit') }).strict(),
        x: terminalPlatformSlice.extend({ platform: z.literal('x') }).strict(),
      })
      .strict(),
    items: z.array(publicationItem).min(1).max(600),
  })
  .strict();

const aggregateMember = publicationItem.omit({
  runId: true,
  planHash: true,
  runManifestHash: true,
  universeVersion: true,
  assessmentCutoffAt: true,
  memberSetHash: true,
});

const aggregatePlatform = terminalPlatformSlice.omit({
  runId: true,
  planHash: true,
  runManifestHash: true,
  universeVersion: true,
  assessmentCutoffAt: true,
  memberSetHash: true,
});

const aggregateMemberIndexHash = (members: readonly z.output<typeof aggregateMember>[]): string =>
  hashRniModelInput({
    version: 'rni-full-universe-member-index-v1',
    members: members.map(({ ordinal, securityId }) => ({ ordinal, securityId })),
  });

const deriveAggregateCounts = (members: readonly z.output<typeof aggregateMember>[]) => ({
  complete: members.filter(({ status }) => status === 'complete').length,
  partial: members.filter(({ status }) => status === 'partial').length,
  insufficient: members.filter(({ status }) => status === 'insufficient').length,
});

const deriveAggregateStatus = (
  members: readonly z.output<typeof aggregateMember>[],
  platforms: {
    readonly reddit: z.output<typeof aggregatePlatform>;
    readonly x: z.output<typeof aggregatePlatform>;
  },
): z.output<typeof memberStatus> => {
  const counts = deriveAggregateCounts(members);
  return counts.insufficient === members.length
    ? 'insufficient'
    : platforms.reddit.status === 'complete' &&
        platforms.x.status === 'complete' &&
        counts.complete === members.length
      ? 'complete'
      : 'partial';
};

const aggregateWithoutHash = z
  .object({
    version: z.literal(RNI_FULL_UNIVERSE_PUBLICATION_VERSION),
    runId: uuid,
    planHash: digest,
    runManifestHash: digest,
    universeVersion,
    scopeKind: z.literal('full_universe'),
    assessmentCutoffAt: instant,
    expectedMemberCount: z.number().int().min(1).max(600),
    memberSetHash: digest,
    memberIndexHash: digest,
    platforms: z
      .object({
        reddit: aggregatePlatform.extend({ platform: z.literal('reddit') }).strict(),
        x: aggregatePlatform.extend({ platform: z.literal('x') }).strict(),
      })
      .strict(),
    members: z.array(aggregateMember).min(1).max(600),
    counts: z
      .object({
        complete: z.number().int().min(0).max(600),
        partial: z.number().int().min(0).max(600),
        insufficient: z.number().int().min(0).max(600),
      })
      .strict(),
    status: memberStatus,
  })
  .strict();

/**
 * Self-validates a persisted release index. The database composition still owns the live combined
 * lease, manifest/member relational lineage, staged graph ownership, atomic receipt/finalization,
 * and read gate; none of those external facts can be proved by a pure value schema.
 */
export const rniFullUniversePublication = aggregateWithoutHash
  .extend({ aggregateHash: digest })
  .strict()
  .superRefine((aggregate, context) => {
    const issue = (path: readonly (string | number)[], message: string): void => {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
    };
    const securityIds = new Set<string>();
    const ordinals = new Set<number>();
    const citedSynthesisIds = new Set<string>();
    const convergenceArtifactIds = new Set<string>();
    for (const [index, member] of aggregate.members.entries()) {
      if (member.ordinal !== index + 1) {
        issue(['members', index, 'ordinal'], 'Aggregate members must be contiguous and ordered');
      }
      if (securityIds.has(member.securityId)) {
        issue(['members', index, 'securityId'], 'Aggregate members repeat a security identity');
      }
      if (ordinals.has(member.ordinal)) {
        issue(['members', index, 'ordinal'], 'Aggregate members repeat an ordinal');
      }
      if (citedSynthesisIds.has(member.citedSynthesisId)) {
        issue(
          ['members', index, 'citedSynthesisId'],
          'Aggregate members repeat a cited-synthesis identity',
        );
      }
      if (convergenceArtifactIds.has(member.convergenceArtifactId)) {
        issue(
          ['members', index, 'convergenceArtifactId'],
          'Aggregate members repeat a convergence-artifact identity',
        );
      }
      securityIds.add(member.securityId);
      ordinals.add(member.ordinal);
      citedSynthesisIds.add(member.citedSynthesisId);
      convergenceArtifactIds.add(member.convergenceArtifactId);
    }

    if (aggregate.expectedMemberCount !== aggregate.members.length) {
      issue(
        ['expectedMemberCount'],
        'Aggregate expected-member count must equal its complete member index',
      );
    }
    if (aggregate.memberIndexHash !== aggregateMemberIndexHash(aggregate.members)) {
      issue(
        ['memberIndexHash'],
        'Aggregate member-index hash must match its ordered security identities',
      );
    }
    if (aggregate.platforms.reddit.sliceId === aggregate.platforms.x.sliceId) {
      issue(['platforms'], 'Persisted Reddit and X slices must retain distinct identities');
    }

    const counts = deriveAggregateCounts(aggregate.members);
    if (
      aggregate.counts.complete !== counts.complete ||
      aggregate.counts.partial !== counts.partial ||
      aggregate.counts.insufficient !== counts.insufficient
    ) {
      issue(['counts'], 'Aggregate counts must exactly match member statuses');
    }
    if (aggregate.status !== deriveAggregateStatus(aggregate.members, aggregate.platforms)) {
      issue(['status'], 'Aggregate status must be derived from members and terminal slices');
    }

    const { aggregateHash, ...withoutHash } = aggregate;
    if (aggregateHash !== hashRniModelInput(withoutHash)) {
      issue(['aggregateHash'], 'Aggregate hash must match the complete canonical release index');
    }
  });

export type RniFullUniversePublicationInput = z.input<typeof rniFullUniversePublicationInput>;
export type RniFullUniversePublication = z.output<typeof rniFullUniversePublication>;

type PublicationIdentity = z.output<typeof publicationIdentity>;

function reject(message: string): never {
  throw new Error(`Invalid RNI full-universe publication: ${message}`);
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareMembers = (
  left: { readonly ordinal: number; readonly securityId: string },
  right: { readonly ordinal: number; readonly securityId: string },
): number => left.ordinal - right.ordinal || compareText(left.securityId, right.securityId);

const assertSameIdentity = (
  expected: PublicationIdentity,
  actual: PublicationIdentity,
  subject: string,
): void => {
  if (
    actual.runId !== expected.runId ||
    actual.planHash !== expected.planHash ||
    actual.runManifestHash !== expected.runManifestHash ||
    actual.universeVersion !== expected.universeVersion ||
    actual.assessmentCutoffAt !== expected.assessmentCutoffAt ||
    actual.memberSetHash !== expected.memberSetHash
  ) {
    reject(`${subject} has crossed run, plan, manifest, universe, cutoff, or member-set identity`);
  }
};

const assertExpectedMembers = (members: readonly z.output<typeof expectedMember>[]): void => {
  const securityIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const member of members) {
    if (securityIds.has(member.securityId)) reject('manifest repeats a security');
    if (ordinals.has(member.ordinal)) reject('manifest repeats an ordinal');
    securityIds.add(member.securityId);
    ordinals.add(member.ordinal);
  }
  for (const [index, member] of members.entries()) {
    if (member.ordinal !== index + 1) {
      reject('manifest ordinals must be contiguous and one-based');
    }
  }
};

/**
 * Builds the D-RNI-33 release index. It derives only completeness counts and status; it never
 * combines member analytics, platform magnitudes, stance, attention, or evidence.
 */
export const buildRniFullUniversePublication = (
  rawInput: RniFullUniversePublicationInput,
): RniFullUniversePublication => {
  const input = rniFullUniversePublicationInput.parse(rawInput);
  const { members: manifestMembers, ...manifestIdentity } = input.manifest;
  const manifest = publicationIdentity.parse(manifestIdentity);
  const members = [...manifestMembers].sort(compareMembers);
  assertExpectedMembers(members);

  assertSameIdentity(manifest, input.platforms.reddit, 'Reddit slice');
  assertSameIdentity(manifest, input.platforms.x, 'X slice');
  if (input.platforms.reddit.sliceId === input.platforms.x.sliceId) {
    reject('Reddit and X require distinct platform-slice identities');
  }

  const expectedBySecurity = new Map(members.map((member) => [member.securityId, member]));
  const itemBySecurity = new Map<string, z.output<typeof publicationItem>>();
  const itemOrdinals = new Set<number>();
  const citedSynthesisIds = new Set<string>();
  const convergenceArtifactIds = new Set<string>();
  for (const item of input.items) {
    assertSameIdentity(manifest, item, `item ${item.securityId}`);
    if (itemBySecurity.has(item.securityId)) reject('items repeat a security');
    if (itemOrdinals.has(item.ordinal)) reject('items repeat an ordinal');
    if (citedSynthesisIds.has(item.citedSynthesisId)) {
      reject('items repeat a cited-synthesis identity');
    }
    if (convergenceArtifactIds.has(item.convergenceArtifactId)) {
      reject('items repeat a convergence-artifact identity');
    }
    const expected = expectedBySecurity.get(item.securityId);
    if (expected === undefined) reject(`item names unexpected security ${item.securityId}`);
    if (expected.ordinal !== item.ordinal) {
      reject(`item ${item.securityId} has a crossed manifest ordinal`);
    }
    itemBySecurity.set(item.securityId, item);
    itemOrdinals.add(item.ordinal);
    citedSynthesisIds.add(item.citedSynthesisId);
    convergenceArtifactIds.add(item.convergenceArtifactId);
  }

  if (input.items.length !== members.length) {
    reject('items do not exactly cover the manifest member count');
  }

  const orderedItems = members.map((member) => {
    const item = itemBySecurity.get(member.securityId);
    if (item === undefined) reject(`item is missing for manifest security ${member.securityId}`);
    return aggregateMember.parse({
      ordinal: item.ordinal,
      securityId: item.securityId,
      citedSynthesisId: item.citedSynthesisId,
      citedSynthesisResultHash: item.citedSynthesisResultHash,
      convergenceArtifactId: item.convergenceArtifactId,
      convergenceArtifactHash: item.convergenceArtifactHash,
      status: item.status,
    });
  });

  const counts = deriveAggregateCounts(orderedItems);
  const status = deriveAggregateStatus(orderedItems, input.platforms);

  const aggregate = aggregateWithoutHash.parse({
    version: RNI_FULL_UNIVERSE_PUBLICATION_VERSION,
    runId: manifest.runId,
    planHash: manifest.planHash,
    runManifestHash: manifest.runManifestHash,
    universeVersion: manifest.universeVersion,
    scopeKind: 'full_universe',
    assessmentCutoffAt: manifest.assessmentCutoffAt,
    expectedMemberCount: members.length,
    memberSetHash: manifest.memberSetHash,
    memberIndexHash: aggregateMemberIndexHash(orderedItems),
    platforms: {
      reddit: aggregatePlatform.parse({
        platform: input.platforms.reddit.platform,
        sliceId: input.platforms.reddit.sliceId,
        status: input.platforms.reddit.status,
        outcomeHash: input.platforms.reddit.outcomeHash,
      }),
      x: aggregatePlatform.parse({
        platform: input.platforms.x.platform,
        sliceId: input.platforms.x.sliceId,
        status: input.platforms.x.status,
        outcomeHash: input.platforms.x.outcomeHash,
      }),
    },
    members: orderedItems,
    counts,
    status,
  });
  return rniFullUniversePublication.parse({
    ...aggregate,
    aggregateHash: hashRniModelInput(aggregate),
  });
};
