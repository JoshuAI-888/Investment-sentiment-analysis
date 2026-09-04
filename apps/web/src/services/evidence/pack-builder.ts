/**
 * The evidence-pack builder — F10 §4.3. Turns a security's stored evidence corpus into an
 * `EvidencePack`: deduped **within** each axis (never across — see `flattenAxisBundles`),
 * classified for relevance and ticker-collision, bounded to ≤ 30 items, with a per-axis frame
 * disclosure (§4.5).
 *
 * **Nothing here is persisted.** `MEMORY.md` D-42: "a pack is a query-time construct
 * (`EvidencePack` is zod-only), not a new table." A caller that wants a stable pack across two
 * requests re-runs this function against the same `asOfInstant` — F22's as-of discipline is what
 * makes that reproducible, not a cache this feature owns.
 *
 * **Stance is never computed here.** Every `ClassifiedItem.item.stanceLabel`/`stanceScore` is
 * read straight off the stored `evidence_item` row (F20's pinned scorer wrote it, asynchronously,
 * on its own schedule, or has not scored it yet — both are legitimate states this function passes
 * through unchanged, never substituting a value for either, per D-13).
 */
import { randomUUID } from 'node:crypto';
import type { EvidenceItem } from '@/contracts/evidence';
import type { ClassifiedItem, ClassificationFlag, EvidencePack } from '@/contracts/evidence-pack';
import { evidencePack } from '@/contracts/evidence-pack';
import type { SocialAxis } from '@/contracts/primitives';
import type { EvidenceItemWithDedupeKey } from '@/repositories/evidence';
import type { Queryable } from '@/repositories/client';
import { detectMention, type SecurityIdentity } from './candidates';
import { fetchAxisBundles, buildFrameDisclosure, type AxisBundle, type SubstackBasis } from './frames';
import { runRelevanceFilter, type RelevanceCandidate } from './relevance-filter';
import { runCollisionGuard, type CollisionCandidate } from './collision-guard';
import type { BudgetGate, ModelBackend, ModelCallAttemptRecord } from './model-client';
import {
  COLLISION_GUARD_VERSION_TAG,
  DETERMINISTIC_CANDIDACY_VERSION_TAG,
  RELEVANCE_FILTER_VERSION_TAG,
} from './method-registry';

/** F10 §4.3: "Bounded: ≤ 30 evidence items ... ordered by relevance then recency." */
export const MAX_PACK_ITEMS = 30;

/**
 * A rough, char-count stand-in for FinBERT/RoBERTa's 512-token window (F10 §4.4's `truncated`
 * trigger) — this feature does not call the scorer and has no authoritative token count to read.
 * ~4 characters/token is a conservative English-text estimate; 2048 chars ≈ 512 tokens. Flagged
 * under this lane's `RISKS`: once F20 exposes its own `truncated` bit per score, this heuristic
 * should be replaced by that authoritative value rather than estimated twice.
 */
const TRUNCATION_CHAR_ESTIMATE = 2048;

/** Prompt text is bounded regardless of what is actually stored, purely to cap call size/cost. */
const PROMPT_TEXT_MAX_CHARS = 2000;

type ProcessedItem = {
  readonly item: EvidenceItem;
  readonly axis: SocialAxis;
  readonly availableAt: Date;
  relevant: boolean;
  /**
   * Which registered method (`method-registry.ts`) produced (or attempted to produce) this
   * item's `relevant` verdict — stamped the moment a method is *dispatched* for this item, not
   * only on a successful admit, so a rejection (schema-invalid, backend outage, budget denial)
   * still correctly attributes the method that was actually attempted (lane-review finding 5).
   * Starts at the deterministic sentinel and is overwritten if an LLM method is ever dispatched.
   */
  relevanceMethodVersion: string;
  flags: ClassificationFlag[];
  excludedReason: string | null;
};

function itemText(item: EvidenceItem): string {
  return `${item.title} ${item.snippet ?? ''}`.trim();
}

function boundedText(text: string): string {
  return text.length > PROMPT_TEXT_MAX_CHARS ? `${text.slice(0, PROMPT_TEXT_MAX_CHARS)}…` : text;
}

function stripDedupeKey(item: EvidenceItemWithDedupeKey): EvidenceItem {
  const { dedupeKey: _dedupeKey, ...rest } = item;
  return rest;
}

export type BuildEvidencePackDeps = {
  readonly db: Queryable;
  readonly modelBackend: ModelBackend;
  readonly model: string;
  /**
   * Required, not optional (lane-review finding 4): a caller that forgets to wire the real
   * check (`services/dashboard/budget.ts`'s `checkGlobalBudget`) must fail to compile rather
   * than silently get an unbudgeted LLM path. Checked before **every** dispatch this pipeline
   * makes, including a repair retry — see `model-client.ts`'s `classifyBatch`.
   */
  readonly checkBudget: () => Promise<BudgetGate>;
  /** Defaults to a no-op — production callers wire `services/evidence/cost-recording.ts`. */
  readonly onModelCallRecord?: (record: ModelCallAttemptRecord, methodTitle: string) => void | Promise<void>;
  readonly substackBasis?: () => Promise<SubstackBasis>;
  readonly scanLimit?: number;
  readonly now?: () => Date;
};

export type BuildEvidencePackInput = {
  readonly securityId: string;
  readonly asOfInstant: Date;
  readonly window: { readonly from: Date; readonly to: Date };
  readonly retrievalQuery: string;
  readonly security: SecurityIdentity;
};

/**
 * Flattens every axis's already-deduped items, tagged with their axis — and does **no further
 * dedup of its own**. F10 §4.2 / D-14, verbatim: "a Reddit comment quoting an article is *not*
 * the article — it is a separate observation in a different frame, and collapsing the two would
 * silently merge two sampling frames into one." An earlier version of this function deduped
 * *across* axes by `dedupeKey`, which did exactly that: a Substack original and its Reddit
 * crosspost share a url/title and are genuinely two different sampling-frame observations, not
 * one item (lane-review finding 1). Dedup within one axis's own query is `evidenceForSecurity`'s
 * job and already happened before this function ever sees the rows.
 */
function flattenAxisBundles(
  bundles: readonly AxisBundle[],
): readonly (EvidenceItemWithDedupeKey & { readonly axis: SocialAxis })[] {
  return bundles.flatMap((bundle) => bundle.items.map((item) => ({ ...item, axis: bundle.axis })));
}

export async function buildEvidencePack(
  input: BuildEvidencePackInput,
  deps: BuildEvidencePackDeps,
): Promise<EvidencePack> {
  const now = deps.now ?? (() => new Date());
  const onModelCallRecord = deps.onModelCallRecord ?? (() => undefined);

  const bundles = await fetchAxisBundles(
    {
      securityId: input.securityId,
      asOfInstant: input.asOfInstant,
      ...(deps.scanLimit === undefined ? {} : { scanLimit: deps.scanLimit }),
    },
    deps.db,
  );

  const flattened = flattenAxisBundles(bundles);

  const processed = new Map<string, ProcessedItem>();
  const collisionCandidates: CollisionCandidate[] = [];
  const relevanceCandidates: RelevanceCandidate[] = [];

  for (const item of flattened) {
    const base: ProcessedItem = {
      item: stripDedupeKey(item),
      axis: item.axis,
      availableAt: item.availableAt,
      relevant: false,
      relevanceMethodVersion: DETERMINISTIC_CANDIDACY_VERSION_TAG,
      flags: [],
      excludedReason: null,
    };

    const mention = detectMention(itemText(base.item), input.security);

    if (mention.kind === 'none') {
      processed.set(item.id, { ...base, excludedReason: 'no mention of the security detected in title or snippet' });
      continue;
    }

    if (mention.kind === 'ambiguous' && !mention.corroborated) {
      processed.set(item.id, {
        ...base,
        flags: ['ticker_collision'],
        excludedReason: `ambiguous token "${mention.token}" with no corroborating company name or cashtag`,
      });
      continue;
    }

    if (mention.kind === 'ambiguous' && mention.corroborated) {
      // Stamped now, at dispatch, not only on success — this item WILL be sent to
      // entity.collision_guard, regardless of what that call eventually returns.
      processed.set(item.id, { ...base, relevanceMethodVersion: COLLISION_GUARD_VERSION_TAG });
      collisionCandidates.push({
        itemId: item.id,
        text: boundedText(itemText(base.item)),
        token: mention.token,
      });
      continue;
    }

    // cashtag / symbol / company_name — a confirmed candidate, straight to relevance.filter.
    // Stamped now, at dispatch, for the same reason as above.
    processed.set(item.id, { ...base, relevanceMethodVersion: RELEVANCE_FILTER_VERSION_TAG });
    relevanceCandidates.push({ itemId: item.id, text: boundedText(itemText(base.item)), axis: item.axis });
  }

  // ── entity.collision_guard ───────────────────────────────────────────────────────────────────
  if (collisionCandidates.length > 0) {
    const outcome = await runCollisionGuard(
      collisionCandidates,
      { symbol: input.security.symbol, companyName: input.security.companyName },
      { backend: deps.modelBackend, model: deps.model, checkBudget: deps.checkBudget },
    );
    for (const record of outcome.records) await onModelCallRecord(record, 'Ticker-collision guard');

    for (const candidate of collisionCandidates) {
      const entry = processed.get(candidate.itemId);
      if (entry === undefined) continue;
      const admitted = outcome.admitted.get(candidate.itemId);
      if (admitted === undefined) {
        const reason = outcome.rejected.get(candidate.itemId) ?? 'no collision-guard verdict';
        entry.flags.push('ticker_collision');
        entry.excludedReason = `ticker-collision guard could not confirm this item: ${reason}`;
        continue;
      }
      if (!admitted.aboutSecurity) {
        entry.flags.push('ticker_collision');
        entry.excludedReason = `ticker-collision guard: ${admitted.rationale}`;
        continue;
      }
      // Confirmed — proceeds to relevance.filter like any other candidate. Re-stamped: the
      // method actually deciding this item's final `relevant` value is about to change.
      entry.relevanceMethodVersion = RELEVANCE_FILTER_VERSION_TAG;
      relevanceCandidates.push({
        itemId: candidate.itemId,
        text: candidate.text,
        axis: entry.axis,
      });
    }
  }

  // ── relevance.filter ─────────────────────────────────────────────────────────────────────────
  if (relevanceCandidates.length > 0) {
    const outcome = await runRelevanceFilter(
      relevanceCandidates,
      { symbol: input.security.symbol, companyName: input.security.companyName },
      { backend: deps.modelBackend, model: deps.model, checkBudget: deps.checkBudget },
    );
    for (const record of outcome.records) await onModelCallRecord(record, 'Relevance filter');

    for (const candidate of relevanceCandidates) {
      const entry = processed.get(candidate.itemId);
      if (entry === undefined) continue;
      const admitted = outcome.admitted.get(candidate.itemId);
      if (admitted === undefined) {
        const reason = outcome.rejected.get(candidate.itemId) ?? 'no relevance verdict';
        entry.excludedReason = `relevance filter could not confirm this item: ${reason}`;
        continue;
      }
      if (!admitted.relevant) {
        entry.excludedReason = `relevance filter: ${admitted.rationale}`;
        if (admitted.flag !== null && admitted.flag !== undefined) entry.flags.push(admitted.flag);
        continue;
      }
      entry.relevant = true;
    }
  }

  // ── truncation heuristic (F10 §4.4's `truncated`, estimated — see the module docstring) ──────
  for (const entry of processed.values()) {
    if (entry.axis === 'x') continue;
    const text = itemText(entry.item);
    if (text.length > TRUNCATION_CHAR_ESTIMATE) entry.flags.push('truncated');
  }

  // ── select, then order, then assemble ───────────────────────────────────────────────────────
  const entries = [...processed.entries()].map(([id, entry]) => ({ id, entry }));

  /**
   * Selection (which ≤30 items survive) is deliberately **not** the same criterion as display
   * order. Selecting relevant-first would let an unbounded excess of relevant items completely
   * erase a more recent, genuinely-excluded item's reason purely because of unrelated volume
   * elsewhere — the exact "6 items vanish with zero trace" failure lane-review finding 2
   * reproduced. Selecting the most recent `MAX_PACK_ITEMS` overall, regardless of relevance
   * status, means an excluded item that is more recent than some relevant ones legitimately
   * keeps its slot (and its reason) rather than being unconditionally starved by relevant volume.
   */
  const selected = new Set(
    [...entries]
      .sort((a, b) => b.entry.availableAt.getTime() - a.entry.availableAt.getTime())
      .slice(0, MAX_PACK_ITEMS)
      .map((e) => e.id),
  );

  /** Display order, applied only within the selected set — F10 §4.3: "ordered by relevance then recency." */
  const ranked = entries
    .filter((e) => selected.has(e.id))
    .sort((a, b) => {
      if (a.entry.relevant !== b.entry.relevant) return a.entry.relevant ? -1 : 1;
      return b.entry.availableAt.getTime() - a.entry.availableAt.getTime();
    });

  const items: ClassifiedItem[] = ranked.map(({ entry }) => ({
    item: entry.item,
    axis: entry.axis,
    relevant: entry.relevant,
    relevanceMethodVersion: entry.relevanceMethodVersion,
    stanceConfidence: entry.item.stanceScore,
    flags: entry.flags,
    excludedReason: entry.excludedReason,
  }));

  const usedCountByAxis: Record<SocialAxis, number> = { reddit: 0, x: 0, substack: 0 };
  for (const { entry } of ranked) {
    if (entry.relevant) usedCountByAxis[entry.axis] += 1;
  }

  const substackBasis = deps.substackBasis === undefined ? undefined : await deps.substackBasis();

  const frames = bundles.map((bundle) =>
    buildFrameDisclosure(bundle, usedCountByAxis[bundle.axis], input.window, {
      ...(bundle.axis === 'substack' && substackBasis !== undefined ? { substack: substackBasis } : {}),
    }),
  );

  return evidencePack.parse({
    id: randomUUID(),
    securityId: input.securityId,
    retrievalQuery: input.retrievalQuery,
    retrievalWindow: input.window,
    items,
    frames,
    createdAt: now(),
  });
}
