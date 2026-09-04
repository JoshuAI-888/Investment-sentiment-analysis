# `llm` fixtures — how these were recorded

**Every one of these is synthetic, not recorded from a live vendor call.** `fixtures/scorer/`
sets the precedent for saying this plainly when it is true: that tree's `success.json` at least
runs the service's own real code against a fake backend. This tree has no equivalent — MT-06
(the LLM keys) is provisioned in Vercel for this project, but this build environment has no
access to `AI_GATEWAY_API_KEY` or a live model, and `docs/04-BUILD-LOOP.md` §2.3 ("fixtures
before live calls") asks that development and CI never depend on one anyway. So every fixture
here was **hand-written** to the exact shape `services/llm/model-client.ts` expects — a `status`,
and a `body.content` string holding what a real completion's message content would be — and
every JSON string inside `content` was validated by hand against `relevanceVerdictSchema` /
`collisionVerdictSchema` (`services/evidence/relevance.ts`, `entity-collision.ts`) before being
committed.

**What this means for trust in the pipeline.** Nothing in `apps/web/`'s tests asserts that a real
model would produce these particular verdicts for this particular text — that claim belongs to a
live smoke test against `PROVIDER_MODE=live`, which is out of scope for this build (no key
available here) and is exactly the kind of claim `docs/04-BUILD-LOOP.md`'s Honesty checklist asks
not to imply without evidence. What these fixtures *do* exercise, faithfully, is every code path
`model-client.ts` and the two classify methods are responsible for: budget-check-before-dispatch,
cost/call-log recording, JSON-parse failure, schema-invalid-once-then-repair, schema-invalid-
twice-then-drop-to-unclear, and a 5xx upstream failure. None of that depends on the model being
real.

## `relevance/` cases

| Case | What it exercises |
|---|---|
| `success` | A clean, schema-valid `relevant: true` verdict |
| `irrelevant` | A clean, schema-valid `relevant: false` verdict — excluded as `not_relevant`, not dropped |
| `malformed` / `malformed_repair` | `content` is not JSON at all, twice — the drop-to-`unclear` path |
| `invalid_schema` / `invalid_schema_repair` | First response is valid JSON but wrong types (`relevanceScore` as a string); the repair succeeds — the retry-then-recover path |
| `server_error` | HTTP 503 — the upstream-failure path, no schema question reached |

## `entity_collision/` cases

| Case | What it exercises |
|---|---|
| `confirmed` | Context corroborates the ambiguous token — `confirmed: true` |
| `rejected` | Context does not — `confirmed: false`, excluded as `ticker_collision_unconfirmed` |
| `malformed` / `malformed_repair` | Not JSON, twice — drop-to-`unclear` |
| `server_error` | HTTP 500 |

## Naming convention

`services/llm/model-client.ts`'s fixture client reads `fixtures/llm/<task>/<case>.json`, where
`<task>` is `relevance` or `entity_collision` (`services/llm/ports.ts`'s `ModelTask`). A repair
attempt reads `<case>_repair.json` — `relevance.ts`/`entity-collision.ts` append `_repair` to
whatever case name the caller passed for the first attempt, so a repair fixture only needs to
exist for a case a test actually drives into retry.
