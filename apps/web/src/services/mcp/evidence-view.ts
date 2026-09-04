/**
 * Shared bounding/projection for `list_supporting_evidence`/`list_contradicting_evidence`
 * (F21 §4.2). *"Returns bounded, already-classified items — never a bulk text dump."*
 *
 * **Why this reads `repositories/evidence.ts#evidenceForSecurity` directly rather than calling
 * F10's `services/evidence/pack.ts#buildEvidencePack`.** `buildEvidencePack` re-runs F10's
 * relevance/ticker-collision LLM classification on every call (it takes a `ModelClient` and
 * exists to build the pack a *new* research run or ticker render consumes) — but by the time an
 * `evidence_item` row is queryable at all, F20's scorer service has already written
 * `stanceLabel`/`stanceScore`/`relevanceScore` onto the row (`services/ticker/snapshot.ts#isClassified`
 * is the exact same "already classified" check this module reuses, unmodified). Re-classifying
 * on every MCP evidence read would mean every call to this read-only tool dispatches a live LLM
 * call — the opposite of §3's "F21 reads. It does not compute." Bounding to
 * `MAX_ITEMS` below mirrors F10's own `MAX_PACK_ITEMS`/`MAX_SOCIAL_SNIPPETS` discipline
 * (`services/evidence/pack.ts`) without importing it, since importing it would pull in the
 * `ModelClient` machinery this module deliberately avoids.
 */
import type { EvidenceItem } from '@/contracts/evidence';
import { evidenceForSecurity, type EvidenceItemWithDedupeKey } from '@/repositories/evidence';
import type { Queryable } from '@/repositories/client';

/** Mirrors F10's `MAX_PACK_ITEMS` (`services/evidence/pack.ts`) — the corpus-leak discipline applies here too, not only inside a research run. */
export const MAX_EVIDENCE_ITEMS = 30;

export type BoundedEvidenceItem = {
  readonly id: string;
  readonly sourceKind: string;
  readonly provider: string;
  readonly title: string;
  readonly url: string | null;
  readonly publishedAt: string | null;
  readonly retrievedAt: string;
  readonly snippet: string | null;
  readonly relevance: string | null;
  readonly stanceLabel: string | null;
  readonly stanceScore: string | null;
  readonly availability: string;
  readonly lastCheckedAt: string | null;
};

export type BoundedEvidenceResult = {
  readonly securityId: string;
  readonly items: readonly BoundedEvidenceItem[];
  readonly retrievedCount: number;
  readonly usedCount: number;
  /** True whenever more classified items existed than `MAX_EVIDENCE_ITEMS` admits — never silently dropped. */
  readonly truncated: boolean;
};

function isClassified(item: EvidenceItem): boolean {
  return item.stanceLabel !== null && item.stanceScore !== null && item.relevanceScore !== null;
}

function project(item: EvidenceItemWithDedupeKey): BoundedEvidenceItem {
  return {
    id: item.id,
    sourceKind: item.evidenceType,
    provider: item.provider,
    title: item.title,
    url: item.sourceUrl,
    publishedAt: item.publishedAt === null ? null : item.publishedAt.toISOString(),
    retrievedAt: item.ingestedAt.toISOString(),
    snippet: item.snippet,
    relevance: item.relevanceScore,
    stanceLabel: item.stanceLabel,
    stanceScore: item.stanceScore,
    availability: item.availability,
    lastCheckedAt: item.lastCheckedAt === null ? null : item.lastCheckedAt.toISOString(),
  };
}

export type StanceDirection = 'supporting' | 'contradicting';

/**
 * `direction` selects which side of a stated stance a caller wants — `supporting` keeps items
 * whose `stanceLabel` matches `relativeTo`, `contradicting` keeps the opposite label.
 * `relativeTo` defaults to the sample's own majority label when omitted, so a caller need not
 * already know which way a security leans to ask "what supports the current read" — but never
 * fabricates one when the sample is empty (returns 0 items honestly rather than guessing).
 */
export async function boundedEvidenceFor(
  securityId: string,
  direction: StanceDirection,
  asOfInstant: Date,
  relativeTo: 'bullish' | 'bearish' | null,
  db?: Queryable,
): Promise<BoundedEvidenceResult> {
  const result = await evidenceForSecurity({ securityId, asOfInstant, limit: 200 }, db);
  const classified = result.items.filter(isClassified);

  const majority = relativeTo ?? majorityLabel(classified);

  const filtered =
    majority === null
      ? []
      : classified.filter((item) => {
          if (item.stanceLabel === 'neutral') return false;
          const matches = item.stanceLabel === majority;
          return direction === 'supporting' ? matches : !matches;
        });

  const bounded = filtered.slice(0, MAX_EVIDENCE_ITEMS);

  return {
    securityId,
    items: bounded.map(project),
    retrievedCount: result.scannedCount,
    usedCount: bounded.length,
    truncated: filtered.length > bounded.length,
  };
}

function majorityLabel(items: readonly EvidenceItemWithDedupeKey[]): 'bullish' | 'bearish' | null {
  let bullish = 0;
  let bearish = 0;
  for (const item of items) {
    if (item.stanceLabel === 'bullish') bullish += 1;
    else if (item.stanceLabel === 'bearish') bearish += 1;
  }
  if (bullish === 0 && bearish === 0) return null;
  return bullish >= bearish ? 'bullish' : 'bearish';
}
