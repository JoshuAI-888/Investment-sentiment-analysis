import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { hashRniModelInput } from '@/rni/agents/model-input';
import { rniSourceItem, type RniSourceItem } from '@/rni/contracts';
import type { RniExecutionLease } from '@/rni/orchestration/execution';
import { executionRecord, platformDelivery, type RniOrchestrationTransaction } from '@/rni/orchestration/types';
import {
  hashRniWorkerManifest,
  hashRniWorkerSnapshotValue,
  parseRniWorkerManifest,
} from '@/rni/orchestration/worker-manifest';
import {
  claimRniSourceWorkflowCheckpoint,
  completeRniSourceWorkflowCheckpoint,
  failRniSourceWorkflowCheckpoint,
  heartbeatRniSourceWorkflowCheckpoint,
  retryRniSourceWorkflowCheckpoint,
  rniSourceWorkflowAuthorityV2,
  rniSourceWorkflowCheckpointV2,
  rniSourceWorkflowDeliveryV2,
  stopRniSourceWorkflowForBudget,
  type RniSourceWorkflowAuthorityV2,
  type RniSourceWorkflowCheckpointV2,
  type RniSourceWorkflowClaimResult,
  type RniSourceWorkflowDeliveryV2,
  type RniSourceWorkflowRetryResult,
} from '@/rni/workflow/checkpoint';
import type { Queryable } from '@/repositories/client';
import { queryableForRniOrchestrationTransaction } from './orchestration';
import {
  persistRniSourceInTransaction,
  type RniSourcePersistenceResult,
} from './source-items';

const partitionName = z.string().min(1).max(200);
const identifier = z.string().min(1).max(200);
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const stableCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);

export const rniSourceWorkflowOutputManifestV2 = z
  .object({
    version: z.literal('rni-source-workflow-output-v2'),
    runId: uuid,
    runManifestHash: digest,
    platform: z.enum(['reddit', 'x']),
    sourceItemId: uuid,
    retrievalId: uuid,
    contentVersionId: uuid,
    outboxEventId: uuid,
    semanticOutputHash: digest,
  })
  .strict();

export type RniSourceWorkflowOutputManifestV2 = z.infer<
  typeof rniSourceWorkflowOutputManifestV2
>;

export type RniStoredSourceWorkflowCheckpoint = {
  readonly deliveryId: string;
  readonly revision: number;
  readonly checkpoint: RniSourceWorkflowCheckpointV2;
  readonly outputManifest: RniSourceWorkflowOutputManifestV2 | null;
};

export type RniRegisteredSourceWorkflow = RniSourcePersistenceResult &
  RniStoredSourceWorkflowCheckpoint & {
    readonly claim: Exclude<RniSourceWorkflowClaimResult, { readonly kind: 'expired' }>;
  };

export type RniExactSourceWorkflowEvidence = {
  readonly deliveryId: string;
  readonly delivery: RniSourceWorkflowDeliveryV2;
  readonly source: RniSourceItem;
  readonly retrievalCreatedAt: string;
  readonly contentVersionCreatedAt: string;
  readonly outboxCreatedAt: string;
};

export type RniSourceWorkflowRepositoryErrorCode =
  | 'DELIVERY_CONFLICT'
  | 'MISSING_CHECKPOINT'
  | 'OUTPUT_CONFLICT'
  | 'RIGHTS_POLICY_CONFLICT'
  | 'STALE_CHILD_LEASE'
  | 'STALE_PARENT_AUTHORITY'
  | 'STALE_REVISION';

export class RniSourceWorkflowRepositoryError extends Error {
  override readonly name = 'RniSourceWorkflowRepositoryError';

  constructor(readonly code: RniSourceWorkflowRepositoryErrorCode) {
    super(code);
  }
}

type DeliveryRow = {
  readonly id: string;
  readonly partition: string;
  readonly run_id: string;
  readonly plan_hash: string;
  readonly run_manifest_hash: string;
  readonly platform: 'reddit' | 'x';
  readonly outer_attempt: number;
  readonly outer_token: string;
  readonly deadline: Date | string;
  readonly source_item_id: string;
  readonly retrieval_id: string;
  readonly content_version_id: string;
  readonly source_outbox_event_id: string;
  readonly stage: 'interpret_source';
  readonly stage_version: string;
  readonly lease_ms: number;
  readonly base_backoff_ms: number;
  readonly max_backoff_ms: number;
  readonly input_hash: string;
};

type CheckpointRow = {
  readonly status: RniSourceWorkflowCheckpointV2['status'];
  readonly attempt: number;
  readonly started_at: Date | string;
  readonly updated_at: Date | string;
  readonly revision: number;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly lease_acquired_at: Date | string | null;
  readonly lease_expires_at: Date | string | null;
  readonly not_before: Date | string | null;
  readonly retry_error_code: string | null;
  readonly retry_failed_at: Date | string | null;
  readonly retry_delay_ms: number | null;
  readonly output_manifest: unknown | null;
  readonly output_hash: string | null;
  readonly completed_at: Date | string | null;
  readonly terminal_kind: 'permanent_failure' | 'budget_stopped' | null;
  readonly terminal_error_code: string | null;
  readonly terminal_cause_code: string | null;
  readonly terminal_budget_reason:
    | 'attempts'
    | 'wall_time'
    | 'sources'
    | 'input_tokens'
    | 'output_tokens'
    | 'cost'
    | 'cancelled'
    | null;
  readonly terminal_at: Date | string | null;
};

type ExactEvidenceRow = {
  readonly source_kind: string;
  readonly external_id: string | null;
  readonly canonical_url: string;
  readonly subreddit_or_scope: string;
  readonly author_handle_hash: string | null;
  readonly title: string | null;
  readonly published_at: Date | string | null;
  readonly rights_policy_version: string;
  readonly source_created_at: Date | string;
  readonly returned_url: string;
  readonly search_query_id: string | null;
  readonly provider_request_id: string | null;
  readonly discovered_at: Date | string;
  readonly observed_at: Date | string;
  readonly metadata_json: unknown;
  readonly retrieval_created_at: Date | string;
  readonly bounded_content: string;
  readonly content_sha256: string;
  readonly capture_mode: string;
  readonly content_created_at: Date | string;
  readonly event_type: string;
  readonly payload_json: unknown;
  readonly outbox_created_at: Date | string;
};

type ManifestRightsRow = {
  readonly manifest: unknown;
  readonly run_manifest_hash: string;
  readonly authority_version: string;
  readonly authority_snapshot_hash: string;
  readonly authority_value: unknown;
};

const DELIVERY_COLUMNS = `
  id, partition, run_id, plan_hash, run_manifest_hash, platform, outer_attempt, outer_token,
  deadline, source_item_id, retrieval_id, content_version_id, source_outbox_event_id, stage,
  stage_version, lease_ms, base_backoff_ms, max_backoff_ms, input_hash
`;

const CHECKPOINT_COLUMNS = `
  status, attempt, started_at, updated_at, revision, lease_owner, lease_token,
  lease_acquired_at, lease_expires_at, not_before, retry_error_code, retry_failed_at,
  retry_delay_ms, output_manifest, output_hash, completed_at, terminal_kind,
  terminal_error_code, terminal_cause_code, terminal_budget_reason, terminal_at
`;

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function deliveryFromRow(row: DeliveryRow): RniSourceWorkflowDeliveryV2 {
  return rniSourceWorkflowDeliveryV2.parse({
    version: 'rni-source-workflow-delivery-v2',
    subject: {
      version: 'rni-source-workflow-subject-v2',
      runId: row.run_id,
      planHash: row.plan_hash,
      runManifestHash: row.run_manifest_hash,
      platform: row.platform,
      outerAttempt: row.outer_attempt,
      outerToken: row.outer_token,
      deadline: instant(row.deadline),
      workflowPolicy: {
        leaseMs: row.lease_ms,
        baseBackoffMs: row.base_backoff_ms,
        maxBackoffMs: row.max_backoff_ms,
      },
      sourceItemId: row.source_item_id,
      retrievalId: row.retrieval_id,
      contentVersionId: row.content_version_id,
      outboxEventId: row.source_outbox_event_id,
      stage: row.stage,
      stageVersion: row.stage_version,
    },
    inputHash: row.input_hash,
  });
}

function checkpointFromRows(
  delivery: RniSourceWorkflowDeliveryV2,
  row: CheckpointRow,
): RniSourceWorkflowCheckpointV2 {
  const terminal =
    row.terminal_kind === 'permanent_failure'
      ? {
          kind: 'permanent_failure' as const,
          errorCode: row.terminal_error_code,
          causeCode: row.terminal_cause_code,
          failedAt: row.terminal_at === null ? null : instant(row.terminal_at),
        }
      : row.terminal_kind === 'budget_stopped'
        ? {
            kind: 'budget_stopped' as const,
            reason: row.terminal_budget_reason,
            stoppedAt: row.terminal_at === null ? null : instant(row.terminal_at),
          }
        : null;
  return rniSourceWorkflowCheckpointV2.parse({
    version: 'rni-source-workflow-checkpoint-v2',
    delivery,
    status: row.status,
    attempt: row.attempt,
    startedAt: instant(row.started_at),
    updatedAt: instant(row.updated_at),
    lease:
      row.lease_owner === null
        ? null
        : {
            owner: row.lease_owner,
            token: row.lease_token,
            acquiredAt: row.lease_acquired_at === null ? null : instant(row.lease_acquired_at),
            expiresAt: row.lease_expires_at === null ? null : instant(row.lease_expires_at),
          },
    notBefore: row.not_before === null ? null : instant(row.not_before),
    retry:
      row.retry_error_code === null
        ? null
        : {
            errorCode: row.retry_error_code,
            failedAt: row.retry_failed_at === null ? null : instant(row.retry_failed_at),
            delayMs: row.retry_delay_ms,
          },
    outputHash: row.output_hash,
    completedAt: row.completed_at === null ? null : instant(row.completed_at),
    terminal,
  });
}

function assertExactDelivery(
  expectedPartition: string,
  expected: RniSourceWorkflowDeliveryV2,
  row: DeliveryRow,
): void {
  if (
    row.partition !== expectedPartition ||
    hashRniModelInput(deliveryFromRow(row)) !== hashRniModelInput(expected)
  ) {
    throw new RniSourceWorkflowRepositoryError('DELIVERY_CONFLICT');
  }
}

function assertOutputManifest(
  delivery: RniSourceWorkflowDeliveryV2,
  rawManifest: unknown,
  outputHash: string,
): RniSourceWorkflowOutputManifestV2 {
  const manifest = rniSourceWorkflowOutputManifestV2.parse(rawManifest);
  const subject = delivery.subject;
  if (
    manifest.runId !== subject.runId ||
    manifest.runManifestHash !== subject.runManifestHash ||
    manifest.platform !== subject.platform ||
    manifest.sourceItemId !== subject.sourceItemId ||
    manifest.retrievalId !== subject.retrievalId ||
    manifest.contentVersionId !== subject.contentVersionId ||
    manifest.outboxEventId !== subject.outboxEventId ||
    hashRniModelInput(manifest) !== outputHash
  ) {
    throw new RniSourceWorkflowRepositoryError('OUTPUT_CONFLICT');
  }
  return manifest;
}

async function lockParentOrder(partition: string, db: Queryable): Promise<void> {
  await db.query(
    `select pg_advisory_xact_lock(hashtextextended('rni-ai-budget:' || $1, 0))`,
    [partition],
  );
  await db.query(
    `select pg_advisory_xact_lock(hashtextextended('rni-orchestration:' || $1, 0))`,
    [partition],
  );
}

async function lockDeliverySlot(
  delivery: RniSourceWorkflowDeliveryV2,
  db: Queryable,
): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `rni-source-workflow:${delivery.subject.runId}:${delivery.subject.platform}:${delivery.subject.sourceItemId}:${delivery.subject.stage}`,
  ]);
}

async function databaseNow(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ now: Date | string }>(
    `select date_trunc('milliseconds', clock_timestamp()) as now`,
  );
  return instant(rows[0]!.now);
}

async function requireLiveParentAuthority(
  partition: string,
  authority: RniSourceWorkflowAuthorityV2,
  db: Queryable,
): Promise<void> {
  const parsed = rniSourceWorkflowAuthorityV2.parse(authority);
  const { rows } = await db.query<{ record: unknown; database_now: Date | string }>(
    `select record, clock_timestamp() as database_now from rni_orchestration_execution
      where partition = $1 and run_id = $2 for update`,
    [partition, parsed.runId],
  );
  const raw = rows[0]?.record;
  if (raw === undefined) throw new RniSourceWorkflowRepositoryError('STALE_PARENT_AUTHORITY');
  const record = executionRecord.parse(raw);
  const state = record.platforms[parsed.platform];
  const now = Date.parse(instant(rows[0]!.database_now));
  if (
    record.version !== 'rni-execution-v2' ||
    record.runManifestHash !== parsed.runManifestHash ||
    record.planHash !== parsed.planHash ||
    record.deadline !== parsed.deadline ||
    record.run.status !== 'running' ||
    state.slice.status !== 'running' ||
    state.attempt !== parsed.outerAttempt ||
    state.lease?.token !== parsed.outerToken ||
    state.slice.lastAttemptAt !== parsed.outerLease.acquiredAt ||
    state.lease.expiresAt !== parsed.outerLease.expiresAt ||
    Date.parse(parsed.outerLease.expiresAt) <= now ||
    Date.parse(parsed.deadline) <= now ||
    record.plan.leaseMs !== parsed.workflowPolicy.leaseMs ||
    record.plan.baseBackoffMs !== parsed.workflowPolicy.baseBackoffMs ||
    record.plan.maxBackoffMs !== parsed.workflowPolicy.maxBackoffMs
  ) {
    throw new RniSourceWorkflowRepositoryError('STALE_PARENT_AUTHORITY');
  }
}

async function exactManifestRightsPolicyVersion(
  authority: RniSourceWorkflowAuthorityV2,
  db: Queryable,
): Promise<string> {
  const parsed = rniSourceWorkflowAuthorityV2.parse(authority);
  const { rows } = await db.query<ManifestRightsRow>(
    `select manifest.manifest, manifest.run_manifest_hash,
            rights.version as authority_version,
            rights.snapshot_hash as authority_snapshot_hash,
            rights.value as authority_value
       from rni_worker_run_manifest manifest
       join rni_worker_run_manifest_authority rights_link
         on rights_link.run_id=manifest.run_id
        and rights_link.authority_kind='rights_policy'
        and rights_link.authority_key='default'
       join rni_worker_manifest_authority rights
         on rights.authority_kind=rights_link.authority_kind
        and rights.authority_key=rights_link.authority_key
        and rights.version=rights_link.version
        and rights.snapshot_hash=rights_link.snapshot_hash
      where manifest.run_id=$1 and manifest.run_manifest_hash=$2`,
    [parsed.runId, parsed.runManifestHash],
  );
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    throw new RniSourceWorkflowRepositoryError('RIGHTS_POLICY_CONFLICT');
  }
  const manifest = parseRniWorkerManifest(row.manifest);
  if (
    row.run_manifest_hash !== parsed.runManifestHash ||
    hashRniWorkerManifest(manifest) !== parsed.runManifestHash ||
    manifest.runId !== parsed.runId ||
    manifest.source.rightsPolicy.version !== row.authority_version ||
    manifest.source.rightsPolicy.snapshotHash !== row.authority_snapshot_hash ||
    hashRniWorkerSnapshotValue(row.authority_value) !== row.authority_snapshot_hash ||
    hashRniModelInput(manifest.source.rightsPolicy.value) !== hashRniModelInput(row.authority_value)
  ) {
    throw new RniSourceWorkflowRepositoryError('RIGHTS_POLICY_CONFLICT');
  }
  return row.authority_version;
}

function assertDeliveryAuthority(
  delivery: RniSourceWorkflowDeliveryV2,
  authority: RniSourceWorkflowAuthorityV2,
): void {
  const subject = delivery.subject;
  if (
    subject.runId !== authority.runId ||
    subject.planHash !== authority.planHash ||
    subject.runManifestHash !== authority.runManifestHash ||
    subject.platform !== authority.platform ||
    subject.outerAttempt !== authority.outerAttempt ||
    subject.outerToken !== authority.outerToken ||
    subject.deadline !== authority.deadline ||
    hashRniModelInput(subject.workflowPolicy) !== hashRniModelInput(authority.workflowPolicy)
  ) {
    throw new RniSourceWorkflowRepositoryError('STALE_PARENT_AUTHORITY');
  }
}

async function requireRunnableEffectAuthority(
  input: CommonMutationInput,
  deliveryId: string,
  db: Queryable,
): Promise<void> {
  const { rows } = await db.query<{ valid: boolean }>(
    `select exists (
       select 1 from rni_source_workflow_checkpoint checkpoint
        where checkpoint.delivery_id=$1 and checkpoint.status='running'
          and checkpoint.lease_owner=$2 and checkpoint.lease_token=$3::uuid
          and checkpoint.lease_expires_at > clock_timestamp()
     ) as valid`,
    [deliveryId, input.leaseOwner, input.leaseToken],
  );
  if (rows[0]?.valid !== true) {
    throw new RniSourceWorkflowRepositoryError('STALE_CHILD_LEASE');
  }
  await requireLiveParentAuthority(input.partition, input.authority, db);
}

async function readDeliveryRow(
  partition: string,
  delivery: RniSourceWorkflowDeliveryV2,
  db: Queryable,
): Promise<DeliveryRow | null> {
  const { subject } = delivery;
  const { rows } = await db.query<DeliveryRow>(
    `select ${DELIVERY_COLUMNS} from rni_source_workflow_delivery
      where partition = $1 and run_id = $2 and platform = $3 and source_item_id = $4
        and stage = $5 for update`,
    [partition, subject.runId, subject.platform, subject.sourceItemId, subject.stage],
  );
  const row = rows[0] ?? null;
  if (row !== null) assertExactDelivery(partition, delivery, row);
  return row;
}

async function readStored(
  partition: string,
  delivery: RniSourceWorkflowDeliveryV2,
  db: Queryable,
): Promise<RniStoredSourceWorkflowCheckpoint | null> {
  const deliveryRow = await readDeliveryRow(partition, delivery, db);
  if (deliveryRow === null) return null;
  const { rows } = await db.query<CheckpointRow>(
    `select ${CHECKPOINT_COLUMNS} from rni_source_workflow_checkpoint
      where delivery_id = $1 for update`,
    [deliveryRow.id],
  );
  const row = rows[0];
  if (row === undefined) throw new RniSourceWorkflowRepositoryError('MISSING_CHECKPOINT');
  const checkpoint = checkpointFromRows(delivery, row);
  let outputManifest: RniSourceWorkflowOutputManifestV2 | null = null;
  if (checkpoint.status === 'completed') {
    if (row.output_manifest === null || checkpoint.outputHash === null) {
      throw new RniSourceWorkflowRepositoryError('OUTPUT_CONFLICT');
    }
    outputManifest = assertOutputManifest(delivery, row.output_manifest, checkpoint.outputHash);
  } else if (row.output_manifest !== null) {
    throw new RniSourceWorkflowRepositoryError('OUTPUT_CONFLICT');
  }
  return { deliveryId: deliveryRow.id, revision: row.revision, checkpoint, outputManifest };
}

function checkpointValues(
  checkpoint: RniSourceWorkflowCheckpointV2,
  outputManifest: RniSourceWorkflowOutputManifestV2 | null,
): readonly unknown[] {
  const lease = checkpoint.lease;
  const retry = checkpoint.retry;
  const terminal = checkpoint.terminal;
  return [
    checkpoint.status,
    checkpoint.attempt,
    checkpoint.startedAt,
    checkpoint.updatedAt,
    lease?.owner ?? null,
    lease?.token ?? null,
    lease?.acquiredAt ?? null,
    lease?.expiresAt ?? null,
    checkpoint.notBefore,
    retry?.errorCode ?? null,
    retry?.failedAt ?? null,
    retry?.delayMs ?? null,
    outputManifest === null ? null : JSON.stringify(outputManifest),
    checkpoint.outputHash,
    checkpoint.completedAt,
    terminal?.kind ?? null,
    terminal?.kind === 'permanent_failure' ? terminal.errorCode : null,
    terminal?.kind === 'permanent_failure' ? terminal.causeCode : null,
    terminal?.kind === 'budget_stopped' ? terminal.reason : null,
    terminal?.kind === 'permanent_failure'
      ? terminal.failedAt
      : terminal?.kind === 'budget_stopped'
        ? terminal.stoppedAt
        : null,
  ];
}

async function insertDeliveryAndCheckpoint(
  partition: string,
  delivery: RniSourceWorkflowDeliveryV2,
  checkpoint: RniSourceWorkflowCheckpointV2,
  db: Queryable,
  newId: () => string,
): Promise<RniStoredSourceWorkflowCheckpoint> {
  const deliveryId = uuid.parse(newId());
  const subject = delivery.subject;
  await db.query(
    `insert into rni_source_workflow_delivery (
       id, partition, run_id, plan_hash, run_manifest_hash, platform, outer_attempt, outer_token,
       deadline, source_item_id, retrieval_id, content_version_id, source_outbox_event_id, stage,
       stage_version, lease_ms, base_backoff_ms, max_backoff_ms, input_hash
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      deliveryId,
      partition,
      subject.runId,
      subject.planHash,
      subject.runManifestHash,
      subject.platform,
      subject.outerAttempt,
      subject.outerToken,
      subject.deadline,
      subject.sourceItemId,
      subject.retrievalId,
      subject.contentVersionId,
      subject.outboxEventId,
      subject.stage,
      subject.stageVersion,
      subject.workflowPolicy.leaseMs,
      subject.workflowPolicy.baseBackoffMs,
      subject.workflowPolicy.maxBackoffMs,
      delivery.inputHash,
    ],
  );
  const values = checkpointValues(checkpoint, null);
  await db.query(
    `insert into rni_source_workflow_checkpoint (
       delivery_id, status, attempt, started_at, updated_at, lease_owner, lease_token,
       lease_acquired_at, lease_expires_at, not_before, retry_error_code, retry_failed_at,
       retry_delay_ms, output_manifest, output_hash, completed_at, terminal_kind,
       terminal_error_code, terminal_cause_code, terminal_budget_reason, terminal_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21)`,
    [deliveryId, ...values],
  );
  return { deliveryId, revision: 1, checkpoint, outputManifest: null };
}

async function updateCheckpoint(
  stored: RniStoredSourceWorkflowCheckpoint,
  next: RniSourceWorkflowCheckpointV2,
  outputManifest: RniSourceWorkflowOutputManifestV2 | null,
  db: Queryable,
): Promise<RniStoredSourceWorkflowCheckpoint> {
  if (hashRniModelInput(stored.checkpoint) === hashRniModelInput(next)) {
    return stored;
  }
  const values = checkpointValues(next, outputManifest);
  const { rows } = await db.query<{ revision: number }>(
    `update rni_source_workflow_checkpoint set
       status=$1, attempt=$2, started_at=$3, updated_at=$4, lease_owner=$5, lease_token=$6,
       lease_acquired_at=$7, lease_expires_at=$8, not_before=$9, retry_error_code=$10,
       retry_failed_at=$11, retry_delay_ms=$12, output_manifest=$13::jsonb, output_hash=$14,
       completed_at=$15, terminal_kind=$16, terminal_error_code=$17, terminal_cause_code=$18,
       terminal_budget_reason=$19, terminal_at=$20, revision=revision+1
     where delivery_id=$21 and revision=$22 and status=$23
       and lease_owner is not distinct from $24 and lease_token is not distinct from $25::uuid
     returning revision`,
    [
      ...values,
      stored.deliveryId,
      stored.revision,
      stored.checkpoint.status,
      stored.checkpoint.lease?.owner ?? null,
      stored.checkpoint.lease?.token ?? null,
    ],
  );
  const revision = rows[0]?.revision;
  if (revision === undefined) throw new RniSourceWorkflowRepositoryError('STALE_REVISION');
  return { deliveryId: stored.deliveryId, revision, checkpoint: next, outputManifest };
}

function workflowInputHash(
  delivery: Omit<RniSourceWorkflowDeliveryV2, 'inputHash'>,
  contentSha256: string,
): string {
  return hashRniModelInput({
    version: 'rni-source-workflow-input-v2',
    subject: delivery.subject,
    contentSha256,
  });
}

type CommonMutationInput = {
  readonly partition: string;
  readonly delivery: RniSourceWorkflowDeliveryV2;
  readonly authority: RniSourceWorkflowAuthorityV2;
  readonly leaseOwner: string;
  readonly leaseToken: string;
};

/**
 * D-RNI-34 persistence. Every method requires the caller's active orchestration transaction;
 * this adapter never opens a transaction and never performs provider I/O.
 */
export class PostgresRniSourceWorkflowCheckpointRepository {
  constructor(private readonly newId: () => string = randomUUID) {}

  async registerSourceAndClaim(
    input: {
      readonly partition: string;
      readonly outerLease: RniExecutionLease;
      readonly authority: RniSourceWorkflowAuthorityV2;
      readonly source: RniSourceItem;
      readonly stageVersion: string;
      readonly leaseOwner: string;
      readonly leaseToken: string;
    },
    transaction: RniOrchestrationTransaction,
  ): Promise<RniRegisteredSourceWorkflow> {
    const db = queryableForRniOrchestrationTransaction(transaction);
    const partition = partitionName.parse(input.partition);
    const outerDelivery = platformDelivery.parse(input.outerLease.delivery);
    const authority = rniSourceWorkflowAuthorityV2.parse(input.authority);
    if (
      outerDelivery.version !== 'rni-platform-v2' ||
      outerDelivery.runId !== authority.runId ||
      outerDelivery.planHash !== authority.planHash ||
      outerDelivery.runManifestHash !== authority.runManifestHash ||
      outerDelivery.platform !== authority.platform ||
      outerDelivery.attempt !== authority.outerAttempt ||
      uuid.parse(input.outerLease.token) !== authority.outerToken
    ) {
      throw new RniSourceWorkflowRepositoryError('STALE_PARENT_AUTHORITY');
    }
    await lockParentOrder(partition, db);
    await requireLiveParentAuthority(partition, authority, db);
    const rightsPolicyVersion = await exactManifestRightsPolicyVersion(authority, db);
    if (input.source.rightsPolicyVersion !== rightsPolicyVersion) {
      throw new RniSourceWorkflowRepositoryError('RIGHTS_POLICY_CONFLICT');
    }
    const source = await persistRniSourceInTransaction(input.source, db);
    if (source.source.platform !== authority.platform) {
      throw new RniSourceWorkflowRepositoryError('DELIVERY_CONFLICT');
    }
    const subject = {
      version: 'rni-source-workflow-subject-v2' as const,
      runId: authority.runId,
      planHash: authority.planHash,
      runManifestHash: authority.runManifestHash,
      platform: authority.platform,
      outerAttempt: authority.outerAttempt,
      outerToken: authority.outerToken,
      deadline: authority.deadline,
      workflowPolicy: authority.workflowPolicy,
      sourceItemId: source.source.id,
      retrievalId: source.retrievalId,
      contentVersionId: source.contentVersionId,
      outboxEventId: source.outboxEventId,
      stage: 'interpret_source' as const,
      stageVersion: identifier.parse(input.stageVersion),
    };
    const delivery = rniSourceWorkflowDeliveryV2.parse({
      version: 'rni-source-workflow-delivery-v2',
      subject,
      inputHash: workflowInputHash(
        { version: 'rni-source-workflow-delivery-v2', subject },
        input.source.contentSha256,
      ),
    });
    const result = await this.claimWithDatabase(
      {
        partition,
        delivery,
        authority,
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
      },
      db,
    );
    if (result.kind === 'expired') {
      throw new RniSourceWorkflowRepositoryError('STALE_PARENT_AUTHORITY');
    }
    const stored = await readStored(partition, delivery, db);
    if (stored === null) throw new RniSourceWorkflowRepositoryError('MISSING_CHECKPOINT');
    return { ...source, ...stored, claim: result };
  }

  async load(
    partitionInput: string,
    deliveryInput: RniSourceWorkflowDeliveryV2,
    transaction: RniOrchestrationTransaction,
  ): Promise<RniStoredSourceWorkflowCheckpoint | null> {
    const partition = partitionName.parse(partitionInput);
    const delivery = rniSourceWorkflowDeliveryV2.parse(deliveryInput);
    return readStored(partition, delivery, queryableForRniOrchestrationTransaction(transaction));
  }

  /**
   * Loads the exact retrieval/content/outbox quartet selected by the immutable delivery. Callers
   * must end their transaction before invoking a provider with the returned bounded evidence.
   */
  async loadExactEvidence(
    input: CommonMutationInput,
    transaction: RniOrchestrationTransaction,
  ): Promise<RniExactSourceWorkflowEvidence> {
    const partition = partitionName.parse(input.partition);
    const delivery = rniSourceWorkflowDeliveryV2.parse(input.delivery);
    const authority = rniSourceWorkflowAuthorityV2.parse(input.authority);
    const leaseOwner = identifier.parse(input.leaseOwner);
    const leaseToken = uuid.parse(input.leaseToken);
    assertDeliveryAuthority(delivery, authority);
    const db = queryableForRniOrchestrationTransaction(transaction);
    await lockParentOrder(partition, db);
    await requireLiveParentAuthority(partition, authority, db);
    const rightsPolicyVersion = await exactManifestRightsPolicyVersion(authority, db);
    await lockDeliverySlot(delivery, db);
    const stored = await readStored(partition, delivery, db);
    if (stored === null) throw new RniSourceWorkflowRepositoryError('MISSING_CHECKPOINT');
    const subject = delivery.subject;
    const { rows } = await db.query<ExactEvidenceRow>(
      `select s.source_kind, s.external_id, s.canonical_url, s.subreddit_or_scope,
              s.author_handle_hash, s.title, s.published_at, s.rights_policy_version,
              s.created_at as source_created_at, retrieval.returned_url,
              retrieval.search_query_id, retrieval.provider_request_id,
              retrieval.discovered_at, retrieval.observed_at, retrieval.metadata_json,
              retrieval.created_at as retrieval_created_at, content.bounded_content,
              content.content_sha256, content.capture_mode,
              content.created_at as content_created_at, event.event_type, event.payload_json,
              event.created_at as outbox_created_at
         from rni_source_workflow_delivery delivery
         join rni_source_item s
           on s.id = delivery.source_item_id and s.platform = delivery.platform
         join rni_source_retrieval retrieval
           on retrieval.id = delivery.retrieval_id
          and retrieval.source_item_id = delivery.source_item_id
         join rni_source_content_version content
           on content.id = delivery.content_version_id
          and content.source_item_id = delivery.source_item_id
          and content.source_retrieval_id = delivery.retrieval_id
         join rni_event_outbox event
           on event.id = delivery.source_outbox_event_id
          and event.source_item_id = delivery.source_item_id
          and event.source_retrieval_id = delivery.retrieval_id
          and event.content_version_id = delivery.content_version_id
        where delivery.id = $1`,
      [stored.deliveryId],
    );
    const row = rows[0];
    if (row === undefined || row.event_type !== 'rni.source_persisted.v1') {
      throw new RniSourceWorkflowRepositoryError('DELIVERY_CONFLICT');
    }
    const expectedPayload = {
      sourceItemId: subject.sourceItemId,
      retrievalId: subject.retrievalId,
      contentVersionId: subject.contentVersionId,
    };
    if (
      hashRniModelInput(row.payload_json) !== hashRniModelInput(expectedPayload) ||
      createHash('sha256').update(row.bounded_content, 'utf8').digest('hex') !==
        row.content_sha256
    ) {
      throw new RniSourceWorkflowRepositoryError('DELIVERY_CONFLICT');
    }
    if (row.rights_policy_version !== rightsPolicyVersion) {
      throw new RniSourceWorkflowRepositoryError('RIGHTS_POLICY_CONFLICT');
    }
    const evidence = {
      deliveryId: stored.deliveryId,
      delivery,
      source: rniSourceItem.parse({
        id: subject.sourceItemId,
        platform: subject.platform,
        sourceKind: row.source_kind,
        externalId: row.external_id,
        canonicalUrl: row.canonical_url,
        originalUrl: row.returned_url,
        subredditOrScope: row.subreddit_or_scope,
        authorHandleHash: row.author_handle_hash,
        title: row.title,
        boundedContent: row.bounded_content,
        contentSha256: row.content_sha256,
        captureMode: row.capture_mode,
        publishedAt: row.published_at === null ? null : instant(row.published_at),
        discoveredAt: instant(row.discovered_at),
        observedAt: instant(row.observed_at),
        searchQueryId: row.search_query_id,
        providerRequestId: row.provider_request_id,
        metadata: row.metadata_json,
        rightsPolicyVersion: row.rights_policy_version,
        createdAt: instant(row.source_created_at),
      }),
      retrievalCreatedAt: instant(row.retrieval_created_at),
      contentVersionCreatedAt: instant(row.content_created_at),
      outboxCreatedAt: instant(row.outbox_created_at),
    };
    await requireRunnableEffectAuthority(
      { partition, delivery, authority, leaseOwner, leaseToken },
      stored.deliveryId,
      db,
    );
    return evidence;
  }

  async claim(
    input: CommonMutationInput,
    transaction: RniOrchestrationTransaction,
  ): Promise<RniSourceWorkflowClaimResult> {
    return this.claimWithDatabase(input, queryableForRniOrchestrationTransaction(transaction));
  }

  private async claimWithDatabase(
    input: CommonMutationInput,
    db: Queryable,
  ): Promise<RniSourceWorkflowClaimResult> {
    const partition = partitionName.parse(input.partition);
    const delivery = rniSourceWorkflowDeliveryV2.parse(input.delivery);
    const authority = rniSourceWorkflowAuthorityV2.parse(input.authority);
    const leaseOwner = identifier.parse(input.leaseOwner);
    const leaseToken = uuid.parse(input.leaseToken);
    await lockParentOrder(partition, db);
    await lockDeliverySlot(delivery, db);
    const stored = await readStored(partition, delivery, db);
    const at = await databaseNow(db);
    const result = claimRniSourceWorkflowCheckpoint(stored?.checkpoint ?? null, {
      delivery,
      authority,
      at,
      leaseOwner,
      leaseToken,
      leaseMs: authority.workflowPolicy.leaseMs,
    });
    if (result.kind !== 'acquired' && result.kind !== 'terminal') {
      return result;
    }
    if (
      stored !== null &&
      hashRniModelInput(stored.checkpoint) === hashRniModelInput(result.checkpoint)
    ) {
      return result;
    }
    await requireLiveParentAuthority(partition, authority, db);
    if (stored === null) {
      return {
        kind: 'acquired',
        checkpoint: (
          await insertDeliveryAndCheckpoint(
            partition,
            delivery,
            result.checkpoint,
            db,
            this.newId,
          )
        ).checkpoint,
      };
    }
    const updated = await updateCheckpoint(stored, result.checkpoint, null, db);
    return { kind: result.kind, checkpoint: updated.checkpoint };
  }

  async heartbeat(
    input: CommonMutationInput,
    transaction: RniOrchestrationTransaction,
  ): Promise<RniStoredSourceWorkflowCheckpoint> {
    return this.mutate(input, transaction, (checkpoint, at) =>
      heartbeatRniSourceWorkflowCheckpoint(checkpoint, {
        authority: input.authority,
        at,
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
        leaseMs: input.authority.workflowPolicy.leaseMs,
      }),
    );
  }

  async retry(
    input: CommonMutationInput & { readonly errorCode: string },
    transaction: RniOrchestrationTransaction,
  ): Promise<RniSourceWorkflowRetryResult> {
    const errorCode = stableCode.parse(input.errorCode);
    let result: RniSourceWorkflowRetryResult | undefined;
    const stored = await this.mutate(input, transaction, (checkpoint, at) => {
      result = retryRniSourceWorkflowCheckpoint(checkpoint, {
        authority: input.authority,
        at,
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
        errorCode,
        baseBackoffMs: input.authority.workflowPolicy.baseBackoffMs,
        maxBackoffMs: input.authority.workflowPolicy.maxBackoffMs,
      });
      return result.checkpoint;
    });
    if (result === undefined) throw new RniSourceWorkflowRepositoryError('MISSING_CHECKPOINT');
    return { kind: result.kind, checkpoint: stored.checkpoint };
  }

  async complete(
    input: CommonMutationInput & {
      readonly semanticOutputHash: string;
    },
    transaction: RniOrchestrationTransaction,
  ): Promise<RniStoredSourceWorkflowCheckpoint> {
    const semanticOutputHash = digest.parse(input.semanticOutputHash);
    const subject = input.delivery.subject;
    const outputManifest = rniSourceWorkflowOutputManifestV2.parse({
      version: 'rni-source-workflow-output-v2',
      runId: subject.runId,
      runManifestHash: subject.runManifestHash,
      platform: subject.platform,
      sourceItemId: subject.sourceItemId,
      retrievalId: subject.retrievalId,
      contentVersionId: subject.contentVersionId,
      outboxEventId: subject.outboxEventId,
      semanticOutputHash,
    });
    const outputHash = hashRniModelInput(outputManifest);
    return this.mutate(
      input,
      transaction,
      (checkpoint, at) =>
        completeRniSourceWorkflowCheckpoint(checkpoint, {
          authority: input.authority,
          at,
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          outputHash,
        }),
      outputManifest,
    );
  }

  async fail(
    input: CommonMutationInput & { readonly errorCode: string },
    transaction: RniOrchestrationTransaction,
  ): Promise<RniStoredSourceWorkflowCheckpoint> {
    const errorCode = stableCode.parse(input.errorCode);
    return this.mutate(input, transaction, (checkpoint, at) =>
      failRniSourceWorkflowCheckpoint(checkpoint, {
        authority: input.authority,
        at,
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
        errorCode,
      }),
    );
  }

  async stopForBudget(
    input: CommonMutationInput & {
      readonly reason:
        | 'attempts'
        | 'wall_time'
        | 'sources'
        | 'input_tokens'
        | 'output_tokens'
        | 'cost'
        | 'cancelled';
    },
    transaction: RniOrchestrationTransaction,
  ): Promise<RniStoredSourceWorkflowCheckpoint> {
    return this.mutate(input, transaction, (checkpoint, at) =>
      stopRniSourceWorkflowForBudget(checkpoint, {
        authority: input.authority,
        at,
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
        reason: input.reason,
      }),
    );
  }

  private async mutate(
    input: CommonMutationInput,
    transaction: RniOrchestrationTransaction,
    transition: (checkpoint: RniSourceWorkflowCheckpointV2, at: string) => RniSourceWorkflowCheckpointV2,
    outputManifest: RniSourceWorkflowOutputManifestV2 | null = null,
  ): Promise<RniStoredSourceWorkflowCheckpoint> {
    const db = queryableForRniOrchestrationTransaction(transaction);
    const partition = partitionName.parse(input.partition);
    const delivery = rniSourceWorkflowDeliveryV2.parse(input.delivery);
    rniSourceWorkflowAuthorityV2.parse(input.authority);
    identifier.parse(input.leaseOwner);
    uuid.parse(input.leaseToken);
    await lockParentOrder(partition, db);
    await lockDeliverySlot(delivery, db);
    const stored = await readStored(partition, delivery, db);
    if (stored === null) throw new RniSourceWorkflowRepositoryError('MISSING_CHECKPOINT');
    const next = transition(stored.checkpoint, await databaseNow(db));
    if (hashRniModelInput(stored.checkpoint) !== hashRniModelInput(next)) {
      await requireLiveParentAuthority(partition, input.authority, db);
    }
    const effectiveManifest = next.status === 'completed' ? outputManifest ?? stored.outputManifest : null;
    if (next.status === 'completed') {
      if (effectiveManifest === null || next.outputHash === null) {
        throw new RniSourceWorkflowRepositoryError('OUTPUT_CONFLICT');
      }
      assertOutputManifest(delivery, effectiveManifest, next.outputHash);
      if (
        stored.outputManifest !== null &&
        hashRniModelInput(stored.outputManifest) !== hashRniModelInput(effectiveManifest)
      ) {
        throw new RniSourceWorkflowRepositoryError('OUTPUT_CONFLICT');
      }
    }
    return updateCheckpoint(stored, next, effectiveManifest, db);
  }
}
