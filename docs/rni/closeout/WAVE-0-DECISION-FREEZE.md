# Wave 0 — owner decision freeze

## Definition of done

Wave 0 ends only when `joshuai` has explicitly approved a versioned decision record covering all
items below, the coordinator has frozen the resulting interfaces and acceptance fixtures, and the
checkpoint is committed and pushed. Silence, an existing accepted change request, or approval of
this planning document is not approval of the semantics.

The complete proposed decisions and exact approval wording are in
[`WAVE-0-OWNER-DECISIONS.md`](WAVE-0-OWNER-DECISIONS.md).

Required decisions:

1. **D-RNI-34 content identity:** stable source, immutable content version, retrieval-to-content
   provenance, A→B→A behavior, interpretation-relevant hash fields, replay and reuse rules.
2. **Multi-security completion:** a canonical sorted per-security completion manifest, resolver
   outcome, unresolved/abstained outcome, relationship membership, valid-empty versus failed
   relationship result, and aggregate hash.
3. **D-RNI-33 release proof:** PostgreSQL reconstructs the complete expected release from trusted
   rows and compares every value with null-safe semantics; caller JSON is not authority.
4. **Acquisition policy:** community-first Reddit and independent X planning, bounded allocation,
   ranking, exact/near dedup treatment, retries/truncation, coverage denominators and terminal
   slice statuses.
5. **Readiness lifecycle:** durable eval, narrative and catalyst/challenger receipts, exact
   applicability, membership, cutoff, missingness and terminal reasons. No new narrative model
   task unless separately approved with model/schema/envelope/budget authority.
6. **Confidence and publication:** exact facts and normalization for seven components and four
   penalties, weights/caps/rounding/bands, missingness, threshold, and a separate immutable
   post-E08 assessment before publication for ticker and full-universe paths.

Recommended baseline for decision, not implicit approval:

- Treat content version as analytical evidence identity and every retrieval as immutable
  provenance. A→B→A produces three retrieval observations and two content identities.
- Use a sorted per-security semantic completion manifest plus explicit relationship outcome and
  one aggregate hash derived from durable rows.
- Reconstruct the D-RNI-33 index relationally in PostgreSQL and use `IS DISTINCT FROM` for all
  comparisons.
- Preserve E06 and E07 immutability; assess confidence after durable E08 staging and before any
  publication visibility.

## Session W0-A — coordinator decision packet

**Title:** `RNI W0 — decision and contract freeze`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

Paste this as the first message:

```text
You are the sole RNI integration coordinator for Wave 0. Work in an isolated worktree starting
from the latest pushed feat/rni-integration-demo checkpoint. Read in full, in order: AGENTS.md,
CLAUDE.md, docs/features/RNI-00-CONTRACT.md, docs/rni/AGENTS.md,
docs/rni/RNI_BUILD_LOOP.md, docs/rni/PROGRESS.md, docs/rni/progress/INTEGRATION.md,
docs/rni/DEPLOY.md, docs/rni/DATA_MODEL_AND_LINEAGE.md,
docs/rni/OPENAI_AND_TOKEN_OPTIMISATION.md, and
docs/rni/closeout/WAVE-0-DECISION-FREEZE.md.

Purpose: create one concise, reviewable owner decision packet for the six remaining semantic
decisions listed in the wave file. Show the current contradiction or missing authority, the exact
recommended decision, alternatives that materially change behavior, impact, proposed durable
schema/interface shape, canonical hashing/sorting/missingness rules, and positive/negative/
concurrency acceptance fixtures. Explicitly resolve whether Migration 0024 is still editable on
the target environments; if not, allocate a new forward migration rather than rewriting applied
history.

Do not implement runtime behavior, edit migrations, call providers, inspect secrets, seed or
activate configuration, deploy, merge, or mark G6/G7/G8 complete. Do not touch or include the two
excluded provisional workflow files. Do not turn recommended values into owner-approved facts.

When the packet is ready, present the exact decisions to joshuai and stop for explicit approval.
After approval arrives in this same session, record owner, date, decision IDs, approved semantics,
and rejected alternatives in coordinator-owned RNI decision/progress documentation. Then freeze
only the shared schemas, ports, canonical examples and acceptance fixtures needed by Waves 1–3.
Keep downstream production execution disabled. Run contract/schema tests, request independent
read-only review, commit the approved freeze, push it, and return the standard handoff with the
new coordinator checkpoint SHA.

Stop without edits if owner approval is ambiguous, migration-history status cannot be proven, or
two specifications conflict materially. Ask one precise question rather than choosing policy.
```

## Wave 0 test plan

- Contract fixtures parse the approved positive cases and reject every named crossed/missing case.
- Canonical ordering and hashing are independent of input enumeration order.
- No caller-supplied hash can substitute for durable membership.
- The accepted lifecycle has no path from E08 directly to visibility without final confidence and
  publication decisions.
- A source can represent same-content rediscovery, changed content, and A→B→A without rewriting
  historical bytes or provenance.
- Comparative NVDA/AMD evidence requires two independently classified observations and an explicit
  relationship-stage terminal outcome.

## Exit gate

Record `<W0_CHECKPOINT_SHA>` in the handoff. All later prompts must use it or a descendant as their
starting checkpoint.
