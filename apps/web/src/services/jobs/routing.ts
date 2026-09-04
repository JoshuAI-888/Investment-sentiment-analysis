/**
 * Which pinned model scores which item — F20 §4.1's table, as a total function.
 *
 * | Model | Used for |
 * |---|---|
 * | `ProsusAI/finbert@<sha>` | Substack prose, long Reddit posts |
 * | `cardiffnlp/twitter-roberta-base-sentiment-latest@<sha>` | X snippets, short Reddit comments |
 *
 * **Routing keys on structure, never on length.** §4.1's prose says "long Reddit posts" and
 * "short Reddit comments", which reads like a length threshold and is not one here. A threshold
 * would make the model depend on the body: a body re-truncated under a changed retention rule,
 * or an X snippet that grew a character, could route the *same item* to a different scorer on a
 * re-score. That puts two `scorer_version` values inside one series, which is precisely what
 * Tier D3 rejects and what §4.4's "successor, never in place" rule exists to keep coherent.
 * A Reddit post is long-form and a Reddit comment is short — the structural distinction is the
 * one §4.1 is actually reaching for, and it cannot drift.
 *
 * Recorded on the queue entry at enqueue time, so a re-score routes identically by construction
 * rather than by re-deriving the same answer and hoping.
 */
import type { SocialAxis } from '@/contracts/primitives';
import type { ScorerId } from '@/adapters/scorer';
import type { SocialItemForm } from './ports';

export type RoutableItem = {
  axis: SocialAxis;
  form: SocialItemForm;
};

export function routeToScorer(item: RoutableItem): ScorerId {
  // Substack is long-form prose in every form it takes.
  if (item.axis === 'substack') return 'finbert';

  // X is the short-social axis end to end: D-17 stores a bounded snippet and nothing longer,
  // so there is no X item that is long-form prose.
  if (item.axis === 'x') return 'tweet-roberta';

  // Reddit is the only axis that carries both.
  return item.form === 'comment' ? 'tweet-roberta' : 'finbert';
}
