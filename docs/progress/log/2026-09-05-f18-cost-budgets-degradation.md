# 2026-09-05 — F18, cost, budgets, and degradation

**Lane:** SURFACE, built by a coordinator-dispatched lane-build agent in a worktree, reviewed and
merged by the coordinator in the same session.

## What merged

A real `BudgetPolicy`/`BudgetDecision` (`services/budget/policy.ts`, decimal-safe throughout),
checked before dispatch, never after, at D-32's actual current thresholds — $290 warn / $320
reduce / $350 hard — not the spec's own literal text, which still reads the stale pre-D-20
$80/$90/$100 figures. This is the same threshold discrepancy F15's own session log already
flagged; F18 is the feature that reconciles it, using D-32's numbers because they're what F15
already seeded in `settings-catalogue.ts`. Per-account budgets are correctly absent — void under
D-11, a single-operator system. The full degraded-state catalogue (`services/degradation/
catalogue.ts`) built against the actual current 9-provider roster, with no Reddit row at all
(D-39 — the spec's own table still names Reddit as the highest-severity item, and the build agent
correctly built against reality instead). `services/jobs/x-budget.ts` — the file F16a's own
session log explicitly named as F18's to update — now carries real D-32-sourced monthly/daily/
per-event X-read ceiling values in place of the zero-ceiling placeholder. `pnpm test:chaos`, a new
suite disabling providers and injecting dispatch faults.

## A real design error, caught by the build agent's own self-review

The first draft classified ApeWisdom as `'optional'`, reduce-tier-gated work, reading D-12/D-30's
"demoted cross-check" ruling at face value. Running the full e2e gate broke `attention.spec.ts`,
which led the agent back to `attention/collector.ts`'s own doc comment: D-39 dropped Reddit-Data-
API sourcing entirely, so ApeWisdom is this codebase's **only** running attention collector, not a
discretionary cross-check any more. Gating it at the reduce tier risked silent D-16 permanent
corpus loss for a free, keyless call — the gate wouldn't even have saved money. Reverted to
permissive/critical before the agent's own report, matching `market/provider-deps.ts`'s identical
reasoning. This is exactly the kind of finding the adversarial self-review checklist exists to
catch, and it worked.

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean; unit
1457/1457 on F18's own tree; contract 130/130; integration 415/415; `test:chaos` 7/7; build clean.
On the fully merged tree (everything through F18): unit 1539/1539 — arithmetic checks out exactly
(1508 already-merged + 31 new); lint/typecheck/chaos/build all clean. Merge produced zero
conflicts.

## Honest gaps disclosed, not silently absorbed

- The chaos suite drives live faults for 2 of 9 catalogued providers (ApeWisdom, Marketaux) — the
  two with a real deterministic fetcher seam; the rest have their own dedicated failure-mode
  coverage in their own feature's suite, not re-derived here.
- A wrapper-level `budget_denied` refusal surfaces as a generic degraded marker outside the
  dashboard-refresh entry point, not yet a distinctly-labeled reset-time message everywhere.
- No persisted circuit-breaker-state table exists yet, so `/admin/data-sources` has no live
  per-provider up/down indicator — contract request to SPINE.
- No clean LLM budget-hook point was found without editing `services/llm/`, which was outside this
  lane's authorized paths — reported as a contract request rather than worked around by editing
  another lane's merged file.

## Contract requests

A persisted circuit-breaker-state table (SPINE-owned) so `/admin/data-sources` could show live
status.
