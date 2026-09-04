# 2026-09-05 — F17, Architecture Explorer

**Lane:** SURFACE, built by a coordinator-dispatched lane-build agent in a worktree (branched
from `6e77907`, before F16b/F11/F12 merged — no path overlap with any of them so this caused no
conflict), reviewed and merged by the coordinator in the same session.

## What merged

`/architecture`'s versioned topology manifest, built to the spec's own central rule — no
hand-copied value anywhere — by importing `providerId`, job-key constants, `MODEL_TASKS`, and
`SCORER_IDS` directly from their owning modules rather than retyping them; a public-safe
projection that is an allowlist by construction (proven with hostile-input contract tests, not a
pattern-matching denylist that could miss a new secret field); formula examples that call the
production calculation library and persist a real, linkable `CalculationArtifact` for every one
of the 20 currently-registered methods (integration-tested, not mocked); the searchable
`/architecture/calculations` catalogue; a fully keyboard-operable, reduced-motion-honoring
step-through with a complete static text alternative; CI manifest reconciliation that fails on
drift in either direction (registry has an entry the manifest doesn't know about, or vice versa).

The Opportunities tab states real, current gaps rather than a marketing-safe silence: Reddit is
unwired for the legacy product (D-39), no Substack collector service exists yet to poll the
adapter F04 built, the X-sampling trigger path is a structural stub, `job_definition.config_version`
has no production bootstrap path (F16a's own flagged gap), and there is no query path yet from the
manifest to a real scorer commit SHA (`ScorerIdentity`'s pinned-SHA half is named but not wired).

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean; unit
1345/1345 on F17's own tree; contract 120/120; integration 385/385 (run in the background past the
default tool timeout and monitored to completion); build clean (same). On the fully merged tree
(F10 + F16a + F15 + F11 + F16b + F12 + F17 together): unit 1492/1492 — arithmetic checks out
exactly (1472 already-merged + 20 new); lint/typecheck/build all clean. Merge produced zero
conflicts, including in the two shared test-infra files F17 extended (`tests/e2e/routes.ts`,
`tests/e2e/routes.spec.ts`) following the same dual-state-exclusion pattern F02/F07/F08/F09 already
established there.

**Full e2e was not independently re-run by the coordinator** — the build agent's own run (134/135,
via real Postgres + Chromium) took close to fifteen minutes wall time, and the coordinator's
unit/contract/integration/build verification already independently confirmed every claim in the
agent's report that those suites could check. The one e2e failure (`attention.spec.ts`'s F08
"stale collection" notable-movers case) was reproduced by the build agent on a clean checkout with
zero F17 changes applied, confirming it predates this merge; it was filed as its own follow-up
suggestion rather than fixed here, correctly out of scope for this feature.

## Contract requests

None.
