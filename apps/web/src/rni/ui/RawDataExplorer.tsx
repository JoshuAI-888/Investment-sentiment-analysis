import type { RniCombinedSummary, RniRadarSecurity } from '@/rni/contracts';
import type { CitationEvidenceById } from './evidence';

function sectionId(heading: string) {
  return heading.toLowerCase().replaceAll(' ', '-');
}

export function RawDataExplorer({
  security,
  summary,
  evidenceByCitationId,
}: Readonly<{
  security: RniRadarSecurity;
  summary: RniCombinedSummary;
  evidenceByCitationId: CitationEvidenceById;
}>) {
  return (
    <main data-rni-raw-explorer className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-sm">Retail Narrative Intelligence</p>
        <h1 className="text-3xl font-semibold">
          Raw data and lineage — {security.ticker} — {security.companyName}
        </h1>
        <p>{security.exchange}</p>
        <p>Only citation-linked, bounded source records are available in this explorer.</p>
      </header>

      <section aria-labelledby="summary-lineage-heading" className="space-y-4">
        <h2 id="summary-lineage-heading" className="text-2xl font-semibold">
          Summary-to-source lineage
        </h2>
        {summary.sections.map((section) => (
          <article
            key={section.heading}
            data-rni-summary-section={sectionId(section.heading)}
            className="space-y-2 border p-4"
          >
            <h3 className="text-xl font-semibold">{section.heading}</h3>
            <p>{section.text}</p>
            {section.citationIds.length === 0 ? (
              <p>No publishable source record is available for this summary section.</p>
            ) : (
              <ul>
                {section.citationIds.map((citationId, index) => {
                  const evidence = evidenceByCitationId[citationId];
                  if (!evidence) throw new Error(`Missing evidence for RNI citation ${citationId}`);
                  return (
                    <li key={citationId}>
                      <a
                        href={`#source-${evidence.source.id}`}
                        data-rni-lineage-citation-id={citationId}
                        data-rni-lineage-source-item-id={evidence.source.id}
                        className="underline focus:outline-none focus:ring-2 focus:ring-blue-700"
                      >
                        View source {index + 1} ({evidence.citation.platform})
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        ))}
      </section>

      <section aria-labelledby="source-records-heading" className="space-y-4">
        <h2 id="source-records-heading" className="text-2xl font-semibold">
          Bounded source records
        </h2>
        {Object.values(evidenceByCitationId).map(({ citation, source }) => (
          <article
            key={citation.id}
            id={`source-${source.id}`}
            data-rni-source-record={source.id}
            className="space-y-2 border p-4"
          >
            <h3 className="text-xl font-semibold">Source record</h3>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Platform</dt>
                <dd>{source.platform === 'x' ? 'X' : 'Reddit'}</dd>
              </div>
              <div>
                <dt className="font-medium">Source item ID</dt>
                <dd>{source.id}</dd>
              </div>
              <div>
                <dt className="font-medium">Source kind</dt>
                <dd>{source.sourceKind}</dd>
              </div>
              <div>
                <dt className="font-medium">Capture mode</dt>
                <dd>{source.captureMode}</dd>
              </div>
            </dl>
            <a
              href={source.originalUrl}
              target="_blank"
              rel="noreferrer"
              className="underline focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              Open original source
            </a>
            <section aria-label="Bounded content">
              <h4 className="font-medium">Bounded content</h4>
              <blockquote className="border-l-2 pl-3">{source.boundedContent}</blockquote>
            </section>
          </article>
        ))}
      </section>
    </main>
  );
}
