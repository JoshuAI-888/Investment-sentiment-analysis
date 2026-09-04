# F21 — MCP Server and MCP Apps Surface

**Wave:** 3 · **Lane:** unallocated — follows F12 directly at the Wave 3 exit · **Estimate:** 16–22 h · **Depends on:** F12, F20
**Status:** see `../PROGRESS.md` (this file never records status)
**Decision:** `../MEMORY.md` D-10. Placed at the **Wave 3 exit**, not after Wave 5.

## 1. Purpose

The operator asks Claude a question about a ticker and gets a grounded, inspectable answer with
interactive components — without opening the web app. The model chooses tools from the same
`MethodRegistry` that defines the metrics, so tool selection is structural rather than prompted.

**Placed here deliberately:** Wave 3's exit is the first moment the tool surface has something
honest to expose *and* the evaluation harness exists to measure how it is used.

## 2. Scope

**In:** the MCP server; the read-only tool surface; tool-catalogue generation from
`MethodRegistry`; MCP Apps `ui://` components for the metric card, the evidence list and the
Inspector artifact; the payload contract carrying coverage and limitations; the tool-selection
semantics (`whenToUse`); authentication to the server.

**Out:** any tool that writes (the surface is read-only, without exception); the web research
flow (F11); the evaluation harness (F12); new metrics (F06).

## 3. Contracts

**Consumes:** `MethodRegistryEntry` (`../02-ARCHITECTURE-CONTRACTS.md` §4.3),
`CalculationArtifact` (§4.2), `EvidenceItem` (§4.4), the services layer.
**Produces:** the MCP tool schemas, the `ui://` resource contract, `ToolResultEnvelope`.
**Must not redefine:** any metric, any formula, any threshold. **F21 reads. It does not compute.**

## 4. Build spec

### 4.1 The enforcement problem this feature must solve

The web app owns a render boundary: §6.4's disclosure is emitted by the method, prose failing
verification is withheld, and F19's copy lint governs everything a user sees. **An MCP server
owns none of that.** It returns results to a host it does not control, and that host's model
writes the prose (`../SPEC-REVIEW.md` FIND-1). Four rules make the surface safe anyway, and
they are binding — `../02-ARCHITECTURE-CONTRACTS.md` §2.2:

1. **Tools return computed metrics with a `calculationId`. They never return raw corpora.**
   A model that can only quote cannot fabricate an aggregate. This is the strongest available
   control and it is structural, not advisory. `list_supporting_evidence` returns bounded,
   already-classified items — **never a bulk text dump**.
2. **`ui://` components are the render boundary.** The `n`, the window, the coverage floor, the
   sampling-frame disclosure and the §6.4 line live in markup the server controls. This is a
   compliance mechanism, not a presentation choice.
3. Every result carries structured `coverage`, `n`, `window`, `limitations[]`, `mustNotClaim[]`.
   Advisory, but it makes the honest reading the path of least resistance.
4. **F11's server-side synthesis and verifier are retained as the measurement path.** Tiers B and
   C run against the web surface in CI and stand as the evidence that this tool surface *can* be
   used honestly. Without them B4 is unmeasurable anywhere.

### 4.2 Tool surface — read-only, no exceptions

| Tool | Returns | `whenToUse` |
|---|---|---|
| `get_ticker_sentiment` | Per-axis stance with `n`, window, `calculationId`, per-axis disclosure | The current state of one name |
| `compare_platforms` | The three axes side by side, never blended | Where Reddit, X and Substack disagree |
| `explain_spike` | The trigger event, the items around it, the price context | **The primary tool.** Something moved and the operator wants to know what was said |
| `get_historical_window` | A series with its **coverage floor** and per-axis start dates | Anything about the past |
| `list_supporting_evidence` | Bounded, classified items with URLs and `retrievedAt` | Grounding a claim |
| `list_contradicting_evidence` | Same, filtered to opposing stance | Adversarial checking |
| `open_calculation` | The `CalculationArtifact` with inputs, steps, exact decimal, hashes | "How was this computed?" |
| `get_coverage` | What is collected, since when, with what gaps | **Called before any historical claim** |

**Every tool is read-only.** There is no write tool, no configuration tool, no collection-trigger
tool. The operator changes state through the web app, where authorization and audit live.

### 4.3 Catalogue generation

Tool schemas are **generated from `MethodRegistry`**, not hand-written:

- `methodId` → tool name; `symbolicFormula` and `title` → description
- `inputSchema` (zod) → JSON Schema
- `limitations[]` → the result's `limitations[]`
- `eligibilityRules` → the `whenToUse` text

**A metric added to the registry appears in the catalogue with no code change.** This is I7 solved
structurally: the model learns tool selection from the same registry that defines the metric.

A registry entry with no `whenToUse` derivation fails the build — a tool the model cannot choose
correctly is worse than an absent one.

### 4.4 `ui://` components

Three, all theme-aware, all rendering their own caveats:

| Resource | Renders |
|---|---|
| `ui://metric-card` | One metric: value, `n`, window, per-axis label, §6.4 line or the Tier D4 record |
| `ui://evidence-list` | Bounded classified items, `availability` state, snippet as retrieved |
| `ui://inspector` | The `CalculationArtifact`: inputs, ordered steps, exact decimal, rounding rule, hashes |

Each carries the disclosure text **in markup**, not in a field the model may paraphrase. A
component that renders a value without its `n`, window and disclosure is a build failure.

### 4.5 The Tier D4 split

A metric that has passed Tier D4 renders its IC, Newey–West t, sample period and a link to the
versioned backtest record. **Every other metric renders the §6.4 disclosure.** The component
reads the registry to decide which — it is never a prop the caller sets.

Today that means every metric renders the disclosure (`../01-PRODUCT-SPEC.md` §2.1).

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | Registry → JSON Schema generation; `whenToUse` derivation; envelope construction |
| Contract | Every tool result validates against `ToolResultEnvelope`; every numeric carries a `calculationId`; **no tool response contains an unclassified text corpus** |
| Integration | `open_calculation` resolves an artifact and its replay reproduces the hash; `get_historical_window` returns a coverage floor; `get_coverage` reports real gaps |
| E2E | A host session: ask about a ticker, receive a rendered component, open the calculation, reach the Inspector artifact |
| Feature-specific | **Corpus-leak test:** no tool, on any input, returns raw item bodies. **Disclosure test:** every component renders `n`, window and the disclosure or a D4 record. **Registry-drift test:** adding a registry entry adds a tool with no code change; an entry lacking `whenToUse` fails the build |

## 6. Definition of Done

- [ ] Every tool is read-only. No write path exists, verified by inspection of the server's route table.
- [ ] No tool returns raw corpora on any input (corpus-leak test).
- [ ] Every numeric in every result carries a `calculationId` that resolves.
- [ ] Every result carries `coverage`, `n`, `window`, `limitations[]`, `mustNotClaim[]`.
- [ ] All three `ui://` components render their own `n`, window, coverage floor and disclosure in markup.
- [ ] A metric with no Tier D4 record renders the §6.4 line; a metric with one renders its IC, t-statistic, period and backtest link. Decided by the registry, never by the caller.
- [ ] The catalogue is generated from `MethodRegistry`; a new entry produces a new tool with no code change.
- [ ] A registry entry lacking `whenToUse` fails the build.
- [ ] `get_coverage` reports the real collector start date and real gaps, and is documented as the tool to call before any historical claim.
- [ ] Server authentication is required; an unauthenticated caller reaches no priced provider and no LLM.

## 7. PR review steps

1. **Try to make a tool return raw text.** Every tool, every parameter combination. This is the first check because rule 1 is the surface's only structural control.
2. Confirm every numeric field is accompanied by a resolvable `calculationId`.
3. Read each `ui://` component's markup and confirm the disclosure is *in the markup*, not passed in.
4. Confirm no write path — not a disabled one, an absent one.
5. Add a throwaway registry entry; confirm a tool appears with no code change. Remove its `whenToUse`; confirm the build fails.
6. Confirm F11's synthesis and verifier still run in CI — they are this surface's only evidence of honest use.
7. Check the coverage floor renders on a historical query with an axis that started later than the others.

## 8. Risks and open questions

| Risk | Mitigation / owner |
|---|---|
| **The host model characterises numbers in ways the server cannot control** | Accepted and unfixable at this layer. Mitigated by rules 1–3 and by keeping F11's measurable path. Recorded as a permanent limitation in `../01-PRODUCT-SPEC.md` §7 |
| The model calls the wrong tool and answers a historical question from current-state data | `get_coverage` and `whenToUse` semantics; `get_ticker_sentiment` states its window in the result so a mismatch is visible in the transcript |
| MCP Apps is a young extension and its spec is moving | Pin the spec revision; the components are plain HTML with a narrow JSON-RPC surface, so a spec change is a small port, not a rebuild |
| Tool results grow large enough to crowd the host's context | Hard bounds on evidence counts and series lengths, mirroring F10's pack limits |
| The surface drifts from the web app's metrics | Both read the same services and the same registry. Any metric computed in F21 rather than read from a service is a review failure |
