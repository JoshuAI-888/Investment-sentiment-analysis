import type pg from 'pg';
import { describe, expect, it } from 'vitest';

import { canonicalHash } from '@/calc/canonical';
import type { Queryable } from '@/repositories/client';
import { convergePlatformFacts, type RniConvergenceArtifact } from '@/rni/convergence';
import {
  selectRniFullUniversePublicationInput,
  selectRniFullUniversePublicationMember,
} from '@/rni/repositories/full-universe-artifact-selector';
import {
  REDDIT_SLICE_ID,
  RUN_ID,
  SECURITY_ID,
  X_SLICE_ID,
  convergenceRequest,
  nonPublishablePlatform,
  platformInput,
} from '../convergence/fixtures';

const hash = (character: string): string => character.repeat(64);

const REQUEST = {
  runId: RUN_ID,
  planHash: hash('a'),
  runManifestHash: hash('b'),
  universeVersion: '42',
  memberSetHash: hash('c'),
  securityId: SECURITY_ID,
  assessmentCutoffAt: '2026-09-05T12:00:00Z',
  slices: { reddit: REDDIT_SLICE_ID, x: X_SLICE_ID },
} as const;

const summaryStatus = (artifact: RniConvergenceArtifact) => {
  switch (artifact.result.status) {
    case 'COMPLETE_CROSS_SOURCE':
    case 'DIVERGENT_CROSS_SOURCE':
      return 'complete' as const;
    case 'PARTIAL_CROSS_SOURCE':
      return 'partial' as const;
    case 'INSUFFICIENT_CROSS_SOURCE':
      return 'insufficient' as const;
    case 'PENDING_CROSS_SOURCE':
      throw new Error('Test fixture must be terminal');
  }
};

function row(
  artifact = convergePlatformFacts(convergenceRequest()),
  ordinal = 17,
  identityOffset = 0,
): Record<string, unknown> {
  const status = summaryStatus(artifact);
  const securityId = artifact.result.securityId;
  const identified = (value: number) =>
    `00000000-0000-4000-8000-${String(value + identityOffset).padStart(12, '0')}`;
  const summary = {
    id: identified(705),
    runId: RUN_ID,
    securityId,
    status,
    sections: ['Reddit sentiment', 'X sentiment', 'Combined summary'].map((heading) => ({
      heading,
      status,
      text: `${heading} coverage.`,
      citationIds: [],
    })),
    createdAt: '2026-09-05T12:01:00.000000Z',
  };
  const citedResult = {
    summary,
    platformConclusions: artifact.result.platforms,
    statements: [],
    verification: [],
    challenger: {},
    interpretation: 'deterministic_citation_gated_no_pooled_metric',
  };
  return {
    manifest_version: 'rni-worker-manifest-v2',
    manifest_run_id: RUN_ID,
    manifest_plan_hash: REQUEST.planHash,
    run_manifest_hash: REQUEST.runManifestHash,
    manifest_scope_kind: 'full_universe',
    manifest_universe_version: REQUEST.universeVersion,
    manifest_member_set_hash: REQUEST.memberSetHash,
    manifest_assessment_cutoff_at: REQUEST.assessmentCutoffAt,
    manifest_rights_policy_version: 'rni-source-policy-v1',
    member_ordinal: ordinal,
    member_security_id: securityId,
    execution_version: 'rni-execution-v2',
    execution_run_manifest_hash: REQUEST.runManifestHash,
    execution_plan_hash: REQUEST.planHash,
    run_status: 'running',
    run_universe_version: REQUEST.universeVersion,
    run_window_end: REQUEST.assessmentCutoffAt,
    batch_id: identified(707),
    batch_run_id: RUN_ID,
    batch_security_id: securityId,
    batch_assessment_cutoff_at: REQUEST.assessmentCutoffAt,
    batch_rights_policy_version: 'rni-source-policy-v1',
    cited_synthesis_id: summary.id,
    cited_run_id: RUN_ID,
    cited_security_id: securityId,
    cited_convergence_artifact_id: identified(706),
    cited_result_hash: canonicalHash(citedResult),
    cited_request_snapshot: { convergenceArtifact: artifact },
    cited_result_snapshot: citedResult,
    summary_run_id: RUN_ID,
    summary_security_id: securityId,
    summary_reddit_slice_id: REDDIT_SLICE_ID,
    summary_x_slice_id: X_SLICE_ID,
    summary_status: status,
    summary_sections: summary.sections,
    summary_created_at: summary.createdAt,
    convergence_artifact_id: identified(706),
    convergence_run_id: RUN_ID,
    convergence_security_id: securityId,
    convergence_policy_version: artifact.policyVersion,
    convergence_calculation_code_version: artifact.calculationCodeVersion,
    convergence_input_hash: artifact.inputHash,
    convergence_result_hash: artifact.resultHash,
    convergence_artifact_hash: canonicalHash(artifact),
    convergence_input_snapshot: artifact.inputSnapshot,
    convergence_result_snapshot: artifact.result,
    reddit_analytics_slice_id: REDDIT_SLICE_ID,
    x_analytics_slice_id: X_SLICE_ID,
    reddit_slice_status: artifact.result.platforms.reddit.status,
    x_slice_status: artifact.result.platforms.x.status,
    evidence_role_count: 0,
    inactive_evidence_count: 0,
  };
}

function result<R extends pg.QueryResultRow>(rows: readonly R[]): pg.QueryResult<R> {
  return { command: '', rowCount: rows.length, oid: 0, fields: [], rows: [...rows] };
}

class SelectionDatabase implements Queryable {
  constructor(
    readonly rows: readonly Record<string, unknown>[],
    readonly evidenceRows: readonly Record<string, unknown>[] = [],
  ) {}

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    if (text.includes('select role.id as role_id')) {
      expect(values).toEqual(['00000000-0000-4000-8000-000000000707']);
      return result(this.evidenceRows as readonly R[]);
    }
    expect(text).toContain('from rni_worker_run_manifest manifest');
    expect(text).toContain('source.source_status');
    expect(values).toEqual([RUN_ID, SECURITY_ID]);
    return result(this.rows as readonly R[]);
  }
}

class MultiMemberSelectionDatabase implements Queryable {
  readonly selectedSecurityIds: string[] = [];

  constructor(readonly rowsBySecurity: ReadonlyMap<string, Record<string, unknown>>) {}

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    if (text.includes('select role.id as role_id')) return result([] as readonly R[]);
    expect(text).toContain('from rni_worker_run_manifest manifest');
    const securityId = String(values[1]);
    this.selectedSecurityIds.push(securityId);
    const selected = this.rowsBySecurity.get(securityId);
    return result((selected === undefined ? [] : [selected]) as readonly R[]);
  }
}

describe('D-RNI-33 accepted full-universe artifact selection', () => {
  it('returns one exact complete member with accepted E08/E07 hashes', async () => {
    const selected = await selectRniFullUniversePublicationMember(
      REQUEST,
      new SelectionDatabase([row()]),
    );
    expect(selected).toMatchObject({
      runId: REQUEST.runId,
      planHash: REQUEST.planHash,
      runManifestHash: REQUEST.runManifestHash,
      universeVersion: REQUEST.universeVersion,
      memberSetHash: REQUEST.memberSetHash,
      securityId: REQUEST.securityId,
      ordinal: 17,
      citedSynthesisId: '00000000-0000-4000-8000-000000000705',
      convergenceArtifactId: '00000000-0000-4000-8000-000000000706',
      status: 'complete',
    });
    expect(selected).not.toHaveProperty('slices');
  });

  it('derives partial and insufficient status from replayed convergence', async () => {
    const partial = convergePlatformFacts(
      convergenceRequest({ x: platformInput('x', { status: 'partial' }) }),
    );
    const insufficient = convergePlatformFacts(
      convergenceRequest({
        reddit: nonPublishablePlatform('reddit', 'failed'),
        x: nonPublishablePlatform('x', 'unavailable'),
      }),
    );
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([row(partial)])),
    ).resolves.toMatchObject({ status: 'partial' });
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([row(insufficient)])),
    ).resolves.toMatchObject({ status: 'insufficient' });
  });

  it('rejects missing, duplicate, and crossed accepted lineage', async () => {
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([])),
    ).rejects.toThrow('missing accepted cited-synthesis lineage');
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([row(), row()])),
    ).rejects.toThrow('duplicate accepted cited-synthesis lineage');

    const crossed = row();
    crossed.summary_x_slice_id = REDDIT_SLICE_ID;
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([crossed])),
    ).rejects.toThrow('crossed cited-synthesis');
  });

  it('rejects legacy unhashed artifacts and withdrawn evidence', async () => {
    const legacy = row();
    legacy.convergence_artifact_hash = null;
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([legacy])),
    ).rejects.toThrow('unreleased legacy convergence artifact');

    const withdrawn = row();
    withdrawn.inactive_evidence_count = 1;
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([withdrawn])),
    ).rejects.toThrow('withdrawn or rights-ineligible publication evidence');

    const racedWithdrawal = row();
    racedWithdrawal.evidence_role_count = 1;
    await expect(
      selectRniFullUniversePublicationMember(
        REQUEST,
        new SelectionDatabase(
          [racedWithdrawal],
          [
            {
              role_id: '00000000-0000-4000-8000-000000000708',
              source_status: 'withdrawn',
              rights_policy_version: 'rni-source-policy-v1',
            },
          ],
        ),
      ),
    ).rejects.toThrow('withdrawn or rights-ineligible publication evidence');
  });

  it('rejects hash drift and a summary status that was not deterministically derived', async () => {
    const hashDrift = row();
    hashDrift.cited_result_hash = hash('f');
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([hashDrift])),
    ).rejects.toThrow('hash-drifted cited-synthesis artifact');

    const crossedStatus = row();
    crossedStatus.summary_status = 'partial';
    const sections = crossedStatus.summary_sections as Array<Record<string, unknown>>;
    crossedStatus.summary_sections = sections.map((section) => ({ ...section, status: 'partial' }));
    const citedResult = crossedStatus.cited_result_snapshot as Record<string, unknown>;
    citedResult.summary = {
      ...(citedResult.summary as Record<string, unknown>),
      status: 'partial',
      sections: crossedStatus.summary_sections,
    };
    crossedStatus.cited_result_hash = canonicalHash(citedResult);
    await expect(
      selectRniFullUniversePublicationMember(REQUEST, new SelectionDatabase([crossedStatus])),
    ).rejects.toThrow('summary status differs from deterministic convergence');
  });

  it('assembles every exact manifest member against the supplied persisted slice identities', async () => {
    const otherSecurityId = '00000000-0000-4000-8000-000000000712';
    const otherArtifact = convergePlatformFacts(
      convergenceRequest({
        reddit: platformInput('reddit', { securityId: otherSecurityId }),
        x: platformInput('x', { securityId: otherSecurityId }),
      }),
    );
    const firstRow = row(convergePlatformFacts(convergenceRequest()), 1);
    const secondRow = row(otherArtifact, 2, 10);
    const db = new MultiMemberSelectionDatabase(
      new Map([
        [SECURITY_ID, firstRow],
        [otherSecurityId, secondRow],
      ]),
    );
    const identity = {
      runId: REQUEST.runId,
      planHash: REQUEST.planHash,
      runManifestHash: REQUEST.runManifestHash,
      universeVersion: REQUEST.universeVersion,
      assessmentCutoffAt: REQUEST.assessmentCutoffAt,
      memberSetHash: REQUEST.memberSetHash,
    } as const;

    const selected = await selectRniFullUniversePublicationInput(
      {
        manifest: {
          ...identity,
          members: [
            { ordinal: 1, securityId: SECURITY_ID },
            { ordinal: 2, securityId: otherSecurityId },
          ],
        },
        platforms: {
          reddit: {
            ...identity,
            platform: 'reddit',
            sliceId: REDDIT_SLICE_ID,
            status: 'complete',
            outcomeHash: hash('d'),
          },
          x: {
            ...identity,
            platform: 'x',
            sliceId: X_SLICE_ID,
            status: 'complete',
            outcomeHash: hash('e'),
          },
        },
      },
      db,
    );

    expect(db.selectedSecurityIds).toEqual([SECURITY_ID, otherSecurityId]);
    expect(selected.items.map(({ ordinal, securityId }) => ({ ordinal, securityId }))).toEqual([
      { ordinal: 1, securityId: SECURITY_ID },
      { ordinal: 2, securityId: otherSecurityId },
    ]);
    expect(selected.platforms.reddit.sliceId).toBe(REDDIT_SLICE_ID);
    expect(selected.platforms.x.sliceId).toBe(X_SLICE_ID);
  });
});
