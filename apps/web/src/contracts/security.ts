/** The security master and everything observed about a security. Tables in `0002_`. */
import { z } from 'zod';
import { decimalString, isoDate, jsonValue, timestamp, uuid } from './primitives';

export const assetType = z.enum(['equity', 'etf']);

export const security = z.object({
  id: uuid,
  symbol: z.string().min(1),
  name: z.string().min(1),
  exchange: z.string().min(1),
  assetType,
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  cik: z.string().nullable(),
  currency: z.string().length(3),
  active: z.boolean(),
  aliases: z.array(z.string()),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Security = z.infer<typeof security>;

export const eligibilityState = z.enum([
  'ready',
  'partial',
  'unsupported',
  'rights_blocked',
  'inactive',
]);

export const securityProfileSnapshot = z.object({
  securityId: uuid,
  provider: z.string().min(1),
  marketCap: decimalString.nullable(),
  marketCapCurrency: z.string().length(3).nullable(),
  sectorRaw: z.string().nullable(),
  industryRaw: z.string().nullable(),
  sectorCanonical: z.string().nullable(),
  industryCanonical: z.string().nullable(),
  eligibilityState,
  eligibilityReasons: z.array(z.string()),
  observedAt: timestamp,
  ingestedAt: timestamp,
  rawHash: z.string().min(1),
});
export type SecurityProfileSnapshot = z.infer<typeof securityProfileSnapshot>;

export const marketSession = z.enum(['premarket', 'regular', 'afterhours', 'closed', 'eod']);

export const marketSnapshot = z.object({
  securityId: uuid,
  price: decimalString,
  changePercent: decimalString.nullable(),
  session: marketSession,
  provider: z.string().min(1),
  observedAt: timestamp,
  ingestedAt: timestamp,
  rawHash: z.string().min(1),
});
export type MarketSnapshot = z.infer<typeof marketSnapshot>;

/** D-31: the price trigger runs on FMP Starter's daily bars. `eod` is the Wave 1 session. */
export const adjustmentStatus = z.enum(['adjusted', 'unadjusted', 'unknown']);

export const priceReturnSnapshot = z.object({
  securityId: uuid,
  asOfDate: isoDate,
  horizonCalendarDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180)]),
  asOfPrice: decimalString,
  asOfPriceDate: isoDate,
  baselinePrice: decimalString,
  baselinePriceDate: isoDate,
  totalReturn: decimalString.nullable(),
  adjustmentStatus,
  qualityStatus: z.string().min(1),
  provider: z.string().min(1),
  methodVersion: z.string().min(1),
  computedAt: timestamp,
});
export type PriceReturnSnapshot = z.infer<typeof priceReturnSnapshot>;

export const valuationStatus = z.enum([
  'undervalued',
  'overvalued',
  'uncertain',
  'insufficient_data',
  'not_applicable',
]);

/** ADR-018, deferred under D-19. The contract exists; nothing writes it in Waves 1–5. */
export const valuationSnapshot = z.object({
  id: uuid,
  securityId: uuid,
  asOfDate: isoDate,
  price: decimalString,
  priceObservedAt: timestamp,
  currency: z.string().length(3),
  status: valuationStatus,
  modelLow: decimalString.nullable(),
  modelMid: decimalString.nullable(),
  modelHigh: decimalString.nullable(),
  lowGap: decimalString.nullable(),
  midGap: decimalString.nullable(),
  highGap: decimalString.nullable(),
  confidence: decimalString.nullable(),
  eligibleMethodCount: z.number().int().nonnegative(),
  eligiblePeerCount: z.number().int().nonnegative(),
  methodOutputs: jsonValue,
  assumptions: jsonValue,
  inputLineage: jsonValue,
  analystTarget: jsonValue.nullable(),
  configVersion: z.string(),
  methodVersion: z.string().min(1),
  computedAt: timestamp,
  expiresAt: timestamp.nullable(),
});
export type ValuationSnapshot = z.infer<typeof valuationSnapshot>;

export const attentionSource = z.enum(['apewisdom', 'reddit', 'x', 'substack', 'stocktwits']);
export const coverageClass = z.enum(['pov_index', 'licensed_sample', 'licensed_full']);

export const attentionSnapshot = z.object({
  securityId: uuid,
  source: attentionSource,
  rank: z.number().int().positive().nullable(),
  rankPrior: z.number().int().positive().nullable(),
  mentions: z.number().int().nonnegative(),
  mentionsPrior: z.number().int().nonnegative().nullable(),
  engagement: z.number().int().nonnegative().nullable(),
  windowHours: z.number().int().positive(),
  coverageClass,
  /**
   * F-05 / R-03. Pinned per snapshot because the provider does not version its own methodology.
   * A rank change across a boundary is `not_applicable`, never a number — D-30 makes this the
   * *only* interpretable attention figure, since selecting by attention and then measuring it
   * leaves the level uninterpretable.
   */
  providerMethodologyVersion: z.string().min(1),
  observedAt: timestamp,
  ingestedAt: timestamp,
  rawHash: z.string().min(1),
});
export type AttentionSnapshot = z.infer<typeof attentionSnapshot>;
