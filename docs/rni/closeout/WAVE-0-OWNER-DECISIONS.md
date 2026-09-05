# RNI 1.0 Wave 0 — owner decision packet

**Status:** `PROPOSED_AWAITING_JOSHUAI_APPROVAL`
**Prepared:** 2026-09-05
**Effect of approval:** authorizes frozen contracts and local implementation through Waves 1–4;
does not authorize secrets, providers, deployment, configuration activation, G7, or G8.

## Decision 1 — D-RNI-34 evidence and work identity

Approve these identities:

- A source is the stable external object: `(platform, external_id)` when present, otherwise
  `(platform, canonical_url)`. Conflicting external-ID and URL matches fail closed.
- A content version is the analytical evidence identity. `content_sha256` hashes the exact UTF-8
  bounded-content bytes emitted by the named normalization version.
- The content-evidence hash is SHA-256 over canonical JSON containing version
  `rni-content-evidence-v1`, source ID, platform, source kind, normalization version, capture mode,
  and content SHA-256. Retrieval time/rank/request ID, URL and volatile metadata are excluded.
- Any title or metadata made model-visible later must enter a new versioned evidence hash first.
- Every acquisition observation is an immutable retrieval. Its `rni-retrieval-event-v1` replay key
  contains exact `runId`, `platformSliceId`, `acquisitionAttemptId`, explicit nullable
  `providerRequestId`, zero-based `resultOrdinal`, and `sourceItemId`; no field is defaulted or
  omitted. Exact replay reuses the key and a later observation receives a new attempt identity.
- Add one immutable retrieval-to-content association. Content deduplicates by source and evidence
  hash; every retrieval remains durable provenance, links to exactly one content version, and stores
  explicit nullable `priorObservedContentVersionId` so A→B→A order survives tied timestamps.
- Add one outbox event per retrieval-to-content association rather than per content version.
- Semantic work identity is SHA-256 over version `rni-source-work-v3`, run ID, worker-manifest hash,
  platform-slice ID, content-version ID, stage `interpret_source`, and stage version. Retrieval ID
  is provenance, not part of the work key.
- Same content rediscovered within the same run reuses completed semantic work. Another run creates
  new run membership; inference reuse requires exact prompt/model/policy/input identity.
- A→B→A produces one source, three retrievals/associations/outbox events, two content identities,
  and two work identities within one run. Same bytes under a different capture mode or normalization
  version are different content identities.
- Historical v1 rows remain readable but cannot authorize new v2 effects.

## Decision 2 — multi-security semantic completion

Approve one database-derived completion manifest per content-scoped work identity:

- Persist all resolved mentions and all unresolved/abstained spans.
- The security list contains exactly one entry for each distinct resolved security, sorted by
  lowercase UUID, with ordinal, security ID, observation ID, `classified|insufficient`, and the
  existing exact unrounded D-RNI-22 semantic-output hash.
- Resolution with no security is a valid `no_resolved_security` outcome, not a fake observation or
  provider failure.
- Every v2 mention, unresolved span, observation membership, comparative relation and relationship
  terminal receipt binds the exact `contentVersionId`. Existing source-scoped semantic rows remain
  historical/readable but effect-ineligible for v2 work.
- Relationship inference is required for two or more resolved securities.
- Relationship terminal outcomes are represented by exact `required`, `outcome`, nullable
  `invocationId`, nullable `relationSetHash`, and sorted `relationIds`:
  - `not_applicable`: `required=false`, `invocationId=null`, `relationSetHash=null`,
    `relationIds=[]`;
  - `complete_empty`: `required=true`, non-null `invocationId`, `relationSetHash=hash([])`,
    `relationIds=[]`;
  - `complete_nonempty`: `required=true`, non-null `invocationId`, non-null `relationSetHash`, and
    nonempty `relationIds`;
  - `failed`: `required=true`, non-null `invocationId`, `relationSetHash=null`, `relationIds=[]`,
    durable failed/refused/invalid error receipt, and no semantic-completion hash or checkpoint.
- Normalize inverse preference to `preferred_over`; sort symmetric endpoints. Canonically order
  relations by subject, relation, object, supporting offsets and evidence-text hash.
- Canonically order unresolved spans by start offset, end offset, reason, mention-text hash and then
  sorted candidate-security IDs.
- The aggregate hash covers version `rni-source-semantic-completion-v1`, run/manifest/platform,
  source/content identity, resolver input and resolved/unresolved set hashes, exact security entries,
  and relationship terminal identity/membership.
- PostgreSQL reconstructs membership. Missing, extra, duplicate or crossed security, observation,
  content, unresolved-span, relationship or hash data rejects completion.
- Persisted partial results remain downstream-invisible until exact completion exists.

## Decision 3 — D-RNI-33 database-owned release reconstruction

Approve a finalizer whose authority input is only `runId` and the live combined fence:

- PostgreSQL locks and reconstructs the expected v2 worker manifest, ordered universe members,
  cutoff, Reddit/X terminal receipts, selected synthesis/convergence lineage, member decisions,
  rights state, run/job/execution terminal state and budget settlement.
- Full outer-join and count checks reject missing, extra, duplicate, reordered or crossed members.
- Recompute the member-index hash, member statuses, counts and complete aggregate hash internally.
- Status is `insufficient` when all members are insufficient; `complete` only when both slices and
  all members are complete; otherwise `partial`.
- PostgreSQL writes JSON and scalar projections from the same reconstructed value. Caller JSON and
  hashes are not authority.
- Every nullable comparison uses `IS DISTINCT FROM` with explicit required-key/type checks.
- Release, receipt, terminal run/job/execution, budget release and all read visibility commit or
  roll back together. Concurrent exact finalization replays; crossed finalization fails.
- Rights withdrawal before commit aborts the transaction.

## Decision 4 — manifest-bound acquisition policy v1

Approve `rni-acquisition-policy-v1`:

### Planning and limits

- Canonical Reddit community order is group `PRIMARY`, `CONCENTRATED`, `SECTOR_TICKER`,
  `LONG_HORIZON`, then case-folded community key, then exact key.
- Scheduled Reddit uses all 24 enabled communities in three canonical chunks of eight. It never
  creates ticker×community searches.
- Each scheduled discovery invocation returns at most 50 candidates and uses the governed maximum
  of three Web Search calls. The full scheduled semantic-selection ceiling is 20 content versions.
- On-demand Reddit uses one invocation containing all enabled communities and one selected security
  with approved aliases, returns at most 20 candidates, uses at most three Web Search calls, and
  selects at most three content versions for semantics.
- X query configuration records a nonempty canonically sorted `modes` subset of `scheduled` and
  `on_demand` plus canonically sorted `securityIds`. Scheduled eligibility requires `scheduled`;
  on-demand eligibility requires `on_demand` and either an empty security set or the requested
  security ID.
- Scheduled X selects at most 20 eligible queries, with `maxResults=20` per query and a full-slice
  semantic-selection ceiling of 20 content versions. On-demand X selects at most two eligible
  queries, with `maxResults=20` per query and a semantic-selection ceiling of three.
- For X query planning, sort eligible query IDs, transactionally assign monotonic integer
  `rotationSequence`, and begin cyclic selection at
  `(rotationSequence × queryCeiling) mod eligibleCount`, where `queryCeiling` is 20 scheduled or
  two on-demand.
- Scheduled Reddit semantic selection has its own transactional community rotation sequence. Begin
  the cyclic canonical community order at `(rotationSequence × 20) mod enabledCommunityCount`, then
  take one highest-ranked, not-yet-selected candidate from a new duplicate group per community per
  pass until 20 or exhaustion. Platforms never borrow calls, candidates or spend.

### Ranking and duplicates

- Reject rights, identity, window, bounded-content, citation and publication-time failures first.
- Rank by alias class (exact cashtag, ticker, company/approved alias, no match), then publication
  time descending, full capture before excerpt, provider rank, canonical URL, and content hash.
- Preserve every source and retrieval. Changed hashes remain separate content versions.
- Identical text from distinct sources shares an exact-duplicate group; only the highest-ranked
  representative receives semantic dispatch.
- Near-duplicate normalization is Unicode NFKC, locale-independent lowercase, replacement of every
  `https?://\S+` substring with literal `<url>`, tokenization into maximal Unicode Letter/Number
  sequences, and whitespace collapse. Form the set of consecutive five-token shingles joined by
  U+001F; fewer than five tokens form one whole-token-sequence shingle, while no tokens produces an
  empty set. Empty-set near similarity is zero. Jaccard `>=0.90` groups within the same
  platform/window.
- Before exemplar assignment, sort candidates by normalized-content hash, canonical URL and source
  ID. Assign a candidate to the first prior exemplar meeting the threshold; when several match,
  choose the lexicographically lowest exemplar tuple. This makes assignment independent of provider
  enumeration. Near duplicates stay auditable but do not increase independent breadth.
- Scheduled Reddit selection round-robins communities, taking at most one candidate per duplicate
  group per pass until 20. On-demand uses the global rank and selects at most three.
- Scheduled X candidate selection round-robins the selected canonical cyclic query order, taking
  one highest-ranked, not-yet-selected candidate from a new duplicate group per query per pass until
  20 or exhaustion. On-demand X uses the global rank and selects at most three.

### Retries and coverage

- Maximum three attempts per planned unit. Retry only network interruption, timeout, HTTP
  408/429/5xx or an explicit retryable provider error.
- Never retry rights, authentication, entitlement, budget, schema, invalid URL/content or policy
  failures.
- Deterministic full-jitter is
  `cap=min(30000,1000×2^(attempt-1))` and
  `delayMs=uint64_be(first 8 bytes SHA256(manifestHash|platform|unitId|attempt)) mod (cap+1)`.
- Provider `has_more`, output/tool cap termination or candidate ceiling without affirmative
  completeness records truncation. Valid overflow is `deferred`, not truncation.
- Store exact planned/attempted/terminal/complete/partial/failed/unavailable and
  returned/accepted/rejected/selected/deferred/truncated counts.
- Work coverage is `(2×complete + partial)/(2×planned)`. Semantic completion is
  `completed_selected/selected`; zero selected is explicitly not applicable.
- `complete`: all units complete, none truncated/partial/failed/unavailable, every candidate has a
  terminal decision. `partial`: usable data plus any gap. `unavailable`: no usable unit and every
  terminal reason is capability/entitlement/quota/circuit/budget unavailability. `failed`: no
  usable unit and another failure exists.
- If no X query is eligible, persist `planned=0`, acquisition status `unavailable`, exact reason
  `no_applicable_configured_query`, and `workCoverage=null` with applicability `not_applicable`.
- All units completing with zero candidates is acquisition complete with `zero_candidates=true`;
  downstream sentiment is insufficient, never failed or neutral.

## Decision 5 — readiness policy v1

Approve `rni-readiness-policy-v1` immutable eval, narrative and catalyst/challenger receipts. Each
binds manifest/run/platform/security/cutoff, policy/config/build/stage/code authority, exact
relational membership, input/output hashes, terminal status/reason and creation/expiry where
applicable. Receipt JSON cannot assert its own pass.

Receipt rows are immutable and terminal with status `pass`, `not_applicable`, `failed` or
`unavailable`; pending work has no terminal receipt. The only successful `not_applicable` reasons
are `relationship_not_required`, `no_eligible_claims`, `no_eligible_catalyst_claims`, and
`metric_not_applicable_to_stage`, each only for its named stage. A generic `skipped` reason never
passes readiness.

The exact `failed` reasons are `network_retry_exhausted`, `provider_nonretryable_failure`,
`invalid_provider_response`, `schema_validation_failed`, `rights_policy_rejected`,
`source_identity_invalid`, `citation_binding_failed`, `membership_mismatch`, `cutoff_violation`,
`stage_failed`, and `eval_gate_failed`. The exact `unavailable` reasons are
`no_applicable_configured_query`, `provider_entitlement_unavailable`,
`provider_quota_unavailable`, `provider_capability_unavailable`, `provider_circuit_open`,
`budget_unavailable`, and `applicable_eval_unavailable`. Provider detail is stored separately as
bounded redacted diagnostics and never enters the canonical reason hash.

### Eval

- Match exact provider/model revision, prompt, schemas, tools, source/capture slice, task and
  dimension.
- Thresholds: resolution 0.97; ambiguous abstention recall 0.95; mention recall 0.96; sentiment
  macro-F1 0.85; relation 0.88; claim 0.85; theme 0.82; narrative 0.82; social-catalyst assessment
  0.90; citation completeness 1.00; entailment 0.95; abstention precision 0.95;
  deterministic metrics/lineage 1.00; prompt-injection violation rate 0.
- Require at least 100 adjudicated real-evidence examples per applicable task and 25 per important
  named slice. Synthetic examples do not meet floors. The exact required-slice manifest is:
  resolver `symbol_collision|company_alias`; mention `comparative_post`; sentiment every
  Reddit/X × four frozen dimensions plus `sarcasm`; relation `preferred_over|pair_trade`; claim
  `long_post|quoted_speech`; theme `new_theme|rare_theme`; narrative
  `repost_family|opposing_claim`; social catalyst `supported|contradicted`; citation completeness
  `reddit|x|combined`; citation entailment `primary|social_verification`; abstention
  `low_coverage|ambiguity`; deterministic metrics `window|timezone|empty_baseline`; lineage
  `deletion|rerun`; and prompt injection `reddit|x`.
- Point estimates must pass. Persist 95% Wilson intervals for proportions. For F1/MAE, use 10,000
  stratified bootstrap replicates with replacement, preserving each required slice's original
  sample count. Draw index `j` for replicate `r` from stratum `s` as
  `uint64_be(first 8 bytes SHA256("rni-bootstrap-v1"|evalSetHash|metricKey|s|r|j)) mod stratumSize`;
  `r` is zero through 9,999 and `j` is zero through `stratumSize-1`; aggregate using original
  stratum sizes. Sort the 10,000 replicate metrics ascending and use nearest-rank index
  `ceil(p×10000)-1`: index 249 for 2.5% and 9,749 for 97.5%. Intervals are disclosed, not another v1
  pass condition.
- Wilson intervals are two-sided 95% with exact decimal
  `z=1.959963984540054`; calculate the standard Wilson center and half-width with decimal arithmetic,
  clamp endpoints to `[0,1]`, and encode each endpoint as a half-even 12-decimal string in the
  receipt hash.
- Validity is selector-derived from the immutable receipt as the half-open interval
  `[evaluatedAt, evaluatedAt + 30 days)`. A bound-authority mismatch makes the selector reject the
  receipt without mutating it. Run acceptance must fall inside the interval.
- Only an explicitly enumerated `not_applicable` reason may satisfy readiness. A generic skipped
  receipt never passes.

### Narrative

- No new model task. Eligible membership is the exact current-window, cutoff-valid E05 claim set
  connected to positive-weight E06 observations.
- Begin with one singleton narrative per eligible claim. Claims may share a deterministic narrative
  only when security, claim type/dimension, direction, horizon and normalized claim fingerprint are
  all exactly equal. Acquisition duplicate groups determine repetition/independence only; they do
  not establish narrative equivalence.
- Normalize claim text with version `rni-claim-fingerprint-v1`: Unicode NFKC,
  locale-independent lowercase, replace `https?://\S+` with `<url>`, tokenize maximal Unicode
  Letter/Number sequences, and join tokens with U+001F. The fingerprint hashes the version,
  normalized text, security ID, claim type/dimension, direction and explicit nullable horizon.
- Every eligible claim belongs exactly once. Within a valid shared narrative, the lowest claim ID
  inside each distinct acquisition duplicate group is independent; only additional claims from
  that same duplicate group are repetition. Independently sourced matching claims therefore remain
  independent memberships. Opposing directions cannot share a narrative.
- Empty membership is `not_applicable:no_eligible_claims`; crossed, pending, missing or invalid
  membership never passes.

### Catalyst/challenger

- Reuse E08/I07 rows as the sole truth store. Applicability is the complete persisted E08
  catalyst-claim membership for the exact run/platform/security/cutoff.
- Verifier dispatch occurs iff at least one member claim's platform is E07-ready. A non-ready claim
  may terminate only as `unverified`. No members requires verifier and challenger skips with exact
  reason `no_eligible_catalyst_claims` and a `not_applicable` receipt. Members but no E07-ready claim
  requires verifier skip `no_e07_ready_catalyst_claims`; the receipt cannot pass until every claim
  has an allowed terminal assessment.
- Require exact assessment and verifier lineage for every applicable claim. Challenger dispatch
  occurs iff at least one assessment is not `unverified`. All-unverified output requires exact
  challenger skip `all_assessments_unverified` and may produce a `pass` lifecycle receipt without
  implying factual support.
- `supported`, `contradicted`, `contested` and `unverified` are lifecycle-terminal; terminal does not
  imply factual support.
- Post-cutoff, self-corroborating, crossed or skipped-as-success evidence fails. Missing
  `publishedAt` blocks corroborating/counterevidence; the originating social claim may retain null
  publication time when its persisted discovery and observation times satisfy the cutoff.

## Decision 6 — confidence and post-E08 publication v1

Approve `rni-confidence-method-v1`, exact decimal arithmetic, and null confidence whenever a
required fact/receipt is missing or has a zero denominator.

### Components and weights

| Component | Weight | Normalization |
|---|---:|---|
| Provenance integrity | 0.20 | Weighted mean of four binary/half-quality facts: identity, committed lineage, timestamp quality, citation/span integrity |
| Evidence quality | 0.20 | Weighted semantic quality; when catalyst applies, `0.8×quality + 0.2×verdict quality` |
| Security resolution | 0.15 | Weighted mean resolution confidence |
| Breadth/independence | 0.15 | `0.35×min(sources/5,1) + 0.25×min(clusters/3,1) + 0.25×min(narratives/3,1) + 0.15×(1-narrativeHHI)` |
| Model calibration | 0.15 | Minimum applicable passing eval quality; ordinal MAE maps to `1-min(MAE/4,1)` |
| Coverage/recency | 0.10 | `0.4×workCoverage + 0.3×semanticCompletion + 0.3×2^(-maxAgeHours/24)` |
| Contradiction handling | 0.05 | Mean approved claim/challenger handling; 1 when not applicable |

For evidence item `i`, provenance facts are: identity 1 only when the persisted native/canonical
identity and original HTTP(S) URL validate; committed lineage 1 only when source, retrieval,
content, association, outbox and checkpoint precede interpretation; timestamp quality 1 for verified
`publishedAt` at/before cutoff, 0.5 for cutoff-valid observed/discovered-only evidence, otherwise 0;
and citation/span integrity 1 only when every cited span and URL validates, otherwise 0 plus the
existing hard publication block. `P_i` is the arithmetic mean of these four facts and provenance is
`sum(w_i×P_i)/sum(w_i)`.

Evidence quality per item is
`q_i=informationValue_i×evidenceQuality_i×assertionStrength_i`, each exact `[0,1]`. Let
`Q=sum(w_i×q_i)/sum(w_i)`. When catalyst readiness applies, evidence quality is
`0.8×Q+0.2×mean(verdictQuality)`; otherwise it is Q.

Model calibration takes the minimum applicable normalized point estimate across the exact passing
eval receipts required by the stage graph: resolver accuracy/abstention/mention recall; classifier
macro-F1 and ordinal MAE; relationship F1 when required; claim/theme/narrative metrics when present;
social-catalyst F1 when applicable; citation completeness/entailment; abstention; deterministic
metrics; lineage; and injection resistance. Rate/F1 metrics use `[0,1]` point estimates, ordinal MAE
uses `1-min(MAE/4,1)`, and prohibited-instruction rate uses `1-rate`. A missing, stale or failing
applicable receipt makes confidence unavailable.

For breadth, `independentSourceCount` is the number of distinct acquisition duplicate groups with
positive effective observation weight. `clusterAdjustedCommunityCount` is the number of distinct
configured community-cluster IDs represented by those groups; an unclustered community is the
singleton ID `community:<communityKey>`. `independentNarrativeCount` counts narrative IDs containing
at least one membership marked independent and connected to positive weight. Narrative effective
weight is the sum of its independent memberships' positive weights, and
`narrativeHHI=sum((narrativeWeight/totalNarrativeWeight)^2)`.

`maxAgeHours` is the maximum across included positive-weight evidence of
`(assessmentCutoff-(publishedAt ?? observedAt))/3600` using exact instants. A future timestamp or
missing fallback `observedAt` rejects the assessment.

Verdict quality is supported 1, contested 0.5, contradicted 0, unverified 0. Claim handling scores 1
when supported with no omitted known contradiction or when contradiction/contest is cited; completed
unverified scores 0.5; otherwise 0. Challenger handling scores 1 for a represented material
challenge or explicit no-supported-challenge result, 0.5 for the all-unverified policy skip, else 0.
When catalyst/challenger is applicable, contradiction handling is
`(mean(claimHandling)+challengerHandling)/2`; otherwise it is 1.

### Penalties, caps and publication

- Claim effective weight is the sum of distinct supporting positive-weight E06 source/security
  observation weights, counting each observation once. Claim weight share divides that value by
  total positive E06 observation weight for the same platform/security. A material unresolved claim
  is a distinct current-window normalized claim fingerprint with share at least 0.10,
  `assertionStrength>=0.5`,
  `informationValue>=0.5`, and an E08 assessment of `unverified` or a missing required terminal
  assessment. Count those fingerprints; penalty is `min(0.30,0.15×count)`.
- For each item, `noiseLoss_i=1-((1-sarcasm_i)×(1-spam_i)×(1-0.9×meme_i))`. `noiseShare` is
  `sum(wWithoutNoise_i×noiseLoss_i)/sum(wWithoutNoise_i)`, using the exact positive observation
  weight before its noise discount. High-noise penalty is zero below 0.30, otherwise
  `0.20×noiseShare`.
- Suspected coordination: zero at concentration `<=0.60`, otherwise
  `0.25×(concentration-0.60)/0.40`, capped at 0.25. Concentration is the maximum available narrative,
  duplicate-group and permitted-author HHI. Display copy describes concentration, not misconduct.
- Duplicate-group and author HHI each equal
  `sum((groupPositiveEffectiveWeight/totalPositiveEffectiveWeight)^2)`. When policy forbids author
  identity, author HHI is null and excluded from the maximum; when author identity is permitted,
  missing author hashes share one explicit `unknown` group.
- Route-capability-degradation penalty is present with value zero in v1. Any capability degradation
  or provider/model/prompt/schema/tool identity mismatch is a hard block, not a scored penalty.
- Compute `uncappedUnit=clamp(base-sum(penalties),0,1)`, then
  `uncappedScore100=100×uncappedUnit`, then
  `cappedScore100=min(uncappedScore100, all applicable score-100 caps)`, then
  `score100=round_half_even(cappedScore100,0)`.
- Caps: one independent source or cluster 69; narrative HHI `>=0.80` caps 69; acquisition status
  `partial` or platform-slice status `partial` caps 69; maximum evidence age `>=24h` caps 39.
- Bands: `<40 LOW`, `40–69 MEDIUM`, `70–84 HIGH`, `85–100 VERY_HIGH`.
- Evidence floors: effective attention at least 0.5 and at least two independent duplicate groups.
- Publication threshold is inclusive score `>=40`, every required receipt status is `pass` or an
  allowlisted `not_applicable`, E07 is fresh complete/partial, and every rights/citation/cutoff/
  lineage guard passes.
- Stale, unresolved-security, failed critical stage, invalid rights or invalid citations withhold
  regardless of score.

### Lifecycle

```text
E06 -> E07 -> durable hidden E08
-> immutable platform confidence assessment
-> immutable platform publication decision
-> atomic ticker/full-universe visibility
```

- The assessment binds exact E06/E07/E08, readiness receipts, manifest, cutoff, method, facts,
  components, penalties, caps, score/band or unavailable reason and hard blocks.
- PostgreSQL reconstructs membership. E08 cannot be read through public result/citation/evidence
  paths before release.
- Reddit and X decisions remain separate. Combined status cannot pool or transfer confidence.
- Full-universe release requires a terminal decision for every member/platform; one crossed or
  missing decision rolls back the entire release.
- Rights are revalidated at commit; exact replay reuses E08 and the assessment without redispatch.

Golden confidence vector with no penalties:

```text
P=.875, Q=.8, R=.95, B=.6183333333,
M=.9, C=.9121320344, H=1
base=.8464632033
score100=85
band=VERY_HIGH
```

## Decision 7 — migration allocation

Migration `0024` is pushed and has been changed repeatedly. It is not merged to `origin/main`, but
the repository cannot prove it has never been applied to a non-disposable target, and the migration
runner rejects checksum drift. Therefore:

- Do not edit Migration `0024`.
- Reserve `apps/web/migrations/0025_rni_wave1_identity_release.sql` for the Wave 1 coordinator.
- Later Wave 2/3 schema must extend `0025` only while the coordinator can prove it remains unapplied
  to every non-disposable target; otherwise allocate the next forward migration.
- Clean and populated forward migration tests plus ephemeral Neon rehearsal remain mandatory.

## Canonical identity rules

- SHA-256 as lowercase 64-character hex over UTF-8 canonical JSON.
- Code-unit-sorted object keys; deliberately ordered arrays preserved; sets sorted first;
  `undefined` omitted and explicit `null` retained.
- UUIDs lowercased, instants normalized to UTC with six fractional digits, ordinals/counts are JSON
  integers, and all other numeric identities use exact decimal strings.
- Every hash domain has an explicit version tag. PostgreSQL and TypeScript share golden canonical
  bytes and digests. No caller hash substitutes for durable membership reconstruction.

## Required acceptance examples

- Same-content replay, changed A→B, A→B→A, same bytes/different capture, and concurrent capture.
- NVDA/AMD opposing observations plus preferred-over relation; successful-empty relationship,
  relationship failure, and all-unresolved result remain distinct.
- Direct-SQL missing/extra/duplicate/crossed/null/forged 501-member release attacks fail atomically.
- Reordered community/query/member inputs retain canonical hashes.
- Jaccard 0.900000 groups and 0.899999 does not.
- All planned units completing with zero returned/accepted candidates is acquisition complete plus
  downstream insufficient; mixed usable/failure is partial; all entitlement failure is unavailable.
- Expired/mismatched eval, missing/opposing narrative membership, post-cutoff catalyst evidence and
  skipped-as-success fail readiness.
- Missing readiness yields null confidence; partial coverage caps 69; stale caps 39; raw 39.5
  half-even rounds to 40 and meets the inclusive threshold; raw 38.5 rounds to 38 and withholds.
- One passing platform and one unavailable platform yields only the passing platform plus combined
  partial; confidence never transfers.
- Rights withdrawal before release leaves nothing visible.

## Exact approval text

```text
I, joshuai, approve all seven decisions in docs/rni/closeout/WAVE-0-OWNER-DECISIONS.md as written,
effective 2026-09-05: D-RNI-34 evidence/work identity; content-scoped multi-security completion and
relationship terminals; D-RNI-33 PostgreSQL-owned release reconstruction; acquisition policy v1;
readiness policy v1; confidence/post-E08 publication v1; and forward Migration 0025 allocation.
I authorize the coordinator to freeze the corresponding contracts, schema, hashes and fixtures and
to implement and test Waves 1–4 using Sol/Terra agents in isolated worktrees. Preserve historical
v1 readability, keep only v2 effect-eligible, and keep live providers, secrets, configuration
activation, deployment, G7 and G8 unauthorized until their separate Wave 5 approvals.

I explicitly reject scheduled ticker×subreddit fan-out; Reddit/X fallback or budget reallocation;
provider-order authority; deletion of distinct duplicate/near-duplicate sources; treating any
terminal receipt as factual support; adding a narrative model task; substituting missing facts with
zero; calculating confidence before durable E08; pooling or transferring confidence between
platforms; and exposing staged E08 artifacts. Wave 0 approval does not itself complete G6.
```

To change anything, approve the unaffected decisions and list the exact replacement for each
changed decision. Implementation remains stopped for any unapproved decision.
