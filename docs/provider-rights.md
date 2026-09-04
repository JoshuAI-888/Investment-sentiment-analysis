# Provider rights

**Owner:** F01 §4.5. **This is the document a reviewer checks before any redistribution
question**, and the one F01 §7 step 4 reads against `reference/SOURCE-PRD-v1.5.md` §4 asking a
single question: *does any entry overstate our rights?*

It is written to understate. Where the reviewed material does not establish a right, the cell
says **not established** rather than guessing — an unverified "probably fine" in a rights
document is worse than a blank, because it gets quoted later as though it were checked.

**Everything here is a summary of material reviewed at authoring time, not legal advice, and
not a substitute for the provider's current terms.** Terms change without notice and none of
these rows is a defence. Re-read the source terms before any public launch.

> **RNI source-policy note (2026-09-05):** the Reddit Data API row below applies to the legacy
> collector. RNI uses OpenAI Web Search to discover public Reddit URLs and stores only the
> returned post/comment content or bounded excerpt plus necessary metadata—never whole-page
> HTML. That distinct path still requires a versioned source/retention review before live use;
> search availability does not itself grant redistribution rights. X remains authorised API
> access and an independent source, not a fallback.

---

## 1. The rule that outranks every row below

**No scraping of X or Stocktwits, ever, under any deadline pressure**
(`01-PRODUCT-SPEC.md` §6.1).

D-16's forward-only ruling removed the only pressure that was ever going to test this: there is
no backfill to be tempted by, because backfill is not a thing this product does.

---

## 2. Social and attention sources

### Reddit Data API — **the largest channel, and not yet approved**

| | |
|---|---|
| **Plan** | Free non-commercial tier |
| **Allowance** | Documented at 100 queries/minute for eligible free clients |
| **Commercial display** | **Not established.** The Data API terms require a **separate agreement for commercial use** |
| **Retention** | **Restricted — see the open item below.** The terms impose retention and deletion obligations |
| **Attribution** | Required in the product's labelling: "observed Reddit sample", never "all Reddit" or "Reddit-wide" |
| **We may not** | Train models on the data without approval — the terms **prohibit unapproved model training**. Claim platform-wide coverage. Operate at all before approval |

**Approval, not the rate limit, is the binding constraint.** The Responsible Builder Policy
requires explicit approval before API access. `DEPLOY.md` **MT-13** files it, is confirmed
unfiled, and is the only item in the plan whose clock somebody else controls.

> **⚠ Open conflict — retention.** Product invariant §6.8 retains **full bodies for Reddit
> indefinitely**; the Data API terms impose retention and deletion restrictions. These are not
> obviously compatible, and the resolution is not ours to assume — **the approved agreement
> defines the terms**. Until MT-13 returns, treat §6.8's indefinite retention as **provisional
> for the Reddit axis only** and design the deletion path as though it will be required. A
> deletion path retrofitted onto an indefinite-retention corpus is a migration; designed in, it
> is a column.

### Substack RSS

| | |
|---|---|
| **Plan** | Public RSS, `https://<publication>.substack.com/feed`. No key, no approval |
| **Allowance** | Ordinary polite polling. No published quota; cadence is ours to keep reasonable |
| **Commercial display** | Snippets with attribution and link-through, per ordinary feed practice. **Full-text republication: not established** |
| **Retention** | Full bodies retained (§6.8). No provider restriction identified in the reviewed material |
| **Attribution** | Publication name and a link to the original post, always |
| **We may not** | Present a curated publication set as representative of anything wider. §6.1's honest label is **"curated publication set"** — a convenience sample of chosen authors, with **who chose them and on what basis** disclosed (D-29: sector coverage) |

**Zero lead time and no key**, which is why `DEPLOY.md` MT-15 — naming the publications — is
what actually starts D-16's forward-only clock.

### X API

| | |
|---|---|
| **Plan** | Pay-per-use. **No free tier** |
| **Allowance** | ~$0.005 per Post read. Ceilings in MT-12; **D-32 starts them at zero** |
| **Commercial display** | Governed by the paid tier's terms — **confirm before any public display** |
| **Retention** | **Post IDs, derived scores and a bounded snippet only** (§6.8, D-17). Not full bodies |
| **Attribution** | "watched-account sample" — **never "X sentiment"** |
| **We may not** | Infer X sentiment from web snippets as a substitute for the API (`reference/SOURCE-PRD-v1.5.md` §4). Present a curated watchlist as a sample of "retail" — it has survivorship and paid-promotion bias, and it is **trigger-sampled**, so its coverage is event-conditional rather than continuous |

The snippet is **X's canonical scoring unit**, deliberately: it keeps the X series
self-consistent under re-scoring when the full post is no longer retrievable. Posts deleted
upstream and purged are the one unrecoverable case (D-17).

### ApeWisdom

| | |
|---|---|
| **Plan** | Keyless public API |
| **Allowance** | Unstated. No published SLA |
| **Commercial display** | **Not established** — no published commercial data licence in the reviewed material |
| **Retention** | Unstated. We retain only the observed ranking and its seed date (MT-07) |
| **Attribution** | Methodology link and timestamp where any ApeWisdom-derived figure is shown |
| **We may not** | Make it the production source of record (ADR-004). Compare a series across a methodology change without saying so |

**Role today: universe selection only** (D-30). Its cross-check role is **retired** — an
instrument that selected the universe cannot then validate attention rank on it.

---

## 3. Market data, news and primary sources

### Financial Modeling Prep (FMP) Starter

| | |
|---|---|
| **Plan** | Starter, ~$22/month billed annually |
| **Allowance** | 300 calls/minute; US coverage, historical prices, fundamentals, news |
| **Commercial display** | **A separate Data Display and Licensing Agreement is required.** A paid personal API plan is **not** automatically a public-app licence |
| **Retention** | Governed by that agreement. Internal PoV use only until it exists |
| **Attribution** | Provider timestamp and a "real-time / delayed / EOD" label wherever a price is shown |
| **We may not** | Publicly display or redistribute FMP data before the agreement exists. Treat plan entitlement as proven without an endpoint probe |

This is a **rights** constraint, not a quota one: staying under the call limit does not resolve
it. D-31 also puts the price trigger on FMP Starter's **daily bars**, so no additional
market-data vendor is provisioned.

### Marketaux

| | |
|---|---|
| **Plan** | Free |
| **Allowance** | 100 requests/day, **3 articles per request** |
| **Commercial display** | **Not established** — must be confirmed before public launch |
| **Retention** | **Metadata and snippets only.** No full-text storage or redistribution |
| **Attribution** | Publisher name, article URL, and the provider's own sentiment attribution where it is displayed |
| **We may not** | Store or redistribute full article text. Present a 3-article sample as a survey of coverage — the cap under-samples and the `n` must be shown |

Development shares this quota with production, which is why `PROVIDER_MODE=fixture` is the
default and CI runs with no key at all.

### SEC EDGAR

| | |
|---|---|
| **Plan** | Public. No key |
| **Allowance** | Fair-use rate limits; a descriptive `SEC_USER_AGENT` with a contact address is a **condition of access** |
| **Commercial display** | Public-domain US government filings |
| **Retention** | Unrestricted |
| **Attribution** | Filing type, accession number and a link to the source document |
| **We may not** | Poll without an identifying User-Agent, or at a rate that reads as abuse |

### FRED

| | |
|---|---|
| **Plan** | Free API key |
| **Allowance** | Per FRED API terms |
| **Commercial display** | Permitted subject to the API terms, **with attribution** |
| **Retention** | Cache aggressively — the terms and good practice both favour it |
| **Attribution** | **Required.** Series ID, source, and vintage date |
| **We may not** | Present a revised series as though it were the original vintage. FRED series are revised, and a macro chart that silently re-bases is the same defect F22 exists to prevent on our own data |

### Alpha Vantage

| | |
|---|---|
| **Plan** | Free |
| **Allowance** | 25 calls/day |
| **Commercial display** | **Not established** |
| **Retention** | Unstated |
| **Attribution** | Required wherever displayed |
| **We may not** | Use it as a validator (**F-09** — 25 calls/day validates nothing systematically), or call it at all before Wave 4 |

**Demoted.** Wave 4 only, behind `FEATURE_CONGRESS`, for `CONGRESS_TRADES`.

### Not adopted, and why it matters here

**Twelve Data Basic** was reviewed as a free market-data fallback. Its individual plans are
**personal / internal / non-commercial** and do **not** permit commercial display or
redistribution. It is **not in the stack** (D-31 declined to add a market-data vendor at all),
and it is recorded here so that a future "just use the free one" does not have to rediscover the
licence.

---

## 4. Models and infrastructure

### Hugging Face model weights (F20)

| Model | Position |
|---|---|
| `ProsusAI/finbert` | Upstream GitHub project is **Apache-2.0**; the **HF repo lacks explicit licence metadata**. **Must be cleared before any public launch** |
| `cardiffnlp/twitter-roberta-base-sentiment-latest` | Model-card licence metadata **must be confirmed** before commercial release |

Both are pinned **by commit SHA and baked into the scorer image** (D-13, F20 §4.1), which has a
rights consequence as well as a determinism one: the artifact we ship is a specific, identified
revision, so a licence review is of a fixed thing rather than of a moving tag.

**We may not** promote any model on model-card metrics alone (ADR-011). Download counts and
likes are adoption signals, not quality evidence; self-reported in-domain accuracy is not
comparable across datasets.

### Model providers via Vercel AI Gateway (D-34)

Content sent to a model provider is governed by that provider's terms, including whatever they
say about training on submitted data. **Before Wave 3 provisions keys (MT-06), confirm the
data-use position of each configured provider** — this product sends third-party content
(Reddit comments, Substack prose) into those requests, and the rights we hold in that content
do not automatically extend to a third party training on it.

### Resend, Upstash (Redis + QStash), Neon, Vercel

Infrastructure, not data sources. They carry no content-redistribution rights question. The one
rights-adjacent obligation is that OTP codes are **stored hashed** (ADR-016) and provider
payloads containing personal data are subject to §6.8's retention policy.

---

## 5. What this product must never claim

Restated from `01-PRODUCT-SPEC.md` §6.1, because it is the failure mode a rights document exists
to prevent — and because every one of these is a phrase that arrives in copy by accident:

- ❌ "all Reddit", "Reddit-wide", "Reddit sentiment"
- ❌ "live X sentiment"
- ❌ "consensus"
- ❌ "market sentiment" unqualified
- ✅ "observed Reddit sample", "sampled social stance", "watched-account sample",
  "curated publication set", "coverage-limited", "sector proxy",
  "representative sampled sources"

`check:copy` fails the build on the left-hand column. That is not belt-and-braces: a claim of
coverage we do not have is simultaneously a product lie and a rights problem, and the lint is
the only part of that pair which cannot be talked out of.
