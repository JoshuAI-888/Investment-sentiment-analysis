/**
 * The evidence pack builder — F10 §4.2/§4.3. Turns a security's already-persisted, already-
 * deduped evidence (`repositories/evidence.ts#evidenceForSecurity` — dedupe and retrieved/used
 * counting are that repository's job, not re-done here) into a bounded, classified, honestly
 * disclosed `EvidencePack`.
 *
 * **Persist-first, by construction.** This module takes evidence items that are already rows —
 * it has no insert path of its own and never calls one. Classification only ever runs on what
 * the collector has already committed durably (mirrors RNI's independent version of the same
 * invariant, `RNI-00-CONTRACT.md`).
 *
 * **Stance is not decided here.** Nothing in this file reads or writes `stanceLabel`/
 * `stanceScore` — that stays F20's, and F06/F09 already read it directly off `evidence_item`
 * (see `services/ticker/inputs.ts`'s own documented gap: there is no live score table to gate on
 * yet). This module's only output about "what a snippet is worth" is `relevanceScore` — aboutness,
 * never sentiment (D-13).
 */
import type { Security } from '@/contracts/security';
import type { EvidenceItem } from '@/contracts/evidence';
import type { SocialAxis } from '@/contracts/primitives';
import { D } from '@/calc/decimal';
import { classifyCollision } from './entity-collision';
import { deterministicMatch } from './matching';
import { llmMethod } from './method-registry';
import { classifyRelevance } from './relevance';
import type { ModelClient } from '../llm/ports';
import type {
  AppliedMethod,
  EvidencePack,
  ExclusionReason,
  ExcludedItem,
  IncludedItem,
} from './types';
import { buildAxisDisclosures } from './disclosure';

/** F10 §4.3: "≤ 30 evidence items, ≤ 12 social snippets per synthesis call (source §14.6)." */
export const MAX_PACK_ITEMS = 30;
export const MAX_SOCIAL_SNIPPETS = 12;

/** Only `social_result`/`news` carry free text worth running the deterministic/LLM pipeline on. */
const CLASSIFIABLE_EVIDENCE_TYPES: ReadonlySet<EvidenceItem['evidenceType']> = new Set([
  'social_result',
  'news',
]);

export function axisOf(item: EvidenceItem): SocialAxis | null {
  if (item.evidenceType !== 'social_result') return null;
  if (item.provider === 'reddit' || item.provider === 'x' || item.provider === 'substack') {
    return item.provider;
  }
  return null;
}

function textOf(item: EvidenceItem): string {
  return item.snippet === null ? item.title : `${item.title}\n${item.snippet}`;
}

function timeOf(item: EvidenceItem): number {
  return (item.publishedAt ?? item.availableAt).getTime();
}

/** The provider already scoped these — SEC EDGAR by CIK, FRED by series. No text to classify. */
function autoInclude(item: EvidenceItem): IncludedItem {
  return {
    kind: 'included',
    item,
    axis: axisOf(item),
    relevanceScore: '1.000000',
    matchedVia: 'none',
    methods: [],
    stableId: item.id,
  };
}

export type ClassifyDeps = {
  readonly client: ModelClient;
  readonly security: Pick<Security, 'symbol' | 'name' | 'aliases'>;
};

async function classifyOne(
  item: EvidenceItem,
  deps: ClassifyDeps,
): Promise<IncludedItem | ExcludedItem> {
  const axis = axisOf(item);

  if (!CLASSIFIABLE_EVIDENCE_TYPES.has(item.evidenceType)) return autoInclude(item);

  const text = textOf(item);
  const det = deterministicMatch(text, deps.security);

  if (!det.matched) {
    return {
      kind: 'excluded',
      item,
      axis,
      reason: 'no_deterministic_match',
      detail: `no cashtag, ticker, company-name or alias match for ${deps.security.symbol} in the item text`,
    };
  }

  const methods: AppliedMethod[] = [];

  if (det.ambiguous && !det.corroborated) {
    const collisionMethod = llmMethod('entity_collision');
    const outcome = await classifyCollision(
      { itemId: item.id, token: deps.security.symbol, symbol: deps.security.symbol, companyName: deps.security.name, text },
      deps.client,
    );
    methods.push({ methodId: collisionMethod.id, methodVersion: collisionMethod.version });
    if (outcome.kind === 'unclear') {
      return { kind: 'excluded', item, axis, reason: 'ticker_collision_unclear', detail: outcome.detail };
    }
    if (!outcome.verdict.confirmed) {
      return {
        kind: 'excluded',
        item,
        axis,
        reason: 'ticker_collision_unconfirmed',
        detail: outcome.verdict.reason,
      };
    }
  }

  const relevanceMethod = llmMethod('relevance');
  const relevance = await classifyRelevance(
    { itemId: item.id, symbol: deps.security.symbol, companyName: deps.security.name, text },
    deps.client,
  );
  methods.push({ methodId: relevanceMethod.id, methodVersion: relevanceMethod.version });

  if (relevance.kind === 'unclear') {
    return { kind: 'excluded', item, axis, reason: 'relevance_unclear', detail: relevance.detail };
  }
  if (!relevance.verdict.relevant) {
    return { kind: 'excluded', item, axis, reason: 'not_relevant', detail: relevance.verdict.reason };
  }

  return {
    kind: 'included',
    item,
    axis,
    relevanceScore: new D(relevance.verdict.relevanceScore).toFixed(6),
    matchedVia: det.matchedVia,
    methods,
    stableId: item.id,
  };
}

/** Descending relevance, then descending recency — F10 §4.3. */
function orderForPack(items: readonly IncludedItem[]): readonly IncludedItem[] {
  return [...items].sort((a, b) => {
    const byRelevance = new D(b.relevanceScore).comparedTo(new D(a.relevanceScore));
    if (byRelevance !== 0) return byRelevance;
    return timeOf(b.item) - timeOf(a.item);
  });
}

/**
 * Applies the ≤30 / ≤12-social bound. Anything cut is moved to `excluded` under
 * `pack_bound_exceeded` — never silently dropped (F10 §4.2's retrieved/used discipline applies
 * to the pack bound exactly as it applies to relevance).
 */
function applyBounds(
  ordered: readonly IncludedItem[],
): { kept: readonly IncludedItem[]; cut: readonly ExcludedItem[] } {
  const kept: IncludedItem[] = [];
  const cut: ExcludedItem[] = [];
  let socialCount = 0;

  for (const candidate of ordered) {
    const isSocial = candidate.axis !== null;
    const wouldExceedTotal = kept.length >= MAX_PACK_ITEMS;
    const wouldExceedSocial = isSocial && socialCount >= MAX_SOCIAL_SNIPPETS;

    if (wouldExceedTotal || wouldExceedSocial) {
      cut.push({
        kind: 'excluded',
        item: candidate.item,
        axis: candidate.axis,
        reason: 'pack_bound_exceeded',
        detail: wouldExceedTotal
          ? `pack already holds the ${String(MAX_PACK_ITEMS)}-item maximum`
          : `pack already holds the ${String(MAX_SOCIAL_SNIPPETS)}-social-snippet maximum`,
      });
      continue;
    }

    kept.push(candidate);
    if (isSocial) socialCount += 1;
  }

  return { kept, cut };
}

function emptyAxisCounts(): Record<SocialAxis, { retrieved: number; used: number; exclusions: { reason: ExclusionReason; count: number }[] }> {
  return {
    reddit: { retrieved: 0, used: 0, exclusions: [] },
    x: { retrieved: 0, used: 0, exclusions: [] },
    substack: { retrieved: 0, used: 0, exclusions: [] },
  };
}

function tallyExclusion(
  bucket: { reason: ExclusionReason; count: number }[],
  reason: ExclusionReason,
): void {
  const existing = bucket.find((entry) => entry.reason === reason);
  if (existing === undefined) {
    bucket.push({ reason, count: 1 });
  } else {
    existing.count += 1;
  }
}

export type BuildPackInput = {
  readonly securityId: string;
  readonly asOf: Date;
  readonly items: readonly EvidenceItem[];
  readonly truncatedByScanWindow: boolean;
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly reddit: { readonly subredditsPolled: readonly string[]; readonly treeComplete: boolean | null };
  readonly x: { readonly watchlistVersion: string | null; readonly triggerEvent: string | null };
};

export async function buildEvidencePack(
  input: BuildPackInput,
  classifyDeps: ClassifyDeps,
): Promise<EvidencePack> {
  const classified = await Promise.all(input.items.map((item) => classifyOne(item, classifyDeps)));

  const includedAll = classified.filter((c): c is IncludedItem => c.kind === 'included');
  const excludedFromClassification = classified.filter((c): c is ExcludedItem => c.kind === 'excluded');

  const ordered = orderForPack(includedAll);
  const { kept, cut } = applyBounds(ordered);
  const excluded = [...excludedFromClassification, ...cut];

  const counts = emptyAxisCounts();
  for (const item of input.items) {
    const axis = axisOf(item);
    if (axis === null) continue;
    counts[axis].retrieved += 1;
  }
  for (const item of kept) {
    if (item.axis !== null) counts[item.axis].used += 1;
  }
  for (const item of excluded) {
    if (item.axis !== null) tallyExclusion(counts[item.axis].exclusions, item.reason);
  }

  const disclosures = buildAxisDisclosures({
    counts,
    windowFrom: input.windowFrom,
    windowTo: input.windowTo,
    reddit: input.reddit,
    x: input.x,
  });

  const pack: EvidencePack = {
    securityId: input.securityId,
    asOf: input.asOf.toISOString(),
    retrievalWindow: { from: input.windowFrom, to: input.windowTo },
    retrievalQuery:
      `security=${input.securityId}` +
      ` window=${input.windowFrom ?? 'unbounded'}..${input.windowTo ?? 'unbounded'}` +
      ` asOf=${input.asOf.toISOString()}`,
    items: kept,
    excluded,
    retrievedCount: input.items.length,
    usedCount: kept.length,
    truncatedByScanWindow: input.truncatedByScanWindow,
    disclosures,
  };

  return pack;
}
