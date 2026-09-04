# F06 — Deterministic Analytics Library

> **RNI scope:** calculate Reddit and X metrics independently, then derive explicit
> agreement/divergence facts. Do not pool incomparable raw counts into one sentiment number.

> **Amended 2026-09-03 by the re-lock.** **D-14:** three platform axes, computed and stored separately. A blended cross-axis number is never the stored primitive; a composite may be displayed with its three components beside it. **D-12 consequence — this is the one that will be missed:** every abstention threshold in this package (`n ≥ 5` stance, `n ≥ 3` news, `n_eff ≥ 8` display) was calibrated against a 5–12-snippet sampling regime that no longer exists. **All three must be re-derived per axis before this feature merges** — `n ≥ 5` is met trivially on Reddit and nearly always fails on X at 15-minute resolution. A threshold calibrated to one sampling regime is meaningless in another. **D-15:** X coverage is event-conditional; never average across a trigger gap as though the series were continuous.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 2 · **Lane:** **SPINE** — blocks all Wave 2 lanes · **Estimate:** 14–18 h · **Depends on:** F05

## 1. Purpose

Every number the product shows, as a pure function with a registry entry, golden fixtures and
an artifact. After this, the UI features are assembly rather than invention.

## 2. Scope

**In:** the methods in source §8.1–§8.7 — attention metrics, social stance aggregation, news
sentiment, price regime, market composite, divergence states, technical context; their
registry entries; their golden fixtures.

**Out:** valuation (F13); the retrieval and classification that produce stance inputs (F10 —
F06 owns only the aggregation of already-classified items); any UI.

## 3. Contracts

**Consumes:** `buildArtifact`, `MethodRegistryEntry` (F05); snapshot rows (F03).
**Produces:** one registered method per metric; `DivergenceState`.
**Must not:** import anything with I/O, or anything from `agent/`. Enforced by lint.

## 4. Build spec

Formulas are transcribed **exactly** from source §8. They are executable specifications;
this feature does not improve them. Amendments below are the review's rulings only.

### 4.1 Attention (§8.1)

`rank_change`, `mention_delta`, `mention_growth`, `engagement_per_mention`, and the robust
anomaly `robust_z` over `log(1+mentions)` with MAD scaling.

Display rules, each a registry `eligibilityRule` with a golden case:
prior mentions < 5 ⇒ hide growth, show absolute delta · prior rank missing ⇒ `NEW` ·
current mentions < 5 ⇒ `THIN_SAMPLE`, ineligible for notable analysis · fewer than 14
comparable snapshots ⇒ no z-score.

**F-05 amendment:** if the `provider_methodology_version` differs between the current and
prior snapshot, `rank_change` returns `not_applicable` with reason
`methodology_changed`. Snapshots across a methodology boundary are not comparable, and
computing a delta across one would be a fabricated number.

### 4.2 Social stance (§8.2)

`signed_i`, `weight_i` (relevance × classifier confidence × `exp(-age_hours/36)`),
`raw_social`, `shrunk_social` with `n_eff`, `coverage`, `agreement`.

**F-03 amendments, binding:**
- The output field is `sample_adequacy`, **not** `confidence`. The registry entry says, in
  `limitations[]`: *"Computed over snippets selected by a relevance-ranked web search
  restricted to reddit.com. This is not a random or representative sample of any population.
  Adequacy measures how much material was available, not how likely the result is to be
  correct."*
- The method's title and every label it produces say **"stance of sampled snippets"**.
- n < 5 relevant items ⇒ `insufficient_data`, no score. 5–7 ⇒ score stored, flagged low
  adequacy. ≥ 8 ⇒ displayable.
- `unclear` and sarcasm items contribute zero direction and remain in the diagnostics.
- No author-follower weighting. Ever, in the PoV.

### 4.3 News sentiment (§8.3)

`news_weight_i`, `raw_news`, `shrunk_news`. `source_weight_i = 1` until a documented
methodology and an evaluation dataset exist — a publisher-quality weight without those is a
made-up number.

**F-08 amendment:** fewer than 3 entity-tagged articles ⇒ `insufficient_data`. Marketaux's
free tier caps at 3 articles per request, so a shrunk mean over n<3 is noise wearing a
decimal point.

### 4.4 Price regime (§8.4)

`r_5`, `r_20`, `vol_20` (annualised), `trend_strength` clamped to ±3 then scaled. Labels at
±0.35. **Adjusted closes only**; mixing intraday and close-to-close within one metric is a
registry-level prohibition with a test.

### 4.5 Market composite (§8.5)

Weighted mean of news 0.35, price regime 0.30, sector breadth 0.25, sampled retail stance
0.10. A component with inadequate coverage is **omitted and the weights renormalized** — it
is never set to zero. The artifact records which components participated and the renormalized
weights, so the Inspector can show why today's composite is not comparable to yesterday's.

`sector_breadth_score = 2 × (positive_sector_etfs / sector_etfs_with_data) − 1`.

No "strong buy", "risk-on", or probability language in any label. Copy lint enforces it.

### 4.6 Divergence (§8.6)

The five categorical states, exactly as tabulated. **F-17 amendment:** every state carries
verbatim: *"This is a description of what is currently observable. It has not been tested
against historical returns and is not a forecast."* The line is part of the method's output,
not UI copy that a later feature might drop.

### 4.7 Technical context (§8.7)

RSI(14), 20/50-day MAs, 20-day volatility, recent high/low. Support/resistance zones are P1
and cut-line item 4 — if implemented, the swing-cluster algorithm as specified, returning a
zone, touch count, last touch and invalidation rule; never a single magic level.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | golden fixtures per `../05-TEST-STRATEGY.md` §3 for every method: normal, each eligibility rule, each failure behaviour, divide-by-zero, clamp bounds, empty input, single element, all-zero weights |
| Contract | every method's artifact round-trips; every registry entry validates against the registry schema |
| Integration | analytics over seeded snapshot rows produce persisted artifacts; a full recompute over identical inputs yields identical hashes |
| E2E | — |
| Feature-specific | **no-I/O assertion**: `analytics/` imports resolve to a closed set containing no adapter, repository, or model module; methodology-boundary case returns `not_applicable`; composite with two missing components renormalizes correctly and records which participated |

## 6. Definition of Done

- [ ] Every method in source §8.1–§8.7 is registered, artifact-producing, and golden-tested.
- [ ] Every `eligibilityRule` and every `failureBehaviour` has at least one golden case.
- [ ] Golden expectations are **exact decimal strings**; no test uses a float tolerance.
- [ ] Stance output is `sample_adequacy`, and the selection-bias limitation renders in the
      Inspector for every stance artifact.
- [ ] n<5 stance and n<3 news both return `insufficient_data` with no number.
- [ ] Rank change across a methodology-version boundary returns `not_applicable`.
- [ ] Composite omits and renormalizes; the artifact records participating components.
- [ ] The §6.4 disclosure line is part of every divergence-state output.
- [ ] No I/O and no LLM import anywhere in `analytics/`; proven by test and by lint.
- [ ] `check:calc-coverage` passes with every method registered and golden-covered.

## 7. PR review steps

1. Diff every formula against source §8, character by character. A "cleanup" of a formula is
   a numeric change and requires a version bump and a `MEMORY.md` entry.
2. Confirm no float tolerance appears in any analytics test.
3. Read the stance registry entry's `limitations[]` and confirm it renders in the Inspector.
4. Force two composite components to `insufficient_data`; check the renormalization by hand.
5. Confirm the disclosure line cannot be dropped by a UI change — it is in the method output.
6. Check the import graph of `analytics/` mechanically, not by eye.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| The shrinkage machinery still reads as precision to a user despite relabelling (F-03) | The label, the `n`, the window and the `limitations[]` all render together; reviewed as copy in F09 |
| Golden fixtures are laborious | They are the only thing standing between this product and quietly wrong numbers |
| Someone "fixes" a formula to make a chart look better | Version bump + goldens + `MEMORY.md` are all required; CI fails a silent change |
