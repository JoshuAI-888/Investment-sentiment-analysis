import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import type { Queryable } from '@/repositories/client';
import {
  buildRniFullUniversePublication,
  type RniFullUniversePublication,
  type RniFullUniversePublicationInput,
} from '@/rni/orchestration/full-universe-publication';
import type { RniCombinedFence } from '@/rni/orchestration/types';
import {
  finalizeRniFullUniversePublication,
  stageRniFullUniversePublicationMember,
} from '@/rni/repositories/full-universe-publication';

const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const hash = (character: string): string => character.repeat(64);

const members = [
  { ordinal: 1, securityId: uuid(1) },
  { ordinal: 2, securityId: uuid(2) },
  { ordinal: 3, securityId: uuid(3) },
] as const;

function publication(): RniFullUniversePublication {
  const identity = {
    runId: uuid(100),
    planHash: hash('a'),
    runManifestHash: hash('b'),
    universeVersion: '42',
    assessmentCutoffAt: '2026-09-05T12:00:00.000Z',
    memberSetHash: hash('c'),
  } as const;
  const input: RniFullUniversePublicationInput = {
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
        status: 'partial',
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
      status: index === 2 ? 'insufficient' : 'complete',
    })),
  };
  return buildRniFullUniversePublication(input);
}

function fence(overrides: Partial<RniCombinedFence> = {}): RniCombinedFence {
  return {
    stage: 'combined',
    runId: uuid(100),
    planHash: hash('a'),
    attempt: 1,
    token: uuid(500),
    acquiredAt: '2026-09-05T12:01:00.000Z',
    expiresAt: '2026-09-05T12:02:00.000Z',
    deadline: '2026-09-05T12:03:00.000Z',
    ...overrides,
  };
}

type Row = Record<string, unknown>;

function result<R extends pg.QueryResultRow>(rows: readonly R[]): pg.QueryResult<R> {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

class PublicationDatabase implements Queryable {
  readonly staged = new Map<string, Row>();
  readonly releases = new Map<string, Row>();
  readonly statements: { readonly text: string; readonly values: readonly unknown[] }[] = [];

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    this.statements.push({ text, values });
    if (text.includes('insert into rni_full_universe_publication_item')) {
      const key = `${String(values[0])}:${String(values[2])}`;
      if (this.staged.has(key)) return result<R>([]);
      const row: Row = {
        run_id: values[0],
        ordinal: values[1],
        security_id: values[2],
        plan_hash: values[3],
        run_manifest_hash: values[4],
        universe_version: values[5],
        assessment_cutoff_at: values[6],
        member_set_hash: values[7],
        cited_synthesis_id: values[8],
        cited_synthesis_result_hash: values[9],
        convergence_artifact_id: values[10],
        convergence_artifact_hash: values[11],
        status: values[12],
        stage_attempt: values[13],
        stage_token: values[14],
        stage_acquired_at: values[15],
        stage_expires_at: values[16],
      };
      this.staged.set(key, row);
      return result([row as R]);
    }
    if (text.includes('from rni_full_universe_publication_item')) {
      const row = this.staged.get(`${String(values[0])}:${String(values[1])}`);
      return result(row === undefined ? [] : [row as R]);
    }
    if (text.includes('insert into rni_full_universe_publication_release')) {
      const key = String(values[0]);
      if (this.releases.has(key)) return result<R>([]);
      const row: Row = {
        run_id: values[0],
        plan_hash: values[1],
        run_manifest_hash: values[2],
        universe_version: values[3],
        assessment_cutoff_at: values[4],
        expected_member_count: values[5],
        member_set_hash: values[6],
        member_index_hash: values[7],
        reddit_slice_id: values[8],
        reddit_status: values[9],
        reddit_outcome_hash: values[10],
        x_slice_id: values[11],
        x_status: values[12],
        x_outcome_hash: values[13],
        complete_count: values[14],
        partial_count: values[15],
        insufficient_count: values[16],
        status: values[17],
        aggregate_hash: values[18],
        aggregate_json: JSON.parse(String(values[19])),
        combined_attempt: values[20],
        combined_token: values[21],
        combined_acquired_at: values[22],
        combined_expires_at: values[23],
        released_at: values[24],
      };
      this.releases.set(key, row);
      return result([row as R]);
    }
    if (text.includes('from rni_full_universe_publication_release')) {
      const row = this.releases.get(String(values[0]));
      return result(row === undefined ? [] : [row as R]);
    }
    throw new Error(`Unexpected publication query: ${text}`);
  }
}

describe('D-RNI-33 full-universe publication persistence', () => {
  it('stages one exact member and treats an exact replay as a no-op', async () => {
    const db = new PublicationDatabase();
    const aggregate = publication();
    await expect(
      stageRniFullUniversePublicationMember(aggregate, uuid(2), fence(), db),
    ).resolves.toMatchObject({ disposition: 'inserted', member: { ordinal: 2, securityId: uuid(2) } });
    await expect(
      stageRniFullUniversePublicationMember(aggregate, uuid(2), fence(), db),
    ).resolves.toMatchObject({ disposition: 'duplicate', member: { ordinal: 2 } });
    expect(db.staged).toHaveLength(1);
    expect(db.statements[0]?.text).toContain('on conflict do nothing');
    expect(db.statements[0]?.values).toHaveLength(17);
  });

  it('reuses an exact immutable stage after a later lease attempt takes authority', async () => {
    const db = new PublicationDatabase();
    const aggregate = publication();
    await stageRniFullUniversePublicationMember(aggregate, uuid(2), fence(), db);
    await expect(
      stageRniFullUniversePublicationMember(
        aggregate,
        uuid(2),
        fence({
          attempt: 2,
          token: uuid(501),
          acquiredAt: '2026-09-05T12:02:00.000Z',
          expiresAt: '2026-09-05T12:03:00.000Z',
          deadline: '2026-09-05T12:04:00.000Z',
        }),
        db,
      ),
    ).resolves.toMatchObject({ disposition: 'duplicate', member: { securityId: uuid(2) } });
    expect(db.staged).toHaveLength(1);
  });

  it('fails closed on a crossed staged replay, member, or fence', async () => {
    const db = new PublicationDatabase();
    const aggregate = publication();
    await stageRniFullUniversePublicationMember(aggregate, uuid(1), fence(), db);
    const staged = db.staged.values().next().value;
    if (staged === undefined) throw new Error('Expected staged fixture row');
    staged.convergence_artifact_hash = hash('f');

    await expect(
      stageRniFullUniversePublicationMember(aggregate, uuid(1), fence(), db),
    ).rejects.toThrow('crossed or partial staged member replay');
    await expect(
      stageRniFullUniversePublicationMember(aggregate, uuid(999), fence(), db),
    ).rejects.toThrow('not in the exact release member index');
    await expect(
      stageRniFullUniversePublicationMember(
        aggregate,
        uuid(2),
        fence({ planHash: hash('f') }),
        db,
      ),
    ).rejects.toThrow('crossed publication and combined-fence identity');
  });

  it('inserts every aggregate release projection and returns the exact receipt artifact', async () => {
    const db = new PublicationDatabase();
    const aggregate = publication();
    const releasedAt = '2026-09-05T12:01:30.000Z';
    const first = await finalizeRniFullUniversePublication(
      aggregate,
      fence(),
      releasedAt,
      db,
    );
    expect(first).toMatchObject({
      disposition: 'inserted',
      releasedAt: '2026-09-05T12:01:30.000000Z',
      artifact: {
        runId: aggregate.runId,
        planHash: aggregate.planHash,
        artifactHash: aggregate.aggregateHash,
        status: aggregate.status,
      },
    });
    expect(db.statements[0]?.values).toHaveLength(25);
    expect(db.statements[0]?.values[19]).toBe(JSON.stringify(aggregate));

    await expect(
      finalizeRniFullUniversePublication(aggregate, fence(), releasedAt, db),
    ).resolves.toMatchObject({ disposition: 'duplicate' });
    expect(db.releases).toHaveLength(1);
  });

  it('rejects crossed release replay, malformed aggregate bytes, and an expired release', async () => {
    const db = new PublicationDatabase();
    const aggregate = publication();
    const releasedAt = '2026-09-05T12:01:30.000Z';
    await finalizeRniFullUniversePublication(aggregate, fence(), releasedAt, db);
    const saved = db.releases.get(aggregate.runId)!;
    saved.member_index_hash = hash('f');
    await expect(
      finalizeRniFullUniversePublication(aggregate, fence(), releasedAt, db),
    ).rejects.toThrow('crossed or partial aggregate release replay');

    saved.member_index_hash = aggregate.memberIndexHash;
    saved.aggregate_json = { ...aggregate, aggregateHash: hash('f') };
    await expect(
      finalizeRniFullUniversePublication(aggregate, fence(), releasedAt, db),
    ).rejects.toThrow('malformed aggregate release JSON');

    await expect(
      finalizeRniFullUniversePublication(
        aggregate,
        fence(),
        '2026-09-05T12:02:00.000Z',
        new PublicationDatabase(),
      ),
    ).rejects.toThrow('outside the combined authority window');
  });

  it('rejects a tampered build output before any database write', async () => {
    const db = new PublicationDatabase();
    const tampered = { ...publication(), aggregateHash: hash('f') };
    await expect(
      finalizeRniFullUniversePublication(tampered, fence(), '2026-09-05T12:01:30.000Z', db),
    ).rejects.toThrow('Aggregate hash');
    expect(db.statements).toHaveLength(0);
  });
});
