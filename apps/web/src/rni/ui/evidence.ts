import type { RniCitation, RniReadService, RniSourceItem } from '@/rni/contracts';

export type CitationEvidence = Readonly<{
  citation: RniCitation;
  source: RniSourceItem;
}>;

export type CitationEvidenceById = Readonly<Record<string, CitationEvidence>>;

/**
 * Resolve displayable evidence only through the frozen citation → source chain.
 * A citation identifier is never treated as a source-item identifier.
 */
export async function resolveCitationEvidence(
  service: RniReadService,
  citationIds: readonly string[],
): Promise<CitationEvidenceById> {
  const evidence = await Promise.all(
    [...new Set(citationIds)].map(async (citationId) => {
      const citation = await service.getCitation(citationId);
      const source = await service.getEvidence(citation.sourceItemId);
      if (
        citation.platform !== source.platform ||
        citation.url !== source.originalUrl ||
        !source.boundedContent.includes(citation.evidenceText)
      ) {
        throw new Error(
          `RNI citation ${citation.id} does not resolve to compatible bounded evidence`,
        );
      }
      return [citation.id, { citation, source }] as const;
    }),
  );

  return Object.fromEntries(evidence);
}
