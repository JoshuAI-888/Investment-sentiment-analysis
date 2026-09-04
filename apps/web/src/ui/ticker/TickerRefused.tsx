/**
 * F09 §4.1 — "An ambiguous or ineligible symbol is refused with a stated reason, not silently
 * resolved to a guess." Rendered as a legible page, not an error-shaped dead end.
 */
import type { TickerRefusalView } from './types';

export type TickerRefusedProps = { readonly symbol: string; readonly refusal: TickerRefusalView };

export function TickerRefused({ symbol, refusal }: TickerRefusedProps) {
  return (
    <main className="mx-auto max-w-2xl p-8" data-route={`/ticker/${symbol}/social`} data-refused={refusal.reason}>
      <h1 className="text-xl font-semibold">This symbol was not resolved</h1>
      <p className="mt-2 text-sm text-neutral-700" data-refusal-message="">
        {refusal.message}
      </p>
      <a className="mt-4 inline-block text-sm underline decoration-dotted" href="/dashboard">
        Back to the dashboard
      </a>
    </main>
  );
}
