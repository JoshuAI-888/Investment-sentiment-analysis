import type { RniPlatformSlice, RniRun } from '@/rni/contracts';

export type RniStateMatrixEntry = Readonly<{
  id: string;
  label: string;
  run: RniRun;
  platformSlices: readonly RniPlatformSlice[];
}>;

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function time(value: string | null) {
  return value ?? 'Not available';
}

function PlatformState({ slice }: Readonly<{ slice: RniPlatformSlice }>) {
  const hasFailure = slice.status === 'failed' || slice.status === 'unavailable';
  return (
    <section data-rni-state-platform={slice.platform} className="space-y-2 border p-4">
      <h3 className="text-xl font-semibold">{slice.platform === 'x' ? 'X' : 'Reddit'}</h3>
      <p>
        {label(slice.status)} · {slice.eligibleSourceCount} eligible sources
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Last successful refresh</dt>
          <dd>{time(slice.lastSuccessfulRefreshAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">Data through</dt>
          <dd>{time(slice.dataThroughAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">Computed at</dt>
          <dd>{time(slice.computedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">Last attempt</dt>
          <dd>{time(slice.lastAttemptAt)}</dd>
        </div>
      </dl>
      <p>{slice.coverageDisclosure}</p>
      {hasFailure ? (
        <p role="alert">Source status: {slice.errorCode ?? label(slice.status)}</p>
      ) : null}
    </section>
  );
}

export function RniStateMatrix({ entries }: Readonly<{ entries: readonly RniStateMatrixEntry[] }>) {
  return (
    <main data-rni-state-matrix className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-sm">Retail Narrative Intelligence</p>
        <h1 className="text-3xl font-semibold">Run and source-state matrix</h1>
        <p>Run progress and freshness are reported independently for Reddit and X.</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        {entries.map((entry) => (
          <article key={entry.id} data-rni-state={entry.id} className="space-y-4 border p-4">
            <header className="space-y-1">
              <h2 className="text-2xl font-semibold">{entry.label}</h2>
              <p role={entry.run.status === 'running' ? 'status' : undefined} aria-live="polite">
                Run: {label(entry.run.status)}
              </p>
              {entry.run.status === 'running' ? (
                <p>No derived combined result is shown while source processing is in progress.</p>
              ) : null}
            </header>
            <div className="grid gap-4 sm:grid-cols-2">
              {entry.platformSlices.map((slice) => (
                <PlatformState key={slice.platform} slice={slice} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
