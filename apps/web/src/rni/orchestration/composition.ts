import { randomUUID } from 'node:crypto';
import { env } from '@/env';
import { rniEnvironment } from '@/rni/read-model';
import {
  PostgresRniOrchestrationStore,
  PostgresRniOutbox,
  ensureRniJobDefinitions,
} from '@/rni/repositories/orchestration';
import { RniCombinedExecutionService } from './combined';
import { RniPlatformExecutionService } from './execution';
import { RniRefreshService, validateRniExecution } from './refresh';
import { findTriggerEligibleJobDefinition } from '@/repositories/jobs';
import { relayRniCombinedOutbox, relayRniPlatformOutbox } from './outbox';
import { RniQstashPublisher } from './qstash-publisher';
import {
  getProductionRniWorkerExecutor,
  requireRniWorkerExecutor,
  RNI_WORKER_PATH,
} from './worker';

function assertLiveOrchestrationEnvironment() {
  if (env.PROVIDER_MODE !== 'live' || env.DATABASE_URL === undefined) {
    throw new Error('Live RNI orchestration is unavailable');
  }
  return rniEnvironment();
}

/** Route handlers call this only after requireAdmin and same-origin checks have succeeded. */
export async function createLiveRniRefreshService(actor: string) {
  requireRniWorkerExecutor(getProductionRniWorkerExecutor());
  const partition = assertLiveOrchestrationEnvironment();
  const store = new PostgresRniOrchestrationStore();
  const { manualJobId } = await ensureRniJobDefinitions(partition);
  return new RniRefreshService({
    store,
    partition,
    actor,
    manualJobId,
    now: () => new Date(),
    newId: randomUUID,
    authorize: async () => undefined,
  });
}

export async function dispatchLiveRniSchedule(actor = 'rni-scheduler') {
  requireRniWorkerExecutor(getProductionRniWorkerExecutor());
  const partition = assertLiveOrchestrationEnvironment();
  if (!env.QSTASH_TOKEN) throw new Error('QStash publication is unavailable');
  const store = new PostgresRniOrchestrationStore();
  const now = new Date();
  const destination = new URL(RNI_WORKER_PATH, env.APP_BASE_URL).toString();
  const services = createLiveRniExecutionServices();
  const publisher = new RniQstashPublisher(env.QSTASH_TOKEN, destination);
  let schedule: Awaited<ReturnType<RniRefreshService['schedule']>> | null = null;
  let scheduleError: unknown;
  try {
    const { manualJobId, scheduledJobId } = await ensureRniJobDefinitions(partition);
    const definition = await findTriggerEligibleJobDefinition(`rni-scheduled:${partition}`);
    if (definition !== null && definition.id !== scheduledJobId) {
      throw new Error('RNI schedule definition is unavailable');
    }
    const service = new RniRefreshService({
      store,
      partition,
      actor,
      manualJobId,
      now: () => now,
      newId: randomUUID,
      authorize: async () => undefined,
    });
    schedule =
      definition !== null && definition.nextDueAt.getTime() <= now.getTime()
        ? await service.schedule({
            jobId: scheduledJobId,
            dueAt: definition.nextDueAt.toISOString(),
          })
        : null;
  } catch (error) {
    scheduleError = error;
  }
  // Drain after the schedule transaction finishes so this same heartbeat sees both older
  // intent and any newly committed scheduled run. This still runs after a planning failure,
  // preventing an unrelated bad schedule from starving committed retries/manual work.
  // Await both independently: a serverless request must not return while the sibling relay is
  // still at risk of being frozen after the first relay rejects.
  const relayResults = await Promise.allSettled([
    relayRniPlatformOutbox({ outbox: services.platformOutbox, publisher, now }),
    relayRniCombinedOutbox({ outbox: services.combinedOutbox, publisher, now }),
  ]);
  const relayErrors = relayResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (scheduleError !== undefined && relayErrors.length > 0) {
    throw new AggregateError(
      [scheduleError, ...relayErrors],
      'RNI schedule and outbox relay failed',
    );
  }
  if (scheduleError !== undefined) throw scheduleError;
  if (relayErrors.length > 0) throw new AggregateError(relayErrors, 'RNI outbox relay failed');
  const [platformPublished, combinedPublished] = relayResults.map((result) =>
    result.status === 'fulfilled' ? result.value : 0,
  ) as [number, number];
  return { schedule, platformPublished, combinedPublished };
}

export function createLiveRniExecutionServices() {
  const partition = assertLiveOrchestrationEnvironment();
  const store = new PostgresRniOrchestrationStore();
  const dependencies = { store, partition, now: () => new Date(), newId: randomUUID };
  return {
    partition,
    readExecution: (runId: string) =>
      store.transact(partition, async (tx) =>
        validateRniExecution(await tx.getExecution(runId), partition, runId),
      ),
    platform: new RniPlatformExecutionService(dependencies),
    combined: new RniCombinedExecutionService(dependencies),
    platformOutbox: new PostgresRniOutbox(partition, 'platform'),
    combinedOutbox: new PostgresRniOutbox(partition, 'combined'),
  };
}
