/**
 * The "fetch"/"gathering" stage (F11 §4.2: Fan-out 8 s, Classification 6 s). Calls into F10's
 * already-built evidence pipeline — `repositories/evidence.ts#evidenceForSecurity` for the raw,
 * deduped rows, then `services/evidence/pack.ts#buildEvidencePack` for classification (relevance
 * filtering, ticker-collision disambiguation) and bounding — rather than reimplementing evidence
 * assembly, per this feature's build brief.
 *
 * **A known, disclosed limitation this module cannot close without editing `services/evidence/`
 * (out of bounds).** `buildEvidencePack` classifies every candidate item inside one internal
 * `Promise.all` with no way to observe partial progress or cancel the remainder — F11 §4.2's
 * "Classification | 6 s | proceed with classified subset; record `n` actually classified" asks
 * for a partial result on overrun, but the only overrun behaviour actually achievable against a
 * black-box, non-cancellable batch call is "the whole call didn't finish in time", not "N of M
 * finished". `gatherEvidence` below races the whole `buildEvidencePack` call against the
 * classification budget: on overrun it reports zero classified items and an explicit
 * `classificationTimedOut: true` flag, rather than fabricating a partial count it cannot actually
 * observe. Reported as a contract request: a genuinely partial classification-timeout path needs
 * either a cancellable/streaming `buildEvidencePack` (F10-owned) or an explicit exception letting
 * F11 reimplement a bounded driver over F10's per-item primitives.
 */
import { evidenceForSecurity } from '@/repositories/evidence';
import type { Queryable } from '@/repositories/client';
import { buildEvidencePack, type ClassifyDeps, type EvidencePack } from '@/services/evidence';
import type { ModelClient } from '@/services/llm/ports';
import type { Security } from '@/contracts/security';

export type GatherEvidenceInput = {
  readonly securityId: string;
  readonly asOf: Date;
  readonly security: Pick<Security, 'symbol' | 'name' | 'aliases'>;
  readonly modelClient: ModelClient;
  readonly db?: Queryable;
  /** F11 §4.2's 6 s classification budget — a parameter so tests can exercise the overrun path fast. */
  readonly classificationBudgetMs: number;
};

export type GatherEvidenceResult =
  | { readonly kind: 'ok'; readonly pack: EvidencePack; readonly retrievedCount: number }
  | { readonly kind: 'classification_timed_out'; readonly retrievedCount: number };

function timeoutAfter(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms);
  });
}

export async function gatherEvidence(input: GatherEvidenceInput): Promise<GatherEvidenceResult> {
  const evidenceResult = await evidenceForSecurity(
    { securityId: input.securityId, asOfInstant: input.asOf },
    input.db,
  );

  const classifyDeps: ClassifyDeps = { client: input.modelClient, security: input.security };
  const buildInput = {
    securityId: input.securityId,
    asOf: input.asOf,
    items: evidenceResult.items,
    truncatedByScanWindow: evidenceResult.truncated,
    windowFrom: null,
    windowTo: input.asOf.toISOString(),
    // Reddit is not collected for the legacy product (D-39) — `services/evidence/disclosure.ts`
    // reads `REDDIT_COLLECTED` itself and zeroes these regardless of what is passed here.
    reddit: { subredditsPolled: [], treeComplete: null },
    // No X-collection metadata is available to this read path (F04's X adapter is a separate
    // collector, not something this fetch stage triggers) — disclosed as `null`, never guessed.
    x: { watchlistVersion: null, triggerEvent: null },
  };

  const packOrTimeout = await Promise.race([
    buildEvidencePack(buildInput, classifyDeps).then((pack) => ({ kind: 'ok' as const, pack })),
    timeoutAfter(input.classificationBudgetMs),
  ]);

  if (packOrTimeout === 'timeout') {
    return { kind: 'classification_timed_out', retrievedCount: evidenceResult.scannedCount };
  }
  return { kind: 'ok', pack: packOrTimeout.pack, retrievedCount: evidenceResult.scannedCount };
}
