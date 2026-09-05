import { z } from 'zod';
import { hashRniModelInput } from '@/rni/agents/model-input';
import { rniWorkflowBackoffMs, defaultRniWorkflowPolicy } from '@/rni/workflow/persist-source';
import { RniOrchestrationError } from './budget';
import { deliveryFor, validateRniExecution } from './refresh';
import {
  instant,
  platformDelivery,
  type RniExecutionRecord,
  type RniOrchestrationStore,
  type RniOrchestrationTransaction,
  type RniPlatformDelivery,
} from './types';

export const platformOutcome = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('complete'),
      eligibleSourceCount: z.number().int().nonnegative(),
      dataThroughAt: instant.nullable(),
      computedAt: instant,
    })
    .strict(),
  z
    .object({
      status: z.literal('partial'),
      eligibleSourceCount: z.number().int().nonnegative(),
      dataThroughAt: instant.nullable(),
      computedAt: instant,
      errorCode: z.literal('PROVIDER_PARTIAL'),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      errorCode: z.enum([
        'PROVIDER_TRANSIENT',
        'PROVIDER_PERMANENT',
        'BUDGET_STOPPED',
        'VALIDATION_FAILED',
      ]),
    })
    .strict(),
  z
    .object({ status: z.literal('unavailable'), errorCode: z.literal('PROVIDER_UNAVAILABLE') })
    .strict(),
]);
export type RniPlatformOutcome = z.infer<typeof platformOutcome>;
export type RniExecutionLease = { delivery: RniPlatformDelivery; token: string };
type ClaimResult =
  | { status: 'acquired'; lease: RniExecutionLease; record: RniExecutionRecord }
  | { status: 'busy' | 'deferred'; retryAt: string }
  | { status: 'duplicate' | 'stale' | 'expired' };

const terminal = (status: string) =>
  ['complete', 'partial', 'failed', 'unavailable'].includes(status);

export class RniPlatformExecutionService {
  constructor(
    private readonly deps: {
      store: RniOrchestrationStore;
      partition: string;
      now(): Date;
      newId(): string;
      random?: () => number;
    },
  ) {}

  private async read(tx: RniOrchestrationTransaction, payload: RniPlatformDelivery) {
    const record = validateRniExecution(
      await tx.getExecution(payload.runId),
      this.deps.partition,
      payload.runId,
    );
    if (
      payload.planHash !== record.planHash ||
      hashRniModelInput(payload) !==
        hashRniModelInput(
          deliveryFor(payload.runId, payload.platform, payload.planHash, payload.attempt),
        )
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
    return record;
  }

  async claim(input: RniPlatformDelivery): Promise<ClaimResult> {
    const payload = platformDelivery.parse(input);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, payload);
      const state = record.platforms[payload.platform];
      const now = this.deps.now().getTime();
      if (payload.attempt < state.delivery.attempt) return { status: 'stale' };
      if (payload.attempt > state.delivery.attempt) throw new RniOrchestrationError('CONFLICT');
      if (terminal(state.slice.status)) return { status: 'duplicate' };
      if (record.run.status !== 'requested' && record.run.status !== 'running')
        return { status: 'stale' };
      if (state.lease !== null && Date.parse(state.lease.expiresAt) > now) {
        return { status: 'busy', retryAt: state.lease.expiresAt };
      }
      if (state.lease !== null || now >= Date.parse(record.deadline)) {
        // Unknown provider outcomes retain I10 reservations and are never automatically retried.
        state.slice.status = 'failed';
        state.slice.errorCode = state.lease === null ? 'DEADLINE_EXCEEDED' : 'LEASE_EXPIRED';
        state.outcomeToken = state.lease?.token ?? null;
        state.lease = null;
        state.outcomeHash = hashRniModelInput({
          status: 'failed',
          errorCode: state.slice.errorCode,
        });
        await this.saveTerminal(tx, record, new Date(now).toISOString());
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
      state.attempt = payload.attempt;
      state.slice.status = 'running';
      state.slice.lastAttemptAt = new Date(now).toISOString();
      record.run.status = 'running';
      await tx.putExecution(record);
      return { status: 'acquired', lease: { delivery: payload, token }, record };
    });
  }

  private assertLease(record: RniExecutionRecord, lease: RniExecutionLease, now: number) {
    const state = record.platforms[lease.delivery.platform];
    if (
      state.lease?.token !== lease.token ||
      state.attempt !== lease.delivery.attempt ||
      state.slice.status !== 'running' ||
      record.run.status !== 'running' ||
      Date.parse(state.lease.expiresAt) <= now ||
      Date.parse(record.deadline) <= now
    ) {
      throw new RniOrchestrationError('STALE_EXECUTION');
    }
  }

  /** Check the original authority after awaited writes, even after terminal/retry clears it. */
  private assertLeaseWindow(expiresAt: string, deadline: string) {
    const now = this.deps.now().getTime();
    if (!Number.isFinite(now) || Date.parse(expiresAt) <= now || Date.parse(deadline) <= now)
      throw new RniOrchestrationError('STALE_EXECUTION');
  }

  /** The I07 adapter must check this fence at each provider/commit boundary, and pass its signal. */
  async heartbeat(lease: RniExecutionLease): Promise<void> {
    platformDelivery.parse(lease.delivery);
    z.string().uuid().parse(lease.token);
    await this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery);
      const now = this.deps.now().getTime();
      this.assertLease(record, lease, now);
      const originalExpiry = record.platforms[lease.delivery.platform].lease!.expiresAt;
      record.platforms[lease.delivery.platform].lease!.expiresAt = new Date(
        Math.min(now + record.plan.leaseMs, Date.parse(record.deadline)),
      ).toISOString();
      await tx.putExecution(record);
      this.assertLeaseWindow(originalExpiry, record.deadline);
    });
  }

  async finish(
    lease: RniExecutionLease,
    input: RniPlatformOutcome,
  ): Promise<'complete' | 'retry' | 'duplicate'> {
    const outcome = platformOutcome.parse(input);
    platformDelivery.parse(lease.delivery);
    z.string().uuid().parse(lease.token);
    return this.deps.store.transact(this.deps.partition, async (tx) => {
      const record = await this.read(tx, lease.delivery);
      const state = record.platforms[lease.delivery.platform];
      const outputHash = hashRniModelInput(outcome);
      const at = instant.parse(this.deps.now().toISOString());
      const now = Date.parse(at);
      if (terminal(state.slice.status)) {
        if (
          state.attempt !== lease.delivery.attempt ||
          state.outcomeHash !== outputHash ||
          state.outcomeToken !== lease.token
        )
          throw new RniOrchestrationError('CONFLICT');
        return 'duplicate';
      }
      this.assertLease(record, lease, now);
      const originalExpiry = state.lease!.expiresAt;
      if (
        'computedAt' in outcome &&
        (Date.parse(outcome.computedAt) > now ||
          Date.parse(outcome.computedAt) < Date.parse(state.slice.lastAttemptAt!) ||
          (outcome.dataThroughAt !== null &&
            Date.parse(outcome.dataThroughAt) > Date.parse(record.plan.windowEnd)))
      ) {
        throw new RniOrchestrationError('INVALID_PLAN');
      }
      if (
        outcome.status === 'failed' &&
        outcome.errorCode === 'PROVIDER_TRANSIENT' &&
        state.attempt < record.plan.maxAttempts
      ) {
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
          state.slice.status = 'pending';
          state.slice.errorCode = outcome.errorCode;
          state.lease = null;
          state.notBefore = new Date(now + delay).toISOString();
          state.delivery = deliveryFor(
            record.run.id,
            lease.delivery.platform,
            record.planHash,
            state.attempt + 1,
          );
          await tx.putExecution(record);
          await tx.enqueue(state.delivery, state.notBefore);
          await tx.audit({
            event: 'platform_retry',
            runId: record.run.id,
            actor: 'rni-worker',
            at,
          });
          this.assertLeaseWindow(originalExpiry, record.deadline);
          return 'retry';
        }
      }
      state.slice.status = outcome.status;
      state.slice.errorCode = 'errorCode' in outcome ? outcome.errorCode : null;
      if ('computedAt' in outcome) {
        state.slice.eligibleSourceCount = outcome.eligibleSourceCount;
        state.slice.computedAt = outcome.computedAt;
        state.slice.dataThroughAt = outcome.dataThroughAt;
        state.slice.lastSuccessfulRefreshAt = at;
      }
      state.lease = null;
      state.outcomeHash = outputHash;
      state.outcomeToken = lease.token;
      await this.saveTerminal(tx, record, at);
      this.assertLeaseWindow(originalExpiry, record.deadline);
      return 'complete';
    });
  }

  private async saveTerminal(
    tx: RniOrchestrationTransaction,
    record: RniExecutionRecord,
    at: string,
  ) {
    if (
      terminal(record.platforms.reddit.slice.status) &&
      terminal(record.platforms.x.slice.status) &&
      record.combined.status === 'waiting'
    ) {
      record.combined.status = 'pending';
      record.combined.notBefore = at;
      // Publication still belongs to I07. Source completion cannot mark the whole run published.
      await tx.enqueueCombined(record.combined.delivery, at);
    }
    await tx.putExecution(record);
    await tx.audit({ event: 'platform_terminal', runId: record.run.id, actor: 'rni-worker', at });
  }
}
