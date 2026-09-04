/** The Calculation Inspector's contracts (ADR-019). Tables in `0004_`. */
import { z } from 'zod';
import { bigintString, jsonValue, timestamp, uuid } from './primitives';

export const calculationSubjectType = z.enum([
  'security',
  'sector',
  'market',
  'job',
  'provider',
  'account',
]);

export const scenarioType = z.enum(['official', 'personal', 'shared']);

export const calculationStatus = z.enum([
  'complete',
  'insufficient_data',
  'stale',
  'ineligible',
  'failed',
]);

/** F-07 / R-05: `permanent` for anything a claim, share or open issue references. */
export const retentionClass = z.enum(['standard', 'permanent']);

/**
 * One point of a series artifact. F-07's ruling in one type: a 180-point return series is
 * **one** artifact carrying 180 of these, not 180 artifacts. A chart point is addressed as
 * `{calculationId, pointIndex}` and resolved from here.
 */
export const calculationPoint = z.object({
  pointIndex: z.number().int().nonnegative(),
  observationKey: z.string().min(1),
  exactValue: z.string(),
  displayValue: z.string(),
});
export type CalculationPoint = z.infer<typeof calculationPoint>;

export const calculationSnapshot = z.object({
  id: uuid,
  metricKey: z.string().min(1),
  subjectType: calculationSubjectType,
  subjectId: z.string().min(1),
  observationKey: z.string().nullable(),
  scenarioType,
  officialCalculationId: uuid.nullable(),
  ownerUserId: z.string().nullable(),
  methodKey: z.string().min(1),
  methodVersion: z.string().min(1),
  configVersion: bigintString,
  universeVersion: bigintString.nullable(),
  assumptionProfileVersion: bigintString.nullable(),
  inputCutoff: timestamp,
  status: calculationStatus,
  /** Decimal strings inside JSON. A JSON number is a double the moment it is parsed. */
  exactResult: jsonValue,
  displayResult: jsonValue,
  points: z.array(calculationPoint).nullable(),
  assumptions: jsonValue,
  warnings: z.array(z.string()),
  inputHash: z.string().min(1),
  resultHash: z.string().min(1),
  predecessorCalculationId: uuid.nullable(),
  retentionClass,
  computedAt: timestamp,
  expiresAt: timestamp.nullable(),
});
export type CalculationSnapshot = z.infer<typeof calculationSnapshot>;

export const calculationInput = z.object({
  calculationId: uuid,
  inputKey: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  normalizedValue: jsonValue,
  providerOriginalValue: jsonValue.nullable(),
  dataType: z.string().min(1),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  scale: z.string().nullable(),
  provider: z.string().nullable(),
  providerRecordId: z.string().nullable(),
  rawPayloadId: uuid.nullable(),
  sourceUrl: z.string().nullable(),
  primarySourceRef: jsonValue.nullable(),
  observedAt: timestamp.nullable(),
  availableAt: timestamp.nullable(),
  ingestedAt: timestamp.nullable(),
  fiscalPeriod: jsonValue.nullable(),
  normalizationRule: z.string().nullable(),
  transformation: jsonValue,
  qualityStatus: z.string().min(1),
  freshnessStatus: z.string().min(1),
  licenseClass: z.string().min(1),
  redactionClass: z.string().min(1),
  valueHash: z.string().min(1),
});
export type CalculationInput = z.infer<typeof calculationInput>;

export const stepStatus = z.enum(['applied', 'excluded', 'clamped', 'missing', 'warning']);

export const calculationStep = z.object({
  calculationId: uuid,
  sequence: z.number().int().nonnegative(),
  stepKey: z.string().min(1),
  parentStepKey: z.string().nullable(),
  label: z.string().min(1),
  formulaSymbolic: z.string().min(1),
  formulaSubstituted: z.string().min(1),
  operands: jsonValue,
  exactOutput: jsonValue,
  displayOutput: jsonValue,
  unit: z.string().nullable(),
  roundingRule: z.string().nullable(),
  status: stepStatus,
  notes: jsonValue,
  stepHash: z.string().min(1),
});
export type CalculationStep = z.infer<typeof calculationStep>;

export const assumptionScopeType = z.enum(['account_default', 'subject_override']);
export const assumptionStatus = z.enum(['active', 'reset', 'superseded']);

export const userAssumptionProfile = z.object({
  id: uuid,
  userId: z.string().min(1),
  methodKey: z.string().min(1),
  scopeType: assumptionScopeType,
  subjectId: z.string().nullable(),
  overrides: jsonValue,
  baseMethodVersion: z.string().min(1),
  baseConfigVersion: bigintString,
  version: bigintString,
  status: assumptionStatus,
  updatedBy: z.string().min(1),
  updatedByRole: z.enum(['user', 'admin']),
  changeReason: z.string().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
  resetAt: timestamp.nullable(),
});
export type UserAssumptionProfile = z.infer<typeof userAssumptionProfile>;

export const calculationShare = z.object({
  id: uuid,
  sourceCalculationId: uuid,
  sharedSnapshotId: uuid,
  createdBy: z.string().min(1),
  visibility: z.literal('authenticated_entitled'),
  createdAt: timestamp,
  revokedAt: timestamp.nullable(),
  revokedBy: z.string().nullable(),
});
export type CalculationShare = z.infer<typeof calculationShare>;

export const issueType = z.enum([
  'source',
  'provider_original',
  'normalization',
  'units',
  'formula',
  'assumption',
  'stale',
  'rounding',
  'other',
]);
export const issueStatus = z.enum(['new', 'triaged', 'investigating', 'resolved', 'rejected']);

export const calculationIssue = z.object({
  id: uuid,
  calculationId: uuid,
  inputKey: z.string().nullable(),
  stepKey: z.string().nullable(),
  reporterUserId: z.string().min(1),
  issueType,
  description: z.string().min(1),
  status: issueStatus,
  assignedTo: z.string().nullable(),
  adminNotes: z.string().nullable(),
  resolutionSummary: z.string().nullable(),
  resolutionCalculationId: uuid.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  resolvedAt: timestamp.nullable(),
});
export type CalculationIssue = z.infer<typeof calculationIssue>;

export const validationTriggerType = z.enum([
  'user_replay',
  'scheduled_sample',
  'release_test',
  'issue_review',
]);
export const validationStatus = z.enum(['pass', 'mismatch', 'method_unavailable', 'error']);

export const calculationValidationRun = z.object({
  id: uuid,
  calculationId: uuid,
  requestedBy: z.string().min(1),
  triggerType: validationTriggerType,
  methodVersion: z.string().min(1),
  inputHashExpected: z.string().min(1),
  inputHashActual: z.string().min(1),
  resultHashExpected: z.string().min(1),
  resultHashActual: z.string().min(1),
  status: validationStatus,
  differences: jsonValue,
  startedAt: timestamp,
  completedAt: timestamp.nullable(),
});
export type CalculationValidationRun = z.infer<typeof calculationValidationRun>;
