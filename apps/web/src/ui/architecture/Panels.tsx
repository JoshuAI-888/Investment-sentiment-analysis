/**
 * F17 §4.3 — the remaining tab bodies: PoV/Target, Models, Assumptions, Glossary, Opportunities.
 *
 * Every one of these is a pure mapping from already-resolved plain data (the manifest topology
 * and the public-safe projection, both assembled server-side in
 * `services/architecture/view.ts`) to markup — nothing here reaches a repository or a service.
 * Consolidated into one file because each panel is a handful of lines; the doc comment on each
 * export is what a reader actually needs, not the file boundary.
 */

// ── PoV / Target ───────────────────────────────────────────────────────────────────────────────

export type ComponentEntry = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
};

export function ComponentList(props: { readonly heading: string; readonly items: readonly ComponentEntry[]; readonly tone: 'deployed' | 'target' }) {
  return (
    <section data-component-list={props.tone}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{props.heading}</h2>
      <ul className="mt-2 space-y-3">
        {props.items.map((item) => (
          <li key={item.id} className="rounded border border-neutral-200 p-3">
            <p className="text-sm font-medium">{item.label}</p>
            <p className="mt-1 text-sm text-neutral-700">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * F17 §4.3/§6: PoV and target must be unmistakably distinct. Rendered side by side with
 * different tone classes and an explicit label on each — never interleaved in one list where a
 * reader could mistake a target-only row for something running today.
 */
export function PovTargetTab(props: {
  readonly povItems: readonly ComponentEntry[];
  readonly targetItems: readonly ComponentEntry[];
}) {
  return (
    <div data-architecture-tab="pov-target" className="grid gap-6 md:grid-cols-2">
      <div className="rounded-lg border-2 border-emerald-600 bg-emerald-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
          Point of view — actually deployed today
        </p>
        <div className="mt-3">
          <ComponentList heading="Deployed components" items={props.povItems} tone="deployed" />
        </div>
      </div>
      <div className="rounded-lg border-2 border-dashed border-amber-600 bg-amber-50 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">
          Target — not built. Nothing on this side runs today.
        </p>
        <div className="mt-3">
          <ComponentList heading="Target-only components" items={props.targetItems} tone="target" />
        </div>
      </div>
    </div>
  );
}

// ── Models ─────────────────────────────────────────────────────────────────────────────────────

export type ModelTaskRow = {
  readonly task: string;
  readonly label: string;
  readonly description: string;
};

export type ModelRouteRow = {
  readonly task: string;
  readonly transport: string;
  readonly primaryProvider: string;
  readonly primaryModel: string;
  readonly modelRevision: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly enabled: boolean;
};

export function ModelsTab(props: {
  readonly tasks: readonly ModelTaskRow[];
  readonly routes: readonly ModelRouteRow[];
  readonly scorerIds: readonly string[];
}) {
  const routeByTask = new Map(props.routes.map((route) => [route.task, route]));
  return (
    <div data-architecture-tab="models">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">LLM task routes</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
              <th className="py-2 pr-4">Task</th>
              <th className="py-2 pr-4">Used for</th>
              <th className="py-2 pr-4">Active model</th>
              <th className="py-2 pr-4">Revision</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {props.tasks.map((task) => {
              const route = routeByTask.get(task.task);
              return (
                <tr key={task.task} className="border-b border-neutral-100" data-model-task={task.task}>
                  <td className="py-2 pr-4 font-mono text-xs">{task.task}</td>
                  <td className="py-2 pr-4 text-neutral-700">{task.description}</td>
                  <td className="py-2 pr-4">
                    {route === undefined ? (
                      <span className="text-neutral-500">No route configured for this environment yet</span>
                    ) : (
                      `${route.primaryProvider} / ${route.primaryModel}`
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{route?.modelRevision ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {route === undefined ? '—' : route.enabled ? 'Enabled' : 'Disabled'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Pinned scorer identity (D-13)
      </h2>
      <p className="mt-2 text-sm text-neutral-700">
        Stance classification never runs through the LLM task routes above — it runs through a
        separate, pinned scorer service (D-13), decoupled precisely so a historical series stays
        reproducible after a hosted model retires. The scorer identity vocabulary this product is
        built around:{' '}
        <span className="font-mono" data-scorer-identity-vocabulary="">
          {props.scorerIds.join(', ')}
        </span>
        .
      </p>
      <p className="mt-2 text-sm text-neutral-700">
        Every score carries its exact <span className="font-mono">scorer_id</span> and a{' '}
        <span className="font-mono">{'<hf-repo>@<40-hex-commit-sha>'}</span> revision, enforced at
        the scorer service&rsquo;s own boot — a tag or branch name is refused outright. This
        application has no query path yet over the scored-item store to show the currently
        observed revision here, and this page will not type one in as a stand-in for a real query
        (see the Opportunities tab).
      </p>
    </div>
  );
}

// ── Assumptions ────────────────────────────────────────────────────────────────────────────────

export type AssumptionMethodRow = {
  readonly methodId: string;
  readonly version: string;
  readonly officialAssumptions: Readonly<Record<string, string>>;
  readonly limitations: readonly string[];
};

export function AssumptionsTab(props: {
  readonly noBacktestStatement: string;
  readonly methods: readonly AssumptionMethodRow[];
}) {
  return (
    <div data-architecture-tab="assumptions">
      <div
        role="note"
        data-no-backtest-statement=""
        className="rounded-lg border-2 border-red-600 bg-red-50 p-4 text-sm font-medium text-red-900"
      >
        {props.noBacktestStatement}
      </div>

      <div className="mt-6 space-y-4">
        {props.methods.map((method) => (
          <details key={`${method.methodId}@${method.version}`} className="rounded border border-neutral-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {method.methodId}@{method.version}
            </summary>
            {Object.keys(method.officialAssumptions).length > 0 ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {Object.entries(method.officialAssumptions).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono text-neutral-600">{key}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <ul className="mt-2 list-inside list-disc text-sm text-neutral-700">
              {method.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

// ── Glossary ───────────────────────────────────────────────────────────────────────────────────

export function GlossaryTab(props: { readonly terms: readonly { readonly term: string; readonly definition: string }[] }) {
  return (
    <dl data-architecture-tab="glossary" className="space-y-3">
      {props.terms.map((entry) => (
        <div key={entry.term}>
          <dt className="text-sm font-semibold">{entry.term}</dt>
          <dd className="mt-0.5 text-sm text-neutral-700">{entry.definition}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Opportunities ──────────────────────────────────────────────────────────────────────────────

export type OpportunityRow = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly trigger: string;
};

export function OpportunitiesTab(props: { readonly opportunities: readonly OpportunityRow[] }) {
  return (
    <ul data-architecture-tab="opportunities" className="space-y-3">
      {props.opportunities.map((opportunity) => (
        <li key={opportunity.id} className="rounded border border-neutral-200 p-3">
          <p className="text-sm font-medium">{opportunity.label}</p>
          <p className="mt-1 text-sm text-neutral-700">{opportunity.description}</p>
          <p className="mt-1 text-xs text-neutral-500">Revisit when: {opportunity.trigger}</p>
        </li>
      ))}
    </ul>
  );
}

// ── Active configuration (part of PoV) ────────────────────────────────────────────────────────

export type PublicSettingRow = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly governanceClass: string;
  readonly value: unknown;
};

export function ActiveConfigurationPanel(props: {
  readonly configVersionId: string | null;
  readonly universeSize: number | null;
  readonly settings: readonly PublicSettingRow[];
}) {
  return (
    <section data-active-configuration="" className="mt-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Active configuration (public-safe projection)
      </h2>
      <p className="mt-1 text-sm text-neutral-700">
        {props.configVersionId === null
          ? 'No config version is active in this environment yet.'
          : `Config version ${props.configVersionId} is active.`}{' '}
        {props.universeSize === null ? 'Universe size unknown.' : `Universe: ${props.universeSize} symbols.`}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
              <th className="py-2 pr-4">Setting</th>
              <th className="py-2 pr-4">Description</th>
              <th className="py-2 pr-4">Value</th>
            </tr>
          </thead>
          <tbody>
            {props.settings.map((setting) => (
              <tr key={setting.key} className="border-b border-neutral-100" data-public-setting={setting.key}>
                <td className="py-2 pr-4 font-mono text-xs">{setting.label}</td>
                <td className="py-2 pr-4 text-neutral-700">{setting.description}</td>
                <td className="py-2 pr-4 tabular-nums">{String(setting.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
