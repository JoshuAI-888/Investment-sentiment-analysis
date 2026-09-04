# F09 — Ticker Detail Page and Evidence Drawer

> **RNI scope:** RNI security detail renders Reddit sentiment, X sentiment and combined summary,
> plus bounded raw evidence, canonical citations, coverage and freshness for each source.

> **Amended 2026-09-03 by the re-lock.** The page's structure survives; **what it must disclose
> does not**. **D-14:** there is no longer one sampled-evidence disclosure but **three** — an
> observed Reddit comment sample, a watched-account X sample opened by a price trigger, and a
> curated Substack set. They have different selection mechanics, so one blended sentence would be
> false; each frame renders its own. **D-16 / F22:** the attention chart must render **coverage
> gaps as holes** — never interpolate across a collector outage, because under forward-only
> collection that data does not exist and never will. **D-13:** a scorer outage renders an
> abstention with a reason, never a number from a substitute model. **D-09:** no predictive
> language on this page without a Tier D4 record behind the metric.
> See `../MEMORY.md` §1b for the decisions and `../SPEC-REVIEW.md` for the reasoning.

**Wave:** 2 · **Lane:** **SURFACE** *(was `Lane: P` — the dependency lane in `../03-ROADMAP.md` §2, a different axis)* · **Estimate:** 12–16 h · **Depends on:** F06, F07

> **`Lane:` normalised 2026-09-03.** This field previously carried the *dependency*-lane letters from `../03-ROADMAP.md` §2 (P/A/G/V), or was absent. `PROGRESS.md` warns in prose that dependency lanes and **build lanes** are different axes, but the specs still carried the colliding value — so a `lane-build` agent told "you are SURFACE" opened its feature and read a different lane on line one. The field now names the **build lane**, which is the unit of parallel assignment.

## 1. Purpose

Job J4 — the single-ticker view where attention, stance, news and price sit side by side as
separate axes, and where every source behind them can be opened and read.

## 2. Scope

**In:** `/ticker/[symbol]/social`; the header with price context; the attention chart
**including its coverage gaps and the coverage floor**; the four-axis panel; the divergence state
with its disclosure; **the three per-frame sampling disclosures (F10 §4.5)**; the
**evidence drawer**;
the methodology panel; `GET /api/ticker/:symbol/snapshot`; `GET /api/search`; insider and
filings links (cut-line items 3 and 2).

**Out:** the research run and narratives (F11 — F09 renders placeholders that F11 fills);
the stance *pipeline* (F10 — F09 renders whatever stance exists); valuation (F13).

## 3. Contracts

**Consumes:** F06 methods; `EvidenceItem` (F03/F04); `InspectableMetric` (F05); F07's shared
label components.
**Produces:** the ticker snapshot contract; the `EvidenceDrawer` component F11 reuses.

## 4. Build spec

### 4.1 Header and identity

Symbol, company, exchange, sector, price, change, session state, and the provider's
real-time / delayed / EOD label. Resolution goes through the security master by `security.id`
— never by ticker string (F03 §4.1). An ambiguous or ineligible symbol is refused with a
stated reason, not silently resolved to a guess.

### 4.2 Four axes, kept apart

| Axis | Shows |
|---|---|
| Attention | mentions, Δmentions, rank, Δrank, chart over available history, `observed_at` |
| Sampled stance | **"stance of sampled snippets"**, the value, `n`, `sample_adequacy`, the retrieval window, and the selection-bias note (F-03) |
| News | shrunk news sentiment, article count, window; `insufficient_data` below n=3 |
| Price | 5d/20d returns, 20d volatility, regime label, RSI, MAs |

They are never combined into one number. The divergence state (F06 §4.6) sits below them
with its verbatim disclosure line (product invariant §6.4).

### 4.3 Evidence drawer

Opens from any evidence-backed element. Per item: title, source kind, publisher/subreddit,
`publishedAt`, `retrievedAt`, the **stored snippet as retrieved**, relevance, and the link.

**F-19 (link rot):** items carry `availability`. An item whose last check failed renders the
stored snippet with *"source no longer reachable — snippet as retrieved on {date}"*. The link
is still shown. Availability is displayed state: it is never repaired in place and never
invalidates a completed run.

Items are deduped by `dedupeKey`. The drawer states how many items were retrieved and how
many were used, so a user can see the filtering rather than infer it.

### 4.4 Methodology panel

Per axis: source, window, method, method version, thresholds, and a link to the Inspector.
The stance entry reproduces the registry's `limitations[]` — the selection-bias disclosure
appears on the page a user actually reads, not only in the Inspector.

### 4.5 Search

`GET /api/search?q=` over the local security master. Returns symbol, company, exchange,
eligibility. **No provider call per keystroke** — the catalogue is local (F03 §4.4).

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | axis rendering per state; drawer item rendering for each `availability`; dedupe |
| Contract | ticker snapshot and search response schemas |
| Integration | snapshot assembles from stored data with no provider call in the read path; search hits no provider |
| E2E | navigate dashboard → leaderboard → ticker; every axis renders with its labels; drawer opens, shows the snippet, and marks an unreachable source; every number opens an Inspector; ETF and thin-sample tickers render their `not_applicable`/`insufficient_data` states; ambiguous symbol is refused with a reason; axe passes |
| Feature-specific | selection-bias note present in the DOM wherever stance renders; disclosure line present wherever the divergence state renders |

## 6. Definition of Done

- [ ] Ticker page renders live normalized data with no provider call in the read path.
- [ ] The four axes are visually and structurally separate; no blended score exists.
- [ ] Stance renders as "stance of sampled snippets" with `n`, `sample_adequacy`, window and
      the selection-bias note.
- [ ] News below n=3 renders `insufficient_data`, not a number.
- [ ] The divergence state carries the §6.4 disclosure line verbatim.
- [ ] Evidence drawer shows the stored snippet, provenance, and an honest `availability`
      state for an unreachable source.
- [ ] Retrieved-vs-used counts are visible.
- [ ] Search is local-only and returns eligibility.
- [ ] Every displayed number is an `InspectableMetric`.
- [ ] Ticker snapshot p95 < 3 s cached (Tier A2); axe passes; mobile has no horizontal scroll.

## 7. PR review steps

1. Read the stance panel as a user. Does anything on it imply a measured population estimate?
2. Break an evidence URL in a fixture; confirm the drawer is honest rather than blank.
3. Confirm no provider call occurs on page read or on search keystrokes.
4. Load an ETF and a thin-sample ticker; confirm both are legible, not error-shaped.
5. Confirm the disclosure line is rendered from the method output, not hardcoded in the view
   (it must survive a UI rewrite).

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| Four axes plus labels plus caveats is visually heavy | Layout adapts; the caveats do not |
| Users read adjacency as causation despite the disclosure (F-17) | Disclosure line, banned vocabulary, and no combined score |
| Snippet storage drifts toward archiving a corpus | Snippet length capped in F10; rights posture documented in `provider-rights.md` |
