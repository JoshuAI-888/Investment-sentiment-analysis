/** The evidence corpus and the sentiment aggregates. Tables in `0003_`. */
import { z } from 'zod';
import { decimalString, jsonValue, stanceLabel, timestamp, uuid } from './primitives';

export const evidenceType = z.enum(['news', 'social_result', 'filing', 'macro', 'provider_fact']);

/** F-19 / R-17. An unreachable source is labelled, never repaired, never invalidating. */
export const availability = z.enum([
  'available',
  'unreachable',
  'removed',
  'paywalled',
  'unchecked',
]);

export const evidenceItem = z.object({
  id: uuid,
  securityId: uuid.nullable(),
  evidenceType,
  provider: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string().nullable(),
  sourceUrl: z.string().url().nullable(),
  publisher: z.string().nullable(),
  /** Hashed or pseudonymous only, and only where the agreement permits storing it at all. */
  authorRef: z.string().nullable(),
  stanceLabel: stanceLabel.nullable(),
  stanceScore: decimalString.nullable(),
  relevanceScore: decimalString.nullable(),
  publishedAt: timestamp.nullable(),
  /** PIT: when the provider made it available, which is what F22's as-of reads bound on. */
  availableAt: timestamp,
  ingestedAt: timestamp,
  lastCheckedAt: timestamp.nullable(),
  availability,
  licenseClass: z.string().min(1),
  coverageClass: z.string().min(1),
  rawHash: z.string().min(1),
  metadata: jsonValue,
});
export type EvidenceItem = z.infer<typeof evidenceItem>;

export const subjectType = z.enum(['security', 'sector_proxy', 'market']);
export const sentimentSourceType = z.enum(['news', 'sampled_social', 'composite']);

export const sentimentSnapshot = z.object({
  subjectType,
  subjectId: z.string().min(1),
  sourceType: sentimentSourceType,
  rawScore: decimalString,
  shrunkScore: decimalString,
  /**
   * R-01, closing F-03. Renamed from `confidence`: it measures whether the sample was large
   * enough to say anything, not how sure a model was. The old name invited reading a
   * small-sample warning as a certainty score.
   */
  sampleAdequacy: decimalString,
  sampleSize: z.number().int().nonnegative(),
  positiveCount: z.number().int().nonnegative(),
  neutralCount: z.number().int().nonnegative(),
  negativeCount: z.number().int().nonnegative(),
  unclearCount: z.number().int().nonnegative(),
  methodVersion: z.string().min(1),
  observedAt: timestamp,
  ingestedAt: timestamp,
  expiresAt: timestamp.nullable(),
});
export type SentimentSnapshot = z.infer<typeof sentimentSnapshot>;
