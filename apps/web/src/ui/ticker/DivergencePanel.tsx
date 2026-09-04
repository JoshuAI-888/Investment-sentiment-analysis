/**
 * F06 §4.6 / product invariant §6.4 — the divergence state and its verbatim disclosure line.
 * "The divergence state carries the §6.4 disclosure line verbatim" (F09 DoD): `disclosure` is
 * read straight through from `market.divergence_state`'s artifact `warnings[]`
 * (`services/ticker/snapshot.ts`), never composed or paraphrased in this component — the point
 * of that being service-side is that this line survives a UI rewrite untouched.
 *
 * The exact text, on one line so `check:copy`'s static scan can find it verbatim:
 * "This is a description of what is currently observable. It has not been tested against historical returns and is not a forecast."
 */
import { inspectorHref } from '../inspector-links';
import { FreshnessBadge } from '../FreshnessBadge';
import type { DivergencePanelView } from './types';

export type DivergencePanelProps = { readonly divergence: DivergencePanelView };

export function DivergencePanel({ divergence }: DivergencePanelProps) {
  if (!divergence.available) {
    return (
      <section className="rounded border border-neutral-200 p-6" data-divergence-unavailable="">
        <h2 className="text-lg font-semibold">Divergence</h2>
        <p className="mt-2 text-sm text-neutral-700">{divergence.reason}</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-neutral-200 p-6" data-divergence-state={divergence.state}>
      <h2 className="text-lg font-semibold">Divergence</h2>
      <p className="mt-2 text-base font-semibold">{divergence.state.replaceAll('_', ' ')}</p>
      <p className="mt-1 text-sm text-neutral-700">{divergence.interpretation}</p>
      {/*
       * Round-4 lane-review finding 2: `interpretation` above reads as an unqualified claim about
       * "stance" (e.g. "Discussion is optimistic…"), but the social leg feeding this state is
       * Reddit's sampled frame alone — D-14's three platforms are never blended into one number.
       */}
      <p className="mt-1 text-xs text-neutral-500" data-divergence-social-axis-disclosure="">
        {divergence.socialAxisDisclosure}
      </p>
      {/* §6.4, rendered from the method output verbatim — never hardcoded here. */}
      <p className="mt-2 text-xs font-medium text-amber-700" data-divergence-disclosure="">
        {divergence.disclosure}
      </p>
      {/*
       * Round-4 lane-review finding 3: this panel used to compose neither `CoverageLabel` nor
       * `FreshnessBadge` — the only metric surface on the page that didn't — and its three
       * synthesized inputs all carried `observedAt: null`, making it structurally incapable of
       * ever showing stale. Both are fixed together: real observedAt values feed the artifact,
       * and this badge discloses the result the same way every other metric here does.
       */}
      <FreshnessBadge observedAt={divergence.observedAt} stale={divergence.stale} />
      <a
        className="mt-2 inline-block text-xs underline decoration-dotted"
        href={inspectorHref(divergence.calculationId)}
      >
        How this was calculated
      </a>
    </section>
  );
}
