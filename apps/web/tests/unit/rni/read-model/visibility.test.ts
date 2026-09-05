import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../../../../src/repositories/client';
import { buildRniFullUniversePublication } from '../../../../src/rni/orchestration/full-universe-publication';
import { RniReadError } from '../../../../src/rni/read-model';
import { ReadSnapshot } from '../../../../src/rni/read-model/repositories/snapshot';
import { loadRniResultVisibility } from '../../../../src/rni/read-model/repositories/visibility';

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const hash = (value: string): string => value.repeat(64).slice(0, 64);
const runId = uuid(1);
const cutoff = '2026-09-05T12:00:00.000000Z';

function publication() {
  const identity = {
    runId,
    planHash: hash('a'),
    runManifestHash: hash('b'),
    universeVersion: '9',
    assessmentCutoffAt: cutoff,
    memberSetHash: hash('c'),
  } as const;
  return buildRniFullUniversePublication({
    manifest: {
      ...identity,
      members: [
        { ordinal: 1, securityId: uuid(11) },
        { ordinal: 2, securityId: uuid(12) },
      ],
    },
    platforms: {
      reddit: {
        ...identity,
        platform: 'reddit',
        sliceId: uuid(21),
        status: 'complete',
        outcomeHash: hash('d'),
      },
      x: {
        ...identity,
        platform: 'x',
        sliceId: uuid(22),
        status: 'partial',
        outcomeHash: hash('e'),
      },
    },
    items: [
      {
        ...identity,
        ordinal: 1,
        securityId: uuid(11),
        citedSynthesisId: uuid(31),
        citedSynthesisResultHash: hash('f'),
        convergenceArtifactId: uuid(41),
        convergenceArtifactHash: hash('1'),
        status: 'complete',
      },
      {
        ...identity,
        ordinal: 2,
        securityId: uuid(12),
        citedSynthesisId: uuid(32),
        citedSynthesisResultHash: hash('2'),
        convergenceArtifactId: uuid(42),
        convergenceArtifactHash: hash('3'),
        status: 'partial',
      },
    ],
  });
}

function releaseFixture(overrides?: { executionVersion?: string | null; omitRelease?: boolean }) {
  const aggregate = publication();
  const context = {
    scopeKind: 'full_universe',
    runStatus: aggregate.status === 'insufficient' ? 'failed' : aggregate.status,
    executionRunId: runId,
    executionVersion: overrides?.executionVersion ?? 'rni-execution-v2',
    executionPlanHash: aggregate.planHash,
    executionManifestHash: aggregate.runManifestHash,
    runUniverseVersion: aggregate.universeVersion,
    combinedStatus: 'complete',
    redditSliceId: aggregate.platforms.reddit.sliceId,
    redditStatus: aggregate.platforms.reddit.status,
    redditOutcomeHash: aggregate.platforms.reddit.outcomeHash,
    xSliceId: aggregate.platforms.x.sliceId,
    xStatus: aggregate.platforms.x.status,
    xOutcomeHash: aggregate.platforms.x.outcomeHash,
  };
  const manifest = {
    planHash: aggregate.planHash,
    runManifestHash: aggregate.runManifestHash,
    universeVersion: aggregate.universeVersion,
    assessmentCutoffAt: aggregate.assessmentCutoffAt,
    memberSetHash: aggregate.memberSetHash,
    memberCount: aggregate.expectedMemberCount,
  };
  const release = {
    planHash: aggregate.planHash,
    runManifestHash: aggregate.runManifestHash,
    universeVersion: aggregate.universeVersion,
    assessmentCutoffAt: aggregate.assessmentCutoffAt,
    expectedMemberCount: aggregate.expectedMemberCount,
    memberSetHash: aggregate.memberSetHash,
    memberIndexHash: aggregate.memberIndexHash,
    redditSliceId: aggregate.platforms.reddit.sliceId,
    redditStatus: aggregate.platforms.reddit.status,
    redditOutcomeHash: aggregate.platforms.reddit.outcomeHash,
    xSliceId: aggregate.platforms.x.sliceId,
    xStatus: aggregate.platforms.x.status,
    xOutcomeHash: aggregate.platforms.x.outcomeHash,
    completeCount: aggregate.counts.complete,
    partialCount: aggregate.counts.partial,
    insufficientCount: aggregate.counts.insufficient,
    status: aggregate.status,
    aggregateHash: aggregate.aggregateHash,
    aggregateJson: aggregate,
    storedRedditRunId: runId,
    storedRedditPlatform: 'reddit',
    storedRedditStatus: aggregate.platforms.reddit.status,
    storedXRunId: runId,
    storedXPlatform: 'x',
    storedXStatus: aggregate.platforms.x.status,
  };
  const items = aggregate.members.map((member) => ({
    ordinal: member.ordinal,
    securityId: member.securityId,
    planHash: aggregate.planHash,
    runManifestHash: aggregate.runManifestHash,
    universeVersion: aggregate.universeVersion,
    assessmentCutoffAt: aggregate.assessmentCutoffAt,
    memberSetHash: aggregate.memberSetHash,
    citedSynthesisId: member.citedSynthesisId,
    citedSynthesisResultHash: member.citedSynthesisResultHash,
    storedSynthesisResultHash: member.citedSynthesisResultHash,
    convergenceArtifactId: member.convergenceArtifactId,
    synthesisConvergenceArtifactId: member.convergenceArtifactId,
    convergenceArtifactHash: member.convergenceArtifactHash,
    storedConvergenceArtifactHash: member.convergenceArtifactHash,
    status: member.status,
  }));
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('from rni_run run')) return { rows: [context] };
    if (sql.includes('from rni_worker_run_manifest manifest')) return { rows: [manifest] };
    if (sql.includes('from rni_full_universe_publication_release release'))
      return { rows: overrides?.omitRelease ? [] : [release] };
    if (sql.includes('from rni_full_universe_publication_item item')) return { rows: items };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { aggregate, context, release, items, db: { query } as unknown as Queryable, query };
}

describe('D-RNI-33 result visibility gate', () => {
  it('keeps historical v1 full-universe work compatible without reading v2 release tables', async () => {
    const fixture = releaseFixture({ executionVersion: 'rni-execution-v1' });
    await expect(loadRniResultVisibility(runId, 'test', fixture.db)).resolves.toEqual({
      kind: 'legacy_or_manual',
    });
    expect(fixture.query).toHaveBeenCalledTimes(1);
  });

  it('keeps a v2 manual-ticker result independent of the full-universe release gate', async () => {
    const fixture = releaseFixture();
    fixture.context.scopeKind = 'manual_ticker';
    await expect(loadRniResultVisibility(runId, 'test', fixture.db)).resolves.toEqual({
      kind: 'legacy_or_manual',
    });
    expect(fixture.query).toHaveBeenCalledTimes(1);
  });

  it('returns conflict while a v2 full-universe run has no aggregate release', async () => {
    const fixture = releaseFixture({ omitRelease: true });
    await expect(loadRniResultVisibility(runId, 'test', fixture.db)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('accepts only a complete release whose staged rows retain every exact artifact identity', async () => {
    const fixture = releaseFixture();
    const result = await loadRniResultVisibility(runId, 'test', fixture.db);
    expect(result.kind).toBe('released_v2_full_universe');
    if (result.kind !== 'released_v2_full_universe') throw new Error('Expected release');
    expect(result.items.get(uuid(11))).toEqual(fixture.aggregate.members[0]);
    expect(result.items.get(uuid(12))).toEqual(fixture.aggregate.members[1]);
  });

  it('rejects a staged item crossed to a different durable synthesis result', async () => {
    const fixture = releaseFixture();
    fixture.items[0]!.storedSynthesisResultHash = hash('9');
    await expect(loadRniResultVisibility(runId, 'test', fixture.db)).rejects.toMatchObject({
      code: 'CITATION_INVALID',
    });
  });
});

function evidenceVisibilityFixture(input?: {
  legacy?: boolean;
  candidates?: { runId: string; securityId: string; synthesisId: string }[];
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('select exists (')) return { rows: [{ visible: input?.legacy ?? false }] };
    if (sql.includes('from rni_publication_statement_citation edge'))
      return { rows: input?.candidates ?? [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const store = new ReadSnapshot({ query } as unknown as Queryable, 'test', 'rights-v1');
  return { store, query };
}

describe('v2 citation and evidence result visibility', () => {
  const sourceId = uuid(51);
  const citationId = uuid(52);
  const securityId = uuid(53);
  const synthesisId = uuid(54);
  const releasedItem = {
    ordinal: 1,
    securityId,
    citedSynthesisId: synthesisId,
    citedSynthesisResultHash: hash('4'),
    convergenceArtifactId: uuid(55),
    convergenceArtifactHash: hash('5'),
    status: 'complete' as const,
  };

  it('denies an exact staged citation and source until their full-universe aggregate is released', async () => {
    for (const target of [
      { kind: 'citation' as const, id: citationId },
      { kind: 'source' as const, id: sourceId },
    ]) {
      const fixture = evidenceVisibilityFixture({
        candidates: [{ runId, securityId, synthesisId }],
      });
      vi.spyOn(fixture.store, 'requireResultVisibility').mockRejectedValue(
        new RniReadError('CONFLICT'),
      );
      await expect(fixture.store.requirePublishedEvidenceVisibility(target)).rejects.toMatchObject({
        code: 'CITATION_INVALID',
      });
    }
  });

  it('allows citation and source evidence only through their exact released synthesis member', async () => {
    for (const target of [
      { kind: 'citation' as const, id: citationId },
      { kind: 'source' as const, id: sourceId },
    ]) {
      const fixture = evidenceVisibilityFixture({
        candidates: [{ runId, securityId, synthesisId }],
      });
      const visibility = vi
        .spyOn(fixture.store, 'requireResultVisibility')
        .mockResolvedValue(releasedItem);
      await expect(
        fixture.store.requirePublishedEvidenceVisibility(target),
      ).resolves.toBeUndefined();
      expect(visibility).toHaveBeenCalledWith(runId, securityId);
    }
  });

  it('denies crossed synthesis identities even when the run and security have a release', async () => {
    const fixture = evidenceVisibilityFixture({
      candidates: [{ runId, securityId, synthesisId: uuid(56) }],
    });
    vi.spyOn(fixture.store, 'requireResultVisibility').mockResolvedValue(releasedItem);
    await expect(
      fixture.store.requirePublishedEvidenceVisibility({ kind: 'citation', id: citationId }),
    ).rejects.toMatchObject({ code: 'CITATION_INVALID' });
  });

  it('preserves bounded raw evidence for historical and manual run observations', async () => {
    const fixture = evidenceVisibilityFixture({ legacy: true });
    const visibility = vi.spyOn(fixture.store, 'requireResultVisibility');
    await expect(
      fixture.store.requirePublishedEvidenceVisibility({ kind: 'source', id: sourceId }),
    ).resolves.toBeUndefined();
    expect(visibility).not.toHaveBeenCalled();
    expect(fixture.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      kind: 'citation' as const,
      id: citationId,
      row: { id: citationId },
      call: (store: ReadSnapshot) => store.citation(citationId),
    },
    {
      kind: 'source' as const,
      id: sourceId,
      row: { source_status: 'active' },
      call: (store: ReadSnapshot) => store.evidence(sourceId),
    },
  ])('wires staged $kind denial into the public read path', async ({ kind, id, row, call }) => {
    const query = vi.fn(async () => ({ rows: [row] }));
    const store = new ReadSnapshot({ query } as unknown as Queryable, 'test', 'rights-v1');
    const gate = vi
      .spyOn(store, 'requirePublishedEvidenceVisibility')
      .mockRejectedValue(new RniReadError('CITATION_INVALID'));
    await expect(call(store)).rejects.toMatchObject({ code: 'CITATION_INVALID' });
    expect(gate).toHaveBeenCalledWith({ kind, id });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
