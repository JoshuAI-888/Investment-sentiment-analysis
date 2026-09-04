# Architecture Decision Records

Transcribed from `../reference/SOURCE-PRD-v1.5.md` §1.1 by F01 §4.5, **with the amendments from
`../00-ADVERSARIAL-REVIEW.md` and the re-lock decisions in `../MEMORY.md` applied and the
finding cited.**

That last clause is the whole point. These are not the PRD's original text. Nine of the
nineteen were amended, demoted, superseded or cut before a line of code existed, and an ADR
file that quietly carried the original wording would be worse than no file — it would be a
decision record that lies about the decision.

| ADR | Subject | Status |
|---|---|---|
| [001](./ADR-001-vercel-runtime.md) | Vercel App Router is the runtime | **Amended** — D-13 admits one Python service |
| [002](./ADR-002-fmp-market-data.md) | FMP Starter is the market-data backbone | **Amended** — D-31 puts the trigger on daily bars |
| [003](./ADR-003-marketaux-news.md) | Marketaux is the news-sentiment source | **Amended** — F-08 quota headroom |
| [004](./ADR-004-apewisdom-attention.md) | ApeWisdom | **Amended twice** — D-12 demoted it, D-30 retired the cross-check |
| [005](./ADR-005-linkup-evidence.md) | Linkup is the evidence retriever | **Superseded** — D-12 dropped Linkup |
| [006](./ADR-006-alpha-vantage.md) | Alpha Vantage is a validator | **Demoted** — F-09 |
| [007](./ADR-007-sec-fred.md) | SEC EDGAR and FRED are primary sources | Accepted |
| [008](./ADR-008-llms-do-not-calculate.md) | LLMs do not calculate | Accepted, load-bearing |
| [009](./ADR-009-rag-is-evidence-assembly.md) | RAG is evidence assembly | Accepted |
| [010](./ADR-010-no-recommendation.md) | No trading recommendation | **Amended** — D-08/D-09 Tier D4 |
| [011](./ADR-011-no-generic-hf-model.md) | No single generic HF model | **Superseded twice** — F-21, then D-13 |
| [012](./ADR-012-governed-admin-console.md) | The admin console is a control plane | **Amended** — D-11 |
| [013](./ADR-013-qstash-dispatcher.md) | QStash-driven dispatcher | **Amended** — D-15 trigger, D-16 heartbeat required |
| [014](./ADR-014-architecture-explorer.md) | Source-backed Architecture Explorer | **Amended** — scorer identity, MCP catalogue |
| [015](./ADR-015-governed-universe.md) | Governed ticker universe | **Amended** — D-27, D-30 |
| [016](./ADR-016-auth-otp.md) | Better Auth email OTP | **Cut** to single-account OTP — D-11, D-26, D-28 |
| [017](./ADR-017-ai-gateway.md) | An AI gateway is recommended | **Amended** — D-34 makes it the default and splits the verifier |
| [018](./ADR-018-valuation-is-a-range.md) | "Undervalued" is a range, not a fact | Accepted, **deferred** — D-19 |
| [019](./ADR-019-inspectable-metrics.md) | Every deterministic metric is inspectable | **Amended** — F-07 artifact granularity |
