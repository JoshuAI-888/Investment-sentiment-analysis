# Retail Investment Sentiment

An investment research dashboard that observes what social conversations, news and market
data say about ~100 tracked tickers — and shows the evidence honestly. Spec-driven and built
by an agentic engineering loop; every number it renders is reproducible and labelled.

## What it does

- **Three social axes, never blended** — Reddit (official Data API), X (governed watchlist,
  sampled only when a price move triggers it) and Substack (a curated publication set). Each
  carries its own sampling frame and disclosure, so no aggregate pretends to be platform-wide.
- **News and market context** — Marketaux entity news sentiment, FMP market data (which is the
  sampling trigger), SEC EDGAR and FRED enrichment, with ApeWisdom as an independent
  cross-check on attention rank.
- **Honest coverage labelling** — every aggregate displays its `n`, window and source.
  "Observed Reddit sample", never "all Reddit". Coverage gaps render as holes, never as
  interpolations.
- **Reproducible numbers** — immutable, replayable calculation artifacts; pinned
  classification models in a decoupled scorer service that abstains with a reason rather than
  silently substituting; point-in-time discipline throughout.
- **No recommendations** — this is analytics and evidence, not trade advice.

## What it intends to do

Serve a single operator an institutional-grade, validated, cross-platform view of social
sentiment — historical as well as current. "Validated" means classification accuracy measured
against a labelled set per axis (v1 gate ≥ 0.80 macro-F1) and per-metric predictive checks
(IC, Newey–West). A web dashboard ships first; an MCP server surface follows once the web
tool is proven.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js on Vercel (pnpm monorepo, `apps/web`) |
| Data | Neon Postgres (bitemporal, append-only), Upstash Redis + QStash scheduler |
| Scoring | Decoupled Python service running pinned models (e.g. FinBERT), no silent fallback |
| Sources | Reddit Data API · X API · Substack RSS · ApeWisdom (cross-check) · FMP · Marketaux · Alpha Vantage (validator) · SEC EDGAR · FRED |

## How it is built

A locked product spec, 22 per-feature build specs and a wave-sequenced roadmap, executed by a
build → verify → review agent loop in three lanes (SPINE, COLLECT, SURFACE). Loop state lives
in the repo, so any agent can resume after a context reset:

1. [`docs/MEMORY.md`](docs/MEMORY.md) — durable decisions (read §1b first)
2. [`docs/PROGRESS.md`](docs/PROGRESS.md) — phase, wave gates, lane index
3. [`docs/progress/`](docs/progress/) — your lane's live state
4. [`docs/04-BUILD-LOOP.md`](docs/04-BUILD-LOOP.md) — the loop protocol

## Status

Specification locked; build in progress — F02, F07, F08, F09, F22 merged; F04 (collection)
blocked on the Reddit Data API application (MT-13). The most urgent item is not a feature:
collection is forward-only with no backfill (D-16), so starting the collector outranks
everything else — a blocked feature is a delay, a missed day of collection is permanent.

## Commands

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm check:copy && pnpm check:bundle && pnpm check:calc-coverage
```

