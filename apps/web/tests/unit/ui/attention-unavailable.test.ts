import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionUnavailable } from '../../../src/ui/attention/AttentionUnavailable';

/**
 * Round-26 lane-review finding 2: no test at any level rendered `AttentionUnavailable` — a mutant
 * deleting its `degradedReason` prop, or the branch that reads it, left the whole suite green,
 * silently restoring the "still warming up" copy round 25/26 both found materially false over a
 * genuine outage. `tests/e2e/attention.spec.ts`'s one `state: 'unavailable'` case seeds via
 * `seedAttentionUnavailable`, which `del`s `attention:degraded` — so `degradedReason` is always
 * `null` there and only the generic branch is ever exercised. This is a direct component-render
 * test, the same pattern `tests/unit/ui/attention-table.test.ts` already established in this lane.
 */
function render(
  reason: 'never_collected' | 'no_active_config_version',
  degradedReason: 'provider_unreachable' | 'no_new_data' | 'provider_contract_changed' | null,
  degradedMessage: string | null = null,
): string {
  return renderToStaticMarkup(createElement(AttentionUnavailable, { reason, degradedReason, degradedMessage }));
}

describe('AttentionUnavailable — round-26 lane-review finding 2', () => {
  it('shows the generic cold-start copy when nothing is degraded', () => {
    const html = render('never_collected', null);
    expect(html).toContain('no collection run has produced one');
    expect(html).not.toContain('data-degraded-reason');
  });

  // Round-49 lane-review finding 2: round 48 removed the identical false claim ("accrues") from
  // the footer line but left it here too — nothing collects in the background, so nothing is
  // "warming up" on its own.
  it('never claims the product is warming up on its own', () => {
    expect(render('never_collected', null)).not.toContain('warming up');
  });

  // Round-46 lane-review finding 3: the heading previously said "not available yet" — a
  // wait-it-out claim — even for the one reason that isn't a cold start at all, contradicting the
  // body copy directly beneath it (and, whenever `configVersionGapSymbols` is non-empty, the
  // `ConfigVersionGapBanner` directly above it) in the exact way rounds 10/25/26/27 already fixed
  // for every *other* piece of copy on this component.
  it('gives the config-fault reason its own heading, not the cold-start "not available yet" claim', () => {
    const html = render('no_active_config_version', null);
    expect(html).toContain('Attention data cannot be shown.');
    expect(html).not.toContain('not available yet');
  });

  // Round-47 lane-review finding 2: round 46 keyed the heading on `reason` alone, so
  // `never_collected` + `provider_contract_changed` — one of only two states `needsOperatorAction`
  // marks true, precisely because waiting will never help — kept the wait-it-out heading directly
  // above a body ("an operator likely needs to update the collector") and a footer ("Until that's
  // resolved") that both say the opposite.
  it('gives provider_contract_changed the same non-cold-start heading, even without a config gap', () => {
    const html = render('never_collected', 'provider_contract_changed');
    expect(html).toContain('Attention data cannot be shown.');
    expect(html).not.toContain('not available yet');
    expect(html).toContain('data-needs-operator-action="true"');
  });

  // Round-50 lane-review finding 1, completing rounds 47-49's own correction: "not available yet"
  // kept rendering for the three `needsOperatorAction === false` reasons — exactly the states
  // rounds 48/49 proved never self-resolve without a human in this deployment (no dispatcher is
  // wired — F16a). The heading is now the same regardless of reason; only the footer still
  // distinguishes `needsOperatorAction`.
  it('gives every reason the same heading, since no reason currently self-resolves without a human', () => {
    expect(render('never_collected', null)).toContain('Attention data cannot be shown.');
    expect(render('never_collected', 'provider_unreachable')).toContain('Attention data cannot be shown.');
    expect(render('never_collected', 'no_new_data')).toContain('Attention data cannot be shown.');
    expect(render('no_active_config_version', null)).toContain('Attention data cannot be shown.');
    expect(render('never_collected', 'provider_contract_changed')).toContain('Attention data cannot be shown.');
  });

  it('never claims data is merely "not available yet", for any reason', () => {
    expect(render('never_collected', null)).not.toContain('not available yet');
    expect(render('never_collected', 'provider_unreachable')).not.toContain('not available yet');
    expect(render('never_collected', 'no_new_data')).not.toContain('not available yet');
  });

  // Round-44 lane-review finding 2: this used to be true unconditionally. It is now true only
  // when the caller has no compound `degradedMessage` to hand over — see
  // `social-reddit-page.test.ts` for the compound case, where a concurrent outage's own fact
  // must also reach the reader instead of being silently dropped by this fallback.
  it('falls back to the plain configuration-fault copy when no degradedMessage is supplied, regardless of degradedReason', () => {
    const html = render('no_active_config_version', 'provider_unreachable');
    expect(html).toContain('configuration fault');
    expect(html).not.toContain('still warming up');
  });

  it('names the real outage for provider_unreachable, not "still warming up" (round-25 lane-review finding 1)', () => {
    const html = render('never_collected', 'provider_unreachable');
    expect(html).toContain('data-degraded-reason="provider_unreachable"');
    expect(html).toContain('could not reach ApeWisdom');
    expect(html).not.toContain('still warming up');
  });

  // Round-48 lane-review finding 1: nothing calls `runAttentionCollection` in production yet
  // (`pipeline.ts` — only test code and a not-yet-wired dispatcher stub call it), so there is no
  // schedule for the collector to retry on. Asserting one existed told a reader the correct
  // response was to wait, which is the "plausible-looking empty state" D-16 exists to rule out.
  it('does not claim the collector will retry on a schedule this deployment does not have', () => {
    const html = render('never_collected', 'provider_unreachable');
    expect(html).not.toContain('will keep retrying');
    expect(html).not.toContain('on its own schedule');
  });

  // Round-26 lane-review finding 1: round 25 only branched on 'provider_unreachable', but
  // 'provider_contract_changed' fires on the identical !collected.ok path with zero rows.
  it('names a provider contract change, not "still warming up" (round-26 lane-review finding 1)', () => {
    const html = render('never_collected', 'provider_contract_changed');
    expect(html).toContain('data-degraded-reason="provider_contract_changed"');
    expect(html).toContain('no longer matched the expected shape');
    expect(html).not.toContain('still warming up');
  });

  // Round-26 lane-review finding 1: a first-ever run whose board matched nothing also reaches
  // zero rows with degradedReason 'no_new_data'.
  it('names an unusable-response run, not "still warming up" (round-26 lane-review finding 1)', () => {
    const html = render('never_collected', 'no_new_data');
    expect(html).toContain('data-degraded-reason="no_new_data"');
    expect(html).toContain('every entry on it was malformed or matched no tracked security');
    expect(html).not.toContain('still warming up');
  });

  // Round-32 lane-review finding 1: `no_new_data` also fires when ApeWisdom's board response is
  // genuinely empty (`results: []`) — a real, fixture-covered provider shape
  // (`fixtures/apewisdom/filter/empty.json`), not just "every entry was malformed/unmatched".
  // The old text was a vacuous truth over the empty set, read as pinning the fault on local
  // matching when the provider itself sent zero rows.
  it('does not claim every entry was malformed/unmatched when the board itself was empty', () => {
    const html = render('never_collected', 'no_new_data');
    expect(html).toContain('the board was empty, or every entry on it was malformed');
  });

  it('always includes the working dashboard link', () => {
    const html = render('never_collected', null);
    expect(html).toContain('href="/dashboard"');
  });
});

// Round-45 lane-review findings 1 and 3, on round 44's own fix. Round 44's first attempt appended
// a sentence claiming the provider issue "also holds" and that activation "alone will not resolve
// this" — an unfounded present-tense claim (the collector cannot have run since the config version
// was lost, so `degradedReason` may be stale by days) that also silently dropped the
// `provider_contract_changed` remedy. These pin the corrected, narrower sentence directly, since
// nothing upstream of this component ever supplies a `degradedMessage` string containing it —
// deleting the appended clause without this test would leave the whole gate green.
describe('AttentionUnavailable — the compound config-gap + outage sentence (round-45 lane-review findings 1, 3; round-46 finding 2)', () => {
  // Round-46 lane-review finding 2: each `degradedReason` gets its own real `degradedMessage` —
  // `leaderboard.ts`'s own per-reason text (`degradedReasonExplanation`), not one string reused
  // across all three, which had left two of the three real compositions unpinned at this level
  // (a component-level mirror of `attention-pipeline.test.ts`'s own three round-46 cases).
  //
  // Round-49 lane-review finding 2: the trailing clause used to say "The collector has not been
  // able to attempt another run since, because there is also no active config version" — a false
  // causal claim (nothing calls the collector in production at all, config version or not).
  // Restated to state the config gap on its own.
  const composed = (reasonExplanation: string) =>
    `${reasonExplanation} There is also no active config version to record a calculation against — this could be significantly out of date, and may be hiding attention data this deployment has already collected.`;

  const providerUnreachableMessage = composed('ApeWisdom could not be reached on the last collection run.');
  const noNewDataMessage = composed(
    "ApeWisdom was reached on the last collection run, but nothing new could be added — the board was empty, or every entry on it was malformed or matched no tracked security.",
  );
  const contractChangedMessage = composed(
    "ApeWisdom was reached on the last collection run, but its response no longer matched the expected shape — the provider may have changed its API.",
  );

  it('never claims the provider issue currently holds or that activation alone will not resolve it', () => {
    const html = render('no_active_config_version', 'provider_unreachable', providerUnreachableMessage);
    expect(html).toContain(providerUnreachableMessage);
    expect(html).toContain('An operator needs to activate a config version.');
    expect(html).not.toContain('also holds');
    expect(html).not.toContain('alone will not resolve');
  });

  it('adds no collector-update remedy for provider_unreachable, which self-heals once the collector can run again', () => {
    const html = render('no_active_config_version', 'provider_unreachable', providerUnreachableMessage);
    expect(html).not.toContain('update');
  });

  it('renders the real no_new_data composition and adds no collector-update remedy, which also self-heals', () => {
    const html = render('no_active_config_version', 'no_new_data', noNewDataMessage);
    expect(html).toContain(noNewDataMessage);
    expect(html).toContain('An operator needs to activate a config version.');
    expect(html).not.toContain('update');
  });

  it('renders the real provider_contract_changed composition and also names the collector-update remedy, which it needs regardless of the config gap', () => {
    const html = render('no_active_config_version', 'provider_contract_changed', contractChangedMessage);
    expect(html).toContain(contractChangedMessage);
    expect(html).toContain('An operator needs to activate a config version, and the collector likely also needs an update');
  });
});

// Round-27 lane-review finding 2, corrected by round-48 finding 1. Round 27's "While this
// accrues" asserted data is currently accumulating on its own, unconditionally — false for the
// two causes that need a human before anything will ever accrue (no_active_config_version,
// provider_contract_changed), directly contradicting the "an operator needs to..." sentence
// rendered immediately above it. Round 48 found the replacement claim was *also* false for the
// other three states: nothing calls `runAttentionCollection` in production at all yet (no
// dispatcher is wired — `pipeline.ts`), so nothing is actually accruing in the background for any
// reason. 'In the meantime' keeps the real distinction (these three don't need a human the way
// the other two do) without asserting progress that isn't happening.
describe('AttentionUnavailable — the footer line matches whether a human must act, without claiming background progress (round-27 lane-review finding 2; round-48 finding 1)', () => {
  it('says "in the meantime" for an ordinary cold start, which does not need a human', () => {
    const html = render('never_collected', null);
    expect(html).toContain('In the meantime');
    expect(html).not.toContain('While this accrues');
    expect(html).toContain('data-needs-operator-action="false"');
  });

  it('says "in the meantime" for provider_unreachable, which does not need a human', () => {
    const html = render('never_collected', 'provider_unreachable');
    expect(html).toContain('In the meantime');
    expect(html).not.toContain('While this accrues');
    expect(html).toContain('data-needs-operator-action="false"');
  });

  it('says "in the meantime" for no_new_data, which does not need a human', () => {
    const html = render('never_collected', 'no_new_data');
    expect(html).toContain('In the meantime');
    expect(html).not.toContain('While this accrues');
    expect(html).toContain('data-needs-operator-action="false"');
  });

  it('does not claim accrual for no_active_config_version, which needs an operator to activate one', () => {
    const html = render('no_active_config_version', null);
    expect(html).not.toContain('In the meantime');
    expect(html).not.toContain('While this accrues');
    expect(html).toContain('Until that&#x27;s resolved');
    expect(html).toContain('data-needs-operator-action="true"');
  });

  it('does not claim accrual for provider_contract_changed, which needs an operator to update the collector', () => {
    const html = render('never_collected', 'provider_contract_changed');
    expect(html).not.toContain('In the meantime');
    expect(html).not.toContain('While this accrues');
    expect(html).toContain('Until that&#x27;s resolved');
    expect(html).toContain('data-needs-operator-action="true"');
  });
});
