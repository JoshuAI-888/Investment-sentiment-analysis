/**
 * F17 §4.5 — the dedicated calculation catalogue route. The same data the Architecture
 * Explorer's Formulas tab renders (`services/architecture/view.ts`), given its own full-width
 * page and a permalink — useful when a reader arrives here directly (e.g. from a search engine
 * or a link in the Inspector) rather than through `/architecture`.
 */
import { CatalogueBrowser } from '@/ui/architecture/CatalogueBrowser';
import type { FormulaCardProps } from '@/ui/architecture/FormulaCard';
import { loadArchitectureView, type ArchitectureView } from '@/services/architecture/view';

function toCatalogueCardProps(view: ArchitectureView): readonly FormulaCardProps[] {
  return view.catalogue.map((entry) => ({
    methodId: entry.methodId,
    version: entry.version,
    title: entry.title,
    subjectKind: entry.subjectKind,
    symbolicFormula: entry.symbolicFormula,
    officialAssumptions: entry.officialAssumptions,
    eligibilityRules: entry.eligibilityRules,
    limitations: entry.limitations,
    failureBehaviour: entry.failureBehaviour,
    tierD4Record: entry.tierD4Record,
    isLatestVersion: entry.isLatestVersion,
    example: entry.example,
  }));
}

export async function CataloguePage() {
  let view: ArchitectureView;
  try {
    view = await loadArchitectureView();
  } catch (error) {
    console.error('CataloguePage: loadArchitectureView failed', error);
    return (
      <main className="mx-auto max-w-5xl p-8" data-route="/architecture/calculations" data-state="error">
        <h1 className="text-2xl font-semibold">Calculation catalogue — could not load</h1>
        <p className="mt-3 text-sm text-neutral-700">
          Loading the registry and worked examples failed. This is a fault in retrieving the
          record, not an absent one — the failure has been logged.
        </p>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-5xl p-8"
      data-route="/architecture/calculations"
      data-state={view.databaseAvailable ? 'ready' : 'fixture'}
    >
      <p className="text-xs uppercase tracking-wide text-neutral-500">Architecture Explorer</p>
      <h1 className="mt-2 text-2xl font-semibold">Calculation catalogue</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Every registered method (analytics/registry.ts), with a worked example computed through
        the production calculation library and linked to a real, persisted artifact.
      </p>

      <div className="mt-6">
        {view.databaseAvailable ? (
          <CatalogueBrowser entries={toCatalogueCardProps(view)} />
        ) : (
          <p className="text-sm text-neutral-700" data-state="fixture">
            This surface is running with no database configured, so no worked example can be
            computed or persisted. Nothing is being hidden or estimated — there is no artifact to
            read or write.
          </p>
        )}
      </div>
    </main>
  );
}
