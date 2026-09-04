# F10 — Evidence Pipeline and Stance Classification

**Wave:** 3 · **Lane:** unallocated — assigned at the Wave 2 gate (`../PROGRESS.md`) · **Estimate:** 12–16 h · **Depends on:** F04, F06
**Blocking manual task:** `../DEPLOY.md` **MT-06** (LLM access) — unresolved at spec time.

## 1. Purpose

Turn a ticker into a small, deduped, provenance-carrying evidence pack, and classify its
snippets into a strict schema so F06's aggregation has honest inputs. This is where the
product's most dangerous claim — that it knows what people think — either gets framed
correctly or does not (`../00-ADVERSARIAL-REVIEW.md` F-03).

## 2. Scope

> **Amended 2026-09-03 (D-12, D-13, D-14, D-17, D-21).** Retrieval is replaced, stance
> classification moves to F20's pinned scorer, and the single sampling frame becomes three.

**In:** evidence normalization, dedupe and relevance across **three axes**; the evidence-pack
builder; **the LLM relevance and ticker-collision methods** (D-21); the three per-axis
disclosures; retention per source rights; the availability checker.

**Out:** retrieval itself (**F04** owns the adapters and the collector); **stance
classification** (**F20** owns the pinned scorer and the queue); aggregation arithmetic (F06);
the research state machine and synthesis (F11); sarcasm and long-form Substack stance
(**deferred by D-21**).

## 3. Contracts

**Consumes:** the **Reddit**, **Substack**, **X** and **market-data** adapters plus **Marketaux**
and **FMP** (F04, as re-cut by D-12); **F20's pinned scorer** for stance; `ModelClient` (F04/§4.6)
for the registered *complementary* methods only — never for a stance number on the historical
series (D-13).
**Produces:** `EvidencePack`, `ClassifiedItem`, the three sampling-frame disclosures (§4.5), and
the relevance/collision contract. **The stance prompt and schema move to F20** and are no longer
this feature's to own.

## 4. Build spec

### 4.1 Retrieval — replaced by D-12

**Retrieval is F04's job now.** This feature consumes what the collector already stored. That is
the substantive change: the pack is built from a **corpus**, not assembled from a search at
request time.

Three axes, three sampling frames, **never blended into one stored number** (D-14):

| Axis | Frame | Honest label | Recorded on the pack |
|---|---|---|---|
| Reddit | Comment trees from polled subreddits | **observed sample of a comment population** | subreddits polled, window, `n`, whether the tree was complete |
| X | Trigger-sampled watchlist + cashtags | **watched-account sample** — never "X sentiment" | the watchlist version, the **trigger event** that caused the sample, window, `n` |
| Substack | Curated publication set (MT-15) | **curated publication set** | the publication-set version and **its stated selection basis** |

**Hard rules, unchanged and reinforced:** no scraping of X or Stocktwits, ever (§6.1); historical backfill remains out of scope (D-16 forward-only). Retention is per source rights (D-17): **full bodies for Reddit and Substack** — which
is what makes re-scoring possible and cannot be recovered later — and **ID + scores + a bounded
snippet for X**, where the snippet is the canonical scoring unit.

**The 500-character cap is superseded for Reddit and Substack.** It still governs X.

### 4.2 Normalization and dedupe

`dedupeKey` = normalized URL + normalized title. Cross-source dedupe (a story surfaced by both
Marketaux and a Substack publication is one item; a Reddit comment quoting an article is **not**
the article — it is a separate observation in a different frame, and collapsing the two would
silently merge two sampling frames into one). Relevance is deterministic: exact-symbol match,
company-name match, and a ticker-collision guard for ambiguous tokens (`AI`, `ON`, `IT`,
`ALL`) that requires a corroborating company-name or cashtag reference.

The pack records **retrieved count** and **used count** with the reason for each exclusion.
F09 renders both.

### 4.3 Evidence pack

Bounded: ≤ 30 evidence items, ≤ 12 social snippets per synthesis call (source §14.6). Ordered
by relevance then recency. Every item carries a stable ID that claims will later reference.

### 4.4 Classification — moved to F20, except relevance and collision

**Stance classification is F20's** — pinned FinBERT and Twitter-RoBERTa, asynchronous, queued,
never on a request path. This feature reads scores; it does not produce them.

**What stays here (D-21):** the two LLM methods, each a registered `MethodRegistry` entry with
its own version, so the Inspector shows which method produced which field.

| Method | Why the LLM and not a pinned model |
|---|---|
| `relevance.filter` | The pinned models score sentiment; they do not judge aboutness. Tier B's B1 ≥ 0.95 precision gate requires this |
| `entity.collision_guard` | `AI`, `ON`, `IT`, `ALL` need semantic context, not a lexicon |

**Deferred by D-21, with a named trigger (measured error attributable to either):** sarcasm and
irony detection; long-form Substack stance where text exceeds the 512-token window — F20 records
`truncated` so the error is measurable rather than assumed.

<details><summary>Superseded — the original single-call stance classifier</summary>

One batched call per pack. Strict zod schema per item:

```ts
{
  itemId: string
  relevant: boolean
  stance: 'bullish' | 'bearish' | 'neutral' | 'unclear'
  confidence: number        // 0..1, the model's own, used as a weight — never displayed as accuracy
  rationale: string         // ≤ 200 chars, for diagnostics
  flags: Array<'sarcasm' | 'promotional' | 'off_topic' | 'ticker_collision'>
}
```

Recorded with every result: model ID, route, prompt version, temperature, token usage, cost.
Temperature 0. A schema-invalid response is retried once with a repair instruction, then the
item is dropped as `unclear` — never coerced into a stance.

</details>

The retry-once-then-drop-to-`unclear` discipline above **is retained** for the two LLM methods.
An item is never coerced into a classification.

`unclear` and `sarcasm` items contribute zero direction and remain visible in diagnostics
(F06 §4.2).

### 4.5 Honest framing — now three frames (F-03, D-14, R-21)

The pack carries, and every downstream consumer must render, **per axis**:

- the window, `retrievedCount`, `usedCount`, and the reason for each exclusion;
- the axis's own frame statement, not a shared one:

| Axis | Statement it carries |
|---|---|
| Reddit | *"observed sample of comments from the subreddits polled — not a sample of retail investors."* |
| X | *"watched-account sample, collected around a price trigger. Coverage is event-conditional, not continuous."* |
| Substack | *"curated publication set, selected on the basis recorded in config version {v}."* |

Nothing produced by this feature may be labelled "Reddit sentiment", "social sentiment",
"retail sentiment", "X sentiment" or "consensus". **A blended cross-axis number is never
stored** (D-14); a composite may be displayed with its three components beside it.

**The thresholds are not inherited.** `n ≥ 5`, `n ≥ 3` and `n_eff ≥ 8` were calibrated against a
5–12-snippet regime that no longer exists. F06 re-derives all three **per axis** before it
merges. A threshold calibrated to one sampling regime is meaningless in another.

### 4.6 Availability checking (F-19)

A low-frequency job re-checks stored evidence URLs with a HEAD request and updates
`availability` and `last_checked_at`. It never re-fetches content into the record, never
repairs a snippet, and never invalidates a completed run.

## 5. Test plan

| Level | Cases |
|---|---|
| Unit | dedupe across sources; relevance scoring; ticker-collision guard on each ambiguous token; snippet truncation; pack size bounds |
| Contract | Reddit / Substack / X fixtures → normalized items, each tagged with its frame; F20 `ScoreResult` schema validation; a scorer that is unreachable produces **abstention**, never a substituted number (D-13) |
| Integration | pack construction over seeded evidence; provenance fields persisted; availability checker updates state without touching the snippet |
| E2E | ticker page shows an honest sampled stance or abstains; retrieved-vs-used counts render |
| Feature-specific | on the F12 corpus: relevance precision ≥ 0.95 (B1), stance macro-F1 ≥ 0.80 (B2), thin-sample packs abstain (B5) |

## 6. Definition of Done

- [ ] Retrieval is domain-restricted, date-bounded, and never scrapes.
- [ ] Snippets are capped and no full content is stored.
- [ ] Dedupe works across sources; retrieved and used counts are recorded and rendered.
- [ ] Ticker-collision guard is tested on every ambiguous token in the fixture matrix.
- [ ] Classification uses a strict schema at temperature 0, with model/route/prompt version
      and cost recorded per call.
- [ ] A schema-invalid response never becomes a stance.
- [ ] `unclear` and sarcasm items contribute zero direction and stay in diagnostics.
- [ ] `retrievalQuery` and `retrievalWindow` are on the pack and visible downstream.
- [ ] The "not a representative sample" statement is attached to the pack, not to UI copy.
- [ ] B1, B2 and B5 pass on the F12 corpus.
- [ ] Availability checker updates state only; snippets are immutable.

## 7. PR review steps

1. Read the retrieval code for anything resembling a scrape — a second request to fetch page
   content is a merge blocker.
2. Check snippet cap enforcement at the storage boundary, not just at display.
3. Feed the classifier a deliberately malformed response; confirm it degrades to `unclear`.
4. Confirm the classifier's `confidence` is used only as a weight and never rendered as an
   accuracy figure.
5. Verify the sample-framing statement travels with the pack into F11's output.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| **MT-06** unresolved: no LLM access at spec time | Classification is fixture-driven until the key exists; the feature cannot merge without it |
| Social evidence is thin for low-attention tickers | Abstention is the correct answer and is tested (B5). Under D-15 this is expected and not a fault: a quiet ticker generates no trigger, so the X frame is legitimately empty |
| Three frames are harder to explain than one | Accepted deliberately (D-14). One blended disclosure would be shorter and false: the frames have different selection mechanics and are not poolable |
| Selection bias remains real however it is labelled (F-03) | Labelled, disclosed in the registry, rendered on the page, and stated in the Explorer. The honest position is that the framing is the mitigation |
| Cost per run grows with pack size | Bounds are hard-coded and budget-checked before dispatch |
