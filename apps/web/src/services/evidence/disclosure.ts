/**
 * The three per-axis honest disclosures — F10 §4.5. Verbatim statements, never a shared one:
 * *"Nothing produced by this feature may be labelled 'Reddit sentiment', 'social sentiment',
 * 'retail sentiment', 'X sentiment' or 'consensus'. A blended cross-axis number is never
 * stored."* This module only assembles the three; it never averages, ranks or compares them.
 */
import type { SocialAxis } from '@/contracts/primitives';
import {
  REDDIT_COLLECTED,
  REDDIT_NOT_COLLECTED_STATEMENT,
  SUBSTACK_PUBLICATION_SET_VERSION,
  SUBSTACK_SELECTION_BASIS,
} from './sampling-config';
import type { AxisDisclosure, ExclusionReason } from './types';

const REDDIT_STATEMENT =
  'Observed sample of comments from the subreddits polled — not a sample of retail investors.';
const X_STATEMENT =
  'Watched-account sample, collected around a price trigger. Coverage is event-conditional, ' +
  'not continuous.';
const SUBSTACK_STATEMENT = (version: string): string =>
  `Curated publication set, selected on the basis recorded in config version ${version}.`;

export type AxisCounts = {
  readonly retrieved: number;
  readonly used: number;
  readonly exclusions: readonly { readonly reason: ExclusionReason; readonly count: number }[];
};

export type BuildDisclosuresInput = {
  readonly counts: Readonly<Record<SocialAxis, AxisCounts>>;
  readonly windowFrom: string | null;
  readonly windowTo: string | null;
  readonly reddit: {
    readonly subredditsPolled: readonly string[];
    readonly treeComplete: boolean | null;
  };
  readonly x: {
    readonly watchlistVersion: string | null;
    readonly triggerEvent: string | null;
  };
};

/** Always exactly three, in a fixed order — a caller iterating this array never has to sort it. */
export function buildAxisDisclosures(
  input: BuildDisclosuresInput,
): readonly [AxisDisclosure, AxisDisclosure, AxisDisclosure] {
  const reddit: AxisDisclosure = {
    axis: 'reddit',
    statement: REDDIT_COLLECTED ? REDDIT_STATEMENT : REDDIT_NOT_COLLECTED_STATEMENT,
    windowFrom: REDDIT_COLLECTED ? input.windowFrom : null,
    windowTo: REDDIT_COLLECTED ? input.windowTo : null,
    retrievedCount: REDDIT_COLLECTED ? input.counts.reddit.retrieved : 0,
    usedCount: REDDIT_COLLECTED ? input.counts.reddit.used : 0,
    exclusions: REDDIT_COLLECTED ? input.counts.reddit.exclusions : [],
    meta: {
      kind: 'reddit',
      collected: REDDIT_COLLECTED,
      subredditsPolled: REDDIT_COLLECTED ? input.reddit.subredditsPolled : [],
      treeComplete: REDDIT_COLLECTED ? input.reddit.treeComplete : null,
    },
  };

  const x: AxisDisclosure = {
    axis: 'x',
    statement: X_STATEMENT,
    windowFrom: input.windowFrom,
    windowTo: input.windowTo,
    retrievedCount: input.counts.x.retrieved,
    usedCount: input.counts.x.used,
    exclusions: input.counts.x.exclusions,
    meta: { kind: 'x', watchlistVersion: input.x.watchlistVersion, triggerEvent: input.x.triggerEvent },
  };

  const substack: AxisDisclosure = {
    axis: 'substack',
    statement: SUBSTACK_STATEMENT(SUBSTACK_PUBLICATION_SET_VERSION),
    windowFrom: input.windowFrom,
    windowTo: input.windowTo,
    retrievedCount: input.counts.substack.retrieved,
    usedCount: input.counts.substack.used,
    exclusions: input.counts.substack.exclusions,
    meta: {
      kind: 'substack',
      publicationSetVersion: SUBSTACK_PUBLICATION_SET_VERSION,
      selectionBasis: SUBSTACK_SELECTION_BASIS,
    },
  };

  return [reddit, x, substack];
}
