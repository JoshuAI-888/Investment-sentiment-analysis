/**
 * F09 §4.1 — header and identity. `price`/`changePercent`/`session` are raw stored facts read
 * from `market_snapshot`, not values a registered analytics method produces (there is no
 * `price.*` method that yields "today's raw print" — only derived methods like `price.regime`
 * do). They are rendered as labelled, provenanced facts rather than wrapped in
 * `InspectableMetric`, which would require fabricating a `calculationId` with nothing real behind
 * it — reported under this feature's CONTRACTS line rather than papered over.
 *
 * **Real-time / delayed / EOD.** `market_snapshot.session` records which trading session a print
 * belongs to (`premarket`/`regular`/`afterhours`/`closed`/`eod`); it does not record whether the
 * print itself is real-time or delayed relative to the exchange tape — no column in this schema
 * carries that distinction. This component states the session honestly and does not claim
 * "real-time" or "delayed", which the current schema cannot support either way.
 */
import type { TickerHeaderView } from './types';

export type TickerHeaderCardProps = { readonly header: TickerHeaderView };

function formatObservedAt(observedAt: Date | null): string {
  return observedAt === null ? 'unknown time' : observedAt.toISOString();
}

export function TickerHeaderCard({ header }: TickerHeaderCardProps) {
  return (
    <header className="border-b border-neutral-200 pb-6" data-ticker-header={header.symbol}>
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {header.exchange} · {header.assetType}
        {header.sector === null ? '' : ` · ${header.sector}`}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">
        {header.symbol} — {header.name}
      </h1>

      <div className="mt-4 flex flex-wrap items-baseline gap-4" data-ticker-price="">
        <span className="text-3xl font-semibold tabular-nums" data-price-value={header.price ?? 'null'}>
          {header.price === null ? 'No price on record' : `$${header.price}`}
        </span>
        {header.changePercent === null ? null : (
          <span
            className="text-sm font-medium tabular-nums"
            data-price-change={header.changePercent}
          >
            {header.changePercent}%
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500" data-ticker-session="">
        {header.session === null
          ? 'No session recorded for the latest price'
          : `Session: ${header.session} (this schema does not record real-time-vs-delayed status)`}
        {header.provider === null ? '' : ` · provider: ${header.provider}`}
      </p>
      <p className="text-xs text-neutral-500">Observed {formatObservedAt(header.observedAt)}</p>

      {/*
       * Round-4 lane-review finding 4: F09 §2 lists "insider and filings links (cut-line items 3
       * and 2)" as In scope; nothing rendered or disclosed them until now. `null` (no CIK on
       * record for this security) is an honest "not available", not a broken link.
       */}
      <p className="mt-2 text-xs text-neutral-500" data-ticker-external-links="">
        {header.filingsHref === null && header.insiderTransactionsHref === null ? (
          'No SEC CIK on record for this security — filings and insider-transaction links are not available.'
        ) : (
          <>
            {header.filingsHref === null ? null : (
              <a className="underline decoration-dotted" href={header.filingsHref} data-filings-link="">
                SEC filings
              </a>
            )}
            {header.filingsHref !== null && header.insiderTransactionsHref !== null ? ' · ' : ''}
            {header.insiderTransactionsHref === null ? null : (
              <a className="underline decoration-dotted" href={header.insiderTransactionsHref} data-insider-transactions-link="">
                Insider transactions
              </a>
            )}
          </>
        )}
      </p>
    </header>
  );
}
