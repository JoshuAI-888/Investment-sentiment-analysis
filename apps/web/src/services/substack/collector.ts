/**
 * The Substack collector — F04 §4.3's Substack axis, and the first channel that can actually
 * collect.
 *
 * Substack RSS needs no key and no approval (`docs/provider-rights.md` §Substack RSS), which is
 * why this is the axis that starts D-16's forward-only clock: Reddit waits on `DEPLOY.md` MT-13
 * and X only opens on a market-data trigger. Every hour this does not run is corpus that cannot
 * be reconstructed.
 *
 * ## The shape of one run
 *
 * 1. Load the confirmed publication set (MT-15 / D-40) and the active security master.
 * 2. Poll each publication's feed. **One publication's failure never fails the run** — thirteen
 *    independent feeds, and a single 500 must not cost the other twelve their poll.
 * 3. Attribute each entry to securities with F10's no-LLM `detectMention` pass (`attribute.ts`).
 * 4. Write `evidence_item` rows, then enqueue the attributed ones for scoring — in that order,
 *    which is `ingestAndEnqueue`'s guarantee and the reason it is used rather than two calls.
 * 5. Record one `collector_heartbeat` for the axis.
 *
 * ## Why the heartbeat is written on an empty run but not on a dead one
 *
 * `repositories/coverage.ts`: *"a gap is the absence of the heartbeat, not the absence of
 * data"*. A weekly publication that published nothing today is a real, quiet window — heartbeat
 * written, `itemsSeen: 0`, no gap. But if **every** publication failed, the axis genuinely went
 * dark and this run saw nothing it can vouch for, so no heartbeat is written and F22's gap
 * detection finds the hole on its own. A partial failure is the interesting middle case: the
 * heartbeat *is* written (the collector ran, and the items it did see are real), and the failed
 * publications are returned in the outcome for the caller to log. Writing a `coverage_gap` for
 * the whole axis because one feed of thirteen 500'd would overstate the outage; suppressing the
 * heartbeat would manufacture one.
 */
import { env } from '@/env';
import { fetchSubstackFeed, type SubstackEntry } from '@/adapters/substack';
import { getSubstackPublications, type SubstackPublication } from '@/adapters/substack-publications';
import type { WrapperDeps } from '@/adapters/wrapper';
import type { ProviderError } from '@/contracts/provider';
import { canonicalHash } from '@/calc/canonical';
import { getPool, type Queryable } from '@/repositories/client';
import { listActiveSecurities } from '@/repositories/security';
import { insertEvidenceItem, type NewEvidenceItem } from '@/repositories/evidence';
import { recordHeartbeat } from '@/repositories/coverage';
import { enqueueForScoring, type CollectedItem } from '@/services/jobs/scoring-queue';
import type { ScoringQueuePort } from '@/services/jobs/ports';
import { substackWrapperDeps } from './provider-deps';
import { htmlToText } from './html';
import { attributeText, type AttributionResult } from './attribute';

/**
 * Bumped whenever the extraction, attribution or hashing rules below change in a way that would
 * make two rows collected under different versions non-comparable. Recorded on every row's
 * `metadata` so a later re-derivation can tell which rule set produced it.
 */
export const SUBSTACK_METHOD_VERSION = 'substack-collector-2026-09';

/** Public RSS we fetch ourselves — not licensed redistribution, not a provider's index. */
export const SUBSTACK_LICENSE_CLASS = 'own_collected';

/**
 * The frame this axis can honestly claim: a curated set of publications chosen for sector
 * coverage (D-29), never "Substack". `contracts/evidence-pack.ts` states the same frame to the
 * reader — *"curated publication set, selected on the basis recorded in config version {v}"* —
 * and these two strings must not drift apart.
 */
export const SUBSTACK_COVERAGE_CLASS = 'curated_publication_set';

/**
 * The feed poll, as a port.
 *
 * Injectable for one reason the fixture harness cannot serve: `adapters/fixtures.ts` keys a
 * recorded response by `provider/endpoint/case`, **not** by publication slug, so every
 * publication in one run reads the same file. That makes the partial-failure path — some feeds
 * poll, others fail, which decides whether a heartbeat is written at all — untestable through
 * fixtures alone. Production always takes the default.
 */
export type SubstackFeedFetcher = typeof fetchSubstackFeed;

export type SubstackCollectorOptions = {
  readonly db?: Queryable;
  readonly queue: ScoringQueuePort;
  /** Injectable so a repeated test run is not at the mercy of the real clock. */
  readonly now?: Date;
  readonly providerMode?: 'fixture' | 'live';
  readonly fixturesRoot?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly deps?: Omit<WrapperDeps, 'fetcher'>;
  /** Defaults to the committed MT-15 set. Overridden only by tests. */
  readonly publications?: readonly SubstackPublication[];
  /** Defaults to `fetchSubstackFeed`. See `SubstackFeedFetcher`. */
  readonly fetchFeed?: SubstackFeedFetcher;
};

export type FailedPublication = {
  readonly slug: string;
  readonly error: ProviderError;
};

export type CollectedEvidenceRow = {
  readonly evidenceItemId: string;
  readonly securityId: string | null;
  readonly publicationSlug: string;
  readonly guid: string;
  /** `false` when this exact (security, provider, hash) row already existed — a re-poll no-op. */
  readonly inserted: boolean;
};

export type SubstackCollectionOutcome =
  | {
      readonly ok: true;
      readonly observedAt: string;
      readonly rows: readonly CollectedEvidenceRow[];
      readonly entriesSeen: number;
      readonly enqueuedCount: number;
      readonly failedPublications: readonly FailedPublication[];
      readonly heartbeatWritten: true;
    }
  | {
      readonly ok: false;
      readonly observedAt: string;
      readonly failedPublications: readonly FailedPublication[];
      readonly message: string;
      /** Never written on a total outage — the missing heartbeat *is* the gap signal. */
      readonly heartbeatWritten: false;
    };

/**
 * PIT: `available_at` is when the item could first have been seen. `publishedAt` is the honest
 * answer — an RSS item is public the moment the publication emits it — but a feed carrying a
 * `pubDate` in the future (ordinary publisher clock skew, and scheduled posts make it routine on
 * Substack specifically) would otherwise write an `available_at` this collector could not
 * possibly have observed. Clamping to the observation instant keeps the column's meaning intact
 * without discarding an entry over a clock disagreement.
 */
export function availableAtFor(entry: SubstackEntry, observedAt: Date): Date {
  const published = new Date(entry.publishedAt);
  if (Number.isNaN(published.getTime())) return observedAt;
  return published.getTime() > observedAt.getTime() ? observedAt : published;
}

export function rowsForEntry(
  entry: SubstackEntry,
  publication: SubstackPublication,
  attribution: AttributionResult,
  bodyText: string,
  observedAt: Date,
): readonly NewEvidenceItem[] {
  // The same content hash across every security this entry attributes to. `insertEvidenceItem`
  // keys idempotency on `(security_id, provider, raw_hash)`, so one hash per entry is exactly
  // right: re-polling the feed is a no-op per security, and two securities named in one post are
  // two genuinely distinct rows rather than a collision.
  const rawHash = canonicalHash({
    guid: entry.guid,
    link: entry.link,
    title: entry.title,
    contentHtml: entry.contentHtml,
  });

  const availableAt = availableAtFor(entry, observedAt);
  const publishedAt = new Date(entry.publishedAt);

  const base = {
    evidenceType: 'social_result' as const,
    provider: 'substack',
    title: entry.title,
    // D-17 retains full bodies for Substack — this column is the corpus, not a preview of it.
    snippet: bodyText,
    sourceUrl: entry.link,
    publisher: publication.name,
    // No author is stored: `authorRef` permits "hashed or pseudonymous only", and a Substack
    // byline is a real name under the publication's own terms. Nothing downstream needs it.
    authorRef: null,
    // Stance is the scorer's to write, on a successor row. A collector that guessed here would
    // be the collector depending on the scorer, which §2.1 forbids in the other direction too.
    stanceLabel: null,
    stanceScore: null,
    relevanceScore: null,
    publishedAt: Number.isNaN(publishedAt.getTime()) ? null : publishedAt,
    availableAt,
    lastCheckedAt: observedAt,
    availability: 'available' as const,
    licenseClass: SUBSTACK_LICENSE_CLASS,
    coverageClass: SUBSTACK_COVERAGE_CLASS,
    rawHash,
  };

  const metadata = {
    methodVersion: SUBSTACK_METHOD_VERSION,
    publicationSlug: publication.slug,
    publicationSector: publication.sector,
    guid: entry.guid,
    axis: 'substack',
    form: 'article',
    pendingEntityCandidates: attribution.pending,
  };

  if (attribution.matches.length === 0) {
    // Unattributed, but kept: permanent corpus under D-17, and `entity.collision_guard` can
    // resolve `pendingEntityCandidates` later. Dropping it here would be the cheapest stage in
    // the pipeline making an unrecoverable decision.
    return [{ ...base, securityId: null, metadata: { ...metadata, attributionBasis: null } }];
  }

  return attribution.matches.map((match) => ({
    ...base,
    securityId: match.securityId,
    metadata: { ...metadata, attributionBasis: match.basis },
  }));
}

/** One collector run over the whole publication set. */
export async function collectSubstackEvidence(
  options: SubstackCollectorOptions,
): Promise<SubstackCollectionOutcome> {
  const db = options.db ?? getPool();
  const observedAt = options.now ?? new Date();
  const providerMode = options.providerMode ?? env.PROVIDER_MODE;
  const deps = options.deps ?? substackWrapperDeps({ db });
  const fetchFeed = options.fetchFeed ?? fetchSubstackFeed;

  const publications = options.publications ?? (await getSubstackPublications());
  const securities = await listActiveSecurities(db);

  const failedPublications: FailedPublication[] = [];
  const pending: { row: NewEvidenceItem; publicationSlug: string; guid: string; attributed: boolean }[] = [];
  let entriesSeen = 0;

  for (const publication of publications) {
    const feed = await fetchFeed(
      {
        publicationSlug: publication.slug,
        ...(options.headers === undefined ? {} : { headers: options.headers }),
      },
      providerMode,
      {
        ...deps,
        ...(options.fixturesRoot === undefined ? {} : { fixturesRoot: options.fixturesRoot }),
      },
    );

    if (!feed.ok) {
      failedPublications.push({ slug: publication.slug, error: feed.error });
      continue;
    }

    for (const entry of feed.data) {
      entriesSeen += 1;
      const bodyText = htmlToText(entry.contentHtml);
      // Title and body together: a security named only in the headline is genuinely mentioned.
      const attribution = attributeText(`${entry.title} ${bodyText}`, securities);
      for (const row of rowsForEntry(entry, publication, attribution, bodyText, observedAt)) {
        pending.push({
          row,
          publicationSlug: publication.slug,
          guid: entry.guid,
          attributed: row.securityId !== null,
        });
      }
    }
  }

  if (failedPublications.length === publications.length && publications.length > 0) {
    return {
      ok: false,
      observedAt: observedAt.toISOString(),
      failedPublications,
      message:
        `All ${publications.length} Substack publications failed to poll. This run persisted ` +
        'nothing and wrote no heartbeat, so F22 gap detection will record the window as a gap ' +
        'rather than as a quiet one.',
      heartbeatWritten: false,
    };
  }

  // Write first, enqueue second — the ordering `ingestAndEnqueue` exists to enforce, applied
  // here by hand rather than through it. That helper takes the item ids up front, which suits a
  // collector whose provider supplies them; `evidence_item.id` is database-generated, so there
  // is no id to enqueue until the row is written. The guarantee it encodes is the part that
  // matters and it is preserved exactly: every insert completes before `enqueueForScoring` is
  // called, so a crash between the two leaves a body on disk with no queue entry (recoverable by
  // a later sweep) rather than a queue entry with no body behind it (not recoverable).
  const rows: CollectedEvidenceRow[] = [];
  const collected: CollectedItem[] = [];

  for (const entry of pending) {
    const write = await insertEvidenceItem(entry.row, db);
    rows.push({
      evidenceItemId: write.item.id,
      securityId: write.item.securityId,
      publicationSlug: entry.publicationSlug,
      guid: entry.guid,
      inserted: write.inserted,
    });
    // Only newly-inserted, attributed rows are scored. A re-poll no-op must not re-enqueue an
    // item that already has a score, and an unattributed row has no subject to take a stance
    // about — it waits for `entity.collision_guard` instead.
    if (write.inserted && entry.attributed) {
      collected.push({ itemId: write.item.id, axis: 'substack', form: 'article' });
    }
  }

  const enqueued = await enqueueForScoring({ items: collected, at: observedAt }, { queue: options.queue });

  await recordHeartbeat('substack', observedAt, entriesSeen, db);

  return {
    ok: true,
    observedAt: observedAt.toISOString(),
    rows,
    entriesSeen,
    enqueuedCount: enqueued.enqueued.length,
    failedPublications,
    heartbeatWritten: true,
  };
}
