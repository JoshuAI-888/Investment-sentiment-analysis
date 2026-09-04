/**
 * The Substack collector — MT-08's still-missing Substack half, F04 §4.3's Substack adapter's
 * own deferred note ("Dedup/entry-shift handling across polls... is the collector's job... and
 * stays deferred to that slice"), and F16a's own dispatch-core report ("Substack not seeded — no
 * collector service exists yet").
 *
 * Structurally this mirrors `services/market/collector.ts` and `services/attention/collector.ts`
 * as closely as the domain allows: for each configured publication (`substack-publications.ts`,
 * MT-15/D-29's disclosed 13-publication set), fetch its feed and persist every entry not already
 * captured. One publication's failure never stops another's — the same per-item isolation
 * discipline the other two collectors already establish, and the same "always finishes the full
 * list, reports honestly per publication" contract.
 *
 * **Dedup is on `guid`, not on content** — this is a deliberate, narrower identity than the other
 * two collectors' snapshot hashing, and it is worth stating plainly rather than leaving it
 * implicit in the hash. `adapters/substack.ts`'s own doc defers "dedup/entry-shift handling across
 * polls" to this module, citing `05-TEST-STRATEGY.md` §2.1's guid-tracking framing directly
 * ("which guids were already seen"). `rawHash` here is therefore built from `(publicationSlug,
 * guid)` alone, **not** from `title`/`contentHtml`/`publishedAt` the way `market.ts`'s
 * `dailyBarRawHash` or `attention/collector.ts`'s `snapshotRawHash` hash their full observed
 * payload. The consequence, stated rather than hidden: a publication silently editing an
 * already-captured post (a typo fix, a retitle) after this collector has already seen its guid is
 * **not** captured as a new observation — the edit is invisible to this corpus. `evidence_item`
 * has no update path (`repositories/evidence.ts`'s own doc: "a genuine revision... is a plain new
 * row" — there is no in-place mutation to fall back to either), so the only two honest options were
 * "capture every edit as if it were a new item" (which would make guid-based dedup meaningless —
 * every re-poll of an unchanged RSS entry would also count as a new observation, since RSS gives
 * no separate "this item was modified" signal to tell an edit apart from a routine re-poll of the
 * same unchanged item) or "identity is the guid, first capture wins." The latter is what F04 §4.3's
 * own deferred note asks for, and it is the only one of the two that actually stops a five-minute-
 * to-daily poll cycle from re-inserting the same still-in-feed item on every run.
 *
 * **Not tied to a security.** Substack's set is chosen for *sector* coverage (D-29), not per-ticker
 * relevance, and nothing in the RSS payload names a ticker `SubstackEntry` could match against a
 * security the way `services/attention/collector.ts#matchBoardEntriesToSecurities` does for
 * ApeWisdom's board. Matching free-text commentary to a specific security is a classification
 * problem — `services/evidence/`, `services/research/` and `services/llm/` territory this feature
 * is explicitly barred from touching, not something to invent ad hoc here. Every item this
 * collector writes therefore carries `securityId: null`, the same "macro item, no single subject"
 * shape `repositories/evidence.ts`'s own doc already documents for FRED-style facts — `sector` and
 * `publicationSlug` are recorded in `metadata` instead, for whoever builds the real per-security
 * matching pass later.
 */
import { canonicalHash } from '@/calc/canonical';
import { env } from '@/env';
import { fetchSubstackFeed, type SubstackEntry } from '@/adapters/substack';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderError } from '@/contracts/provider';
import type { EvidenceItem } from '@/contracts/evidence';
import { getPool, type Queryable } from '@/repositories/client';
import { insertEvidenceItem, type NewEvidenceItem } from '@/repositories/evidence';
import { SUBSTACK_PUBLICATIONS, type SubstackPublication } from './substack-publications';
import { substackCollectorWrapperDeps } from './provider-deps';

/** The value persisted to `evidence_item.provider` for every row this collector writes. */
export const SUBSTACK_EVIDENCE_PROVIDER = 'substack';

/**
 * D-17: Substack is one of the two "full bodies, own-collected" sources (Reddit's the other, and
 * it is discarded per D-39). "Own-collected" is the right label here — nothing about a public RSS
 * feed is a paid vendor's licensed resale; this deployment reads it directly, the same relationship
 * `own_collected` already describes for a first-party API integration elsewhere in this codebase.
 */
export const SUBSTACK_LICENSE_CLASS = 'own_collected';

/**
 * `coverageClass`'s enum (`contracts/security.ts`) is `pov_index | licensed_sample |
 * licensed_full`. This is not an index/rank (`pov_index`) and it is not a bounded sample of a
 * larger licensed corpus (`licensed_sample`, the shape X's snippet-only retention needs) — every
 * entry a configured feed returns is captured in full, per D-17's "full bodies... indefinitely."
 * `licensed_full` is the only one of the three that does not misdescribe what is actually stored.
 */
export const SUBSTACK_COVERAGE_CLASS = 'licensed_full';

/**
 * The identity this collector dedupes on — see the module doc's "Dedup is on `guid`" section.
 * `publicationSlug` is included alongside `guid` (not because Substack's own guids are expected to
 * collide across two different publications, but because `evidence_item`'s idempotency check,
 * `repositories/evidence.ts`'s own doc explains, is scoped by `(security_id, provider, raw_hash)`
 * — every row this collector writes shares the same `security_id: null` and `provider: 'substack'`,
 * so `raw_hash` alone is this identity's entire remaining discriminator, and a coincidental
 * guid collision across two unrelated feeds must not silently merge two different publications'
 * items into one dedup bucket).
 */
function substackIdentityHash(pub: SubstackPublication, entry: SubstackEntry): string {
  return canonicalHash({ publicationSlug: pub.subdomain, guid: entry.guid });
}

export type SubstackEvidenceInputResult =
  | { readonly ok: true; readonly input: NewEvidenceItem }
  | { readonly ok: false; readonly reason: string };

/**
 * Builds one `evidence_item` insert from one feed entry. `parseSubstackFeed` already guarantees
 * `title`/`link`/`guid`/a parseable `publishedAt` for anything it returns (a bad `<item>` is
 * dropped at the adapter layer, per that module's own doc) — the checks below are this collector's
 * own defensive belt, not a re-litigation of the adapter's contract, since trusting an upstream
 * invariant without a fallback here is exactly the "ugliest input" discipline `04-BUILD-LOOP.md`
 * §5 asks every collector to have already priced in for itself.
 */
export function buildSubstackEvidenceInput(
  pub: SubstackPublication,
  entry: SubstackEntry,
  checkedAt: Date,
): SubstackEvidenceInputResult {
  if (entry.guid.trim() === '') {
    return { ok: false, reason: 'guid is empty' };
  }
  if (entry.title.trim() === '') {
    return { ok: false, reason: 'title is empty' };
  }

  const publishedAtMs = Date.parse(entry.publishedAt);
  if (!Number.isFinite(publishedAtMs)) {
    return { ok: false, reason: `publishedAt is not a parseable date: ${JSON.stringify(entry.publishedAt)}` };
  }

  let sourceUrl: string;
  try {
    sourceUrl = new URL(entry.link).toString();
  } catch {
    return { ok: false, reason: `link is not a valid URL: ${JSON.stringify(entry.link)}` };
  }

  const publishedAt = new Date(publishedAtMs);

  return {
    ok: true,
    input: {
      // Sector-level expert commentary, not tied to one ticker — see the module doc.
      securityId: null,
      evidenceType: 'news',
      provider: SUBSTACK_EVIDENCE_PROVIDER,
      title: entry.title,
      // D-17: the real `content:encoded` HTML, retained in full — never truncated, never
      // re-summarized. `contentHtml` already falls back to `description` at the adapter layer
      // when a publication omits `content:encoded` (`adapters/substack.ts`'s own doc).
      snippet: entry.contentHtml,
      sourceUrl,
      publisher: pub.publication,
      // Substack's RSS `<item>` carries no per-post byline this adapter surfaces
      // (`SubstackEntry` has no author field) — `publisher` already names the publication.
      authorRef: null,
      // Scoring happens downstream (F20); collection does not guess a stance.
      stanceLabel: null,
      stanceScore: null,
      relevanceScore: null,
      publishedAt,
      // `available_at` is "when the provider made it available" (`repositories/evidence.ts`'s own
      // doc) — the RSS `pubDate` is exactly that, the publication's own disclosed availability.
      availableAt: publishedAt,
      lastCheckedAt: checkedAt,
      availability: 'available',
      licenseClass: SUBSTACK_LICENSE_CLASS,
      coverageClass: SUBSTACK_COVERAGE_CLASS,
      rawHash: substackIdentityHash(pub, entry),
      metadata: { sector: pub.sector, publicationSlug: pub.subdomain, guid: entry.guid },
    },
  };
}

export type CollectedSubstackItemResult = {
  readonly publicationSlug: string;
  readonly sector: string;
  readonly item: EvidenceItem;
  /** `false` when this exact `(publication, guid)` identity was already captured on a prior poll. */
  readonly inserted: boolean;
};

export type FailedSubstackPublicationResult = {
  readonly publicationSlug: string;
  readonly sector: string;
  readonly reason: 'provider_error' | 'no_entries_returned' | 'unexpected_error';
  /** Present only for `reason: 'provider_error'`. */
  readonly error?: ProviderError;
  readonly message: string;
};

export type SkippedSubstackEntryResult = {
  readonly publicationSlug: string;
  readonly guid: string;
  readonly reason: string;
};

export type CollectSubstackItemsOptions = {
  readonly db?: Queryable;
  /** Injectable so a repeated test run is not at the mercy of the real clock. Stamps
   *  `lastCheckedAt` on every write and this outcome's own `collectedAt`; it never overrides an
   *  entry's own `publishedAt`/`availableAt`, which always come from the feed's own `pubDate`. */
  readonly now?: Date;
  readonly providerMode?: 'fixture' | 'live';
  readonly fixturesRoot?: string;
  readonly publications?: readonly SubstackPublication[];
  /** Applied to every publication's call, unless overridden per-publication below. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Per-publication override of `headers`, keyed by `subdomain`. Exists for the identical reason
   * `services/market/collector.ts`'s `headersBySymbol` does: every publication shares the same
   * wrapper endpoint tag (`provider: 'substack', operation: 'feed'`), so a fixture-mode
   * `x-fixture-case` header applies identically to every publication this run touches unless
   * overridden per-publication — without this, a test cannot construct a genuine partial-failure
   * run (one publication's feed call failing while another succeeds).
   */
  readonly headersByPublication?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly deps?: Omit<WrapperDeps, 'fetcher'>;
};

export type CollectSubstackItemsOutcome = {
  readonly collectedAt: string;
  readonly results: readonly CollectedSubstackItemResult[];
  readonly failures: readonly FailedSubstackPublicationResult[];
  /** An entry the feed returned that this collector could not honestly build an item from — see
   *  `buildSubstackEvidenceInput`. Dropped, never fabricated, the same discipline
   *  `services/attention/collector.ts`'s `malformedEntries` already establishes for its provider. */
  readonly skippedEntries: readonly SkippedSubstackEntryResult[];
};

/**
 * One collector run: for every configured publication, fetch its feed and persist every entry not
 * already captured (dedup on `(publicationSlug, guid)` — see the module doc). A given publication's
 * provider failure, empty response, or unexpected error produces no new items **for that
 * publication only** — it neither stops the loop nor touches any other publication's result, and
 * it never fabricates a value in that publication's place (`docs/04-BUILD-LOOP.md` §2.3's "the
 * ugliest input" discipline, applied per-publication the same way `services/market/collector.ts`
 * applies it per-security).
 */
export async function collectSubstackItems(
  options: CollectSubstackItemsOptions = {},
): Promise<CollectSubstackItemsOutcome> {
  const db = options.db ?? getPool();
  const providerMode = options.providerMode ?? env.PROVIDER_MODE;
  const deps = options.deps ?? substackCollectorWrapperDeps({ db });
  const now = options.now ?? new Date();
  const publications = options.publications ?? SUBSTACK_PUBLICATIONS;

  const results: CollectedSubstackItemResult[] = [];
  const failures: FailedSubstackPublicationResult[] = [];
  const skippedEntries: SkippedSubstackEntryResult[] = [];

  for (const pub of publications) {
    // Mirrors `services/market/collector.ts`'s own per-security `try`/`catch`: every step below
    // already returns an honest per-publication failure rather than throwing, but this makes the
    // module's own "always finishes the full publication list" claim a structural guarantee
    // rather than one that happens to hold only while every step inside it happens not to throw.
    try {
      const headersForPub = options.headersByPublication?.[pub.subdomain] ?? options.headers;
      const feed = await fetchSubstackFeed(
        {
          publicationSlug: pub.subdomain,
          ...(headersForPub === undefined ? {} : { headers: headersForPub }),
        },
        providerMode,
        {
          ...deps,
          ...(options.fixturesRoot === undefined ? {} : { fixturesRoot: options.fixturesRoot }),
        },
      );

      if (!feed.ok) {
        failures.push({
          publicationSlug: pub.subdomain,
          sector: pub.sector,
          reason: 'provider_error',
          error: feed.error,
          message:
            `${pub.publication}'s feed could not be read (${feed.error.kind}). No new evidence ` +
            'items were persisted for this publication this run; every other publication in this ' +
            'run is unaffected.',
        });
        continue;
      }

      if (feed.data.length === 0) {
        failures.push({
          publicationSlug: pub.subdomain,
          sector: pub.sector,
          reason: 'no_entries_returned',
          message:
            `${pub.publication}'s feed call succeeded but returned no entries. No new evidence ` +
            'items were persisted for this publication this run.',
        });
        continue;
      }

      for (const entry of feed.data) {
        const built = buildSubstackEvidenceInput(pub, entry, now);
        if (!built.ok) {
          skippedEntries.push({ publicationSlug: pub.subdomain, guid: entry.guid, reason: built.reason });
          continue;
        }
        const write = await insertEvidenceItem(built.input, db);
        results.push({
          publicationSlug: pub.subdomain,
          sector: pub.sector,
          item: write.item,
          inserted: write.inserted,
        });
      }
    } catch (error) {
      failures.push({
        publicationSlug: pub.subdomain,
        sector: pub.sector,
        reason: 'unexpected_error',
        message:
          `${pub.publication}'s poll raised an unexpected error: ` +
          `${error instanceof Error ? error.message : String(error)}. No new evidence items were ` +
          'persisted for this publication this run; every other publication in this run is still processed.',
      });
    }
  }

  return { collectedAt: now.toISOString(), results, failures, skippedEntries };
}
