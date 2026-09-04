import { parsePointIndex } from '@/ui/inspector-links';
import { InspectorPage } from '../../../calculations/[calculationId]/InspectorPage';

/**
 * The intercepted route. Reaching /calculations/{id} from inside the app renders it here, in
 * the drawer slot, over whatever the reader was looking at; a hard navigation or a reload
 * falls through to the full page. This is the fiddliest piece of routing in the product,
 * which is exactly why F01 §4.6 built it before there was anything to put in it.
 *
 * It renders the **same component** as the full page. Two implementations would agree on the day
 * they were written and drift by the second change — and the thing they would drift on is what
 * the reader is told about a number, which is the one thing this feature exists to protect.
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
    <aside data-slot="calculationDrawer" data-intercepted="">
      <InspectorPage
        calculationId={calculationId}
        pointIndex={parsePointIndex(query['point'])}
        intercepted
      />
    </aside>
  );
}
