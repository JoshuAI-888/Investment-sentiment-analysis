import type {
  RniSecurityDetail,
  RniSecurityDetailDimension,
  RniSecurityDetailPlatform,
} from '@/rni/contracts';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (character) => character.toUpperCase());
}

function CitationLinks({ citationIds }: Readonly<{ citationIds: readonly string[] }>) {
  return (
    <p>
      {citationIds.map((citationId, index) => (
        <a
          key={citationId}
          href={`#citation-${citationId}`}
          data-rni-citation-id={citationId}
          className="mr-2 underline focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          Citation {index + 1}
        </a>
      ))}
    </p>
  );
}

function Dimension({ dimension }: Readonly<{ dimension: RniSecurityDetailDimension }>) {
  return (
    <li data-rni-dimension={dimension.dimension} className="space-y-1 border-t pt-3">
      <h4 className="font-medium">{label(dimension.dimension)}</h4>
      <p>
        {label(dimension.stance)} · Score: {dimension.score ?? 'Insufficient evidence'}
      </p>
      <p>{dimension.rationale}</p>
      <CitationLinks citationIds={dimension.citationIds} />
    </li>
  );
}

function PlatformDimensions({
  platform,
  heading,
}: Readonly<{ platform: RniSecurityDetailPlatform; heading: string }>) {
  return (
    <section data-rni-detail-platform={platform.platform} className="space-y-3 border p-4">
      <h3 className="text-xl font-semibold">{heading}</h3>
      <p>
        {label(platform.status)} · {platform.eligibleSourceCount} eligible sources
      </p>
      <p>{platform.summary}</p>
      <CitationLinks citationIds={platform.citationIds} />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Freshness</dt>
          <dd>{platform.dataThroughAt ?? 'Not available'}</dd>
        </div>
        <div>
          <dt className="font-medium">Confidence</dt>
          <dd>{platform.confidence ?? 'Insufficient evidence'}</dd>
        </div>
      </dl>
      <p className="text-sm">{platform.coverageDisclosure}</p>
      <ol className="space-y-3" aria-label={`${heading} dimensions`}>
        {platform.dimensions.map((dimension) => (
          <Dimension key={dimension.dimension} dimension={dimension} />
        ))}
      </ol>
    </section>
  );
}

export function SecurityDetail({ detail }: Readonly<{ detail: RniSecurityDetail }>) {
  return (
    <main data-rni-security-detail className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
      <header>
        <p className="text-sm">Retail Narrative Intelligence</p>
        <h1 className="text-3xl font-semibold">
          {detail.security.ticker} — {detail.security.companyName}
        </h1>
        <p>{detail.security.exchange}</p>
        <p>
          Each platform reports all four dimensions independently; no platform evidence is pooled.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformDimensions platform={detail.reddit} heading="Reddit sentiment" />
        <PlatformDimensions platform={detail.x} heading="X sentiment" />
      </div>
    </main>
  );
}
