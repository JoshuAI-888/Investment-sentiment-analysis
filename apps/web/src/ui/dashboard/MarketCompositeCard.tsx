/**
 * `MarketCompositeCard` — F07 §4.2.
 *
 * *"Shows the composite label and value, and — always, not behind a disclosure — the component
 * breakdown: which of the four participated, each one's value, and the renormalized weights. A
 * composite computed from two of four components must **look** different from one computed
 * from four."* The component list below always renders all four rows — an omitted component is
 * a visibly different row (`data-participated="false"`), not a hidden one, which is what makes
 * "looks different" actually true rather than merely inspectable one click away.
 */
import { AggregateMetric } from './AggregateMetric';
import type { MarketCompositeCardView } from './types';

export type MarketCompositeCardProps = { readonly view: MarketCompositeCardView };

export function MarketCompositeCard({ view }: MarketCompositeCardProps) {
  const { composite, components } = view;

  return (
    <section className="rounded border border-neutral-200 p-6" data-market-composite-card="">
      <h2 className="text-lg font-semibold">Market composite</h2>

      {composite === null ? (
        <p className="mt-2 text-sm text-neutral-700" data-market-composite-empty="">
          No market composite has been computed yet.
        </p>
      ) : (
        <div className="mt-2">
          <AggregateMetric metric={composite} />
        </div>
      )}

      <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Component breakdown
      </h3>
      <ul className="mt-2 space-y-3" data-component-count={String(components.filter((c) => c.participated).length)}>
        {components.map((component) => (
          <li
            key={component.key}
            data-composite-component={component.key}
            data-participated={String(component.participated)}
            className={component.participated ? '' : 'border-l-2 border-dashed border-neutral-300 pl-3'}
          >
            {!component.participated || component.metric === null ? (
              // Gated on `participated` (plus a null check TS needs to narrow `component.metric`
              // below), not on `component.metric === null` alone (round-2 review finding 1): a
              // component whose artifact loaded but abstained (eligibility !== 'ok') still has a
              // non-null `metric`, and previously fell into the "applied" branch below, where the
              // missing `renormalizedWeight` (no `contribution_` step exists for a
              // non-participating component) silently fell back to displaying the *official*
              // weight as though it had been applied this cycle — the exact defect this card
              // exists to avoid, now reachable through a different door.
              //
              // Distinguished from a participating row by the dashed border above, not by
              // `opacity` — a lowered-opacity gray failed WCAG AA contrast (axe, F07 §5's e2e
              // case), and the text still needs to be read, not merely noticed.
              <p className="text-sm text-neutral-700">
                {component.label} — official weight {component.officialWeight} — omitted this cycle (inadequate
                coverage, never supplied as zero)
              </p>
            ) : (
              <>
                <AggregateMetric
                  metric={component.metric}
                  label={`${component.label} (applied weight ${component.renormalizedWeight ?? 'unavailable'})`}
                />
                {/*
                 * F07 §4.2, review finding 2: the renormalized weight — what was actually
                 * applied this cycle — is displayed directly, not only behind the Inspector
                 * link. Shown alongside the fixed official weight, clearly labeled, rather than
                 * in its place, since a reader comparing today to a four-component day needs
                 * both. A participating component should always have a `renormalizedWeight`
                 * (the composite's own `contribution_<key>` step); "unavailable" — never a
                 * silent substitution of the official weight — is what a reader sees if that
                 * step is ever missing despite `participated` being true, which would itself be
                 * a bug in `renormalizedComponentWeight` worth investigating, not hiding.
                 */}
                <p className="text-xs text-neutral-500" data-composite-component-weight="">
                  Applied weight this cycle: {component.renormalizedWeight ?? 'unavailable'} (official weight{' '}
                  {component.officialWeight})
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
