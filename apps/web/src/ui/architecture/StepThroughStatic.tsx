/**
 * F17 §4.4's "complete static text alternative" — a plain, server-rendered ordered list of the
 * same pipeline stages the animated walkthrough steps through. This is what reaches first
 * meaningful paint; it never depends on the animated component's client JS having loaded, run,
 * or even shipped (a JS error in `StepThroughAnimated` leaves this fully readable).
 *
 * `ui/` may import only `contracts/` — this component receives already-resolved plain stage data
 * as props, the same shape `StepThroughAnimated` receives, so the two can never describe a
 * different pipeline by construction (both read from `manifest.ts`'s `PIPELINE` at the one call
 * site that builds the page).
 */
export type StaticStage = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly providers: readonly string[];
  readonly jobKeys: readonly string[];
};

export type StepThroughStaticProps = {
  readonly stages: readonly StaticStage[];
};

export function StepThroughStatic({ stages }: StepThroughStaticProps) {
  return (
    <ol data-step-through-static="" className="space-y-4">
      {stages.map((stage, index) => (
        <li key={stage.id} data-stage={stage.id} className="border-l-2 border-neutral-300 pl-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Step {index + 1} of {stages.length}
          </p>
          <h3 className="text-base font-semibold">{stage.label}</h3>
          <p className="mt-1 text-sm text-neutral-700">{stage.description}</p>
          {stage.providers.length === 0 ? null : (
            <p className="mt-1 text-xs text-neutral-500">Providers: {stage.providers.join(', ')}</p>
          )}
          {stage.jobKeys.length === 0 ? null : (
            <p className="mt-1 text-xs text-neutral-500">Jobs: {stage.jobKeys.join(', ')}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
