/**
 * `DegradedPanel` — F07 §3, §4.5's "Degraded" row: *"the panel names the unavailable provider
 * and what is missing."* Shared with F08/F09.
 */

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  market: 'the market-data provider (FMP daily bars)',
  marketaux: 'the news provider (Marketaux)',
  database: 'storage (the database could not be reached)',
  /** F08 §4.5 — the last successful attention-collector run's snapshot set still renders. */
  apewisdom: 'the attention board provider (ApeWisdom)',
};

export type DegradedPanelProps = {
  readonly providers: readonly string[];
};

export function DegradedPanel({ providers }: DegradedPanelProps) {
  if (providers.length === 0) return null;

  return (
    <div
      className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
      data-degraded-panel=""
    >
      <p className="font-semibold">This page is showing a degraded state.</p>
      <p className="mt-1">
        {providers.length === 1 ? 'One provider is' : `${String(providers.length)} providers are`} currently
        unavailable, so some values below could not be recomputed on the last refresh:
      </p>
      <ul className="mt-2 list-disc pl-5">
        {providers.map((provider) => (
          <li key={provider} data-degraded-provider={provider}>
            {PROVIDER_LABELS[provider] ?? provider}
          </li>
        ))}
      </ul>
    </div>
  );
}
