/** Research runs, their event stream and the claim ledger. Tables in `0005_`. Wave 3 writes these. */
import { z } from 'zod';
import { decimalString, jsonValue, timestamp, uuid } from './primitives';

/** F-10 adds `degraded` and `verification_failed`; F-20 adds `retracted`. */
export const researchRunStatus = z.enum([
  'queued',
  'running',
  'complete',
  'degraded',
  'verification_failed',
  'retracted',
  'failed',
  'cancelled',
]);

export const researchRun = z
  .object({
    id: uuid,
    userId: z.string().min(1),
    securityId: uuid.nullable(),
    question: z.string().min(1),
    status: researchRunStatus,
    coverageStatus: z.string().min(1),
    inputCutoff: timestamp,
    startedAt: timestamp,
    completedAt: timestamp.nullable(),
    promptVersion: z.string().min(1),
    modelRoute: jsonValue,
    toolManifest: jsonValue,
    costUsd: decimalString,
    result: jsonValue.nullable(),
    error: jsonValue.nullable(),
    retractedReason: z.string().nullable(),
    retractedBy: z.string().nullable(),
    retractedAt: timestamp.nullable(),
  })
  .refine(
    (run) =>
      run.status !== 'retracted' ||
      (run.retractedReason !== null && run.retractedBy !== null && run.retractedAt !== null),
    {
      message:
        'A retracted run must carry its reason, actor and time (R-18). A retraction with no reason is indistinguishable from a bug, and the state exists so a reader can tell those apart.',
      path: ['retractedReason'],
    },
  );
export type ResearchRun = z.infer<typeof researchRun>;

export const researchEvent = z.object({
  runId: uuid,
  sequence: z.number().int().nonnegative(),
  eventType: z.string().min(1),
  label: z.string().min(1),
  payload: jsonValue,
  createdAt: timestamp,
});
export type ResearchEvent = z.infer<typeof researchEvent>;

export const claimType = z.enum(['fact', 'calculation', 'interpretation', 'hypothesis']);
export const materiality = z.enum(['material', 'supporting']);
export const verificationStatus = z.enum([
  'verified',
  'unverified',
  'contradicted',
  'unsupported',
  'withheld',
]);

export const claimLedgerEntry = z
  .object({
    id: uuid,
    runId: uuid,
    claimText: z.string().min(1),
    claimType,
    materiality,
    evidenceIds: z.array(uuid),
    metricIds: z.array(z.string()),
    verificationStatus,
    verifierNotes: z.string().nullable(),
  })
  .refine(
    (claim) =>
      claim.materiality !== 'material' ||
      !['fact', 'calculation'].includes(claim.claimType) ||
      claim.evidenceIds.length > 0 ||
      claim.metricIds.length > 0,
    {
      message:
        'Every material factual claim resolves to an evidence_item or a calculation_id (product invariant §6.3). A material fact supported by neither is the failure this ledger exists to make impossible.',
      path: ['evidenceIds'],
    },
  );
export type ClaimLedgerEntry = z.infer<typeof claimLedgerEntry>;
