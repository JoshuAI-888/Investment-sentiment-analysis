/**
 * The canonical Inspector, shared by the full page and the intercepted drawer (F05 §4.8).
 *
 * One component behind both routes, because §5's E2E case is that the drawer and the full page
 * show the same artifact — two implementations would satisfy that on the day they were written
 * and diverge afterwards.
 *
 * Four states, and the difference between them is the point:
 *
 * - **no database configured** — the surface is running without one, so nothing can be loaded.
 *   Renders `data-state="fixture"`, which is true rather than convenient: F01's route gate
 *   exercises this route with no database, and a page that invented an artifact to satisfy it
 *   would be exactly the "plausible-looking empty state" the review checklist asks about.
 * - **a real fault, with a database that IS configured** — a dropped connection, a malformed
 *   stored row, anything else `loadInspectorView` can throw. Rendering this the same as "no
 *   database configured" would be exactly the false reassurance lane-review found: a reader
 *   told "nothing is being hidden" while a real fault is, in fact, being hidden.
 * - **no such artifact** — a distinct state, said plainly.
 * - **an artifact** — the seven sections, whatever its method and whatever its eligibility.
 */
import { CalculationInspector, type InspectorView } from '@/ui/CalculationInspector';
import { loadInspectorView } from '@/services/inspector';

export type InspectorPageProps = {
  readonly calculationId: string;
  readonly pointIndex: number | null;
  readonly intercepted?: boolean;
};

function Notice(props: {
  readonly state: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl p-8" data-state={props.state}>
      <h1 className="text-2xl font-semibold">{props.title}</h1>
      <div className="mt-3 text-sm text-neutral-700">{props.children}</div>
    </div>
  );
}

export async function InspectorPage({ calculationId, pointIndex }: InspectorPageProps) {
  // Checked directly, not inferred from what loadInspectorView happens to throw — matching an
  // error message is brittle, and conflates "no database configured" with any other failure a
  // configured database can still produce (lane-review finding 4).
  if (!process.env['DATABASE_URL']) {
    return (
      <Notice state="fixture" title="Calculation Inspector">
        <p>
          This surface is running with no database configured, so no calculation can be loaded.
          Nothing is being hidden and nothing is being estimated — there is no record to read.
        </p>
        <p className="mt-2 font-mono text-xs text-neutral-500">{calculationId}</p>
      </Notice>
    );
  }

  let view: InspectorView | null;

  try {
    view = await loadInspectorView(calculationId, { pointIndex });
  } catch (error) {
    // A real fault with a database that IS configured — a dropped connection, a malformed
    // stored row, anything else this can throw. Logged server-side so it is diagnosable;
    // rendered as an honest, distinct failure rather than the "nothing is being hidden" notice
    // above, which would be false here.
    console.error('InspectorPage: loadInspectorView failed for', calculationId, error);
    return (
      <Notice state="error" title="Calculation Inspector — could not load">
        <p>
          Loading this calculation failed. This is a fault in retrieving the record, not an
          absent one and not an unconfigured surface — the failure has been logged.
        </p>
        <p className="mt-2 font-mono text-xs text-neutral-500">{calculationId}</p>
      </Notice>
    );
  }

  if (view === null) {
    return (
      <Notice state="not-found" title="No such calculation">
        <p>
          There is no stored calculation with this identifier. Records are kept for 90 days unless
          something references them — a claim, a share, or a reported issue — in which case they
          are kept permanently. An identifier that once worked and no longer does is most likely
          past that window.
        </p>
        <p className="mt-2 font-mono text-xs text-neutral-500">{calculationId}</p>
      </Notice>
    );
  }

  return <CalculationInspector view={view} />;
}
