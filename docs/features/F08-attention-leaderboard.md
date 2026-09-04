# F08 — Attention Leaderboard and Notable Rank Change

> **Amended 2026-09-03 by the re-lock.** **D-12:** the attention axis is re-sourced to the Reddit Data API; ApeWisdom is demoted to an independent cross-check and no longer carries this feature. **D-16:** rank change accrues forward-only — there is no backfill, so MT-08's start date is this feature's real dependency.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 2 · **Lane:** **SURFACE** *(was `Lane: A` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 10–14 h · **Depends on:** F06

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.

## 1. Purpose

Job J1 — "show me which stocks are gaining retail attention fastest" — and the honest
framing that keeps it from being a lie. This is the product's most visible surface and its
most fragile dependency (`../00-ADVERSARIAL-REVIEW.md` F-05, F-06).

## 2. Scope

**In:** `/social/reddit`; the leaderboard table with mentions, upvotes, rank, rank change and
price context; the notable-top-rank-change cards; the snapshot collector job and its
**history-depth tracking**; `GET /api/social/reddit`; the methodology disclosure; the
attention-unavailable degraded mode.

**Out:** narrative explanation of a move (F11); the ticker detail page (F09).

## 3. Contracts

**Consumes:** F06 attention methods; ApeWisdom adapter (F04); `InspectableMetric` (F05).
**Produces:** the leaderboard response contract; `HistoryDepth`, read by F07's cold-start
state and reported in `../PROGRESS.md`.

## 4. Build spec

### 4.1 The collector (deployed in Wave 1, owned here)

Persists an `attention_snapshot` per active symbol per run, with `observed_at`,
`ingested_at`, and `provider_methodology_version`. Idempotent per `(security_id, observed_at)`.

**F-06:** local history is what makes rank change ours rather than the provider's. Until
depth ≥ 14 comparable snapshots, the z-score is hidden and deltas are labelled
**provider-defined**. `HistoryDepth` is exposed to the UI and recorded in `PROGRESS.md`, so
the state of the warm-up is never a guess.

### 4.2 Honest framing (product invariant §6.1 — the DoD items here are the point of the feature)

- The page title and the table header name **ApeWisdom** as the source, with a link to its
  methodology and the captured methodology version.
- The subtitle is **"observed Reddit sample — coverage-limited"**. The words "all Reddit",
  "Reddit-wide", "retail sentiment" and "consensus" appear nowhere; the copy lint enforces it.
- Every row shows the observation window and `observed_at`.
- A rank change spanning a methodology-version boundary renders `not_applicable` with the
  reason, never a number (F06 §4.1 already returns this; F08 must render it, not swallow it).

### 4.3 Table

Columns: symbol, company, mentions, Δmentions, upvotes, rank, Δrank, price, Δprice(1d),
5-day trend. Sortable by rank change and mention change. Attention and price are **separate
columns and separate axes** — never blended into one score (source §3, engagement sentiment).

Every numeric cell is an `InspectableMetric`.

### 4.4 Notable rank changes

Top three movers, subject to the minimum-base rules from F06 (`prior mentions < 5` ⇒ absolute
delta only; `current mentions < 5` ⇒ `THIN_SAMPLE`, excluded from notable). Cached 30 minutes.
An evidence threshold applies before any narrative is attached — in Wave 2 the card shows the
metrics only; F11 later attaches the explanation.

### 4.5 Degraded mode (F-05)

ApeWisdom unavailable ⇒ the last snapshot renders with an explicit stale marker and the age;
if there is no snapshot at all, the page states that attention data is unavailable and
**directs the user to the parts of the product that still work** (ticker pages, news
sentiment, price regime). It never renders an empty table with no explanation.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | sorting; minimum-base filtering; `NEW` and `THIN_SAMPLE` presentation; depth-gated z-score visibility |
| Contract | ApeWisdom fixture → normalized rows, including the uppercase-ticker rule and an unmapped symbol |
| Integration | collector idempotency on a repeated `observed_at`; depth counter increments; a methodology-version change suppresses cross-boundary deltas |
| E2E | leaderboard renders; source and methodology link present; sorting works; a thin-sample row is excluded from notable; every cell opens an Inspector; ApeWisdom-down renders the degraded mode with a working path onward |
| Feature-specific | **copy assertion**: banned phrases absent from the rendered DOM, not just the source |

## 6. Definition of Done

- [ ] Leaderboard renders live normalized data with ApeWisdom named in the title and the
      methodology version shown.
- [ ] "Observed Reddit sample — coverage-limited" appears on the page; no banned phrase
      appears in the rendered DOM.
- [ ] Attention and price remain separate columns; no blended score exists anywhere.
- [ ] Minimum-base rules, `NEW` and `THIN_SAMPLE` all render correctly.
- [ ] The z-score is hidden below 14 comparable snapshots and `HistoryDepth` is exposed.
- [ ] A methodology-boundary rank change renders `not_applicable` with its reason.
- [ ] The collector is idempotent and running against the seed universe.
- [ ] Attention-unavailable degrades explicitly and points the user somewhere useful.
- [ ] Every numeric cell is an `InspectableMetric`.

## 7. PR review steps

1. Read the rendered page as a sceptical outsider: could anyone believe this is all of Reddit?
2. Force a methodology-version change in a fixture; confirm suppression, not a number.
3. Run the collector twice on the same window; confirm one row.
4. Kill ApeWisdom; confirm the page is still useful and says why it is not complete.
5. Confirm `HistoryDepth` reaches `PROGRESS.md` — the warm-up must be observable.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| ApeWisdom disappears mid-build (F-05) | Degraded mode is a DoD item, not a runbook footnote; production replacement is a procurement workstream |
| Demo happens before depth ≥ 14 (F-06) | MT-08 starts the warm-up in Wave 1; the UI is honest about provider-defined deltas until then |
| Uppercase-ticker rule collides with common words (`AI`, `ON`, `IT`, `ALL`) | Fixture cases in `../05-TEST-STRATEGY.md` §4; unmapped symbols are dropped, not guessed |
