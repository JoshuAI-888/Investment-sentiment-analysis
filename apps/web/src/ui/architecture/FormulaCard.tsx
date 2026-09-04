/**
 * F17 §4.3/§4.5 — one registered method, rendered from a catalogue entry: symbolic form, official
 * assumptions, eligibility rules, limitations, and the worked example, which is rendered through
 * `InspectableMetric` — the same component every other product surface uses, so this card
 * structurally cannot render a number without a `calculationId` resolving to a real artifact
 * (F05 §4.8, product invariant §6.2).
 */
import { InspectableMetric } from '../InspectableMetric';

export type FormulaCardProps = {
  readonly methodId: string;
  readonly version: string;
  readonly title: string;
  readonly subjectKind: string;
  readonly symbolicFormula: string;
  readonly officialAssumptions: Readonly<Record<string, string>>;
  readonly eligibilityRules: readonly string[];
  readonly limitations: readonly string[];
  readonly failureBehaviour: string;
  readonly tierD4Record: string | null;
  readonly isLatestVersion: boolean;
  readonly example: {
    readonly calculationId: string;
    readonly eligibility: 'ok' | 'insufficient_data' | 'not_applicable' | 'stale';
    readonly display: string | null;
    readonly unit: string;
    readonly roundingRule: string;
    readonly abstentionReason: string | null;
  };
};

export function FormulaCard(props: FormulaCardProps) {
  return (
    <article
      data-catalogue-entry={`${props.methodId}@${props.version}`}
      className="rounded-lg border border-neutral-200 p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {/* h2: every catalogue entry sits directly under the page's own h1, with nothing at h2
         * (there is no intervening section heading) — axe's `heading-order` rule catches a jump
         * straight to h3. */}
        <h2 className="text-base font-semibold">{props.title}</h2>
        <span className="font-mono text-xs text-neutral-500">
          {props.methodId}@{props.version}
          {props.isLatestVersion ? null : ' (superseded)'}
        </span>
      </header>

      <p className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
        Subject: {props.subjectKind} · Failure mode: {props.failureBehaviour}
      </p>

      {
        /* `tabIndex={0}` — WCAG 2.1.1: a horizontally-scrollable region (a long symbolic formula)
         * must itself be reachable and operable by keyboard, not only by a pointer drag. Axe's
         * `scrollable-region-focusable` rule catches the omission. No `role="region"`: two
         * entries can share an identical title (a superseded version beside its successor), and
         * a landmark role requires a *unique* accessible name (axe's `landmark-unique`) — a plain
         * focusable `<pre>` needs neither a role nor a label to satisfy the keyboard rule. */
      }
      <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs" tabIndex={0}>
        {props.symbolicFormula}
      </pre>

      {Object.keys(props.officialAssumptions).length === 0 ? null : (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Official assumptions
          </h3>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {Object.entries(props.officialAssumptions).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-neutral-600">{key}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {props.eligibilityRules.length === 0 ? null : (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Eligibility</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-neutral-700">
            {props.eligibilityRules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      )}

      {props.limitations.length === 0 ? null : (
        <div className="mt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Limitations</h3>
          <ul className="mt-1 list-inside list-disc text-sm text-neutral-700">
            {props.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500" data-tier-d4={props.tierD4Record !== null}>
        {props.tierD4Record === null
          ? 'No Tier D4 validation record — predictive language is not licensed for this metric (D-09).'
          : `Tier D4 record: ${props.tierD4Record}`}
      </p>

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <InspectableMetric
          metricId={props.methodId}
          calculationId={props.example.calculationId}
          label="Worked example"
          display={props.example.display}
          unit={props.example.unit}
          roundingRule={props.example.roundingRule}
          eligibility={props.example.eligibility}
          reason={props.example.abstentionReason}
        />
      </div>
    </article>
  );
}
