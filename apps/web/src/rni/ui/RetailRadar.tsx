import type { RniRadarPage, RniRadarPlatformCell } from '@/rni/contracts';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (c) => c.toUpperCase());
}
function time(value: string | null) {
  return value === null ? 'Not available' : value;
}

function PlatformCell({
  cell,
  heading,
}: Readonly<{ cell: RniRadarPlatformCell; heading: string }>) {
  return (
    <section data-rni-platform={cell.platform} className="space-y-1">
      <strong>{heading}</strong>
      <p>
        {label(cell.stance)} · {label(cell.status)}
      </p>
      <p>{cell.eligibleSourceCount} eligible sources</p>
      <p>Freshness: {time(cell.dataThroughAt)}</p>
      <p>Confidence: {cell.confidence ?? 'Insufficient evidence'}</p>
      <p>{cell.coverageDisclosure}</p>
      <p>{cell.summary}</p>
      {cell.citationIds.map((id, index) => (
        <a
          key={id}
          href={`#citation-${id}`}
          data-rni-citation-id={id}
          className="mr-2 underline focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          Citation {index + 1}
        </a>
      ))}
    </section>
  );
}

export function RetailRadar({ page }: Readonly<{ page: RniRadarPage }>) {
  return (
    <main data-rni-radar className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-sm">Retail Narrative Intelligence</p>
        <h1 className="text-3xl font-semibold">Retail Radar</h1>
        <p>Reddit and X are independent; combined summaries never pool source counts.</p>
      </header>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full">
          <caption className="sr-only">Retail Radar source-separated results</caption>
          <thead>
            <tr>
              <th scope="col">Security</th>
              <th scope="col">Reddit sentiment</th>
              <th scope="col">X sentiment</th>
              <th scope="col">Combined summary</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr
                key={row.security.id}
                data-rni-radar-row={row.security.ticker}
                className="align-top"
              >
                <th scope="row" className="p-3">
                  {row.security.ticker} — {row.security.companyName}
                  <span className="block text-sm font-normal">{row.security.exchange}</span>
                </th>
                <td className="p-3">
                  <PlatformCell cell={row.reddit} heading="Reddit sentiment" />
                </td>
                <td className="p-3">
                  <PlatformCell cell={row.x} heading="X sentiment" />
                </td>
                <td className="p-3" data-rni-combined-state={row.combined.state}>
                  <strong>Combined summary</strong>
                  <p>{label(row.combined.state)}</p>
                  <p>{row.combined.summary}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-4 md:hidden" aria-label="Retail Radar cards">
        {page.rows.map((row) => (
          <article
            key={row.security.id}
            data-rni-radar-card={row.security.ticker}
            className="space-y-3 border p-4"
          >
            <h2>
              {row.security.ticker} — {row.security.companyName}
            </h2>
            <p>{row.security.exchange}</p>
            <PlatformCell cell={row.reddit} heading="Reddit sentiment" />
            <PlatformCell cell={row.x} heading="X sentiment" />
            <section data-rni-combined-state={row.combined.state}>
              <strong>Combined summary</strong>
              <p>{label(row.combined.state)}</p>
              <p>{row.combined.summary}</p>
            </section>
          </article>
        ))}
      </div>
    </main>
  );
}
