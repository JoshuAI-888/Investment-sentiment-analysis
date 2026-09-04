/**
 * Per-axis fetch and frame disclosure — F10 §4.1, §4.5.
 *
 * The three axes are `provider` values on `evidence_item` (`repositories/evidence.ts`'s own
 * docstring), not a separate column — this module reads each axis with its own
 * `evidenceForSecurity` call, `providers: [axis]`, matching F09's existing `SOCIAL_AXIS_PROVIDERS`
 * mapping in `services/ticker/snapshot.ts` (`reddit → ['reddit']`, `x → ['x']`,
 * `substack → ['substack']`).
 */
import type { SocialAxis } from '@/contracts/primitives';
import { AXIS_FRAME_STATEMENT, type FrameDisclosure } from '@/contracts/evidence-pack';
import {
  CANDIDATE_SCAN_LIMIT,
  evidenceForSecurity,
  type EvidenceItemWithDedupeKey,
  type EvidenceForSecurityResult,
} from '@/repositories/evidence';
import type { Queryable } from '@/repositories/client';

export const SOCIAL_AXES: readonly SocialAxis[] = ['reddit', 'x', 'substack'];

export type AxisBundle = {
  readonly axis: SocialAxis;
  /** Already deduped *within this axis* by `evidenceForSecurity` itself — never across axes. */
  readonly items: readonly EvidenceItemWithDedupeKey[];
  /**
   * F10 §4.2's "retrieved count" — the raw, **pre-dedup** scan count for this axis
   * (`evidenceForSecurity`'s `scannedCount`), not the post-dedup `distinctCount`.
   * `repositories/evidence.ts`'s own docstring is explicit that calling the post-dedup number
   * "retrieved" is exactly the conflation a previous review there already caught and fixed —
   * this module had reintroduced the same bug one layer up (lane-review finding 2b). Using
   * `distinctCount` here would silently hide the duplicate copies this axis's own dedup pass
   * already filtered out, understating how much raw content was actually scanned.
   */
  readonly retrievedCount: number;
  readonly truncatedScan: boolean;
};

export async function fetchAxisBundles(
  query: { readonly securityId: string; readonly asOfInstant: Date; readonly scanLimit?: number },
  db: Queryable,
): Promise<readonly AxisBundle[]> {
  const bundles: AxisBundle[] = [];
  for (const axis of SOCIAL_AXES) {
    const result: EvidenceForSecurityResult = await evidenceForSecurity(
      {
        securityId: query.securityId,
        asOfInstant: query.asOfInstant,
        providers: [axis],
        // Pack-level dedupe/relevance runs over every distinct item this axis has, not just a
        // display page — `limit` defaults to 50 in `evidenceForSecurity`, which would silently
        // starve `retrievedCount` for a heavily-covered ticker. `scanLimit` still bounds the scan.
        limit: query.scanLimit ?? CANDIDATE_SCAN_LIMIT,
      },
      db,
      query.scanLimit,
    );
    bundles.push({
      axis,
      items: result.items,
      retrievedCount: result.scannedCount,
      truncatedScan: result.truncated,
    });
  }
  return bundles;
}

function readStringField(metadata: unknown, key: string): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBooleanField(metadata: unknown, key: string): boolean | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

export type SubstackBasis = {
  readonly publicationSetVersion: string;
  readonly selectionBasis: string;
};

/**
 * Builds the axis's `FrameDisclosure` (F10 §4.5). Axis-specific fields are read from each item's
 * own `metadata` where the collector recorded them.
 *
 * **No F16a collector exists yet** (`MEMORY.md` D-42), so no committed schema for
 * `evidence_item.metadata`'s Reddit/X fields exists to read against. This function reads the
 * field names F04/F16a's own eventual adapter is most likely to use (`subreddit`,
 * `treeComplete`, `watchlistVersion`, `triggerEventId`) and simply omits a field it cannot find
 * rather than fabricating one — an honest "unknown" (the schema field stays optional/undefined)
 * beats a guessed value. **Flagged under this lane's `RISKS`**: once F16a lands, its actual
 * metadata key names should be reconciled against this reader.
 *
 * **`AxisBundle.truncatedScan` is surfaced as `frameDisclosure.truncated`** (lane-review finding
 * 6; the field was added to the frozen contract at merge time — see `MEMORY.md` D-43).
 */
export function buildFrameDisclosure(
  bundle: AxisBundle,
  usedCount: number,
  window: { readonly from: Date; readonly to: Date },
  extras: { readonly substack?: SubstackBasis } = {},
): FrameDisclosure {
  const base: FrameDisclosure = {
    axis: bundle.axis,
    frameStatement: AXIS_FRAME_STATEMENT[bundle.axis],
    window: { from: window.from, to: window.to },
    retrievedCount: bundle.retrievedCount,
    usedCount,
    truncated: bundle.truncatedScan,
  };

  if (bundle.axis === 'reddit') {
    const subreddits = new Set<string>();
    let anyTreeIncomplete = false;
    let sawTreeCompleteField = false;
    for (const item of bundle.items) {
      const subreddit = readStringField(item.metadata, 'subreddit');
      if (subreddit !== null) subreddits.add(subreddit);
      const treeComplete = readBooleanField(item.metadata, 'treeComplete');
      if (treeComplete !== null) {
        sawTreeCompleteField = true;
        if (!treeComplete) anyTreeIncomplete = true;
      }
    }
    return {
      ...base,
      ...(subreddits.size > 0 ? { subredditsPolled: [...subreddits].sort() } : {}),
      ...(sawTreeCompleteField ? { treeComplete: !anyTreeIncomplete } : {}),
    };
  }

  if (bundle.axis === 'x') {
    const watchlistVersion = bundle.items
      .map((item) => readStringField(item.metadata, 'watchlistVersion'))
      .find((value): value is string => value !== null);
    const triggerEventId = bundle.items
      .map((item) => readStringField(item.metadata, 'triggerEventId'))
      .find((value): value is string => value !== null);
    return {
      ...base,
      ...(watchlistVersion !== undefined ? { watchlistVersion } : {}),
      ...(triggerEventId !== undefined ? { triggerEventId } : {}),
    };
  }

  // substack
  return {
    ...base,
    ...(extras.substack !== undefined
      ? {
          publicationSetVersion: extras.substack.publicationSetVersion,
          selectionBasis: extras.substack.selectionBasis,
        }
      : {}),
  };
}
