/**
 * The availability checker — F10 §4.6 / F-19. *"A low-frequency job re-checks stored evidence
 * URLs with a HEAD request and updates `availability` and `last_checked_at`. It never re-fetches
 * content into the record, never repairs a snippet, and never invalidates a completed run."*
 *
 * **Why this is a port, not a repository call.** `repositories/evidence.ts` has an insert path
 * (`insertEvidenceItem`) and a read path (`evidenceForSecurity`) but no update path at all — no
 * migration or function exists for writing `availability`/`last_checked_at` back onto an
 * existing row. `repositories/` is SPINE-owned (`CLAUDE.md`: "a needed contract change is
 * reported, not made"), so this module takes an `AvailabilityWritePort` the same way F20's
 * `services/jobs/ports.ts` took a `ScoreStorePort` for the identical reason — see that file's
 * own docstring for the precedent. The concrete Postgres-backed implementation is a SPINE
 * contract request (`updateEvidenceAvailability(itemId, { availability, lastCheckedAt })`),
 * reported in this feature's build report; everything here is fully exercised against an
 * in-memory fake with no database.
 *
 * **The signature is the guarantee, not a convention someone has to remember.** `writeAvailability`
 * has no field for content or a snippet — an implementation literally cannot "repair" one through
 * this port, which is the same structural move `services/jobs/ports.ts`'s append-only
 * `ScoreStorePort` makes for "never overwrite, insert a successor."
 */
import type { EvidenceItem } from '@/contracts/evidence';

/** `contracts/evidence.ts` exports the zod schema (`availability`) but not this type alias. */
export type Availability = EvidenceItem['availability'];

export type HeadCheckResult =
  | { readonly kind: 'response'; readonly status: number }
  | { readonly kind: 'network_error' };

/** A minimal slice of `fetch`, HEAD-only — injected so a test never makes a real request. */
export type HeadChecker = (url: string) => Promise<HeadCheckResult>;

export type AvailabilityWritePort = {
  writeAvailability(input: {
    readonly itemId: string;
    readonly availability: Availability;
    readonly lastCheckedAt: Date;
  }): Promise<void>;
};

/**
 * The HEAD status → `availability` mapping. `network_error` (DNS failure, connection refused,
 * timeout) is `'unreachable'`, not `'removed'` — a network failure says nothing about whether
 * the content still exists, only that this check could not reach it.
 */
export function availabilityFromHeadCheck(result: HeadCheckResult): Availability {
  if (result.kind === 'network_error') return 'unreachable';
  const { status } = result;
  if (status >= 200 && status < 300) return 'available';
  if (status === 404 || status === 410) return 'removed';
  if (status === 401 || status === 402 || status === 403) return 'paywalled';
  return 'unreachable';
}

export type RecheckDeps = {
  readonly headChecker: HeadChecker;
  readonly writer: AvailabilityWritePort;
  readonly now: () => Date;
};

export type RecheckSummary = {
  readonly checked: number;
  readonly changed: number;
  /** Items with `sourceUrl: null` — nothing to HEAD-check, skipped rather than guessed at. */
  readonly skippedNoUrl: number;
};

/**
 * Re-checks every item passed in. The caller selects which items are due (F10 §4.6: "low-
 * frequency" — this module has no schedule of its own; F16a/the cron surface owns dispatch and
 * this feature does not touch `app/api/cron/**`).
 */
export async function recheckAvailability(
  items: readonly Pick<EvidenceItem, 'id' | 'sourceUrl' | 'availability'>[],
  deps: RecheckDeps,
): Promise<RecheckSummary> {
  let checked = 0;
  let changed = 0;
  let skippedNoUrl = 0;

  for (const item of items) {
    if (item.sourceUrl === null) {
      skippedNoUrl += 1;
      continue;
    }

    const result = await deps.headChecker(item.sourceUrl);
    const next = availabilityFromHeadCheck(result);
    checked += 1;
    if (next !== item.availability) changed += 1;

    await deps.writer.writeAvailability({
      itemId: item.id,
      availability: next,
      lastCheckedAt: deps.now(),
    });
  }

  return { checked, changed, skippedNoUrl };
}
