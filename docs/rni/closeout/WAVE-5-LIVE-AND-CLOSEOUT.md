# Wave 5 — preview, live G7, and RNI 1.0 closeout

**Required code base:** `<W4_ACCEPTED_SHA>`. W5-B establishes the exact immutable Preview
deployment/build identity before generating an authority pack.

Wave 5 contains external actions. Environment variables existing locally or in Vercel do not
authorize their use. Every live, seed, activation, deployment, migration, universe activation and
production action requires the explicit owner authority named below.

## Definition of done

RNI 1.0 can close only after:

- production-equivalent preview uses the reviewed Wave 4 code/build and authority identities;
- the approved forward migration passes on an ephemeral Neon branch;
- G7 proves bounded OpenAI Reddit persistence on at least five sources, independent X behavior,
  FMP stage-only universe validation, QStash signed delivery/idempotency, optional Gateway parity
  only if launching it, and the authenticated preview full story;
- redacted evidence proves source-first persistence, citations, manifest/lease/budget authority,
  source-specific failure states, no fixture fallback and no uncited sentence;
- `joshuai` reviews the full packet and explicitly approves G8, the FMP universe activation, and
  the exact production promotion;
- the production migration/promotion and final smoke then pass without weakening controls.

## Required owner authorization text

Before W5-B changes any Preview or ephemeral environment, send this exact instruction with real
placeholders filled:

```text
I, joshuai, authorize the RNI Preview rehearsal against <PREVIEW_ORIGIN> and ephemeral Neon branch
<EPHEMERAL_BRANCH_ID> for build <DEPLOYMENT_ID>/<COMMIT_SHA>/<ARTIFACT_SHA>. I authorize applying
the approved forward migration to that ephemeral branch, establishing the immutable Preview
deployment with schedules off, generating and independently reviewing its authority pack, seeding
that pack only into draft config <DRAFT_CONFIG_VERSION>, and separately activating only that
unchanged config in Preview after review. No production resource, universe activation, provider
probe, schedule, heartbeat, model/budget/source-policy change or other config is authorized.
```

Before any G7 live session, send this exact instruction with real placeholders filled:

```text
I, joshuai, authorize the bounded RNI G7 preview checks against <PREVIEW_ORIGIN> using the
configured Preview credentials and the reviewed build <DEPLOYMENT_ID>/<COMMIT_SHA>/<ARTIFACT_SHA>.
Keep schedules and heartbeat paused. Use only the approved per-call and run budgets, run one
provider check at a time, do not activate the production universe or deploy to production, redact
all secrets and raw unrestricted content, and stop on the first source-first, citation, authority,
budget, rights or security failure.
```

Before G8 production action, send a separate approval after reviewing the evidence packet:

```text
I, joshuai, approve RNI G8 for the exact reviewed deployment <DEPLOYMENT_ID>/<COMMIT_SHA>/
<ARTIFACT_SHA>, authority-pack inventory <AUTHORITY_PACK_HASH_INVENTORY>, production config
<PRODUCTION_CONFIG_VERSION>, and staged FMP universe <UNIVERSE_VERSION>. I authorize the documented
production migration and promotion, seeding the named authority pack only if the named production
config does not already contain it, separately activating only that unchanged config, activating
only that staged universe, and running the bounded smoke plan. No other configuration, universe,
model, budget or source-policy change is authorized.
```

## Execution order

1. W5-A performs a non-network credential/environment preflight.
2. After the explicit W5-B authorization, W5-B rehearses migration, establishes the immutable
   Preview deployment, then generates/reviews/seeds/activates the matching Preview authority/config.
3. After the G7 authorization text above, W5-C runs one bounded provider gate at a time.
4. W5-D uses Spark only to collate already-redacted evidence; it makes no live calls or judgments.
5. W5-R independently reviews the full evidence.
6. W5-E presents the G8 decision packet and stops. Only after the separate G8 approval may it
   perform the exact production migration/promotion/smoke.

## Session W5-A — safe environment preflight

**Title:** `RNI W5-A — preview environment preflight`
**Model:** `gpt-5.6-terra`
**Reasoning:** `high`

```text
Start from <W4_ACCEPTED_SHA> and read the full RNI cold-start set, DEPLOY.md and Wave 5. Perform a
read-only, non-network preflight. Validate required environment variable names, nonempty/placeholder
status, server-only placement, typed parsing, expected Preview origin, planned build-identity inputs,
and client-bundle/log redaction. Never print, copy, decode or compare secret values. Do not connect
to providers or databases, seed/activate, deploy, enable schedules, or alter files.

Confirm OpenAI Direct, X, FMP, QStash token and both signing keys, isolated Preview database URLs,
auth/origins, internal dispatch secret, and the exact RNI deployment/commit/artifact identity are
present as required. Treat optional Gateway separately. Return a redacted table of PRESENT,
MISSING, PLACEHOLDER, INVALID-SHAPE or OPTIONAL-DISABLED plus the exact safe remediation names.
Return READY only when an isolated Preview environment—not production data—is targeted.
```

## Session W5-B — preview rehearsal and activation

**Title:** `RNI W5-B — ephemeral migration and preview authority`
**Model:** `gpt-6-astra`
**Reasoning:** `high`

```text
You are the RNI release coordinator. Start from <W4_ACCEPTED_SHA> only after W5-A READY and the user
has supplied the exact W5-B Preview authorization text. Read DEPLOY.md and Wave 5.

Apply/rehearse the approved migration only on an ephemeral Neon branch. Run clean/forward,
normal-origin, concurrency, D-RNI-33/34, readiness/confidence, rollback and complete serialized RNI
PostgreSQL gates. Record redacted branch/deployment identifiers and hashes, never credentials.

First establish the immutable Preview deployment matching the authorized RNI_DEPLOYMENT_ID,
RNI_COMMIT_SHA and RNI_ARTIFACT_SHA256 with schedules/heartbeat paused. Then regenerate the complete
authority pack against that exact deployed build, obtain independent hash/content review, seed it
only into the authorized draft configuration, inspect redacted inserted/duplicate results, and
separately activate only that unchanged Preview configuration. Stop if deployment, build, pack or
config identities differ at any point.

Do not call OpenAI, X, FMP or Gateway yet; do not target production; do not activate a universe;
do not loosen budgets or policies. Stop on any hash mismatch, crossed config/build, migration drift,
secret exposure or failing test. Return the exact preview origin/build/config IDs and redacted
evidence needed for the G7 authorization message.
```

## Session W5-C — bounded live G7 gates

**Title:** `RNI W5-C — live G7 coordinator`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
You are the sole live G7 coordinator. Do not begin until the user has supplied the exact Wave 5 G7
authorization text and W5-B reports a matching preview build/config with schedules paused. Read
DEPLOY.md and Wave 5. Never reveal credentials, authorization headers, unrestricted evidence or raw
provider payloads. Use persisted budgets and approved task envelopes; do not retry with looser
settings.

Run one bounded gate at a time in this order, reviewing the prior result before continuing:

1. OpenAI Direct Reddit discovery: persist at least five live Reddit post/comment sources with
   original/canonical URLs, bounded content, capture mode, retrieval/content identity and commit
   before semantic work. Prove citations and no whole-page HTML.
2. Existing X adapter: run independently and record slice status, coverage and freshness. Do not
   disable credentials, change source policy or intentionally break the provider to create a live
   failure. Use Wave 4's deterministic failure-path evidence to prove no Reddit fallback or
   relabeling; record a naturally occurring live partial state if one occurs.
3. FMP /stable/sp500-constituent: validate 501–600 unique members including NVDA, schema/hash and
   entitlement; stage only and produce impact. Do not activate.
4. QStash: prove signed preview worker delivery, current/next key rotation, redelivery idempotency,
   busy retry and exact manifest/lease authority. Keep heartbeat disabled.
5. Gateway only if the planned launch enables it: use a future-run test configuration pinned to
   OpenAI with exact evaluated model metadata and no fallback, then restore Direct default.
6. Authenticated preview full story: named ticker plus comparative source, separate Reddit/X/
   combined output, confidence and honest-state rendering, sentence citations, bounded raw explorer, freshness,
   budgets and disclosures; then a deterministic full-universe resume/atomic closeout over
   already-persisted Preview artifacts with provider calls disabled. A live 501-member acquisition
   run requires separate owner authorization naming its manifest, allocation and maximum cost.

After each gate, record only redacted request/response hashes or IDs, counts, timings, cost/usage,
slice classification, persisted durable IDs and pass/fail reasons. Stop immediately on source-first,
citation, manifest, lease, budget, rights, auth, privacy or unexpected production-target failure.
Do not update code to make a live result pass. Return a complete G7 handoff and leave schedules off.
```

## Session W5-D — mechanical evidence collation

**Title:** `RNI W5-D — redacted G7 evidence index`
**Model:** `gpt-5.3-codex-spark`
**Reasoning:** `high`

```text
Collate the already-redacted W5-A/B/C outputs into the Wave 5 evidence index. Do not read environment
values, access providers/databases, rerun commands, edit source, decide pass/fail, approve hashes,
deploy, activate or make security judgments. Map each G6/G7/G8 requirement to its evidence ID,
build/config/universe identity, test result and reviewer status. Flag missing or inconsistent fields
for W5-R. Preserve redaction and do not include raw post content or secret-like values.
```

If Spark is unavailable, use `gpt-5.6-terra` medium. Spark's report is an index, not acceptance.

## Session W5-R — independent release review

**Title:** `RNI W5-R — G7 evidence review`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
Review the exact W4 build and complete redacted W5 evidence read-only. Confirm migration rehearsal,
authority/build/config equality, five-source source-first Reddit proof, independent X, valid staged
FMP impact, signed/idempotent QStash, optional Gateway constraints, budgets, rights/citations,
failure states, no fixture fallback, no uncited sentence, rollback readiness and schedules paused.
Cross-check durable identities rather than trusting screenshots or self-reported PASS labels.

Return P0/P1/P2 findings and an explicit PASS only when G7 is complete. Do not edit, use credentials,
call providers, seed/activate, deploy, activate the universe, or approve G8.
```

## Session W5-E — G8 decision and authorized production smoke

**Title:** `RNI W5-E — owner closeout`
**Model:** `gpt-6-astra`
**Reasoning:** `xhigh`

```text
You are the RNI release coordinator. Assemble the G8 decision packet from the independently reviewed
evidence: exact commit/deployment/artifact/config/authority hashes; approved decisions; migration and
restore evidence; complete test matrix; G7 results; staged FMP impact; cost headroom; source/terms/
retention and disclosure review; rollback rehearsal; monitoring; and exact production smoke plan.

Present it to joshuai and stop. Do not infer approval and do not deploy, migrate production, activate
the universe/config, enable schedules or run production providers until the user supplies the exact
separate Wave 5 G8 approval text.

After that approval only, verify every named identity still matches, seed/activate only the exact
named authority pack and production config if needed, perform only the documented production
migration/promotion and staged universe activation, then run bounded production smoke:
login, health, manual named-ticker run, independent source state, citations to bounded evidence and
original URL, raw explorer escaping, freshness, budget ledger, and read-only MCP/no-trading boundary.
Inspect the already-proven deterministic honest partial/failure rendering; do not disable a
credential, alter source configuration or force a production provider outage. Keep schedules off
until smoke passes; enable only the separately approved schedule afterward. On any mismatch/failure,
stop, pause schedules, follow the approved rollback and do not rewrite historical runs.

Record production approval timestamp and redacted evidence in coordinator-owned progress only after
all smoke gates pass. Then, and only then, mark G6–G8 and RNI 1.0 complete and return the final exact
deployment/config/universe identities and rollback reference.
```

## Wave 5 exit gate

Completion requires W5-R PASS, the separate explicit G8 approval, successful authorized production
smoke, and coordinator progress showing G0–G8 passed. A code commit, preview, fixture run, existing
credentials, or live provider success alone is not RNI 1.0 completion.
