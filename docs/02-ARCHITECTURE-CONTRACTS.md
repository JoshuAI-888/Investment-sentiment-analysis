# Architecture and Shared Contracts

> **Scoped RNI addendum (2026-09-05):** the existing contracts remain binding outside RNI.
> `features/RNI-00-CONTRACT.md` is binding within the RNI namespace and reconciles source-first
> bounded persistence, per-security observations, independent Reddit/X slices, RNI-specific
> OpenAI Direct routing, and forward migrations `0020–0024` with this application.

**Status:** Binding. Every feature builds against this. Changes require a `MEMORY.md` entry
and a coordinated update of every affected feature spec.
**Source:** `reference/SOURCE-PRD-v1.5.md` §6–§11, amended by `00-ADVERSARIAL-REVIEW.md` and by
the 2026-09-03 re-lock (`MEMORY.md` §1b).

---

## 1. Runtime

| Concern | Choice | Constraint |
|---|---|---|
| App + API | Next.js App Router, TypeScript, Server Components, Route Handlers | One project. No separate backend service. |
| Host | Vercel Hobby (Waves 1–4), Pro before any public demo | F-12: private/invited only while on Hobby |
| Database | Neon Postgres | Free tier 0.5 GB — F-07 storage projection is a gate |
| Cache / locks / rate limits | Upstash Redis (REST) | Free tier 500k commands/month |
| Scheduler | One fixed Upstash QStash schedule → protected dispatcher every 5 min | Admin edits DB job rows, never the QStash schedule |
| Email | Resend, `welcome@accounts.joshuai.nz` | Free tier 100/day — OTP throttle is P0 |
| Auth | Better Auth, email OTP | Hashed codes, 5-min expiry, 3 attempts, rotate on resend |
| LLM | Provider-neutral `ModelClient`; Vercel AI Gateway default, direct-provider fallback | Model IDs come from versioned config, never hardcoded. **Relevance and ticker-collision only in v1** (D-21) |
| **Scorer** | **Small Python service** (Fly/Railway/Modal): FinBERT + Twitter-RoBERTa **pinned to commit SHAs** | D-13. Deployed and CI'd separately from the web app. Never on the request path — see §2.1 |
| **MCP** | MCP server + MCP Apps `ui://` components, generated from the `MethodRegistry` | D-10, F21. Added after F12, not after Wave 5 |

**Forbidden in P0:** Azure, Databricks, Kafka, Kubernetes, any vector database.

**Named exception (D-13):** exactly one Python service, running pinned classification models.
It exists because **reproducibility requires it** — a hosted LLM classifier cannot back a
historical series, since model IDs retire and the corpus then becomes unverifiable at precisely
the moment a Tier D4 backtest needs it. The exception is narrow: no other Python service, and no
model whose revision is not pinned to a commit SHA.

**Database tier (D-17, D-20).** Neon **Launch**, not Free. The social corpus is permanent, grows
at roughly 120–180 MB/month at the D-15 universe, and exhausts the 0.5 GB free tier in three to
four months without recovering. `00-ADVERSARIAL-REVIEW.md` F-07's fixed `< 300 MB` ceiling is
superseded by a **growth-rate budget in MB/month**, measured in F05 and re-measured quarterly.

## 2. Trust boundaries

```
browser ── Server Component / Route Handler ── service layer ── repository ── Postgres
                     │                              │
                     │                              ├── provider adapters ── external APIs
                     │                              ├── analytics (pure, no I/O, no LLM)
                     │                              └── ModelClient ── gateway/provider
                     └── never: provider keys, DB URL, admin state, raw payloads
```

Rules:
- No provider SDK, database client, or secret may appear in a client bundle. Enforced by a
  bundle assertion in CI (F01).
- Analytics modules import nothing with I/O. Enforced by lint (F01).
- Admin authorization is re-checked in the server action / route handler itself. A layout
  check is not authorization.

### 2.1 The scoring boundary (D-13)

Scoring is **asynchronous and decoupled**. It is never on a user request path.

```
collector ──→ raw item store ──→ scoring queue ──→ pinned scorer service
                    ▲          (full bodies, D-17)          │
             never blocked by                               ▼
             scorer availability                     scored corpus ──→ analytics
```

Binding:

1. **Collection never depends on the scorer.** An outage produces an unscored backlog, not lost
   data — recoverable precisely because D-17 retains the bodies.
2. **No silent substitution.** A scorer outage renders §6.3 abstention and F18's degraded mode.
3. Every score row carries `scorer_id` and `scorer_version`. **No series admitted to a metric
   mixes scorers** (Tier D3).
4. **Capacity fallback is a provisioned hook, not a v1 build.** If the queue backs up during a
   high-volume event, LLM-scoring the backlog and re-scoring later is permitted — writing a
   **successor artifact** per §4.2, never recomputing in place. Provision `scorer_provenance` in
   Wave 1; build the path only if the queue actually backs up.

### 2.2 The MCP boundary (D-10, F21)

The web app owns a render boundary. **An MCP server does not** — it returns results to a host it
does not control, and that host's model writes the prose. Every §6.4 control becomes advisory
there (`SPEC-REVIEW.md` FIND-1). Four rules make the surface safe anyway:

1. **Tools return computed metrics with a `calculationId`. They never return raw corpora the
   model could aggregate itself.** This is the strongest available control and it is structural:
   a model that can only quote cannot fabricate an aggregate. `list_supporting_evidence` returns
   bounded, already-classified items — never a bulk text dump.
2. **MCP Apps `ui://` components are the render boundary.** The `n`, the window, the coverage
   floor, the sampling-frame disclosure and the §6.4 line live in markup the server controls.
   This is a compliance mechanism, not a presentation choice.
3. Every tool result carries structured `coverage`, `n`, `window`, `limitations[]` and
   `mustNotClaim[]`. Advisory, but it makes the honest reading the path of least resistance.
4. **F11's server-side synthesis and verifier are retained as the measurement path.** Tiers B and
   C run against the web surface in CI and stand as evidence that the tool surface *can* be used
   honestly. Without them, B4 ("numeric claims must string-match a stored metric") is
   unmeasurable anywhere.

## 3. Layering and dependency direction

```
contracts (zod)  ←  everything
repositories     ←  services
adapters         ←  services
analytics        ←  services            (analytics depends only on contracts)
calc             ←  services            (calc depends only on contracts)
services         ←  route handlers, server actions, server components
ui components    ←  pages
```

A dependency that points the other way is a review failure.

**`calc` added 2026-09-03 (F05, `MEMORY.md` B-21).** This diagram never named `calc/` — F01's
`layer-direction` lint rule added `calc: ['contracts']` unilaterally when it scaffolded the
directory, and the omission surfaced as a real constraint once F05 needed to build against it:
**`analytics` and `calc` are siblings, and neither may import the other.** A method that emits
its own computation trace needs `calc`'s `ComputeContext`; the split forces the pattern F05
proved out and every later analytics method should follow:

- `analytics/registry.ts` (or `.../*.ts`) — the declarative descriptor: what the metric is,
  its data shape, its zod contract. Depends on `contracts` only. This is what `check:calc-
  coverage` and `check:copy` read.
- `calc/methods/*.ts` — the arithmetic. Depends on `contracts` only (decimals, canonicalization,
  the artifact builder).
- `services/*.ts` — the binder. Imports both, and throws at load if either side has drifted from
  the other (a descriptor with no matching method, or vice versa).

**Why this is the fix and not a workaround pending a real one:** it keeps both existing
guarantees intact — `analytics` still depends on contracts alone, so a review can still reason
about a metric's shape without reading its computation, and `calc` importing only `contracts`
keeps the no-I/O, decimal-only discipline (`CLAUDE.md`) enforceable by the same lint rule. Adding
`analytics → calc` instead would have let a descriptor quietly embed arithmetic, which is the
coupling this layering exists to prevent.

## 4. Core shared contracts

These are the interfaces multiple features depend on. They are defined once, in Wave 1, and
hardened by surviving a real end-to-end round trip (F-11).

### 4.1 `ProviderResult<T>`

Every adapter returns this. No adapter throws for an expected condition.

```ts
type ProviderResult<T> =
  | { ok: true;  data: T; meta: ProviderMeta }
  | { ok: false; error: ProviderError; meta: ProviderMeta }

type ProviderMeta = {
  provider: ProviderId
  endpoint: string
  requestedAt: string        // ISO-8601 UTC
  latencyMs: number
  cache: 'hit' | 'miss' | 'stale'
  quotaRemaining: number | null
  costUsd: number | null     // null means UNPRICED, never 0
  payloadRef: string | null  // raw_provider_payload id, if retained
}

type ProviderError =
  | { kind: 'entitlement'; endpoint: string; status: number }  // never retry
  | { kind: 'quota';       resetAt: string | null }
  | { kind: 'rate_limit';  retryAfterMs: number }
  | { kind: 'timeout' }
  | { kind: 'upstream';    status: number }
  | { kind: 'contract';    issues: string[] }   // response failed its zod schema
  | { kind: 'budget_denied'; scope: 'account' | 'global' }
```

`costUsd: null` renders as "unpriced" everywhere. It never becomes `0`.

### 4.2 `CalculationArtifact`

The spine of the trust story. Produced by every deterministic function, persisted, replayed.

```ts
type CalculationArtifact = {
  calculationId: string           // uuid
  methodId: string                // e.g. 'attention.rank_change'
  methodVersion: string           // semver; bump on any numeric change
  subject: { kind: 'security' | 'market' | 'sector'; id: string }
  asOf: string                    // ISO-8601 UTC
  inputs: CalculationInput[]
  assumptions: ResolvedAssumption[]
  steps: CalculationStep[]        // ordered, each with expression + exact value
  result: {
    exact: string                 // full-precision decimal as string, never a JS number
    display: string               // after named rounding
    roundingRule: string          // registry id, e.g. 'pct_2dp_half_even'
    unit: string
  }
  eligibility: 'ok' | 'insufficient_data' | 'not_applicable' | 'stale'
  inputHash: string               // canonical hash of inputs + assumptions
  resultHash: string              // canonical hash of result.exact
  configVersion: string
  scenario: { kind: 'official' } | { kind: 'personal'; userId: string; profileId: string }
  points?: DerivedPoint[]         // F-07: series artifacts carry per-point derivations
}
```

**F-07 granularity rule (binding).** One artifact per *computation invocation*, not per
rendered pixel. A 180-point series is one artifact with a `points[]` table; a chart point is
addressed as `{calculationId, pointIndex}`.

All arithmetic uses a decimal library. A raw JS `number` in an analytics module is a review
failure.

### 4.3 `MethodRegistry` entry

The single runtime description of a metric. The Inspector, the formula catalogue, the
assumption validator and the Architecture Explorer all read this — none of them
reimplements a formula.

```ts
type MethodRegistryEntry = {
  methodId: string
  version: string
  title: string
  symbolicFormula: string          // rendered in the Inspector
  inputSchema: ZodSchema
  officialAssumptions: Record<string, DecimalString>
  editableAssumptions: Array<{     // the ONLY source of truth for what a user may change
    key: string; min: DecimalString; max: DecimalString; unit: string
  }>
  workingPrecision: number
  roundingRule: string
  eligibilityRules: string[]       // human-readable, shown in the Inspector
  failureBehaviour: 'abstain' | 'clamp' | 'not_applicable'
  externalComparator: { provider: ProviderId; field: string } | null
  limitations: string[]            // F-03: selection bias etc. render here
}
```

A database value can never make a non-registered parameter editable; the server validates
overrides against the registry **and** a second code-level allowlist.

### 4.4 `EvidenceItem`

```ts
type EvidenceItem = {
  id: string
  sourceKind: 'reddit_sample' | 'news' | 'filing' | 'web'
  url: string
  title: string
  snippet: string                 // as retrieved; never re-fetched into the record
  publishedAt: string | null
  retrievedAt: string
  lastCheckedAt: string | null    // F-19
  availability: 'ok' | 'unreachable' | 'unchecked'
  relevance: DecimalString
  dedupeKey: string               // normalized url + normalized title
}
```

F-19: `availability` is displayed state. It never invalidates a completed run and is never
repaired in place.

### 4.5 `ResearchRun`

```ts
type ResearchRunState =
  | 'queued' | 'gathering' | 'analyzing' | 'synthesizing'
  | 'verifying' | 'complete'
  | 'degraded'             // deterministic metrics only; prose withheld
  | 'verification_failed'  // F-10
  | 'abstained'            // insufficient evidence
  | 'failed'
  | 'retracted'            // F-20: set by an operator, with reason + actor
```

Runs are append-only. Retraction adds state; it never deletes claims, evidence links, or
artifacts.

### 4.6 `ModelClient`

```ts
interface ModelClient {
  classify<T>(task: 'stance', input: ClassifyInput, schema: ZodSchema<T>): Promise<T>
  synthesize<T>(task: 'synthesis' | 'followup', input: SynthInput, schema: ZodSchema<T>): Promise<T>
  verify<T>(task: 'verify', input: VerifyInput, schema: ZodSchema<T>): Promise<T>
}
```

Every call: strict zod schema, bounded tokens, task-routed model from versioned config,
recorded to `cost_event` with `costUsd` or `null`, and subject to the pre-dispatch budget
check.

## 5. Data model

27 tables, per source §7.2, retained unchanged in name and purpose. Conventions:

- **Surrogate keys only.** Ticker text is never a primary or foreign key (a symbol is
  reassignable). `security.id` is the key; symbol is an attribute with history.
- **Bitemporal where it matters:** `observed_at` (when the fact was true) and `ingested_at`
  (when we learned it) on every snapshot table. Never overwrite; insert a successor.
- **UTC everywhere** in storage and scheduling. US/Eastern and admin-local are display-only.
- **Decimals as `numeric`**, never float, for anything a user sees.
- **Append-only** for `calculation_*`, `claim_ledger`, `audit_event`, `cost_event`,
  `research_event`.
- **Every score row carries `scorer_id`, `scorer_version` and `scorer_provenance`** (D-13).
- **Point-in-time discipline (D-09).** `observed_at` / `ingested_at` on every social and market
  snapshot is not a convention here, it is the mechanism that makes a Tier D4 backtest possible.
  A query that reads a fact by `observed_at` without bounding `ingested_at` is a look-ahead bug;
  F22 owns the guard and a test proving the guard fires.

### 5.1 Retention (superseded 2026-09-03 by D-16 + D-17)

The previous policy — raw 7 days, normalized 90 days — is **self-defeating under forward-only
collection**. Deleting normalized social data at 90 days means the corpus never exceeds 90 days,
so the Tier D4 promotion path can never run. The rolling delete eats the asset.

> **The normalized social corpus and its derived scores are permanent.** They are the product's
> asset, not retained data.

| Class | Policy |
|---|---|
| Normalized social corpus + derived scores | **Permanent** |
| Reddit, Substack item bodies | **Full bodies, permanent** — own-collected via official APIs, personal use, re-scoreable indefinitely |
| X items | **Post ID + derived scores + bounded snippet**, re-hydrated on demand. The **snippet is X's canonical scoring unit**, so the X series stays self-consistent under re-scoring. Upstream deletions are honoured |
| Raw sanitized provider payloads | 7 days (0 where provider rights forbid) |
| Calculation artifacts | 90 days, **except** any referenced by a claim or an open issue, and **except** any admitted to a Tier D4 record — those are permanent |
| Market and price series | Permanent (they are backtest inputs) |

**Storage governance:** a measured growth-rate budget in MB/month, not a fixed ceiling. Projected
~120–180 MB/month at the D-15 universe. Re-measured in F05 and quarterly thereafter.

## 6. Configuration precedence

```
code-level invariants and safety allowlists      (never overridable)
  → environment / deployment secrets              (never readable from the browser)
    → active config_version row                   (typed, versioned, audited)
      → active universe_version / model_route     (typed, versioned, audited)
        → official assumption defaults
          → user account-default overrides        (bounded, personal scenario only)
            → user subject-level override         (bounded, personal scenario only)
```

Every job run and every research run **freezes** the config version it used and stores the
reference. Official scheduled materialisation ignores personal assumptions entirely.

## 7. Scheduling

One QStash schedule, every 5 minutes, POSTs to `/api/cron/dispatch` with a signature.
The dispatcher:

1. verifies the QStash signature — unsigned requests are rejected before any work;
2. acquires a Redis lock (a duplicate delivery must be a no-op);
3. selects due `job_definition` rows;
4. claims each with an idempotency key derived from `(job_id, due_at)`;
5. executes through the **same internal job service** that manual admin refresh uses;
6. records outcome, cost, and next run.

Admin edits `job_definition` rows. Admin never touches QStash or `vercel.json`.
An optional daily Vercel Cron heartbeat exists only to alert on a stalled dispatcher.

## 8. API surface

Retained from source §11. Route inventory lives in `reference/SOURCE-PRD-v1.5.md` §6.2 and
is implemented feature-by-feature. Two global rules:

- No unauthenticated route may reach a paid provider or the LLM. Health returns status only.
- Every mutation is a server action or POST route with server-side authorization, zod input
  validation, optimistic-concurrency check, reason capture and an `audit_event` write.

## 9. Repository shape

**Amended 2026-09-03 (D-25):** the package owns the repository root; the `barebones/` prefix
is gone and `archive/` holds the retired finsent pipeline and the published approach comparison.

```
/
  docs/                     ← this package
  archive/                  ← finsent (D-18 ports its harness from here) and the comparison
  .claude/agents/           ← lane-build, lane-verify, lane-review
  apps/web/                 ← the Next.js application (created in F01)
    app/                    ← routes per source §6.2
    src/
      contracts/            ← zod schemas; imported by everything
      adapters/             ← one directory per provider; ProviderResult only
      analytics/            ← pure functions; no I/O, no LLM, decimal only
      calc/                 ← artifact builder, hashing, replay, method registry
      repositories/         ← the only place SQL lives
      services/             ← orchestration; the only place that composes the above
      agent/                ← research state machine, prompts, verifier
      ui/                   ← components
    tests/
      unit/ contract/ integration/ e2e/ eval/
    fixtures/               ← frozen recorded provider payloads (committed)
    migrations/
```
