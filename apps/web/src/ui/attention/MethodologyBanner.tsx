/**
 * F08 §4.2 — the honest-framing banner, which is the point of this feature.
 *
 * - Names ApeWisdom as the source, with a link to its methodology and the captured
 *   `provider_methodology_version`.
 * - The subtitle is "observed Reddit sample — coverage-limited", verbatim.
 *
 * **The version string — round-48 lane-review finding 2.** `providerMethodologyVersion` is not
 * something ApeWisdom publishes: `collector.ts`'s `APEWISDOM_METHODOLOGY_VERSION` doc comment
 * says plainly "ApeWisdom publishes no version of its own ranking algorithm" — it is a constant
 * this deployment hand-bumps if a change to ApeWisdom's ranking or windowing is ever *observed*,
 * and the adapter's own schema (`adapters/apewisdom.ts`) parses no version field from the wire at
 * all. Rendered with no disclosure, directly beside a link to ApeWisdom's own methodology page, a
 * reader has no way to tell this from a value ApeWisdom actually versions — and would reasonably
 * conclude an unchanged value means ApeWisdom's methodology is unchanged, when it only ever moves
 * if a human notices a change and edits this constant. The last paragraph below states this
 * plainly, the same way it already discloses that the universe itself is selected by this same
 * measure.
 * - F08 §4.2 names four banned phrases this component must never render — deliberately not
 *   quoted here anyway, for the same reason `analytics/registry.ts` holds itself to it even where
 *   `check:copy` would not catch a comment: *"quoting them would put the banned vocabulary itself
 *   in front of"* the next author reading this file, in the one comment that exists to say it
 *   never reaches a user. (`check:copy`'s own `stripComments` — `scripts/checks/copy.ts` —
 *   removes comments before scanning, so this discipline is a style choice here, not something
 *   the check enforces on this file's prose.) This component's own e2e case
 *   (`tests/e2e/attention.spec.ts`) asserts their absence from the rendered DOM directly.
 */

export type MethodologyBannerProps = {
  readonly providerMethodologyVersion: string | null;
  readonly boardSourceUrl: string;
  readonly boardMethodologyUrl: string;
};

export function MethodologyBanner({
  providerMethodologyVersion,
  boardSourceUrl,
  boardMethodologyUrl,
}: MethodologyBannerProps) {
  return (
    <div data-methodology-banner="">
      <p className="text-sm text-neutral-600" data-methodology-subtitle="">
        observed Reddit sample — coverage-limited
      </p>
      <p className="mt-1 text-sm text-neutral-700">
        Source:{' '}
        <a className="underline decoration-dotted" href={boardSourceUrl} data-source-link="apewisdom">
          ApeWisdom
        </a>
        {' · '}
        <a className="underline decoration-dotted" href={boardMethodologyUrl} data-methodology-link="">
          methodology
        </a>
        {providerMethodologyVersion === null ? null : (
          <>
            {' · '}
            <span data-methodology-version="">version {providerMethodologyVersion}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        This board is the posts one Reddit-adjacent index tracks, not a survey of everyone posting
        anywhere. The 100 names on it were themselves selected by this same measure, so the level
        is not an independent finding — only the change in rank, across two of this board&rsquo;s
        own observations, is.
        {providerMethodologyVersion === null ? null : (
          <>
            {' '}
            ApeWisdom publishes no version of its own ranking methodology; the version above is
            this deployment&rsquo;s own record, updated only when a change to ApeWisdom&rsquo;s
            ranking or windowing is observed.
          </>
        )}
      </p>
    </div>
  );
}
