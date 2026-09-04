/** Jobs, providers and raw payloads (ADR-013). Tables in `0007_`. */
import { z } from 'zod';
import { bigintString, decimalString, jsonValue, timestamp, uuid } from './primitives';

export const scheduleType = z.enum(['interval', 'cron']);
export const concurrencyPolicy = z.enum(['skip', 'queue', 'cancel_running']);

export const jobDefinition = z.object({
  id: uuid,
  jobKey: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean(),
  scheduleType,
  scheduleExpression: z.string().min(1),
  displayTimezone: z.string().min(1),
  activeWindows: jsonValue,
  jitterSeconds: z.number().int().nonnegative(),
  scope: jsonValue,
  priority: z.number().int(),
  maxRuntimeSeconds: z.number().int().positive(),
  concurrencyPolicy,
  maxAttempts: z.number().int().positive(),
  backoffPolicy: jsonValue,
  dependencies: jsonValue,
  maxCallsPerRun: z.number().int().positive().nullable(),
  maxCostUsdPerRun: decimalString.nullable(),
  /**
   * D-15 / F16 §4.1b. The trigger path may dispatch only a job registered eligible here. A
   * seeded column rather than a runtime predicate, so a spike cannot dispatch something
   * nobody costed.
   */
  triggerEligible: z.boolean(),
  nextDueAt: timestamp,
  configVersion: bigintString,
  version: z.number().int().positive(),
  updatedBy: z.string().min(1),
  updatedAt: timestamp,
});
export type JobDefinition = z.infer<typeof jobDefinition>;

/** `triggered` is D-15's second dispatch path: opened by a market-data event, not a clock. */
export const jobTriggerType = z.enum(['scheduled', 'manual', 'bootstrap', 'retry', 'triggered']);

export const jobRunStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'degraded',
  'failed',
  'cancelled',
  'skipped',
]);

export const jobRun = z.object({
  id: uuid,
  jobId: uuid,
  triggerType: jobTriggerType,
  /** F16 §4.1: derived from (job_id, due_at). A re-delivery of the same due instant is a no-op. */
  idempotencyKey: z.string().min(1),
  configVersion: bigintString,
  universeVersion: bigintString.nullable(),
  status: jobRunStatus,
  attempt: z.number().int().positive(),
  dryRun: z.boolean(),
  requestedBy: z.string().nullable(),
  requestReason: z.string().nullable(),
  lockKey: z.string().min(1),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  dataAsOf: timestamp.nullable(),
  itemsRead: z.number().int().nonnegative(),
  itemsWritten: z.number().int().nonnegative(),
  providerCalls: z.number().int().nonnegative(),
  estimatedCostUsd: decimalString,
  unpricedUnits: jsonValue,
  error: jsonValue.nullable(),
  metrics: jsonValue,
});
export type JobRun = z.infer<typeof jobRun>;

/**
 * Mirrors `docs/provider-rights.md`. `not_established` is the default and is **not** the same
 * as `blocked`: it means nobody has checked, which is the state most providers are in.
 */
export const rightsStatus = z.enum([
  'internal_only',
  'display_permitted',
  'not_established',
  'blocked',
]);

export const providerPolicy = z.object({
  configVersion: bigintString,
  provider: z.string().min(1),
  enabled: z.boolean(),
  planName: z.string().min(1),
  allowedOperations: jsonValue,
  defaultJobId: uuid.nullable(),
  timeoutMs: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  dailyCallCap: z.number().int().positive().nullable(),
  warningAgeSeconds: z.number().int().positive(),
  hardExpirySeconds: z.number().int().positive(),
  retentionDays: z.number().int().nonnegative(),
  rightsStatus,
  attributionText: z.string().nullable(),
});
export type ProviderPolicy = z.infer<typeof providerPolicy>;

export const dataAgreement = z.object({
  id: uuid,
  provider: z.string().min(1),
  productName: z.string().min(1),
  agreementStatus: z.string().min(1),
  allowedPurposes: jsonValue,
  prohibitedPurposes: jsonValue,
  geographicScope: jsonValue,
  userProductScope: jsonValue,
  attributionRequirements: z.string().nullable(),
  retentionDays: z.number().int().nonnegative().nullable(),
  /** Where the open Reddit retention conflict gets its answer recorded. */
  deletionObligations: z.string().nullable(),
  quotaTerms: jsonValue,
  contractOwner: z.string().min(1),
  operationalContact: z.string().nullable(),
  documentReference: z.string().nullable(),
  startsAt: z.string().nullable(),
  renewsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  nextReviewAt: z.string(),
  reviewedBy: z.string().min(1),
  reviewedAt: timestamp,
  notes: z.string().nullable(),
});
export type DataAgreement = z.infer<typeof dataAgreement>;

export const providerCallLog = z.object({
  id: uuid,
  provider: z.string().min(1),
  operation: z.string().min(1),
  requestFingerprint: z.string().min(1),
  statusCode: z.number().int().nullable(),
  latencyMs: z.number().int().nonnegative(),
  cacheStatus: z.string().min(1),
  itemsReturned: z.number().int().nonnegative().nullable(),
  estimatedCostUsd: decimalString,
  startedAt: timestamp,
  errorClass: z.string().nullable(),
});
export type ProviderCallLog = z.infer<typeof providerCallLog>;

export const rawProviderPayload = z.object({
  id: uuid,
  provider: z.string().min(1),
  operation: z.string().min(1),
  jobRunId: uuid.nullable(),
  researchRunId: uuid.nullable(),
  securityId: uuid.nullable(),
  requestFingerprint: z.string().min(1),
  httpStatus: z.number().int().nullable(),
  /** Nullable so a hash and metadata can be stored where rights forbid raw retention. */
  sanitizedPayload: jsonValue.nullable(),
  payloadHash: z.string().min(1),
  contentClass: z.string().min(1),
  redactionStatus: z.string().min(1),
  rightsStatus,
  parserVersion: z.string().min(1),
  dataAsOf: timestamp.nullable(),
  ingestedAt: timestamp,
  retentionUntil: timestamp,
});
export type RawProviderPayload = z.infer<typeof rawProviderPayload>;
