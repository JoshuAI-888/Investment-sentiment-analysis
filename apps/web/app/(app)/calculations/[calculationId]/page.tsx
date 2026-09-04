import { parsePointIndex } from '@/ui/inspector-links';
import { InspectorPage } from './InspectorPage';

/**
 * The canonical Inspector page (F05 §4.8). A Server Component: the artifact, the registry entry
 * and the last validation outcome are read on the server and rendered as markup, so no database
 * client and no provider identity reaches the browser.
 *
 * Reaching this URL from inside the app renders the intercepted drawer instead; a reload or a
 * hard navigation lands here. Both render the same component.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ calculationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { calculationId } = await params;
  const query = await searchParams;

  return (
    // `data-route` marks the canonical page and is deliberately absent from the intercepted
    // drawer: it is how `tests/e2e/routes.spec.ts` tells a hard load apart from an interception,
    // which is the one behaviour of this route pair that a reader would never notice was broken.
    <main data-route={`/calculations/${calculationId}`}>
      <InspectorPage calculationId={calculationId} pointIndex={parsePointIndex(query['point'])} />
    </main>
  );
}
