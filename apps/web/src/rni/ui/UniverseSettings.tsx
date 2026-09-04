import type {
  RniActiveUniverse,
  RniStagedUniversePreview,
  RniUniverseSearchResult,
} from '@/rni/contracts';

export function presentActiveUniverseVersion(
  version: RniActiveUniverse['version'],
): Readonly<{ source: string; retrievedAt: string }> {
  if (version.source === 'legacy_seed') {
    return {
      source: 'Legacy seed',
      retrievedAt: 'Not available for the legacy seed',
    };
  }

  return {
    source: 'FMP S&P 500 constituent',
    retrievedAt: version.retrievedAt,
  };
}

export function UniverseSettings({
  active,
  staged,
  searchResult,
}: {
  active: RniActiveUniverse;
  staged: RniStagedUniversePreview;
  searchResult: RniUniverseSearchResult;
}) {
  const activePresentation = presentActiveUniverseVersion(active.version);
  const searchSubject = searchResult.query
    ? `for “${searchResult.query}”`
    : 'in the initial member list';

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <h1>Universe settings</h1>
      <p>
        Active version {active.version.id} · {active.version.securityCount} members
      </p>
      <p>
        Default: {active.defaultSecurity.ticker} — {active.defaultSecurity.companyName} ·{' '}
        {active.defaultSecurity.exchange}
      </p>
      <dl>
        <div>
          <dt className="inline font-semibold">Source:</dt>{' '}
          <dd className="inline">{activePresentation.source}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Retrieved at:</dt>{' '}
          <dd className="inline">{activePresentation.retrievedAt}</dd>
        </div>
      </dl>

      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" method="get">
        <label className="flex flex-1 flex-col gap-1" htmlFor="universe-member-query">
          Search active S&amp;P 500 members
        </label>
        <input
          className="rounded border border-slate-400 px-3 py-2"
          defaultValue={searchResult.query}
          id="universe-member-query"
          maxLength={100}
          name="query"
          type="search"
        />
        <button className="rounded border border-slate-700 px-3 py-2" type="submit">
          Search members
        </button>
      </form>

      <section aria-labelledby="universe-search-results-heading">
        <h2 id="universe-search-results-heading">Search results</h2>
        <p id="universe-search-status" role="status" aria-live="polite" aria-atomic="true">
          <strong>Search result status:</strong> {searchResult.members.length}{' '}
          {searchResult.members.length === 1 ? 'member' : 'members'} found {searchSubject}. Results
          are bound to active version {searchResult.version.id}.
          {searchResult.hasMore ? ' More matching members are available.' : ''}
        </p>
        {searchResult.members.length > 0 ? (
          <ul>
            {searchResult.members.map((member) => (
              <li key={member.id}>
                {member.ticker} — {member.companyName} · {member.exchange}
              </li>
            ))}
          </ul>
        ) : (
          <p>No active members match this search.</p>
        )}
      </section>

      <section>
        <h2>Staged preview {staged.stagedVersion.id}</h2>
        <p>
          Active version {staged.activeVersion.id} → staged version {staged.stagedVersion.id}
        </p>
        <p>
          {staged.added.length} added · {staged.removed.length} removed ·{' '}
          {staged.stagedVersion.securityCount} members
        </p>
        <p>
          Staged source: FMP S&amp;P 500 constituent · Retrieved at:{' '}
          {staged.stagedVersion.retrievedAt}
        </p>
        <div>
          <h3>Added members</h3>
          {staged.added.length > 0 ? (
            <ul>
              {staged.added.map((member) => (
                <li key={member.id}>
                  {member.ticker} — {member.companyName} · {member.exchange}
                </li>
              ))}
            </ul>
          ) : (
            <p>No members added.</p>
          )}
        </div>
        <div>
          <h3>Removed members</h3>
          {staged.removed.length > 0 ? (
            <ul>
              {staged.removed.map((member) => (
                <li key={member.id}>
                  {member.ticker} — {member.companyName} · {member.exchange}
                </li>
              ))}
            </ul>
          ) : (
            <p>No members removed.</p>
          )}
        </div>
      </section>
    </main>
  );
}
