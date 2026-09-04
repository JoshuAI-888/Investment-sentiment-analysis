/**
 * F09 §4.2's price axis: "5d/20d returns, 20d volatility, regime label, RSI, MAs."
 *
 * The returns rendered below are `price_return_snapshot`'s actual stored horizons (7/30/90/180
 * *calendar* days), not the originally-specified 5-/20-*trading*-day windows — `horizonDisclosure`
 * (sourced from the service layer, not hardcoded twice) states this honestly.
 *
 * **`totalReturn` is not rendered as an `InspectableMetric`, but round-1 lane-review finding 3
 * corrected why: it is not a raw provider print the way header `price`/`changePercent` are.** It
 * is this deployment's own computed figure — `price_return_snapshot` carries its own
 * `methodVersion`, `adjustmentStatus` and `baselinePriceDate`, none of which describe a fact a
 * vendor sent — but §6.2's "every displayed number carries a `calculation_id`" is unmet here
 * because no `analytics/registry.ts` method exists yet for a price return; only SPINE may
 * register one (`02-ARCHITECTURE-CONTRACTS.md` §3). `check:calc-coverage` cannot see this gap
 * without a manifest entry `check:calc-coverage`'s own design treats as "declares a number from
 * nowhere," which would fail the check for a value SURFACE cannot fix by registering a method
 * itself — recorded as a cross-lane dependency instead (this feature's CONTRACTS report;
 * `docs/progress/surface.md`). The `data-return-uninspectable` marker below is this panel's own
 * honest disclosure that the figure has no Inspector link, distinct from a genuine
 * `InspectableMetric`'s labelled provenance.
 */
import { AxisMetricCard } from './AxisMetricCard';
import type { PriceAxisView } from './types';

export type PriceAxisPanelProps = { readonly price: PriceAxisView };

export function PriceAxisPanel({ price }: PriceAxisPanelProps) {
  return (
    <section className="rounded border border-neutral-200 p-6" data-axis="price">
      <h2 className="text-lg font-semibold">Price</h2>

      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4" data-price-returns="">
        {price.returns.length === 0 ? (
          <p className="col-span-full text-sm text-neutral-700">No return on record yet.</p>
        ) : (
          price.returns.map((r) => (
            <div key={r.horizonCalendarDays} data-price-return={r.horizonCalendarDays}>
              <p className="text-xs uppercase tracking-wide text-neutral-500">{r.horizonCalendarDays}-day return</p>
              <p className="text-lg font-semibold tabular-nums">
                {r.totalReturn === null ? 'insufficient_data' : `${r.totalReturn}`}
              </p>
              <p className="text-xs text-neutral-500">as of {r.asOfDate} · quality: {r.qualityStatus}</p>
              {r.totalReturn === null ? null : (
                <p className="text-xs text-neutral-500" data-return-uninspectable="">
                  Computed by this deployment; no registered method exists yet to open in the Inspector.
                </p>
              )}
            </div>
          ))
        )}
      </div>
      <p className="mt-2 text-xs text-amber-700" data-horizon-disclosure="">
        {price.horizonDisclosure}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {price.regime === null ? null : <AxisMetricCard metric={price.regime} />}
        {price.volatility20 === null ? null : <AxisMetricCard metric={price.volatility20} />}
        {price.rsi14 === null ? null : <AxisMetricCard metric={price.rsi14} />}
        {price.movingAverage20 === null ? null : <AxisMetricCard metric={price.movingAverage20} />}
        {price.movingAverage50 === null ? null : <AxisMetricCard metric={price.movingAverage50} />}
      </div>
    </section>
  );
}
