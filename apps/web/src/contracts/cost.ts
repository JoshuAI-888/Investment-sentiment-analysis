/** Cost accounting, budgets, audit and the method registry. Tables in `0008_`. */
import { z } from 'zod';
import { bigintString, decimalString, jsonValue, timestamp, uuid } from './primitives';

export const unitType = z.enum([
  'call',
  'search',
  'input_token',
  'output_token',
  'compute_second',
  'post_read',
]);

export const costStatus = z.enum(['estimated', 'actual', 'reconciled', 'unpriced']);

export const costEvent = z
  .object({
    id: uuid,
    occurredAt: timestamp,
    provider: z.string().min(1),
    service: z.string().min(1),
    operationOrModel: z.string().min(1),
    feature: z.string().min(1),
    jobRunId: uuid.nullable(),
    researchRunId: uuid.nullable(),
    userId: z.string().nullable(),
    requestId: z.string().min(1),
    unitType,
    requestUnits: decimalString,
    billableUnits: decimalString,
    unitPrice: decimalString.nullable(),
    currency: z.string().length(3),
    priceBookVersion: z.string().nullable(),
    /** Null means unpriced. There is no zero default — see the refinement below. */
    costUsd: decimalString.nullable(),
    costStatus,
    cacheStatus: z.string().min(1),
    metadata: jsonValue,
    /** Reconciliation writes a successor row rather than updating this one. */
    supersedesCostEventId: uuid.nullable(),
  })
  .refine((event) => (event.costStatus === 'unpriced') === (event.costUsd === null), {
    message:
      'cost_usd is null exactly when cost_status is unpriced (F03 §4.2). Null means "we made the call and do not know what it cost"; zero means "it was free". Collapsing those is how a month reads as comfortable on the day the ceiling is actually exhausted — and D-11 left the global ceiling as the only budget control.',
    path: ['costUsd'],
  });
export type CostEvent = z.infer<typeof costEvent>;

export const unitPriceBookEntry = z.object({
  priceBookVersion: z.string().min(1),
  provider: z.string().min(1),
  service: z.string().min(1),
  operationOrModel: z.string().min(1),
  unitType,
  unitPrice: decimalString,
  currency: z.string().length(3),
  effectiveFrom: timestamp,
  effectiveUntil: timestamp.nullable(),
  sourceReference: z.string().min(1),
});
export type UnitPriceBookEntry = z.infer<typeof unitPriceBookEntry>;

export const budgetScopeType = z.enum(['global', 'provider', 'feature', 'model_route']);
export const budgetPeriod = z.enum(['daily', 'monthly']);

export const budgetPolicy = z
  .object({
    id: uuid,
    environment: z.string().min(1),
    scopeType: budgetScopeType,
    scopeId: z.string(),
    period: budgetPeriod,
    softLimit: decimalString,
    hardLimit: decimalString,
    currency: z.string().length(3),
    actions: jsonValue,
    enabled: z.boolean(),
    configVersion: bigintString,
  })
  .refine((policy) => Number(policy.softLimit) <= Number(policy.hardLimit), {
    message: 'softLimit must not exceed hardLimit',
    path: ['softLimit'],
  });
export type BudgetPolicy = z.infer<typeof budgetPolicy>;

export const auditResult = z.enum(['success', 'failure', 'rejected']);

export const auditEvent = z.object({
  id: uuid,
  occurredAt: timestamp,
  actorId: z.string().min(1),
  actorRole: z.string().min(1),
  action: z.string().min(1),
  objectType: z.string().min(1),
  objectId: z.string().min(1),
  environment: z.string().min(1),
  reason: z.string().min(1),
  beforeValue: jsonValue.nullable(),
  afterValue: jsonValue.nullable(),
  result: auditResult,
  requestId: z.string().min(1),
  correlationId: z.string().min(1),
  ipHash: z.string().nullable(),
  userAgent: z.string().nullable(),
  approval: jsonValue.nullable(),
  rollbackOf: uuid.nullable(),
});
export type AuditEvent = z.infer<typeof auditEvent>;

export const methodRegistryEntry = z.object({
  methodKey: z.string().min(1),
  methodVersion: z.string().min(1),
  displayName: z.string().min(1),
  family: z.string().min(1),
  plainLanguage: z.string().min(1),
  formulaLatex: z.string().nullable(),
  inputContract: jsonValue,
  parameterSchema: jsonValue,
  assumptions: jsonValue,
  outputContract: jsonValue,
  workingPrecision: z.number().int().positive(),
  roundingRule: z.string().min(1),
  userEditableAssumptionKeys: z.array(z.string()),
  exampleFixtureKey: z.string().min(1),
  changeSummary: z.string().min(1),
  failureBehavior: z.string().min(1),
  sourceCodeRef: z.string().min(1),
  /**
   * D-09. Null means the metric has not passed Tier D4 and carries the §6.4 disclosure
   * verbatim. `check:copy` reads this: predictive vocabulary on a metric with no record here
   * is a build failure, not a copy choice.
   */
  tierD4Record: z.string().nullable(),
  activeFrom: timestamp,
  retiredAt: timestamp.nullable(),
});
export type MethodRegistryEntry = z.infer<typeof methodRegistryEntry>;
