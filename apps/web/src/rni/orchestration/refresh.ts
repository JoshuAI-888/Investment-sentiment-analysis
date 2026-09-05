import { z } from 'zod';
import Decimal from 'decimal.js';
import { jobDefinition, jobRun } from '@/contracts/operations';
import {
  rniManualRefreshRequest,
  rniManualRefreshResult,
  rniManualRefreshScope,
  type RniCommandService,
  type RniManualRefreshRequest,
  type RniManualRefreshResult,
  type RniManualRefreshScope,
  type RniPlatform,
} from '@/rni/contracts';
import { hashRniModelInput } from '@/rni/agents/model-input';
import {
  assertRniAggregateBudget,
  estimateRniRefreshBudget,
  RniOrchestrationError,
} from './budget';
import { previewRniSchedule } from './schedules';
import {
  commandRecord,
  executionRecord,
  identifier,
  instant,
  refreshPlan,
  type RniExecutionRecord,
  type RniOrchestrationDependencies,
  type RniOrchestrationTransaction,
  type RniPlatformDelivery,
  type RniCombinedDelivery,
  type RniRefreshPlan,
} from './types';

export function deliveryFor(
  runId: string,
  platform: RniPlatform,
  planHash: string,
  attempt: number,
): RniPlatformDelivery {
  return {
    version: 'rni-platform-v1',
    runId,
    platform,
    planHash,
    attempt,
    deliveryKey: `rni-platform-${hashRniModelInput({ runId, platform, planHash, attempt })}`,
  };
}

export function combinedDeliveryFor(
  runId: string,
  planHash: string,
  attempt: number,
): RniCombinedDelivery {
  return {
    version: 'rni-combined-v1',
    runId,
    planHash,
    attempt,
    deliveryKey: `rni-combined-${hashRniModelInput({ runId, planHash, attempt })}`,
  };
}

function coalesceIdentity(partition: string, plan: RniRefreshPlan): string {
  const { windowStart, windowEnd, comparisonStart, comparisonEnd, ...stable } = plan;
  return hashRniModelInput({
    partition,
    stable,
    windowMs: Date.parse(windowEnd) - Date.parse(windowStart),
    comparisonMs:
      comparisonStart === null ? null : Date.parse(comparisonEnd!) - Date.parse(comparisonStart),
    comparisonOffsetMs:
      comparisonEnd === null ? null : Date.parse(windowStart) - Date.parse(comparisonEnd),
  });
}

/** Validate persisted cross-identities before replay, coalescing, claiming or committing. */
export function validateRniExecution(
  value: unknown,
  partition: string,
  runId?: string,
): RniExecutionRecord {
  const record = executionRecord.parse(value);
  const estimate = estimateRniRefreshBudget(record.plan);
  if (
    record.partition !== partition ||
    (runId !== undefined && record.run.id !== runId) ||
    record.planHash !== hashRniModelInput(record.plan) ||
    record.coalesceKey !== coalesceIdentity(partition, record.plan) ||
    record.run.configVersion !== record.plan.configVersion ||
    record.run.universeVersion !== record.plan.universeVersion ||
    record.run.promptVersion !== record.plan.promptVersion ||
    record.run.aiRoute !== record.plan.aiRoute ||
    record.run.windowStart !== record.plan.windowStart ||
    record.run.windowEnd !== record.plan.windowEnd ||
    record.run.comparisonStart !== record.plan.comparisonStart ||
    record.run.comparisonEnd !== record.plan.comparisonEnd ||
    record.platforms.reddit.slice.id === record.platforms.x.slice.id ||
    record.reservedCostUsd !== estimate.totalUsd ||
    Date.parse(record.deadline) !== Date.parse(record.run.requestedAt) + record.plan.maxRuntimeMs ||
    Date.parse(record.coalesceUntil) !== Date.parse(record.run.requestedAt) + record.plan.coalesceMs
  ) {
    throw new RniOrchestrationError('CONFLICT');
  }
  for (const platform of ['reddit', 'x'] as const) {
    const state = record.platforms[platform];
    if (
      state.slice.runId !== record.run.id ||
      state.slice.platform !== platform ||
      state.delivery.attempt > record.plan.maxAttempts ||
      state.attempt > state.delivery.attempt ||
      (state.lease !== null &&
        (state.slice.status !== 'running' || state.attempt !== state.delivery.attempt)) ||
      hashRniModelInput(state.delivery) !==
        hashRniModelInput(
          deliveryFor(record.run.id, platform, record.planHash, state.delivery.attempt),
        )
    ) {
      throw new RniOrchestrationError('CONFLICT');
    }
  }
  const combined = record.combined;
  const proof = combined.publication;
  const terminalPlatforms = Object.values(record.platforms).every((p) =>
    ['complete', 'partial', 'failed', 'unavailable'].includes(p.slice.status),
  );
  if (
    combined.delivery.attempt > record.plan.maxAttempts ||
    combined.attempt > combined.delivery.attempt ||
    hashRniModelInput(combined.delivery) !==
      hashRniModelInput(
        combinedDeliveryFor(record.run.id, record.planHash, combined.delivery.attempt),
      ) ||
    (combined.status !== 'waiting' && !terminalPlatforms) ||
    (combined.status === 'waiting' &&
      (terminalPlatforms ||
        combined.attempt !== 0 ||
        combined.lastAttemptAt !== null ||
        combined.outcomeHash !== null)) ||
    (combined.status === 'running' && record.run.status !== 'running') ||
    (combined.status === 'failed' && record.run.status !== 'failed') ||
    (combined.status === 'running') !== (combined.lease !== null) ||
    (combined.lease !== null &&
      (combined.attempt !== combined.delivery.attempt ||
        combined.lastAttemptAt === null ||
        Date.parse(combined.lease.expiresAt) > Date.parse(record.deadline) ||
        Date.parse(combined.lease.expiresAt) <= Date.parse(combined.lastAttemptAt))) ||
    (combined.status === 'complete' && proof === null)
  )
    throw new RniOrchestrationError('CONFLICT');
  if (
    proof !== null &&
    (proof.artifact.runId !== record.run.id ||
      proof.artifact.planHash !== record.planHash ||
      proof.attempt !== combined.attempt ||
      proof.acquiredAt !== combined.lastAttemptAt ||
      !['running', 'complete'].includes(combined.status) ||
      proof.token !== (combined.lease?.token ?? combined.outcomeToken) ||
      (proof.artifact.status === 'complete' &&
        Object.values(record.platforms).some((p) => p.slice.status !== 'complete')) ||
      (combined.lease !== null &&
        Date.parse(proof.expiresAt) > Date.parse(combined.lease.expiresAt)) ||
      Date.parse(proof.acquiredAt) < Date.parse(record.run.requestedAt) ||
      Date.parse(proof.committedAt) < Date.parse(proof.acquiredAt) ||
      Date.parse(proof.committedAt) >= Date.parse(proof.expiresAt) ||
      Date.parse(proof.expiresAt) > Date.parse(record.deadline) ||
      (combined.status === 'complete' &&
        (combined.outcomeHash !== hashRniModelInput(proof.artifact) ||
          record.run.status !==
            (proof.artifact.status === 'insufficient' ? 'failed' : proof.artifact.status) ||
          record.run.completedAt !== proof.committedAt)))
  ) {
    throw new RniOrchestrationError('CONFLICT');
  }
  return record;
}

type Intent =
  | { kind: 'manual'; idempotencyKey: string; scope: RniManualRefreshScope }
  | { kind: 'rerun'; idempotencyKey: string; runId: string }
  | { kind: 'schedule'; idempotencyKey: string; jobId: string; dueAt: string };

export type RniScheduleResult =
  | RniManualRefreshResult
  | {
      disposition: 'skipped';
      reason: 'busy';
      idempotencyKey: string;
      jobId: string;
      dueAt: string;
      nextDueAt: string;
    };

export class RniRefreshService implements RniCommandService {
  constructor(private readonly deps: RniOrchestrationDependencies) {
    identifier.parse(deps.partition);
    identifier.parse(deps.actor);
    z.string().uuid().parse(deps.manualJobId);
  }

  async requestManualRefresh(input: RniManualRefreshRequest): Promise<RniManualRefreshResult> {
    const request = rniManualRefreshRequest.parse(input);
    identifier.parse(request.idempotencyKey);
    return this.submit({ kind: 'manual', ...request });
  }

  async rerun(input: { idempotencyKey: string; runId: string }): Promise<RniManualRefreshResult> {
    const request = z
      .object({ idempotencyKey: identifier, runId: z.string().uuid() })
      .strict()
      .parse(input);
    return this.submit({ kind: 'rerun', ...request });
  }

  async schedule(input: { jobId: string; dueAt: string }): Promise<RniScheduleResult> {
    const request = z.object({ jobId: z.string().uuid(), dueAt: instant }).strict().parse(input);
    return this.submit({
      kind: 'schedule',
      ...request,
      idempotencyKey: `rni-schedule-${hashRniModelInput(request)}`,
    });
  }

  private submit(
    intent: Extract<Intent, { kind: 'manual' | 'rerun' }>,
  ): Promise<RniManualRefreshResult>;
  private submit(intent: Extract<Intent, { kind: 'schedule' }>): Promise<RniScheduleResult>;
  private async submit(intent: Intent): Promise<RniScheduleResult> {
    const deps = this.deps;
    await deps.authorize(intent.kind === 'manual' ? 'refresh' : intent.kind);
    return deps.store.transact(deps.partition, async (tx) => {
      const at = instant.parse(deps.now().toISOString());
      // The key's namespace is shared across manual and rerun; changing the intent is a conflict.
      const key = `rni-command-${hashRniModelInput([deps.partition, intent.idempotencyKey])}`;
      const intentHash = hashRniModelInput(intent);
      const prior = await tx.getCommand(key);
      if (prior !== null) {
        const command = commandRecord.parse(prior);
        if (command.key !== key || command.intentHash !== intentHash)
          throw new RniOrchestrationError('CONFLICT');
        if (command.disposition === 'skipped') {
          if (
            intent.kind !== 'schedule' ||
            command.jobId !== intent.jobId ||
            command.dueAt !== intent.dueAt
          )
            throw new RniOrchestrationError('CONFLICT');
          return {
            disposition: 'skipped',
            reason: 'busy',
            idempotencyKey: intent.idempotencyKey,
            jobId: command.jobId,
            dueAt: command.dueAt,
            nextDueAt: command.nextDueAt,
          };
        }
        const record = validateRniExecution(
          await tx.getExecution(command.runId),
          deps.partition,
          command.runId,
        );
        if (
          hashRniModelInput(command.scopePreview) !== hashRniModelInput(record.plan.scopePreview)
        ) {
          throw new RniOrchestrationError('CONFLICT');
        }
        return rniManualRefreshResult.parse({
          disposition: 'duplicate',
          runId: command.runId,
          idempotencyKey: intent.idempotencyKey,
          scopePreview: command.scopePreview,
        });
      }
      let scope: RniManualRefreshScope;
      let rerunOf: string | null = null;
      let scheduled: { jobId: string; version: number; dueAt: string; nextDueAt: string } | null =
        null;
      const definition = jobDefinition.parse(
        await tx.getJobDefinition(intent.kind === 'schedule' ? intent.jobId : deps.manualJobId),
      );
      const empty = (value: unknown) =>
        value === null || (typeof value === 'object' && Object.keys(value).length === 0);
      if (
        definition.id !== (intent.kind === 'schedule' ? intent.jobId : deps.manualJobId) ||
        !definition.enabled ||
        definition.concurrencyPolicy !== 'skip' ||
        definition.jitterSeconds !== 0 ||
        !empty(definition.activeWindows) ||
        !empty(definition.dependencies)
      )
        throw new RniOrchestrationError('INVALID_PLAN');
      if (intent.kind === 'schedule') {
        if (
          definition.id !== intent.jobId ||
          definition.nextDueAt.toISOString() !== intent.dueAt ||
          Date.parse(intent.dueAt) > Date.parse(at)
        )
          throw new RniOrchestrationError('NOT_DUE');
        // Forward-only: advance from now and perform one bounded fire, never a catch-up burst.
        scheduled = {
          jobId: definition.id,
          version: definition.version,
          dueAt: intent.dueAt,
          nextDueAt: previewRniSchedule(definition, new Date(at), 1)[0]!.dueAt,
        };
        // Resolve no new-work scope, configuration or model plan for an already-busy job.
        // This read holds the scheduled job lock through the atomic skip/advance transaction.
        if (await tx.isScheduledJobBusy(definition.id)) {
          await tx.putCommand({
            disposition: 'skipped',
            key,
            intentHash,
            acceptedAt: at,
            jobId: scheduled.jobId,
            dueAt: scheduled.dueAt,
            nextDueAt: scheduled.nextDueAt,
          });
          await tx.advanceSchedule(scheduled);
          await tx.audit({
            event: 'schedule_skipped',
            runId: null,
            actor: deps.actor,
            at,
            jobId: scheduled.jobId,
            dueAt: scheduled.dueAt,
          });
          return {
            disposition: 'skipped',
            reason: 'busy',
            idempotencyKey: intent.idempotencyKey,
            jobId: scheduled.jobId,
            dueAt: scheduled.dueAt,
            nextDueAt: scheduled.nextDueAt,
          };
        }
        scope = rniManualRefreshScope.parse(definition.scope);
      } else if (intent.kind === 'rerun') {
        const old = await tx.getExecution(intent.runId);
        if (old === null) throw new RniOrchestrationError('NOT_FOUND');
        const previous = validateRniExecution(old, deps.partition, intent.runId);
        if (previous.run.status === 'requested' || previous.run.status === 'running')
          throw new RniOrchestrationError('CONFLICT');
        scope =
          previous.plan.scopePreview.kind === 'ticker'
            ? { kind: 'ticker', ticker: previous.plan.scopePreview.ticker }
            : { kind: 'full_universe' };
        rerunOf = previous.run.id;
      } else scope = intent.scope;
      const plan = refreshPlan.parse(await tx.resolveActivePlan(scope, at));
      const plannedCalls = Object.values(plan.calls.reddit)
        .concat(Object.values(plan.calls.x))
        .reduce((sum, value) => sum + value, 0);
      if (
        plan.scopePreview.kind !== scope.kind ||
        (scope.kind === 'ticker' &&
          plan.scopePreview.kind === 'ticker' &&
          scope.ticker !== plan.scopePreview.ticker) ||
        Date.parse(plan.windowEnd) > Date.parse(at) ||
        plan.maxAttempts > definition.maxAttempts ||
        plan.maxRuntimeMs > definition.maxRuntimeSeconds * 1000 ||
        (definition.maxCallsPerRun !== null && plannedCalls > definition.maxCallsPerRun) ||
        (definition.maxCostUsdPerRun !== null &&
          new Decimal(estimateRniRefreshBudget(plan).totalUsd).gt(definition.maxCostUsdPerRun))
      ) {
        throw new RniOrchestrationError('INVALID_PLAN');
      }
      const coalesceKey = coalesceIdentity(deps.partition, plan);
      const existing = rerunOf === null ? await tx.findCoalescible(coalesceKey, at) : null;
      let record: RniExecutionRecord;
      let disposition: 'accepted' | 'duplicate' = 'accepted';
      if (existing !== null) {
        record = validateRniExecution(existing, deps.partition);
        if (
          record.coalesceKey !== coalesceKey ||
          record.rerunOf !== null ||
          Date.parse(record.coalesceUntil) <= Date.parse(at) ||
          Date.parse(record.deadline) <= Date.parse(at) ||
          Date.parse(record.run.requestedAt) > Date.parse(at) ||
          !['requested', 'running'].includes(record.run.status)
        )
          throw new RniOrchestrationError('CONFLICT');
        disposition = 'duplicate';
      } else {
        record = await this.createExecution(
          tx,
          intent,
          definition.id,
          plan,
          coalesceKey,
          rerunOf,
          at,
        );
      }
      await tx.putCommand({
        disposition: 'run',
        key,
        intentHash,
        runId: record.run.id,
        scopePreview: record.plan.scopePreview,
        acceptedAt: at,
      });
      if (scheduled !== null) await tx.advanceSchedule(scheduled);
      await tx.audit({
        event: disposition === 'duplicate' ? 'coalesced' : rerunOf === null ? 'accepted' : 'rerun',
        runId: record.run.id,
        actor: deps.actor,
        at,
      });
      return rniManualRefreshResult.parse({
        disposition,
        runId: record.run.id,
        idempotencyKey: intent.idempotencyKey,
        scopePreview: record.plan.scopePreview,
      });
    });
  }

  private async createExecution(
    tx: RniOrchestrationTransaction,
    intent: Intent,
    jobId: string,
    plan: RniRefreshPlan,
    coalesceKey: string,
    rerunOf: string | null,
    at: string,
  ): Promise<RniExecutionRecord> {
    const runId = z.string().uuid().parse(this.deps.newId());
    const estimate = estimateRniRefreshBudget(plan);
    const usage = await tx.admitBudget({
      runId,
      at,
      costUsd: estimate.totalUsd,
      runLimitUsd: estimate.runLimitUsd,
    });
    assertRniAggregateBudget(estimate.totalUsd, usage);
    const planHash = hashRniModelInput(plan);
    const job = jobRun.parse(
      await tx.createJob({
        jobId,
        triggerType:
          intent.kind === 'schedule' ? 'scheduled' : intent.kind === 'rerun' ? 'retry' : 'manual',
        idempotencyKey: `rni-run-${runId}`,
        configVersion: plan.configVersion,
        universeVersion: plan.universeVersion,
        requestedBy: this.deps.actor,
        lockKey: `rni-run-${runId}`,
        estimatedCostUsd: estimate.totalUsd,
        metrics: { rniRunId: runId, planHash },
      }),
    );
    if (
      job.jobId !== jobId ||
      job.idempotencyKey !== `rni-run-${runId}` ||
      job.configVersion !== plan.configVersion ||
      job.universeVersion !== plan.universeVersion ||
      job.status !== 'queued' ||
      hashRniModelInput(job.metrics) !== hashRniModelInput({ rniRunId: runId, planHash })
    )
      throw new RniOrchestrationError('CONFLICT');
    const platform = (name: RniPlatform) => ({
      slice: {
        id: this.deps.newId(),
        runId,
        platform: name,
        status: 'pending' as const,
        eligibleSourceCount: 0,
        coverageDisclosure: plan.coverage[name],
        lastAttemptAt: null,
        lastSuccessfulRefreshAt: null,
        dataThroughAt: null,
        computedAt: null,
        errorCode: null,
      },
      attempt: 0,
      delivery: deliveryFor(runId, name, planHash, 1),
      notBefore: at,
      lease: null,
      outcomeHash: null,
      outcomeToken: null,
    });
    const record = executionRecord.parse({
      version: 'rni-execution-v1',
      partition: this.deps.partition,
      jobRunId: job.id,
      run: {
        id: runId,
        idempotencyKey: `rni-run-${runId}`,
        trigger: intent.kind === 'schedule' ? 'schedule' : 'manual',
        status: 'requested',
        windowStart: plan.windowStart,
        windowEnd: plan.windowEnd,
        comparisonStart: plan.comparisonStart,
        comparisonEnd: plan.comparisonEnd,
        universeVersion: plan.universeVersion,
        configVersion: plan.configVersion,
        promptVersion: plan.promptVersion,
        aiRoute: plan.aiRoute,
        requestedAt: at,
        completedAt: null,
      },
      plan,
      planHash,
      coalesceKey,
      coalesceUntil: new Date(Date.parse(at) + plan.coalesceMs).toISOString(),
      deadline: new Date(Date.parse(at) + plan.maxRuntimeMs).toISOString(),
      rerunOf,
      reservedCostUsd: estimate.totalUsd,
      platforms: { reddit: platform('reddit'), x: platform('x') },
      combined: {
        status: 'waiting',
        attempt: 0,
        delivery: combinedDeliveryFor(runId, planHash, 1),
        notBefore: at,
        lastAttemptAt: null,
        lease: null,
        errorCode: null,
        outcomeHash: null,
        outcomeToken: null,
        publication: null,
      },
    });
    await tx.createExecution(record);
    await tx.enqueue(record.platforms.reddit.delivery, at);
    await tx.enqueue(record.platforms.x.delivery, at);
    return record;
  }
}
