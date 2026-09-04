/** Versioned configuration and the governed universe (ADR-012, ADR-015). Tables in `0006_`. */
import { z } from 'zod';
import { bigintString, decimalString, jsonValue, timestamp, uuid } from './primitives';

export const configVersionStatus = z.enum([
  'draft',
  'staged',
  'active',
  'superseded',
  'rolled_back',
]);

export const configVersion = z.object({
  id: bigintString,
  environment: z.string().min(1),
  status: configVersionStatus,
  parentVersion: bigintString.nullable(),
  createdBy: z.string().min(1),
  changeReason: z.string().min(1),
  createdAt: timestamp,
  effectiveAt: timestamp,
  activatedAt: timestamp.nullable(),
  approvedBy: z.string().nullable(),
  checksum: z.string().min(1),
});
export type ConfigVersion = z.infer<typeof configVersion>;

export const settingScopeType = z.enum(['global', 'provider', 'feature', 'route', 'user_tier']);

export const appSetting = z.object({
  configVersion: bigintString,
  settingKey: z.string().min(1),
  scopeType: settingScopeType,
  scopeId: z.string(),
  value: jsonValue,
  valueType: z.string().min(1),
  governanceClass: z.string().min(1),
  settingSchemaVersion: z.string().min(1),
  methodAffecting: z.boolean(),
  /**
   * ADR-012: secrets are deployment-only and never enter this catalogue. `false` is the only
   * legal value — the database enforces it too, because a rule that lives only in one write
   * path stops holding the day a second one is added.
   */
  sensitive: z.literal(false),
});
export type AppSetting = z.infer<typeof appSetting>;

export const universeVersionStatus = z.enum(['draft', 'staged', 'active', 'superseded']);

/** D-RNI-06: hard safety ceiling for the configurable FMP S&P 500 universe. */
export const UNIVERSE_MAX_SYMBOLS = 600;

export const universeVersion = z.object({
  id: bigintString,
  environment: z.string().min(1),
  configVersion: bigintString,
  status: universeVersionStatus,
  parentVersion: bigintString.nullable(),
  selectedCount: z.number().int().nonnegative().max(UNIVERSE_MAX_SYMBOLS),
  selectionQuery: jsonValue.nullable(),
  impactPreview: jsonValue,
  sourceProvider: z.string().min(1).nullable(),
  sourceEndpoint: z.string().min(1).nullable(),
  sourceRetrievedAt: timestamp.nullable(),
  sourcePayloadHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  providerCallId: uuid.nullable(),
  createdBy: z.string().min(1),
  changeReason: z.string().min(1),
  createdAt: timestamp,
  activatedAt: timestamp.nullable(),
  approvedBy: z.string().min(1).nullable(),
});
export type UniverseVersion = z.infer<typeof universeVersion>;

export const selectionSource = z.enum([
  'checkbox',
  'bulk_filter',
  'import',
  'preset',
  'seed',
  'fmp_sp500',
]);

export const universeMember = z.object({
  universeVersion: bigintString,
  securityId: uuid,
  enabled: z.boolean(),
  addedBy: z.string().min(1),
  selectionSource,
  providerSymbol: z.string().min(1).nullable(),
  providerCompanyName: z.string().min(1).nullable(),
  constituentFirstAddedAt: timestamp.nullable(),
  createdAt: timestamp,
});
export type UniverseMember = z.infer<typeof universeMember>;

export const modelRoute = z.object({
  configVersion: bigintString,
  task: z.string().min(1),
  transport: z.string().min(1),
  primaryProvider: z.string().min(1),
  primaryModel: z.string().min(1),
  /** Immutable. A model whose ID can be retired may not produce anything entering the corpus. */
  modelRevision: z.string().min(1),
  fallbackChain: jsonValue,
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  calibrationVersion: z.string().nullable(),
  temperature: decimalString,
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxCostUsd: decimalString,
  allowedDataClasses: jsonValue,
  shadowModel: jsonValue.nullable(),
  canaryPercent: decimalString,
  evaluationRunId: uuid.nullable(),
  enabled: z.boolean(),
});
export type ModelRoute = z.infer<typeof modelRoute>;
