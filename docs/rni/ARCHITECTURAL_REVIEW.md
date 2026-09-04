# Retail Narrative Intelligence — Final Adversarial Architectural Review

**Review date:** 2026-09-04  
**Review scope:** PRD, architecture, development plan, deployment runbook, agent rules, data model/lineage, MCP, UI, evals/guardrails, OpenAI/token optimisation  
**Review posture:** hostile failure analysis, not design restatement  
**Verdict:** **conditionally fit for a five-day evidence-led demo; not a claim of exhaustive social surveillance or production investment signal quality**

## 1. Executive judgement

The design is coherent around its strongest invariant: a canonical original URL and bounded evidence record are committed before interpretation. It correctly treats multi-ticker language as one source with independent security observations, separates semantic model work from deterministic measurement, makes citations relational data, and uses immutable configuration/run versions. The live Web Search spike supports the proposed narrow use: sampled post discovery with bounded persistence—not firehose collection, complete comments, or exact attention-volume claims.

The most serious challenge is measurement validity. “Attention” derived from search-discovered samples is attention within the captured sample, not Reddit-wide retail attention. The design prevents overclaiming through coverage modes, freshness, breadth/concentration, and publication gates, but the demo team must reinforce that language in every presentation. If exact platform-wide volume is made a core promise, the current acquisition path is not fit.

The architecture is therefore approved for implementation under eight conditions:

1. keep Web Search metrics explicitly sample-relative;
2. complete current source terms/retail-access review before enabling a source;
3. implement source-first database constraints/outbox before agents;
4. prove the comparative-post fixture across DB, pipeline, UI, and MCP;
5. enforce sentence-level citation completeness and entailment before publish;
6. calibrate confidence/eval thresholds on real adjudicated examples;
7. use durable idempotent stage execution, not a single long request;
8. rehearse an honest insufficient-evidence/partial-coverage live outcome.

## 2. Review method

The review traced the following adversarial paths through every artifact:

- source discovered but content incomplete;
- source saved after model interpretation;
- comparative source with stance leakage;
- exact subreddit versus analytical community cluster;
- duplicate cron/queue/user delivery;
- ambiguous common-word ticker;
- source prompt injection;
- unsupported synthesis citation;
- stale/partial acquisition shown as fresh/neutral;
- provider fallback changing semantics;
- taxonomy/prompt changes rewriting history;
- cross-tenant UI/MCP access;
- retail-only data constraint violation;
- five-day delivery pressure and scope collapse;
- live named-ticker sparse evidence.

Internal checks confirmed every requested artifact exists and local Markdown cross-links resolve. No unfinished placeholder markers or obsolete licensed-feed coverage mode remains.

## 3. Findings and dispositions

### F-01 — Search sample cannot support population-level attention claims

**Severity:** Critical if misrepresented; Medium under specified disclosures.  
**Attack:** Search ranking/retrieval changes can look like attention change even when underlying discussion is unchanged. Exact scores/comments and full comment coverage were inconsistent in the live spike.  
**Existing controls:** `REDDIT_SAMPLED_WEB_DISCOVERY`, independent `X_CONFIGURED_SAMPLE`, source/retrieval trace, per-platform data-through and coverage states, breadth/concentration, limitation summary, suppression on incompatible coverage, no completeness claim.  
**Required action:** name the metric “captured-sample attention” in sampled mode; do not compare against API/other coverage modes; persist search query/provider/rank and result counts; add repeated-query variance eval.  
**Residual risk:** search-engine selection bias cannot be eliminated; it can only be disclosed and bounded.

### F-02 — “Persist original” could be confused with archiving a webpage

**Severity:** High.  
**Attack:** an implementer stores full HTML, unrelated comments, hidden text, cookies, or page chrome, creating rights, privacy, security, and token problems.  
**Existing controls:** explicit bounded capture levels, source content version, rejection tests, escaped rendering, AGENTS rule, UI/MCP contracts.  
**Required action:** enforce content-type/size/schema allowlist in ingestion; do not expose an arbitrary-HTML column; add a test fixture containing malicious hidden instructions.  
**Residual risk:** a returned “post body” may itself include quoted material; retention/source policy must cover it.

### F-03 — Source-first sequencing needs enforcement beyond convention

**Severity:** Critical.  
**Attack:** a worker sends text to a model, then fails before source persistence; an interpretation exists without evidence lineage.  
**Existing controls:** source transaction + outbox, FK from model input evidence, event emitted after commit, workflow checkpoints.  
**Required action:** prevent agent runner from accepting raw text; require committed `source_content_version_id`; add crash-before/after-commit integration tests.  
**Residual risk:** provider request logs may contain pre-persistence discovery text; treat as restricted ephemeral acquisition telemetry with a documented retention rule.

### F-04 — Multi-security classification can leak stance between names

**Severity:** Critical to product meaning.  
**Attack:** “prefer NVDA over AMD” becomes bullish for both or one source-level sentiment copied to every ticker.  
**Existing controls:** no source-sentiment field, per-mention/security/dimension observations, relation table, span requirements, worked fixture and eval gate.  
**Required action:** make the worked comparison a blocking test in all implementations and include quoted/opponent speech variants.  
**Residual risk:** complex baskets and pronouns remain error-prone; abstain or escalate ambiguous relations.

### F-05 — Community clustering could hide concentration

**Severity:** High.  
**Attack:** `r/Superstonk` and `r/GME` are counted as independent communities, inflating breadth for one coordinated narrative; alternatively collapsing them destroys provenance.  
**Existing controls:** exact community on source item, versioned `GME_RETAIL_CLUSTER`, exact and cluster-adjusted breadth, conservative confidence cap.  
**Required action:** display both measures and use the cluster-adjusted value in publication policy.  
**Residual risk:** other communities may also be dependent; monitor duplicate language/referral graphs and revise mapping through governance.

### F-06 — Deterministic does not automatically mean valid

**Severity:** High.  
**Attack:** precisely implemented weights/z-scores create false authority from a biased sample or an unstable baseline.  
**Existing controls:** formula/version disclosure, minimum baseline, winsorization, exact tests, sample counts, coverage caps.  
**Required action:** validate sensitivity to weights/windows and retrieval variance; suppress z-score below baseline sufficiency; never infer normal distribution or price predictiveness.  
**Residual risk:** parameter choice remains normative and requires investment-team review.

### F-07 — Confidence can be misread as investment probability

**Severity:** High.  
**Attack:** a user interprets 82 confidence as 82% chance a stock rises.  
**Existing controls:** repeated “defensibility, not return probability” definition, component display, caps/penalties, independent signal direction.  
**Required action:** label UI `Evidence confidence`; avoid percent symbol; user-test comprehension; include a permanent methodology tooltip.  
**Residual risk:** numerical authority bias remains.

### F-08 — Citation presence is weaker than citation support

**Severity:** Critical.  
**Attack:** a citation chip exists but its excerpt contradicts or only weakly relates to the sentence.  
**Existing controls:** sentence-citation relation, deterministic completeness, semantic entailment eval, exact spans, primary/verification distinction, fail-closed publishing.  
**Required action:** use deterministic sentence parsing plus calibrated entailment judge and human spot checks; require all material qualifiers to be supported.  
**Residual risk:** semantic graders can agree incorrectly; retain direct analyst access to spans.

### F-09 — Catalyst Web Search can introduce circular corroboration

**Severity:** High.  
**Attack:** multiple reposts of the same rumour are mistaken for verification.  
**Existing controls:** primary issuer/regulator preference, source persistence, independence/repost edges, challenger, `unverified/contradicted` outcomes.  
**Required action:** only issuer/regulator/exchange evidence can assign the highest verification tier; model “not found” as unknown; record source-family dependencies.  
**Residual risk:** public primary sources may be delayed or incomplete.

### F-10 — Provider abstraction can erase meaningful differences

**Severity:** Medium–High.  
**Attack:** Gateway fallback changes model/tool/citation behaviour while reporting a nominally equivalent run.  
**Existing controls:** common envelope, actual provider/model/fallback trace, no silent mid-run switch, versioned route, eval-before-fallback.  
**Required action:** run contract and quality evals for every permitted provider/model tuple; forbid a fallback without a compatible citation/tool capability.  
**Residual risk:** upstream model behaviour can drift; use snapshots where available and periodic evals.

### F-11 — Scheduling/runtime design can duplicate or strand work

**Severity:** High.  
**Attack:** QStash, retries, and manual double-clicks create duplicate sources/metrics/publications or a stuck “refreshing” state.  
**Existing controls:** unique schedule fire, run idempotency key, per-stage natural keys, at-least-once design, leases/heartbeats/checkpoints.  
**Required action:** perform duplicate-delivery and kill/restart tests; expose last heartbeat and recovery outcome; cap retries.  
**Residual risk:** external provider side effects/costs may repeat even if database writes deduplicate; use provider idempotency/call ledger where supported.

### F-11A — Cross-source convergence can hide platform disagreement

**Severity:** High.  
**Attack:** X is treated as a fallback for unavailable Reddit, raw source volumes are pooled, or a fluent combined summary suppresses opposing platform conclusions.  
**Existing controls:** independent `REDDIT` and `X` source slices, per-platform calculations/freshness/coverage, terminal-state convergence, platform-labelled citations.  
**Required action:** test bullish-versus-bearish divergence, one-platform failure, stale/fresh mismatch and citation-platform mismatch. The UI must always show Reddit sentiment, X sentiment and combined summary as separate sections.  
**Residual risk:** source populations are structurally different; combined commentary is a synthesis of observed evidence, not an estimate of a common population.

### F-12 — MCP expands the attack and mutation surface

**Severity:** High.  
**Attack:** wrong-audience bearer token, client-supplied tenant, prompt injection, unconfirmed refresh/backfill, or cross-tenant source read.  
**Existing controls:** OAuth 2.1 resource metadata, audience validation, server-derived tenant, RLS, read-only default, scopes, idempotency, bounded actions, audit.  
**Required action:** independently penetration-test authorization; initially ship read-only; enable mutation tools only after both-client confirmation UX is verified.  
**Residual risk:** client MCP implementations change; compatibility testing is ongoing operational work.

### F-13 — Source availability and terms may undermine the demo

**Severity:** High.  
**Attack:** a source is technically searchable but its systematic use or retention is not permitted, or would require an institutional agreement forbidden by the brief.  
**Existing controls:** retail-only policy, source register, per-source terms/retention ID, human deployment gate, sampled discovery.  
**Required action:** review all configured sources before activation; disable any requiring unavailable commercial/high-volume agreement; retain a public-primary-source-only verification path.  
**Residual risk:** terms can change; schedule review and rapid disable/tombstone capability.

### F-13A — Existing universe cannot represent the S&P 500

**Severity:** Critical to requested scope.  
**Attack:** the repository's 100-member contract/database constraint and Reddit-attention seed remain active, preventing most S&P 500 constituents from being selected and embedding circular social-selection bias.  
**Confirmed control:** forward migration to a 600-member safety ceiling, FMP `/stable/sp500-constituent` synchronization, canonical security resolution, immutable versions, atomic validation and minimal Settings activation flow.  
**Owner/evidence:** integration lane implements; `joshuai` approves. Closure requires an authenticated FMP probe, more than 500 resolved membership rows within the safety ceiling, NVDA presence, an arbitrary-constituent on-demand run and proof that invalid sync leaves the prior version active.  
**Residual risk:** FMP composition or entitlements can change. Preserve the last good snapshot, show it as stale, and block claims of current membership until a new probe succeeds.

### F-14 — Five-day scope is still ambitious

**Severity:** High to delivery.  
**Attack:** team implements broad MCP/admin/eval polish while core live path remains unreliable.  
**Existing controls:** contract-first parallel paths and de-scope order.  
**Required action:** enforce vertical-slice priority: one named ticker, source persistence, multi-security classification, deterministic metrics, citation UI, freshness, honest failure. MCP mutations and advanced visualisation remain secondary.  
**Residual risk:** live provider/source variability on presentation day.

### F-15 — The specification is not an implemented control

**Severity:** Critical if mistaken.  
**Attack:** detailed documents create confidence without code, migrations, tests, source approvals, or operational evidence.  
**Existing controls:** task-level definitions of done, deploy checklist, release gates.  
**Required action:** do not mark the system production-ready until test artifacts and approvals exist. Treat this pack as design input.  
**Residual risk:** schedule pressure may cause checklist exceptions; exceptions must be explicit and visible in the demo.

## 4. Requirements traceability audit

| Requirement | Primary specification | Review result |
|---|---|---|
| Original URL persisted before downstream work | Architecture §4.1; data model source tables; agent invariant | Complete; must be DB/envelope enforced |
| Do not persist whole webpage | Data model §16; UI §7; OpenAI §8; agent rule | Complete and empirically justified |
| Multi-ticker, per-security stance | Data model §15; pipeline/agent tests | Complete; blocking fixture required |
| Direct default, Gateway setting | Architecture/provider; UI Settings; OpenAI routing | Complete |
| Ticker plus company | PRD/UI/MCP contracts | Complete |
| Primary and comparison windows | PRD/UI/data model | Complete |
| Deterministic versus LLM | Architecture stage table; data formulas | Complete |
| Four dimensions and dynamic themes | PRD/UI/data model | Complete |
| pgvector and lineage | Data model; architecture | Complete; index tuning deferred to measured scale |
| z-score/sentiment/attention explanations | Data model/UI methodology | Complete |
| Agent tools/system prompts/evals | Architecture; evals; agent rules | Complete at design level; real-data proof pending implementation |
| Confidence and editable guardrails | Data model; UI; evals | Complete; calibration pending |
| Raw explorer/citations | UI/data model | Complete |
| Cron/freshness/manual rerun | UI/architecture/deployment | Complete |
| External data sources, retail-only | PRD/DEPLOY | Complete with human terms gate |
| Token optimisation/prompt caching | OpenAI optimisation | Complete; deploy-time capability verification required |
| ChatGPT/Claude MCP | MCP spec | Complete at contract level; client verification pending |
| Parallel non-clashing tasks | Development plan; AGENTS | Complete |
| Initial subreddit groups | PRD/architecture/data model/deploy | Complete; exact provenance plus GME cluster |

## 5. What must be proved before the demo

### Blocking proof

- actual OpenAI Web Search call through the application with stored `sources` trace;
- database record exists before the first classifier call;
- comparative fixture and at least one live multi-security example if available;
- deterministic metric reproduction from SQL/input snapshot;
- 100% citation completeness and reviewed entailment sample;
- partial/stale/insufficient-evidence UI path;
- duplicate delivery/restart recovery;
- source register/retail-access sign-off;
- direct route and optional gateway route contract test;
- named-ticker rehearsal with cost/latency budget.

### Important but de-scopable

- MCP mutation tools;
- automated theme impact backfill;
- sophisticated coordination/network detection;
- broad podcast/video transcript coverage;
- advanced charting and exports.

## 6. Recommended implementation order after review

1. Contract + database source-first transaction/outbox.
2. One bounded live discovery adapter and exact initial subreddit configuration.
3. Resolver/classifier comparative fixture and strict schemas.
4. Deterministic metrics/confidence with honest sample labels.
5. Radar/security/evidence explorer and citation gate.
6. Durable runs, freshness, manual/full refresh, one schedule.
7. Verification/challenger and eval regression.
8. Read-only MCP; then settings/gateway; then optional mutations/polish.

## 7. Final decision

**Proceed with the architecture for the demo**, subject to the blocking proof above. The design is fit for source-backed narrative discovery and explanation from a sampled, retail-accessible evidence set. It is not fit to claim complete Reddit coverage, statistically representative retail sentiment, manipulation detection, or investment alpha without additional acquisition rights, empirical validation, and production controls.

The most defensible presentation framing is:

> “This system turns a bounded, disclosed sample of public retail discussion into traceable research leads. Every interpretation links to persisted original evidence; every security is scored independently; calculations are reproducible; and the system abstains when coverage or support is inadequate.”
