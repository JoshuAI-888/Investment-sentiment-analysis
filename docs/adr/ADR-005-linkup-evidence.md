# ADR-005 — Linkup is the on-demand evidence retriever

**Status:** **Superseded by D-12.** Linkup is dropped from the stack.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Original decision

Linkup `standard` search with `searchResults`, date filters and a `reddit.com` domain
restriction, to find representative public posts and current web evidence. ~$0.005 per call
against a $20 monthly balance. Store URLs and short snippets, never scraped social archives.

## Supersedure

**D-12 replaced the source stack.** Reddit content now comes from the **Reddit Data API**
directly, Substack from **RSS**, and X from a **governed watchlist** — all official APIs. A
domain-restricted web search standing in for a social API was a workaround for not having the
API, and the API is available.

The retained half of the original decision is the important half and is now product invariant
§6.1: **no scraping of X or Stocktwits, ever, under any deadline pressure**.

`../MEMORY.md` records that F10's spec carried four stale references to Linkup *outside* its
superseded block — a `Consumes` line, a dedupe example, a contract test and a risk row. That is
the failure mode a supersedure note exists to prevent, and the reason this file names the
replacement rather than just deleting the decision.

## Consequences

- `LINKUP_API_KEY` is **not** in F01's environment schema, despite appearing in source §6.3.
  §6.3 predates D-12 (F01 §4.2 says so); the key would configure a provider that does not exist.
