/**
 * F17 — the Architecture Explorer. A Server Component: the manifest, the public-safe projection
 * and every worked example are read on the server and rendered as markup, mirroring F05's
 * `InspectorPage` — no database client and no provider identity ever reaches the browser.
 *
 * Every value on this page traces to one of three places, and never to a literal in this file:
 * `services/architecture/manifest.ts` (topology — imported constants, not hand-typed strings),
 * `services/architecture/projection.ts` (the public-safe live config read), or
 * `services/architecture/catalogue.ts` (the registry plus a real, persisted artifact per method).
 */
import { Tabs, type TabDefinition } from '@/ui/architecture/Tabs';
import { PipelineWalkthrough } from '@/ui/architecture/PipelineWalkthrough';
import {
  PovTargetTab,
  ModelsTab,
  AssumptionsTab,
  GlossaryTab,
  OpportunitiesTab,
  ActiveConfigurationPanel,
} from '@/ui/architecture/Panels';
import { CatalogueBrowser } from '@/ui/architecture/CatalogueBrowser';
import type { FormulaCardProps } from '@/ui/architecture/FormulaCard';
import { loadArchitectureView, type ArchitectureView } from '@/services/architecture/view';

function Notice(props: { readonly state: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-8" data-route="/architecture" data-state={props.state}>
      <h1 className="text-2xl font-semibold">{props.title}</h1>
      <div className="mt-3 text-sm text-neutral-700">{props.children}</div>
    </main>
  );
}

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

export async function ArchitecturePage() {
  let view: ArchitectureView;
  try {
    view = await loadArchitectureView();
  } catch (error) {
    console.error('ArchitecturePage: loadArchitectureView failed', error);
    return (
      <Notice state="error" title="Architecture Explorer — could not load">
        <p>
          Loading the live configuration and worked examples failed. This is a fault in
          retrieving the record, not an absent one — the failure has been logged. The manifest
          topology below does not depend on this and would normally still render; a page-level
          failure here means the fault happened before rendering began.
        </p>
      </Notice>
    );
  }

  const { manifest } = view;

  const tabs: TabDefinition[] = [
    {
      id: 'how-it-works',
      label: 'How it works',
      panel: (
        <div data-architecture-tab="how-it-works">
          <p className="text-sm text-neutral-700">
            From a post on a source this product watches to a number you can click through to its
            exact inputs. Every stage below is real: it either names a live job or provider, or
            describes the code path a value passes through before it is ever displayed.
          </p>
          <div className="mt-4">
            <PipelineWalkthrough stages={manifest.pipeline} />
          </div>
        </div>
      ),
    },
    {
      id: 'pov-target',
      label: 'PoV vs. Target',
      panel: (
        <div>
          <PovTargetTab povItems={manifest.povComponents} targetItems={manifest.targetComponents} />
          {view.databaseAvailable && view.projection !== null ? (
            <ActiveConfigurationPanel
              configVersionId={view.projection.configVersion?.id ?? null}
              universeSize={view.projection.universeVersion?.selectedCount ?? null}
              settings={view.projection.settings}
            />
          ) : (
            <p className="mt-6 text-sm text-neutral-700" data-state="fixture">
              This surface is running with no database configured, so the active-configuration
              panel cannot be read. The PoV/Target split above does not depend on a database and
              renders in full regardless.
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'formulas',
      label: 'Formulas',
      panel:
        view.databaseAvailable ? (
          <CatalogueBrowser entries={toCatalogueCardProps(view)} />
        ) : (
          <p className="text-sm text-neutral-700" data-state="fixture">
            This surface is running with no database configured, so no worked example can be
            computed or persisted. Nothing is being hidden or estimated — there is no artifact to
            read or write.
          </p>
        ),
    },
    {
      id: 'models',
      label: 'Models',
      panel: (
        <ModelsTab
          tasks={manifest.modelTasks}
          routes={view.projection?.modelRoutes ?? []}
          scorerIds={manifest.scorerIdentityVocabulary}
        />
      ),
    },
    {
      id: 'assumptions',
      label: 'Assumptions',
      panel: (
        <AssumptionsTab
          noBacktestStatement={manifest.noBacktestStatement}
          methods={view.catalogue.map((entry) => ({
            methodId: entry.methodId,
            version: entry.version,
            officialAssumptions: entry.officialAssumptions,
            limitations: entry.limitations,
          }))}
        />
      ),
    },
    {
      id: 'opportunities',
      label: 'Opportunities',
      panel: <OpportunitiesTab opportunities={manifest.opportunities} />,
    },
    {
      id: 'glossary',
      label: 'Glossary',
      panel: <GlossaryTab terms={manifest.glossary} />,
    },
  ];

  return (
    <main className="mx-auto max-w-5xl p-8" data-route="/architecture" data-state={view.databaseAvailable ? 'ready' : 'fixture'}>
      <p className="text-xs uppercase tracking-wide text-neutral-500">Architecture Explorer</p>
      <h1 className="mt-2 text-2xl font-semibold">How this product actually works</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Manifest version {manifest.manifestVersion}. Topology and formulas are read from the same
        registries the application runs on — never described separately from them.
      </p>

      <div className="mt-6">
        <Tabs tabs={tabs} aria-label="Architecture Explorer sections" />
      </div>
    </main>
  );
}
