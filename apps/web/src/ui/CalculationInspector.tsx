/**
 * The Calculation Inspector's seven sections (F05 §4.8).
 *
 * **Zero method names appear in this file, and that is the reviewer's check** (§8): every
 * section reads the registry entry and the artifact it is handed. A section that special-cased
 * `attention.rank_change` would render nothing for the next method, and the pressure to add
 * that special case is exactly what §8 predicts.
 *
 * `ui/` may import only `contracts/` (`02-ARCHITECTURE-CONTRACTS.md` §3), so the view type is
 * declared here and assembled by the page. That is the intended shape for a component — data
 * arrives as props — and it makes the page the compile-time check that the service's output and
 * this component's expectations still agree.
 */
import { InspectableMetric, type MetricEligibility } from './InspectableMetric';

export type InspectorStep = {
  readonly index: number;
  readonly key: string;
  readonly label: string;
  readonly expression: string;
  readonly substituted: string;
  readonly exactValue: string;
  readonly displayValue: string;
  readonly unit: string;
  readonly status: string;
};

export type InspectorInput = {
  readonly key: string;
  readonly value: string;
  readonly unit: string | null;
  readonly dataType: string;
  readonly source: string;
  readonly provider: string | null;
  readonly providerField: string | null;
  readonly sourceUrl: string | null;
  readonly observedAt: string | null;
  readonly availableAt: string | null;
  readonly freshness: string;
  readonly quality: string;
  /** Whether a rights-sanitized fragment exists for an entitled reader (F14). */
  readonly rawPayloadId: string | null;
};

export type InspectorAssumption = {
  readonly key: string;
  readonly value: string;
  readonly officialValue: string;
  readonly unit: string;
  readonly source: string;
  readonly min: string | null;
  readonly max: string | null;
  readonly editable: boolean;
};

export type InspectorPoint = {
  readonly pointIndex: number;
  readonly observationKey: string;
  readonly exactValue: string;
  readonly displayValue: string;
};

export type InspectorValidation = {
  readonly status: string;
  readonly outcome: string;
  readonly triggerType: string;
  readonly requestedBy: string;
  readonly startedAt: string;
  readonly explanation: string;
} | null;

export type InspectorView = {
  readonly calculationId: string;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly title: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly subjectLabel: string | null;
  readonly asOf: string;
  readonly computedAt: string;
  readonly scenario: string;
  readonly configVersion: string;
  readonly eligibility: MetricEligibility;
  readonly eligibilityRules: readonly string[];
  readonly abstentionReason: string | null;
  readonly exact: string | null;
  readonly display: string | null;
  readonly unit: string;
  readonly roundingRule: string;
  readonly roundingRuleDescription: string;
  readonly symbolicFormula: string;
  readonly inputs: readonly InspectorInput[];
  readonly assumptions: readonly InspectorAssumption[];
  readonly steps: readonly InspectorStep[];
  readonly points: readonly InspectorPoint[] | null;
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
  readonly inputHash: string;
  readonly resultHash: string;
  readonly retentionStored: string;
  readonly retentionEffective: string;
  readonly retentionReasons: readonly string[];
  readonly validation: InspectorValidation;
  /** Rendered under §7 in place of the button while there is no session to authorize it. */
  readonly validationActionNote: string;
  readonly highlightPointIndex: number | null;
};

function Section(props: {
  readonly n: number;
  readonly id: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mt-8" data-inspector-section={props.id}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {props.n}. {props.title}
      </h2>
      <div className="mt-2 text-sm">{props.children}</div>
    </section>
  );
}

function Field(props: { readonly name: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-0.5">
      <span className="w-40 shrink-0 text-neutral-500">{props.name}</span>
      <span className="font-mono">{props.children}</span>
    </div>
  );
}

export function CalculationInspector({ view }: { readonly view: InspectorView }) {
  return (
    <article
      className="mx-auto max-w-3xl p-8"
      data-calculation-inspector=""
      data-calculation-id={view.calculationId}
      data-method={view.methodId}
    >
      <h1 className="text-2xl font-semibold">{view.title}</h1>
      <p className="mt-1 font-mono text-xs text-neutral-500">
        {view.methodId} v{view.methodVersion} · {view.calculationId}
      </p>

      {/* 1 ─ Summary */}
      <Section n={1} id="summary" title="Summary">
        <InspectableMetric
          metricId={view.methodId}
          calculationId={view.calculationId}
          label={view.title}
          display={view.display}
          unit={view.unit}
          roundingRule={view.roundingRule}
          eligibility={view.eligibility}
          reason={view.abstentionReason}
          asOf={view.asOf}
        />
        <div className="mt-3">
          <Field name="Subject">
            {view.subjectLabel ?? view.subjectId} ({view.subjectKind})
          </Field>
          <Field name="As of">{view.asOf}</Field>
          <Field name="Computed at">{view.computedAt}</Field>
          <Field name="Scenario">{view.scenario}</Field>
          <Field name="Config version">{view.configVersion}</Field>
          <Field name="Eligibility">{view.eligibility}</Field>
          <Field name="Exact value">{view.exact ?? '—'}</Field>
          <Field name="Retention">
            {view.retentionEffective}
            {view.retentionEffective === view.retentionStored
              ? ''
              : ` (stored as ${view.retentionStored})`}
          </Field>
        </div>

        {view.abstentionReason === null ? null : (
          <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3" data-abstention="">
            {view.abstentionReason}
          </p>
        )}

        {view.retentionReasons.length === 0 ? null : (
          <ul className="mt-3 list-disc pl-5 text-neutral-700" data-retention-reasons="">
            {view.retentionReasons.map((reason) => (
              <li key={reason}>Kept permanently because of {reason}</li>
            ))}
          </ul>
        )}

        {view.warnings.length === 0 ? null : (
          <ul className="mt-3 list-disc pl-5 text-amber-800" data-warnings="">
            {view.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        <ul className="mt-3 list-disc pl-5 text-neutral-600" data-eligibility-rules="">
          {view.eligibilityRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Section>

      {/* 2 ─ Formula */}
      <Section n={2} id="formula" title="Formula">
        <pre className="overflow-x-auto rounded bg-neutral-100 p-3 font-mono text-xs">
          {view.symbolicFormula}
        </pre>
        {view.steps.length === 0 ? (
          <p className="mt-2 text-neutral-600">
            The computation stopped before any step ran, so there is nothing to substitute.
          </p>
        ) : (
          <pre className="mt-2 overflow-x-auto rounded bg-neutral-100 p-3 font-mono text-xs">
            {view.steps.map((step) => `${step.substituted} = ${step.exactValue}`).join('\n')}
          </pre>
        )}
      </Section>

      {/* 3 ─ Inputs and provenance */}
      <Section n={3} id="inputs" title="Inputs and provenance">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-2">Input</th>
              <th className="py-1 pr-2">Value</th>
              <th className="py-1 pr-2">Source</th>
              <th className="py-1 pr-2">Provider field</th>
              <th className="py-1 pr-2">Observed</th>
              <th className="py-1 pr-2">Available</th>
              <th className="py-1 pr-2">Freshness</th>
            </tr>
          </thead>
          <tbody>
            {view.inputs.map((input) => (
              <tr key={input.key} className="border-b" data-input-key={input.key}>
                <td className="py-1 pr-2">{input.key}</td>
                <td className="py-1 pr-2">
                  {input.value}
                  {input.unit === null || input.unit === '' ? '' : ` ${input.unit}`}
                </td>
                <td className="py-1 pr-2">
                  {input.sourceUrl === null ? (
                    input.source
                  ) : (
                    <a className="underline decoration-dotted" href={input.sourceUrl}>
                      {input.source}
                    </a>
                  )}
                </td>
                <td className="py-1 pr-2">{input.providerField ?? '—'}</td>
                <td className="py-1 pr-2">{input.observedAt ?? '—'}</td>
                <td className="py-1 pr-2">{input.availableAt ?? '—'}</td>
                <td className="py-1 pr-2">
                  {input.freshness} / {input.quality}
                  {input.rawPayloadId === null ? null : (
                    <a
                      className="ml-2 underline decoration-dotted"
                      href={`/api/calculations/${view.calculationId}/inputs/${input.key}/raw`}
                    >
                      as retrieved
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 4 ─ Trace */}
      <Section n={4} id="trace" title="Trace">
        {view.steps.length === 0 ? (
          <p className="text-neutral-600">
            No steps ran. The reason is in the Summary above, and it is the whole of what happened.
          </p>
        ) : (
          <ol className="space-y-2">
            {view.steps.map((step) => (
              <li key={step.key} className="rounded border p-2" data-step-key={step.key}>
                <div className="text-neutral-700">
                  {step.index + 1}. {step.label}{' '}
                  {step.status === 'applied' ? null : (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-xs">{step.status}</span>
                  )}
                </div>
                <div className="mt-1 font-mono text-xs text-neutral-500">{step.expression}</div>
                <div className="font-mono text-xs">{step.substituted}</div>
                <div className="font-mono text-xs">
                  = {step.exactValue} {step.unit}
                </div>
              </li>
            ))}
          </ol>
        )}

        {view.points === null ? null : (
          <table className="mt-4 w-full border-collapse text-left font-mono text-xs" data-points="">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Observation</th>
                <th className="py-1 pr-2">Exact</th>
                <th className="py-1 pr-2">Displayed</th>
              </tr>
            </thead>
            <tbody>
              {view.points.map((point) => (
                <tr
                  key={point.pointIndex}
                  className={
                    point.pointIndex === view.highlightPointIndex ? 'border-b bg-amber-50' : 'border-b'
                  }
                  data-point-index={point.pointIndex}
                >
                  <td className="py-1 pr-2">{point.pointIndex}</td>
                  <td className="py-1 pr-2">{point.observationKey}</td>
                  <td className="py-1 pr-2">{point.exactValue}</td>
                  <td className="py-1 pr-2">{point.displayValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* 5 ─ Precision */}
      <Section n={5} id="precision" title="Precision">
        <Field name="Exact">{view.exact ?? '—'}</Field>
        <Field name="Displayed">{view.display ?? '—'}</Field>
        <Field name="Rounding rule">
          {view.roundingRule} — {view.roundingRuleDescription}
        </Field>
        <Field name="Input hash">{view.inputHash}</Field>
        <Field name="Result hash">{view.resultHash}</Field>
        <p className="mt-2 text-neutral-600">
          The exact value is what was computed; the displayed value is what the named rounding rule
          produced from it. They are stored separately so the difference between them is visible
          rather than assumed.
        </p>
      </Section>

      {/* 6 ─ Assumptions */}
      <Section n={6} id="assumptions" title="Assumptions">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-2">Key</th>
              <th className="py-1 pr-2">Used</th>
              <th className="py-1 pr-2">Official</th>
              <th className="py-1 pr-2">Bounds</th>
              <th className="py-1 pr-2">Set by</th>
            </tr>
          </thead>
          <tbody>
            {view.assumptions.map((assumption) => (
              <tr key={assumption.key} className="border-b" data-assumption-key={assumption.key}>
                <td className="py-1 pr-2">{assumption.key}</td>
                <td className="py-1 pr-2">
                  {assumption.value}
                  {assumption.unit === '' ? '' : ` ${assumption.unit}`}
                </td>
                <td className="py-1 pr-2">{assumption.officialValue}</td>
                <td className="py-1 pr-2">
                  {assumption.editable && assumption.min !== null && assumption.max !== null
                    ? `${assumption.min} to ${assumption.max}`
                    : 'fixed'}
                </td>
                <td className="py-1 pr-2">{assumption.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-700" data-limitations="">
          {view.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </Section>

      {/* 7 ─ Validation */}
      <Section n={7} id="validation" title="Validation">
        {view.validation === null ? (
          <p className="text-neutral-700">
            This calculation has not been validated yet. Validation re-runs the method against the
            inputs recorded above and compares the result — it is an action someone takes, not
            something that happens when this page opens.
          </p>
        ) : (
          <div data-validation-outcome={view.validation.outcome}>
            <Field name="Outcome">{view.validation.outcome}</Field>
            <Field name="Recorded">{view.validation.status}</Field>
            <Field name="Requested by">{view.validation.requestedBy}</Field>
            <Field name="Trigger">{view.validation.triggerType}</Field>
            <Field name="When">{view.validation.startedAt}</Field>
            <p className="mt-2 text-neutral-700">{view.validation.explanation}</p>
          </div>
        )}

        {/*
         * Points at the real target shape for this action — its own route, POST, not the
         * unrelated export route a GET form was pointed at before (lane-review finding 7). Still
         * `disabled`: F02 has not landed, there is no identity to authorize against, and
         * `runReplay` cannot enforce authorization it has nothing to check (see its own doc
         * comment). The route below does not exist yet either — naming it correctly now is what
         * stops it silently reaching the wrong endpoint the day someone removes `disabled`.
         */}
        <form action={`/api/calculations/${view.calculationId}/validate`} method="post" className="mt-3">
          <button
            type="submit"
            disabled
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            data-action="run-validation"
          >
            Run a validation
          </button>
          <p className="mt-1 text-xs text-neutral-600">{view.validationActionNote}</p>
        </form>
      </Section>
    </article>
  );
}
