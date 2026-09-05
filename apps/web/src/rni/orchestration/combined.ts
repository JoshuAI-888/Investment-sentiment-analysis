import { z } from 'zod';
import { hashRniModelInput } from '@/rni/agents/model-input';
import { defaultRniWorkflowPolicy, rniWorkflowBackoffMs } from '@/rni/workflow/persist-source';
import { RniOrchestrationError } from './budget';
import { combinedDeliveryFor, validateRniExecution } from './refresh';
import {
  combinedArtifact,
  combinedDelivery,
  digest,
  instant,
  type RniCombinedArtifact,
  type RniCombinedDelivery,
  type RniCombinedFence,
  type RniExecutionRecord,
  type RniOrchestrationStore,
  type RniOrchestrationTransaction,
} from './types';

export type RniCombinedLease = { delivery: RniCombinedDelivery; token: string };
const leaseSchema = z.object({ delivery: combinedDelivery, token: z.string().uuid() }).strict();
const failure = z
  .object({
    errorCode: z.enum([
      'SYNTHESIS_TRANSIENT',
      'SYNTHESIS_PERMANENT',
      'VALIDATION_FAILED',
      'BUDGET_STOPPED',
    ]),
  })
  .strict();
type Claim =
  | { status: 'acquired'; lease: RniCombinedLease; record: RniExecutionRecord }
  | { status: 'busy' | 'deferred'; retryAt: string }
  | { status: 'duplicate' | 'stale' | 'expired' };

/**
 * Private I07 bridge. Provider/model calls stay OUTSIDE transactions and receive effectFence()
 * immediately before every dispatch. Publication must use commitPublication(): its callback
 * writes only through the supplied transaction, enforcing the token/expiry/deadline in SQL.
 * The adapter must roll back publication, receipt, job projection and audit together on failure,
 * and enforce the same fence through transaction commit. No success receipt may be fabricated
 * by a read callback, copied from another attempt, or inserted outside that transaction.
 */
export class RniCombinedExecutionService {
  constructor(
    private readonly deps: {
      store: RniOrchestrationStore;
      partition: string;
      now(): Date;
      newId(): string;
      random?: () => number;
    },
  ) {}

  private now() {
    return Date.parse(instant.parse(this.deps.now().toISOString()));
  }

  private async read(tx: RniOrchestrationTransaction, payload: RniCombinedDelivery) {
    const record = validateRniExecution(
      await tx.getExecution(payload.runId),
      this.deps.partition,
      payload.runId,
    );
    if (
      record.planHash !== payload.planHash ||
      hashRniModelInput(payload) !==
        hashRniModelInput(
          combinedDeliveryFor(
            payload.runId,
            payload.planHash,
            payload.attempt,
            record.version === 'rni-execution-v2' ? record.runManifestHash : undefined,
          ),
        )
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
    return record;
  }

  private fence(record: RniExecutionRecord, lease: RniCombinedLease): RniCombinedFence {
    const state = record.combined,
      now = this.now();
    if (
      state.status !== 'running' ||
      record.run.status !== 'running' ||
      state.lease?.token !== lease.token ||
      state.attempt !== lease.delivery.attempt ||
      state.delivery.attempt !== lease.delivery.attempt ||
      state.lastAttemptAt === null ||
      Date.parse(state.lease.expiresAt) <= now ||
      Date.parse(record.deadline) <= now
    ) {
      throw new RniOrchestrationError('STALE_EXECUTION');
    }
    return Object.freeze({
      stage: 'combined',
      runId: record.run.id,
      planHash: record.planHash,
      attempt: state.attempt,
      token: lease.token,
      acquiredAt: state.lastAttemptAt,
      expiresAt: state.lease.expiresAt,
      deadline: record.deadline,
    });
  }

  private matchesProof(record: RniExecutionRecord, lease: RniCombinedLease, artifactHash: string) {
    const proof = record.combined.publication;
    if (
      proof === null ||
      proof.token !== lease.token ||
      proof.attempt !== lease.delivery.attempt ||
      proof.artifact.artifactHash !== artifactHash
    )
      throw new RniOrchestrationError('CONFLICT');
    return proof;
  }

  private async finalize(tx: RniOrchestrationTransaction, record: RniExecutionRecord) {
    const proof = record.combined.publication!;
    record.combined.status = 'complete';
    record.combined.lease = null;
    record.combined.errorCode = null;
    record.combined.outcomeToken = proof.token;
    record.combined.outcomeHash = hashRniModelInput(proof.artifact);
    record.run.status = proof.artifact.status === 'insufficient' ? 'failed' : proof.artifact.status;
    record.run.completedAt = proof.committedAt;
    await tx.putExecution(record);
    await tx.audit({
      event: 'combined_terminal',
      runId: record.run.id,
      actor: 'rni-worker',
      at: new Date(this.now()).toISOString(),
    });
  }

  async claim(input: RniCombinedDelivery): Promise<Claim> {
    const payload = combinedDelivery.parse(input);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, payload),
        state = record.combined;
      if (payload.attempt < state.delivery.attempt) return { status: 'stale' };
      if (payload.attempt > state.delivery.attempt) throw new RniOrchestrationError('CONFLICT');
      if (state.status === 'waiting') throw new RniOrchestrationError('CONFLICT');
      if (state.status === 'complete' || state.status === 'failed') return { status: 'duplicate' };
      // Recovery is completion of an already committed exact artifact, never new publication.
      if (state.publication !== null) {
        await this.finalize(tx, record);
        return { status: 'duplicate' };
      }
      if (!['requested', 'running'].includes(record.run.status)) return { status: 'stale' };
      const now = this.now();
      if (
        state.lease !== null &&
        Date.parse(state.lease.expiresAt) > now &&
        Date.parse(record.deadline) > now
      )
        return { status: 'busy', retryAt: state.lease.expiresAt };
      if (state.lease !== null || now >= Date.parse(record.deadline)) {
        state.errorCode = state.lease === null ? 'DEADLINE_EXCEEDED' : 'LEASE_EXPIRED';
        state.outcomeToken = state.lease?.token ?? null;
        state.outcomeHash = hashRniModelInput({ errorCode: state.errorCode });
        state.status = 'failed';
        state.lease = null;
        record.run.status = 'failed';
        record.run.completedAt = new Date(now).toISOString();
        await tx.putExecution(record);
        await tx.audit({
          event: 'combined_terminal',
          runId: record.run.id,
          actor: 'rni-worker',
          at: record.run.completedAt,
        });
        return { status: 'expired' };
      }
      if (Date.parse(state.notBefore) > now)
        return { status: 'deferred', retryAt: state.notBefore };
      const token = z.string().uuid().parse(this.deps.newId());
      state.lease = {
        token,
        expiresAt: new Date(
          Math.min(now + record.plan.leaseMs, Date.parse(record.deadline)),
        ).toISOString(),
      };
      state.status = 'running';
      state.attempt = payload.attempt;
      state.lastAttemptAt = new Date(now).toISOString();
      record.run.status = 'running';
      await tx.putExecution(record);
      return { status: 'acquired', lease: { delivery: payload, token }, record };
    });
  }

  /** Carry this capability into EACH I07 provider boundary. It authorizes no later publication. */
  async effectFence(input: RniCombinedLease): Promise<RniCombinedFence> {
    const lease = leaseSchema.parse(input);
    return this.deps.store.transact(this.deps.partition, async (tx) =>
      this.fence(await this.read(tx, lease.delivery), lease),
    );
  }

  async heartbeat(input: RniCombinedLease): Promise<void> {
    const lease = leaseSchema.parse(input);
    await this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery);
      const originalFence = this.fence(record, lease);
      record.combined.lease!.expiresAt = new Date(
        Math.min(this.now() + record.plan.leaseMs, Date.parse(record.deadline)),
      ).toISOString();
      await tx.putExecution(record);
      // A renewal cannot use its uncommitted extension to outlive the original authority.
      if (this.now() >= Date.parse(originalFence.expiresAt))
        throw new RniOrchestrationError('STALE_EXECUTION');
      this.fence(record, lease);
    });
  }

  async commitPublication(
    input: RniCombinedLease,
    expected: RniCombinedArtifact,
    publish: (
      tx: RniOrchestrationTransaction,
      fence: RniCombinedFence,
      artifact: RniCombinedArtifact,
    ) => Promise<unknown>,
  ): Promise<'committed' | 'duplicate'> {
    const lease = leaseSchema.parse(input),
      artifact = combinedArtifact.parse(expected);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      let record = await this.read(tx, lease.delivery);
      if (
        artifact.runId !== record.run.id ||
        artifact.planHash !== record.planHash ||
        (artifact.status === 'complete' &&
          Object.values(record.platforms).some((p) => p.slice.status !== 'complete'))
      )
        throw new RniOrchestrationError('CONFLICT');
      if (record.combined.publication !== null) {
        const proof = this.matchesProof(record, lease, artifact.artifactHash);
        if (hashRniModelInput(proof.artifact) !== hashRniModelInput(artifact))
          throw new RniOrchestrationError('CONFLICT');
        return 'duplicate';
      }
      const fence = this.fence(record, lease);
      const committed = combinedArtifact.parse(await publish(tx, fence, artifact));
      if (hashRniModelInput(committed) !== hashRniModelInput(artifact))
        throw new RniOrchestrationError('CONFLICT');
      record = await this.read(tx, lease.delivery);
      const stillValid = this.fence(record, lease);
      if (record.combined.publication !== null) throw new RniOrchestrationError('CONFLICT');
      record.combined.publication = {
        artifact: committed,
        token: lease.token,
        attempt: fence.attempt,
        acquiredAt: fence.acquiredAt,
        expiresAt: stillValid.expiresAt,
        committedAt: new Date(this.now()).toISOString(),
      };
      await tx.putExecution(record);
      await tx.audit({
        event: 'combined_committed',
        runId: record.run.id,
        actor: 'rni-worker',
        at: record.combined.publication.committedAt,
      });
      this.fence(record, lease);
      return 'committed';
    });
  }

  /**
   * Full-universe v2 closeout. Unlike the historical/manual two-step path, the release row,
   * immutable receipt, execution/run/job terminal projections and both audit records are written
   * in one transaction. The callback receives the one commit timestamp it must persist on the
   * release; no staged member becomes visible before this transaction commits.
   */
  async commitFullUniversePublication(
    input: RniCombinedLease,
    expected: RniCombinedArtifact,
    publish: (
      tx: RniOrchestrationTransaction,
      fence: RniCombinedFence,
      artifact: RniCombinedArtifact,
      committedAt: string,
    ) => Promise<unknown>,
  ): Promise<'committed' | 'duplicate'> {
    const lease = leaseSchema.parse(input);
    const artifact = combinedArtifact.parse(expected);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery);
      if (
        artifact.runId !== record.run.id ||
        artifact.planHash !== record.planHash ||
        record.version !== 'rni-execution-v2' ||
        record.plan.scopePreview.kind !== 'full_universe' ||
        (artifact.status === 'complete' &&
          Object.values(record.platforms).some((platform) => platform.slice.status !== 'complete'))
      ) {
        throw new RniOrchestrationError('CONFLICT');
      }
      if (record.combined.publication !== null) {
        const proof = this.matchesProof(record, lease, artifact.artifactHash);
        if (
          hashRniModelInput(proof.artifact) !== hashRniModelInput(artifact) ||
          record.combined.status !== 'complete'
        ) {
          throw new RniOrchestrationError('CONFLICT');
        }
        return 'duplicate';
      }

      const fence = this.fence(record, lease);
      const committedAt = new Date(this.now()).toISOString();
      if (
        Date.parse(committedAt) >= Date.parse(fence.expiresAt) ||
        Date.parse(committedAt) >= Date.parse(fence.deadline)
      ) {
        throw new RniOrchestrationError('STALE_EXECUTION');
      }
      const committed = combinedArtifact.parse(
        await publish(tx, fence, artifact, committedAt),
      );
      if (hashRniModelInput(committed) !== hashRniModelInput(artifact)) {
        throw new RniOrchestrationError('CONFLICT');
      }
      const stillValid = this.fence(record, lease);
      record.combined.publication = {
        artifact: committed,
        token: lease.token,
        attempt: fence.attempt,
        acquiredAt: fence.acquiredAt,
        expiresAt: stillValid.expiresAt,
        committedAt,
      };
      record.combined.status = 'complete';
      record.combined.lease = null;
      record.combined.errorCode = null;
      record.combined.outcomeToken = lease.token;
      record.combined.outcomeHash = hashRniModelInput(committed);
      record.run.status = committed.status === 'insufficient' ? 'failed' : committed.status;
      record.run.completedAt = committedAt;
      await tx.putExecution(record);
      await tx.audit({
        event: 'combined_committed',
        runId: record.run.id,
        actor: 'rni-worker',
        at: committedAt,
      });
      await tx.audit({
        event: 'combined_terminal',
        runId: record.run.id,
        actor: 'rni-worker',
        at: committedAt,
      });
      return 'committed';
    });
  }

  /** Expiry never authorizes a read/publication; a validated durable receipt is the only exception. */
  async finish(
    input: RniCombinedLease,
    expectedArtifactHash: string,
    readAccepted: (fence: RniCombinedFence) => Promise<unknown>,
  ): Promise<'complete' | 'duplicate'> {
    const lease = leaseSchema.parse(input),
      expected = digest.parse(expectedArtifactHash);
    const start = await this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery),
        state = record.combined;
      if (state.publication !== null) {
        this.matchesProof(record, lease, expected);
        if (state.status === 'complete') return null;
        if (
          this.now() >= Date.parse(record.deadline) ||
          this.now() >= Date.parse(state.lease!.expiresAt)
        ) {
          await this.finalize(tx, record);
          return null;
        }
      }
      return this.fence(record, lease);
    });
    if (start === null) return 'duplicate';
    if (this.now() >= Date.parse(start.expiresAt) || this.now() >= Date.parse(start.deadline))
      throw new RniOrchestrationError('STALE_EXECUTION');
    const artifact = combinedArtifact.parse(await readAccepted(start));
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery);
      // A read claiming historical success without our atomic fenced receipt is not proof.
      if (record.combined.publication === null) this.fence(record, lease);
      const proof = this.matchesProof(record, lease, expected);
      if (hashRniModelInput(artifact) !== hashRniModelInput(proof.artifact))
        throw new RniOrchestrationError('CONFLICT');
      if (record.combined.status === 'complete') return 'duplicate';
      await this.finalize(tx, record);
      return 'complete';
    });
  }

  async fail(
    input: RniCombinedLease,
    output: z.infer<typeof failure>,
  ): Promise<'failed' | 'retry' | 'duplicate'> {
    const lease = leaseSchema.parse(input),
      outcome = failure.parse(output),
      hash = hashRniModelInput(outcome);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery),
        state = record.combined;
      if (state.publication !== null) throw new RniOrchestrationError('CONFLICT');
      if (
        ['failed', 'pending'].includes(state.status) &&
        state.attempt === lease.delivery.attempt &&
        state.outcomeToken === lease.token &&
        state.outcomeHash === hash
      )
        return 'duplicate';
      const validThrough = this.fence(record, lease);
      const now = this.now();
      state.errorCode = outcome.errorCode;
      state.outcomeHash = hash;
      state.outcomeToken = lease.token;
      if (outcome.errorCode === 'SYNTHESIS_TRANSIENT' && state.attempt < record.plan.maxAttempts) {
        const sample = (this.deps.random ?? Math.random)();
        if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
          throw new RniOrchestrationError('INVALID_PLAN');
        const delay = Math.max(
          1,
          rniWorkflowBackoffMs(state.attempt, {
            ...defaultRniWorkflowPolicy,
            baseBackoffMs: record.plan.baseBackoffMs,
            maxBackoffMs: record.plan.maxBackoffMs,
            random: () => sample,
          }),
        );
        if (now + delay < Date.parse(record.deadline)) {
          state.status = 'pending';
          state.lease = null;
          state.notBefore = new Date(now + delay).toISOString();
          state.delivery = combinedDeliveryFor(
            record.run.id,
            record.planHash,
            state.attempt + 1,
            record.version === 'rni-execution-v2' ? record.runManifestHash : undefined,
          );
          await tx.putExecution(record);
          await tx.enqueueCombined(state.delivery, state.notBefore);
          await tx.audit({
            event: 'combined_retry',
            runId: record.run.id,
            actor: 'rni-worker',
            at: new Date(now).toISOString(),
          });
          if (
            this.now() >= Date.parse(validThrough.expiresAt) ||
            this.now() >= Date.parse(record.deadline)
          )
            throw new RniOrchestrationError('STALE_EXECUTION');
          return 'retry';
        }
      }
      state.status = 'failed';
      state.lease = null;
      record.run.status = 'failed';
      record.run.completedAt = new Date(now).toISOString();
      await tx.putExecution(record);
      await tx.audit({
        event: 'combined_terminal',
        runId: record.run.id,
        actor: 'rni-worker',
        at: record.run.completedAt,
      });
      if (
        this.now() >= Date.parse(validThrough.expiresAt) ||
        this.now() >= Date.parse(record.deadline)
      )
        throw new RniOrchestrationError('STALE_EXECUTION');
      return 'failed';
    });
  }
}
