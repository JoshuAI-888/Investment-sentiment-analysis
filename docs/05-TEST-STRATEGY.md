# Test Strategy

> **Amended 2026-09-03 by the re-lock.** Two additions below — §2.1 (fixtures for streaming and
> paginated social sources, which the original fixture policy does not cover) and §9 (Tier D).
> See `MEMORY.md` §1b and `SPEC-REVIEW.md`.

**Governing principle:** the merge gate runs entirely on **frozen fixtures**. Nothing that
depends on live market state may block a merge (`00-ADVERSARIAL-REVIEW.md` F-16).

---

## 1. Suites

| Suite | Command | Runs on | Determinism | Gates merge |
|---|---|---|---|---|
| Lint + typecheck | `pnpm lint`, `pnpm typecheck` | every push | total | yes |
| Unit | `pnpm test:unit` | every push | total | yes |
| Contract | `pnpm test:contract` | every push | frozen fixtures | yes |
| Integration | `pnpm test:integration` | every push | ephemeral Postgres + fixtures | yes |
| E2E | `pnpm test:e2e` | every push | seeded DB + fixtures, Playwright | yes |
| Eval (Tiers B & C) | `pnpm test:eval` | research-touching PRs, nightly | frozen corpus, temperature 0 | yes on those PRs |
| Perf | `pnpm test:perf` | nightly, Wave 5 gate | seeded DB | Wave 5 only |
| Chaos | `pnpm test:chaos` | nightly, Wave 5 gate | fault-injected adapters | Wave 5 only |
| Live smoke | `pnpm smoke:live` | manual + daily schedule | **non-deterministic** | **never** |

## 2. Fixture policy

**Recording.** Each adapter records real payloads once into
`apps/web/fixtures/<provider>/<endpoint>/<case>.json`, sanitized of keys and PII, committed.
Recording is a deliberate, logged act — never a test side effect.

**Default mode.** `PROVIDER_MODE=fixture` is the default in development and the only mode in
CI. `PROVIDER_MODE=live` requires an explicit flag and is counted against the quota ledger
(F-08).

**Required cases per adapter.** Success; empty result; malformed-but-200; 401/403
entitlement; 429 with and without `Retry-After`; 5xx; timeout; a field the schema does not
expect; a null where a number is required.

**Freshness.** Fixtures are re-recorded when an adapter's contract test fails against live
smoke — which is how a provider's silent schema change is detected. Re-recording is a PR with
the diff visible, never an in-place overwrite during a build.

### 2.1 Fixtures for social sources (added 2026-09-03, D-12)

`PROVIDER_MODE=fixture` is excellent for request/response APIs and **silently does not extend to
the new sources**. Recording a fixture for a paginated Reddit comment tree, an RSS feed that
changes shape between polls, or a trigger-sampled X window is a different problem, and CI
determinism is a headline property of this package that would otherwise quietly lapse.

| Source | Fixture unit | Recorded |
|---|---|---|
| **Reddit** | One submission **with its complete comment tree**, paginated responses included, as one fixture | Frozen at record time. Pagination cursors are part of the fixture, so a partial-page bug is reproducible |
| **Substack** | One feed snapshot **plus a second snapshot of the same feed later**, so entry-shift and republish handling are testable | Two files per case; the pair is the fixture |
| **X** | One trigger event and the read window it produced — **the trigger is part of the fixture**, since coverage is event-conditional (D-15) | Includes the market-data state that fired it |
| **Market data** | Intraday bars spanning a trigger threshold crossing, and one not crossing | Both, so trigger logic is tested in each direction |

**Rules:**

- **A social fixture must include at least one item the relevance filter should reject** and one
  ticker-collision case. A fixture set of clean items tests nothing that matters (D-21).
- **A fixture must include a coverage gap.** F22's discontinuity rendering has no other way to be
  tested deterministically, and a gap is a permanent state under D-16.
- **Scorer fixtures are separate and live with the scorer service** (F20). Its determinism test
  runs on cached model weights inside its own image, with **no network access to Hugging Face** —
  a CI run that fetches a model has reintroduced the unpinned drift F20 exists to remove.
- Live smoke against the real providers stays non-blocking and never gates a merge (F-16).

## 3. Golden numeric fixtures

Every registered method in the method registry carries golden fixtures in
`tests/unit/analytics/golden/<methodId>.json`:

```json
{
  "methodId": "attention.rank_change",
  "methodVersion": "1.0.0",
  "cases": [
    { "name": "normal",            "inputs": {...}, "exact": "12", "display": "+12", "eligibility": "ok" },
    { "name": "no_prior_rank",     "inputs": {...}, "eligibility": "not_applicable", "state": "NEW" },
    { "name": "thin_sample",       "inputs": {...}, "eligibility": "insufficient_data" },
    { "name": "divide_by_zero",    "inputs": {...}, "eligibility": "not_applicable" },
    { "name": "clamp_upper_bound", "inputs": {...}, "exact": "3" }
  ]
}
```

Rules:
- Expected values are **exact decimal strings**. No float tolerance — if a test needs a
  tolerance, the calculation is using floats and that is the defect.
- Every `eligibilityRule` and every `failureBehaviour` in the registry has at least one case.
- A `methodVersion` bump requires a golden-fixture update in the same PR; CI fails a version
  change with unchanged goldens.
- CI asserts **registry coverage**: every registered method has goldens; every rendered
  deterministic metric has a registered method (this is the `calculation_id` coverage check).

## 4. Edge-case matrix (from source §14.3, corrected per F-16)

These are **constructed fixture conditions**, not live symbols. A symbol is named only as a
convenience label.

| Condition | Fixture |
|---|---|
| Ambiguous ticker token | `AI`, `ON`, `IT`, `ALL` in evidence text without the security |
| ETF (valuation ineligible) | `SPY`, `USO` |
| High-attention name | synthetic high mention count + large rank change |
| Thin sample | mentions = 3 |
| New entrant | `prior_rank` absent |
| Price unavailable, attention present | FMP quote 5xx + valid ApeWisdom row |
| News sentiment unavailable | Marketaux returns 0 entity-tagged articles |
| Conflicting bullish social vs negative news | constructed stance +0.6, news −0.5 |
| Stale data | `observed_at` older than the staleness threshold |
| Provider returns 200 with null body | malformed fixture |

The 30-symbol list in source §14.3 remains the **seed universe** for the running system. It
is not the test oracle.

## 5. LLM evaluation harness (Tiers B and C)

Location: `apps/web/tests/eval/`. Built in F12.

### 5.1 Corpus

≥ 30 frozen evidence packs, human-labelled, committed:

| Bucket | Count | Labels |
|---|---|---|
| Clear positive/negative stance | 10 | per-item stance, relevance |
| Sarcasm / ambiguity | 5 | expected `unclear`, zero direction |
| Ticker collision | 5 | expected relevance = 0 for the collided items |
| Conflicting sources | 5 | expected `mixed`, no confident direction |
| Thin evidence | 5 | **expected abstention** |

Each pack also carries: acceptable claims, required abstentions, and the stored metric
values the prose must match.

### 5.2 Seeded-error corpus (F-10, F-22)

≥ 40 answers generated from the packs above with one injected fault each:

wrong number · swapped ticker · unsupported causal claim (“because of X”) · stale date ·
buy recommendation · price target · citation pointing at an unrelated evidence item ·
stance asserted on a thin sample · fabricated evidence ID.

Used twice: to measure the **verifier** (B7 catch ≥ 0.90, B8 false-positive ≤ 0.10) and to
validate the **judge** (a judge that scores a seeded-error answer ≥ 4/5 on groundedness is
itself a defect).

### 5.3 The judge

- A separate model from the synthesiser, on a separate task route, temperature 0.
- Sees: the answer, the evidence pack text, and the stored metric values. It does **not**
  see the synthesiser's prompt or reasoning.
- Returns a strict schema: `{c1..c4: 1-5, violations: string[], rationale: string}`.
- Gate: mean ≥ 4.0 across the corpus; **no answer below 3 on C2 (groundedness)**; zero
  Tier-B violations.
- Judge outputs are stored per run so a threshold change can be re-evaluated without
  re-running the models.

**Known limitation, stated rather than hidden:** an LLM judge is systematically forgiving of
fluent, well-cited, subtly wrong prose. Its output is a gate, not evidence of quality. The
one-time human calibration (`DEPLOY.md` MT-11) and the seeded-error validation above are
what keep it honest.

### 5.4 Determinism

Temperature 0, pinned model IDs recorded per eval run, corpus frozen. A model-route change
re-runs the whole corpus and records the delta in `MEMORY.md`. Eval results are compared
run-to-run; an unexplained score movement is investigated, not accepted.

## 6. Deterministic verification checks (F11, non-LLM)

These run on every research answer in production, not just in tests. Each has unit tests.

1. Every numeric token in the prose string-matches a stored metric at its display rounding.
2. Every citation marker resolves to an `evidence_item` in this run's pack.
3. Every cited item's `retrievedAt` is within the run's declared window.
4. No banned vocabulary (recommendation verbs, certainty language, "signal").
5. No stance score is asserted where `n < 5`.
6. No claim references a ticker outside the run's subject set.
7. Date claims are consistent with the evidence timestamps they cite.
8. The answer's stated freshness matches the oldest input's `observed_at`.

A failure of any check ⇒ prose withheld, run state `verification_failed`, deterministic
metrics still rendered.

## 7. Non-functional suites

**Perf** (`test:perf`) asserts the Tier-A budgets in `01-PRODUCT-SPEC.md` §4 against a seeded
database with fixture providers, measuring p95 over ≥ 50 iterations. F11 additionally
asserts the per-stage latency decomposition, not just the total.

**Chaos** (`test:chaos`) disables each noncritical provider in turn and asserts: the page
renders, the degraded state is explicit and named, no invented content appears, and no
unhandled error reaches the user. Also injects a duplicate QStash delivery, an expired lock,
and a budget-exceeded condition.

**Accessibility** runs axe on every route in E2E; keyboard traversal and reduced-motion are
asserted on the Architecture Explorer and the Inspector drawer specifically.

**Copy lint** (F19) is a plain source scan: banned vocabulary anywhere in user-facing
strings; the §6.4 disclosure line present wherever a divergence state renders.

## 8. CI

**Amended 2026-09-03 by the pre-build audit (D-13).** CI spans **two deploy targets**. The
scorer lane below was named in F01's amendment banner and in `PROGRESS.md`, and was in neither
this workflow nor F01's body — so nothing would have built the thing `03-ROADMAP.md`'s Wave 1
exit gate tests.

```yaml
on: [push, pull_request]
jobs:
  verify:                        # deploy target 1 — the Next.js app
    - pnpm install --frozen-lockfile
    - pnpm lint                  # incl. the five architectural rules (F01 §4.3)
    - pnpm typecheck
    - pnpm test:unit
    - pnpm test:contract
    - pnpm test:integration      # ephemeral Postgres service
    - pnpm build
    - pnpm test:e2e              # against the built app
    - pnpm check:calc-coverage   # every rendered metric has a registered method
    - pnpm check:bundle          # no provider SDK / db client in client chunks
    - pnpm check:copy            # banned vocabulary + disclosure + Tier D4 clause
  scorer:                        # deploy target 2 — F20's pinned scorer service
    - build the scorer image     # models baked in; no network at test time
    - run the scorer suite       # determinism, HTTP contract, provenance
  eval:
    if: touches agent/ or prompts/ or analytics/
    - pnpm test:eval
```

`verify` and `scorer` are **separate jobs, and either one red blocks the merge**. The scorer
is not a step inside `verify`: a Python failure reported as a Next.js failure costs a
debugging cycle every time. Until F20 lands, `scorer` runs a placeholder asserting the §3 HTTP
contract — a lane introduced at F20 is a lane that has never gated anything.

The scorer job reaches **no network at test time**. Its models are baked into the image, so a
Hugging Face outage cannot turn every merge red for a reason unrelated to the diff.

CI runs with `PROVIDER_MODE=fixture` and no real provider keys present. A test that needs a
key to pass is a test that will pass for the wrong reason.

---

## 9. Tier D — measurement fidelity (added 2026-09-03, D-09)

Tiers B and C measure the *prose about* a number. Tier D measures the number. Tier C without
Tier D is a well-written account of an unchecked measurement.

| ID | What is tested | How | Gates |
|---|---|---|---|
| D1 | Stance accuracy **per axis** | Hand-labelled set; macro-F1 ≥ 0.80 per axis. **A blended figure is not admissible** (D-14) | v1 |
| D2 | Scorer reproducibility | The same fixture items scored twice, and again at a different batch size, produce byte-identical scores (F20) | v1 |
| D3 | Scorer provenance | Every score row carries `scorer_id` + `scorer_version`; **no series admitted to a metric mixes scorers** | v1 |
| D4 | Return predictivity, **per metric** | Ported harness (D-18): PIT-correct, cross-sectional IC, Newey–West t, decay curve, **momentum-residualised IC** | ~2027 |

**D4's null discipline is binding, and it is the reason to port finsent's harness rather than
write a new one.** The evaluation must run a null scenario **it is required to fail**. A gate
that cannot fail is not a gate — this package's own F-02 finding, and finsent demonstrated it
empirically: a null case reached raw-IC Newey–West **t = +2.15**, a false positive that a raw-IC
gate would have passed, rejected only by the momentum-residual control at t = +1.44.

**Raw IC alone is not an acceptable promotion criterion.**

**D1's labelled set is unspecified** — size, labeller and sampling method are `MEMORY.md` OQ-7.
Until it is settled D1 is unmeasurable, and "validated" has no measurement behind it. Settle it
before F12 starts, not during.
