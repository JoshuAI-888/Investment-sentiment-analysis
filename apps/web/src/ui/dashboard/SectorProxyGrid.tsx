/**
 * `SectorProxyGrid` — F07 §4.3. 11 US sector ETF proxies, titled "sector proxy" with a tooltip
 * stating that an ETF is a proxy for its sector, not a population of its constituents. A sector
 * with no news data renders `insufficient_data` (via `InspectableMetric`'s own abstention
 * rendering), never a zero tile.
 */
import { AggregateMetric } from './AggregateMetric';
import type { SectorTileView } from './types';

export type SectorProxyGridProps = { readonly tiles: readonly SectorTileView[] };

const PROXY_TOOLTIP =
  'A sector ETF proxy stands in for the companies in its sector. It is not a population of the sector’s constituents, and a sector-wide event may not be reflected in any single constituent this proxy holds.';

export function SectorProxyGrid({ tiles }: SectorProxyGridProps) {
  return (
    <section data-sector-proxy-grid="">
      <h2 className="text-lg font-semibold">
        Sector proxies
        <span
          className="ml-2 cursor-help text-xs font-normal text-neutral-500 underline decoration-dotted"
          title={PROXY_TOOLTIP}
          data-sector-proxy-tooltip=""
        >
          what is a sector proxy?
        </span>
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <article
            key={tile.sectorKey}
            className="rounded border border-neutral-200 p-4"
            data-sector-tile={tile.sectorKey}
          >
            <h3 className="text-sm font-semibold">
              {tile.sectorLabel} <span className="font-mono text-xs text-neutral-500">({tile.tickerSymbol})</span>
            </h3>

            <div className="mt-2 space-y-2">
              {tile.newsSentiment === null ? (
                <p className="text-sm text-neutral-600" data-sector-metric="news.sentiment-empty">
                  No value — no news sentiment has been computed yet
                </p>
              ) : (
                <AggregateMetric metric={tile.newsSentiment} label="News sentiment" />
              )}

              {tile.priceRegime === null ? (
                <p className="text-sm text-neutral-600" data-sector-metric="price.regime-empty">
                  No value — no price regime has been computed yet
                </p>
              ) : (
                <AggregateMetric metric={tile.priceRegime} label="Price regime" />
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
