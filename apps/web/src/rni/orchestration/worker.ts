import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RniOrchestrationError } from './budget';
import type { RniCombinedExecutionService, RniCombinedLease } from './combined';
import type { RniExecutionLease, RniPlatformExecutionService } from './execution';
import { verifyRniQstashRequest } from './qstash';
import { combinedDelivery, platformDelivery, type RniExecutionRecord } from './types';

export const RNI_WORKER_PATH = '/api/internal/rni/worker';
const MAX_BODY_BYTES = 32_768;
const delivery = z.union([platformDelivery, combinedDelivery]);

export type RniWorkerServices = {
  platform: Pick<RniPlatformExecutionService, 'claim' | 'heartbeat' | 'finish'>;
  combined: Pick<
    RniCombinedExecutionService,
    | 'claim'
    | 'effectFence'
    | 'heartbeat'
    | 'commitPublication'
    | 'commitFullUniversePublication'
    | 'finish'
    | 'fail'
  >;
  /** Reconstruct and validate the committed record in the trusted environment partition. */
  readExecution(runId: string): Promise<RniExecutionRecord>;
};

/**
 * Production composition must provide BOTH real pipelines. Implementations own heartbeat,
 * per-provider lease/budget checks, source-first checkpoints and durable finish/retry. Combined
 * publication must use the matching transaction-bound combined commit method with the I07 writer.
 * A returned promise alone is not success: the receiver verifies committed terminal/retry state.
 */
export interface RniWorkerExecutor {
  platform(input: {
    lease: RniExecutionLease;
    record: RniExecutionRecord;
    services: RniWorkerServices;
  }): Promise<void>;
  combined(input: {
    lease: RniCombinedLease;
    record: RniExecutionRecord;
    services: RniWorkerServices;
  }): Promise<void>;
}

export class RniWorkerUnavailableError extends Error {
  constructor() {
    super('The production RNI worker executor is not configured.');
    this.name = 'RniWorkerUnavailableError';
  }
}

/** No fixture fallback or mutable registration hook. Replace only with reviewed live composition. */
export function getProductionRniWorkerExecutor(): RniWorkerExecutor | null {
  return null;
}

export function requireRniWorkerExecutor(executor: RniWorkerExecutor | null): RniWorkerExecutor {
  if (
    executor === null ||
    typeof executor?.platform !== 'function' ||
    typeof executor?.combined !== 'function'
  ) {
    throw new RniWorkerUnavailableError();
  }
  return executor;
}

type ReceiverDependencies = {
  expectedUrl: string;
  currentSigningKey: string;
  nextSigningKey: string;
  now(): Date;
  /** Invoked only after raw-byte authentication and strict delivery validation. */
  resolveExecutor(): RniWorkerExecutor | null | Promise<RniWorkerExecutor | null>;
  /** Must remain lazy: invalid/unconfigured deliveries construct no storage/provider services. */
  createServices(): RniWorkerServices | Promise<RniWorkerServices>;
};

class InvalidBody extends Error {
  constructor(readonly status: 400 | 413) {
    super('Invalid worker request body');
  }
}

async function boundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InvalidBody(413);
      }
      chunks.push(chunk.value);
    }
    // Reject invalid UTF-8 instead of hashing replacement characters rather than signed bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    if (error instanceof InvalidBody) throw error;
    throw new InvalidBody(400);
  } finally {
    reader.releaseLock();
  }
}

function processed(record: RniExecutionRecord, lease: RniExecutionLease | RniCombinedLease) {
  if (record.run.id !== lease.delivery.runId || record.planHash !== lease.delivery.planHash)
    return false;
  if ('platform' in lease.delivery) {
    const state = record.platforms[lease.delivery.platform];
    if (state.attempt !== lease.delivery.attempt || state.lease !== null) return false;
    return (
      (['complete', 'partial', 'failed', 'unavailable'].includes(state.slice.status) &&
        state.outcomeToken === lease.token) ||
      (state.slice.status === 'pending' && state.delivery.attempt === lease.delivery.attempt + 1)
    );
  }
  const state = record.combined;
  if (
    state.attempt !== lease.delivery.attempt ||
    state.lease !== null ||
    state.outcomeToken !== lease.token
  )
    return false;
  return (
    (state.status === 'complete' && state.publication?.token === lease.token) ||
    state.status === 'failed' ||
    (state.status === 'pending' && state.delivery.attempt === lease.delivery.attempt + 1)
  );
}

export async function receiveRniWorkerRequest(
  request: Request,
  deps: ReceiverDependencies,
): Promise<Response> {
  // Do not reflect caller-controlled request IDs, signatures, payloads or exception text.
  const requestId = randomUUID();
  const error = (status: number, code: string, message: string, retryable = status >= 500) =>
    Response.json(
      { error: { code, message, retryable, requestId } },
      {
        status,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  if (!deps.currentSigningKey || !deps.nextSigningKey)
    return error(503, 'PROVIDER_UNAVAILABLE', 'RNI worker authentication is unavailable.');

  let rawBody: string;
  try {
    rawBody = await boundedBody(request);
    verifyRniQstashRequest({
      rawBody,
      signature: request.headers.get('upstash-signature'),
      expectedUrl: deps.expectedUrl,
      currentSigningKey: deps.currentSigningKey,
      nextSigningKey: deps.nextSigningKey,
      now: deps.now(),
    });
  } catch (caught) {
    if (caught instanceof InvalidBody)
      return error(caught.status, 'INVALID_REQUEST', 'The RNI delivery body is invalid.', false);
    return error(403, 'FORBIDDEN', 'RNI delivery authentication failed.', false);
  }
  let payload: z.infer<typeof delivery>;
  try {
    payload = delivery.parse(JSON.parse(rawBody));
  } catch {
    return error(400, 'INVALID_REQUEST', 'The RNI delivery payload is invalid.', false);
  }

  try {
    const executor = requireRniWorkerExecutor(await deps.resolveExecutor());
    const services = await deps.createServices();
    const claim =
      'platform' in payload
        ? await services.platform.claim(payload)
        : await services.combined.claim(payload);
    if (claim.status === 'busy' || claim.status === 'deferred') {
      const response = error(503, 'CONFLICT', 'The RNI delivery is not ready to execute.');
      response.headers.set(
        'Retry-After',
        String(Math.max(1, Math.ceil((Date.parse(claim.retryAt) - deps.now().getTime()) / 1000))),
      );
      return response;
    }
    if (claim.status !== 'acquired') {
      return Response.json(
        { data: { status: claim.status, runId: payload.runId } },
        {
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }
    // Discriminate the acquired lease itself so crossed platform/combined payloads cannot route.
    if ('platform' in claim.lease.delivery) {
      await executor.platform({
        lease: claim.lease as RniExecutionLease,
        record: claim.record,
        services,
      });
    } else {
      await executor.combined({
        lease: claim.lease as RniCombinedLease,
        record: claim.record,
        services,
      });
    }
    if (!processed(await services.readExecution(payload.runId), claim.lease))
      throw new RniWorkerUnavailableError();
    return Response.json(
      { data: { status: 'processed', runId: payload.runId } },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (caught) {
    if (caught instanceof RniOrchestrationError) {
      if (caught.code === 'NOT_FOUND')
        return error(404, 'RUN_NOT_FOUND', 'The RNI execution was not found.', false);
      if (caught.code === 'CONFLICT' || caught.code === 'STALE_EXECUTION')
        return error(409, 'CONFLICT', 'The RNI execution authority is no longer valid.', true);
    }
    return error(503, 'PROVIDER_UNAVAILABLE', 'RNI worker execution is currently unavailable.');
  }
}
