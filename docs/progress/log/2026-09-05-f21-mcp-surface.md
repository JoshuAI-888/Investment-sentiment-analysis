# 2026-09-05 — F21, MCP server and MCP Apps surface

**Lane:** unallocated (Wave 3 exit), built by a coordinator-dispatched lane-build agent in a
worktree, reviewed and merged by the coordinator in the same session. The last of the originally
requested feature set to land.

## What merged

A hand-rolled JSON-RPC 2.0 dispatcher at `POST /api/mcp` — no MCP SDK dependency, a deliberate
choice disclosed in the build report: every tool here is a bounded read, nothing needs streaming,
and a plain route handler keeps this surface in the same deploy target, auth pattern, and request
lifecycle as everything else in the app. `requireUser()` gates the entire endpoint, stricter than
the DoD's own stated minimum.

The 8 named tools (`get_ticker_sentiment`, `compare_platforms`, `explain_spike`,
`get_historical_window`, `list_supporting_evidence`, `list_contradicting_evidence`,
`open_calculation`, `get_coverage`) plus one generated tool per currently-registered metric, all
conforming to one shared `ToolResultEnvelope` (`coverage`/`n`/`window`/`limitations[]`/
`mustNotClaim[]` on every result, none optional). Rule 1 — the surface's only structural safety
control, per the spec's own words — proven with a corpus-leak test written *first*, following the
spec's own priority order: seeds 40–45 classified evidence items and asserts every
evidence-returning tool caps at 30, sets `truncated: true`, and never leaks an unclassified row.
The three `ui://` resources (`metric-card`, `evidence-list`, `inspector`) render their own `n`,
window, coverage floor, and disclosure in markup — never as a prop the caller could omit or
paraphrase — extended to all three in a same-day follow-up commit (`2b951dd`) after the build
agent's own testing found the DoD's blanket phrasing needed a second, honest-equivalent pass for
the two resources beyond `metric-card`. The catalogue is generated from the real
`calc/registry.ts#MethodDescriptor`, with a registry-drift test (add a throwaway entry, get a new
tool with no code change) and a build-time throw on an entry missing `eligibilityRules` — this
registry's real equivalent of the spec's idealized `whenToUse` field.

A new, purely additive `repositories/mcp-calculation-lookup.ts` (two read-only
`calculation_snapshot` queries `repositories/calculations.ts` doesn't yet expose) follows the same
authorized cross-lane gap-fill precedent `repositories/jobs.ts` already documents for itself.

## Two disclosed interpretive gaps, named rather than silently narrowed

1. F20's persisted per-item evidence `relevance`/`stanceScore` fields carry no `calculationId` —
   they are not `CalculationArtifact`s, the same shape F09's own reviewed `evidenceItemView`
   contract already carries with no per-item id. A documented interpretive call, not an oversight.
2. `market.spike_detection` (F16a's cross-lane addition) is still not projected into
   `analytics/registry.ts`'s `MethodRegistry` — `explain_spike`'s trigger data therefore carries no
   registry-sourced `limitations`/disclosure the way every other method's does. Named explicitly in
   that tool's own `limitations[]` array, not silently absorbed.

## Verification

Coordinator re-ran the full gate independently in the merge tree: lint/typecheck clean; unit
1488/1488 on F21's own tree; contract 148/148; integration 428/428; build clean. On the fully
merged tree — every feature this session built, F10 through F21 plus the Substack collector —
unit 1555/1555 (arithmetic checks out exactly: 1539 already-merged + 16 new); lint/typecheck/build
all clean. Merge produced zero conflicts; the diff was purely additive (31 new files, zero existing
files touched).

`test:e2e` was not runnable in either the build agent's sandbox or the coordinator's — no
Playwright browsers available (a network-blocked download attempt was confirmed, the same gap
F10's and F11's session logs already reported). `tests/e2e/mcp.spec.ts` is written and covers the
DoD's full e2e row (ask about a ticker → rendered component → open the calculation → reach the
Inspector artifact), ready to run once browser access exists.

## Contract requests

1. `repositories/calculations.ts` should eventually gain `findLatestCalculationByMethod`/
   `findCalculationsInRange` natively, retiring the standalone lookup file this feature added.
2. `market.spike_detection` still needs promotion into `analytics/registry.ts` (same request F16a's
   and F17's own logs already carry — this is now the third feature to flag it).
