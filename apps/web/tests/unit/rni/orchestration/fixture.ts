import Decimal from 'decimal.js';
import { jobDefinition, jobRun } from '@/contracts/operations';
import { RNI_APPROVED_TASK_ENVELOPES } from '@/rni/config/model-policy';
import { RniRefreshService } from '@/rni/orchestration/refresh';
import { RniPlatformExecutionService } from '@/rni/orchestration/execution';
import { assertRniAggregateBudget } from '@/rni/orchestration/budget';
import type {
  RniCommandRecord,
  RniExecutionRecord,
  RniOrchestrationDependencies,
  RniOrchestrationStore,
  RniOrchestrationTransaction,
  RniPlatformDelivery,
  RniRefreshPlan,
} from '@/rni/orchestration/types';

export const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const START = '2026-09-05T00:00:00.000Z';
export const scope = { kind: 'ticker', ticker: 'NVDA' } as const;
const noCalls = {
  rni_discovery: 0,
  rni_relationship: 0,
  rni_classifier: 0,
  rni_verification: 0,
  rni_challenger: 0,
};
export const planFixture = (): RniRefreshPlan => ({
  configVersion: '1',
  universeVersion: '1',
  promptVersion: 'rni-v1',
  aiRoute: 'openai_direct',
  scopePreview: {
    kind: 'ticker',
    ticker: 'NVDA',
    securityId: uuid(900),
    companyName: 'NVIDIA',
    exchange: 'NASDAQ',
    universeVersion: '1',
  },
  timezone: 'Pacific/Auckland',
  windowStart: '2026-09-04T00:00:00.000Z',
  windowEnd: START,
  comparisonStart: '2026-09-03T00:00:00.000Z',
  comparisonEnd: '2026-09-04T00:00:00.000Z',
  envelopes: structuredClone(Object.values(RNI_APPROVED_TASK_ENVELOPES)),
  calls: { reddit: { ...noCalls, rni_discovery: 3 }, x: { ...noCalls, rni_classifier: 3 } },
  maxAttempts: 3,
  maxRuntimeMs: 120_000,
  leaseMs: 10_000,
  baseBackoffMs: 1000,
  maxBackoffMs: 8000,
  coalesceMs: 5000,
  maxCostUsd: '2',
  coverage: { reddit: 'Sampled Reddit discovery', x: 'Configured X sample' },
});

/** Transactional, rollback-capable test double; not advertised as a production durable adapter. */
export class TransactionalStore implements RniOrchestrationStore {
  data = {
    commands: new Map<string, RniCommandRecord>(),
    executions: new Map<string, RniExecutionRecord>(),
    outbox: new Map<string, { delivery: RniPlatformDelivery; notBefore: string }>(),
    combined: new Map<string, { runId: string; planHash: string; idempotencyKey: string }>(),
    admissions: new Map<string, string>(),
    jobs: [] as ReturnType<typeof jobRun.parse>[],
    audits: [] as Parameters<RniOrchestrationTransaction['audit']>[0][],
    definition: jobDefinition.parse({
      id: uuid(800),
      jobKey: 'rni-refresh',
      displayName: 'RNI refresh',
      enabled: true,
      scheduleType: 'interval',
      scheduleExpression: '300',
      displayTimezone: 'Pacific/Auckland',
      activeWindows: [],
      jitterSeconds: 0,
      scope,
      priority: 1,
      maxRuntimeSeconds: 120,
      concurrencyPolicy: 'skip',
      maxAttempts: 3,
      backoffPolicy: {},
      dependencies: [],
      maxCallsPerRun: 100,
      maxCostUsdPerRun: '25',
      triggerEligible: false,
      nextDueAt: START,
      configVersion: '1',
      version: 1,
      updatedBy: 'admin',
      updatedAt: START,
    }),
  };
  activePlan = planFixture();
  usage = { rollingDayUsd: '0', calendarMonthUsd: '0' };
  failEnqueue = false;
  failAudit = false;
  crossedJob = false;
  planReads = 0;
  transactions = 0;
  private tail: Promise<void> = Promise.resolve();
  async transact<T>(
    _partition: string,
    operation: (tx: RniOrchestrationTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactions++;
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    const draft = structuredClone(this.data);
    const tx: RniOrchestrationTransaction = {
      getCommand: async (key) => draft.commands.get(key) ?? null,
      putCommand: async (record) => {
        draft.commands.set(record.key, structuredClone(record));
      },
      getExecution: async (id) => draft.executions.get(id) ?? null,
      findCoalescible: async (key, at) =>
        [...draft.executions.values()].find(
          (record) =>
            record.coalesceKey === key &&
            Date.parse(record.coalesceUntil) > Date.parse(at) &&
            Date.parse(record.deadline) > Date.parse(at) &&
            ['requested', 'running'].includes(record.run.status),
        ) ?? null,
      resolveActivePlan: async (requestedScope) => {
        this.planReads++;
        const plan = structuredClone(this.activePlan);
        plan.scopePreview =
          requestedScope.kind === 'full_universe'
            ? { kind: 'full_universe', universeVersion: plan.universeVersion, securityCount: 501 }
            : {
                kind: 'ticker',
                ticker: requestedScope.ticker,
                securityId: requestedScope.ticker === 'NVDA' ? uuid(900) : uuid(901),
                companyName: requestedScope.ticker === 'NVDA' ? 'NVIDIA' : 'AMD',
                exchange: 'NASDAQ',
                universeVersion: plan.universeVersion,
              };
        return plan;
      },
      getJobDefinition: async (id) => (id === draft.definition.id ? draft.definition : null),
      assertScheduledJobIdle: async (jobId) => {
        if (
          draft.jobs.some(
            (job) =>
              job.jobId === jobId &&
              [...draft.executions.values()].some(
                (record) =>
                  record.jobRunId === job.id &&
                  ['requested', 'running'].includes(record.run.status),
              ),
          )
        ) {
          throw new Error('CONFLICT: schedule job is still active');
        }
      },
      createJob: async (input) => {
        const result = jobRun.parse({
          ...input,
          id: uuid(500 + draft.jobs.length),
          status: 'queued',
          attempt: 1,
          dryRun: false,
          requestedBy: input.requestedBy ?? null,
          requestReason: input.requestReason ?? null,
          startedAt: null,
          completedAt: null,
          dataAsOf: null,
          itemsRead: 0,
          itemsWritten: 0,
          providerCalls: 0,
          estimatedCostUsd: input.estimatedCostUsd,
          unpricedUnits: [],
          error: null,
        });
        draft.jobs.push(result);
        return this.crossedJob ? { ...result, configVersion: '999' } : result;
      },
      createExecution: async (record) => {
        draft.executions.set(record.run.id, structuredClone(record));
      },
      putExecution: async (record) => {
        draft.executions.set(record.run.id, structuredClone(record));
      },
      admitBudget: async ({ runId, costUsd }) => {
        const reserved = [...draft.admissions.values()].reduce(
          (sum, value) => sum.plus(value),
          new Decimal(0),
        );
        const usage = {
          rollingDayUsd: reserved.plus(this.usage.rollingDayUsd).toFixed(),
          calendarMonthUsd: reserved.plus(this.usage.calendarMonthUsd).toFixed(),
        };
        assertRniAggregateBudget(costUsd, usage);
        draft.admissions.set(runId, costUsd);
        return usage;
      },
      enqueue: async (delivery, notBefore) => {
        if (this.failEnqueue) throw new Error('simulated outbox failure');
        draft.outbox.set(delivery.deliveryKey, { delivery: structuredClone(delivery), notBefore });
      },
      enqueueCombined: async (event) => {
        draft.combined.set(event.idempotencyKey, event);
      },
      advanceSchedule: async (input) => {
        if (
          draft.definition.version !== input.version ||
          draft.definition.nextDueAt.toISOString() !== input.dueAt
        )
          throw new Error('schedule conflict');
        draft.definition.nextDueAt = new Date(input.nextDueAt);
        draft.definition.version++;
      },
      audit: async (event) => {
        if (this.failAudit) throw new Error('simulated audit failure');
        draft.audits.push(event);
      },
    };
    try {
      const result = await operation(tx);
      this.data = draft;
      return result;
    } finally {
      release();
    }
  }
}

export function harness() {
  let time = Date.parse(START),
    counter = 0;
  const store = new TransactionalStore();
  const deps: RniOrchestrationDependencies = {
    store,
    partition: 'preview',
    actor: 'admin',
    manualJobId: uuid(800),
    now: () => new Date(time),
    newId: () => uuid(++counter),
    authorize: async () => undefined,
  };
  return {
    store,
    deps,
    service: new RniRefreshService(deps),
    worker: new RniPlatformExecutionService({ ...deps, random: () => 0.5 }),
    advance: (ms: number) => {
      time += ms;
    },
    record: (id: string) => structuredClone(store.data.executions.get(id)!),
  };
}
