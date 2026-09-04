# 2026-09-04 — SPINE — market, evidence and sentiment repositories (F09 dependency)

A standalone cross-lane repository gap-fill, the same shape as `attention_snapshot` (merged
earlier the same day) but covering three more table families at once: `market_snapshot`,
`price_return_snapshot` (migration `0002`), `evidence_item` and `sentiment_snapshot` (migration
`0003`). Surfaced while scoping F09 (ticker detail page): F09's own DoD requires "no provider call
in the read path" — unlike F07's dashboard, which calls adapters live — so it needs to assemble
entirely from stored data, and none of these four tables had a repository function yet.

## The review loop — five rounds, twelve findings, the longest review history in this package so far

**Round 1 (5 findings).** `evidence.ts`'s idempotency check was scoped globally on `raw_hash`
alone — the same wire story collected for two different tickers silently collided, with the
second ticker's insert reporting success while handing back the first ticker's row.
`sentiment.ts`'s revision-equality check compared 5 of the table's 10 real value columns, so a
count-only reclassification (positive/neutral/negative/unclear breakdown moving, scores unchanged)
was silently dropped as a duplicate instead of written as a successor. The recurring
wall-clock-vs-hardcoded-`asOf` test defect (a test reading at a fixed instant while its own insert
defaults `ingestedAt` to the real clock) appeared again. `dedupeKeyOf` collapsed every
null-`sourceUrl` evidence item sharing a title to one key, dropping genuinely distinct items.
`searchSecurities` didn't escape LIKE metacharacters — a literal `%` or `_` query matched
everything or every one-character symbol.

**Round 2 (3 findings).** The exact same hardcoded-`asOf` defect recurred in the very two tests
written to fix round 1 — proven by shifting the JS clock forward and watching them fail within
17 hours of the real wall clock at review time. The "dedupe before limit" fix for `evidence.ts`
wasn't actually implemented — the SQL `LIMIT` still ran before dedup, so a caller asking for 5
evidence items on a security with 6 distinct items (5 of them duplicates of one syndicated story)
got handed 1. Null-`security_id` identity semantics were documented as one thing and implemented
as the opposite, untested either way.

**Round 3 (3 findings).** The hardcoded-`asOf` defect recurred a *third* time in two more test
files. `readBackExisting`'s as-of bound — needed only to read back a row this exact call just
inserted, never a genuine historical read — used the caller's own `ingestedAt` rather than a value
guaranteed not to exclude the just-written row, throwing on the legitimate case of a retry with an
older `ingestedAt` than the row it's retrying against. The three-number dedup return shape
(`scannedCount`/`distinctCount`/`items`) needed one more precision pass to actually mean what its
own docstring claimed.

**Round 4 (1 finding).** `CANDIDATE_SCAN_LIMIT = 1_000_000` — the scan window that made rounds 2–3's
dedup fix correct — was safe from a counting-correctness standpoint but far too slow in practice:
measured at ~4.25s/268MB for 100,000 rows against real Postgres, which blows F09's own p95<3s
budget and risks an OOM in a memory-capped serverless function. See `MEMORY.md` **B-29** for the
lesson this produced.

**Round 5: clean PASS.** Lowered to `5_000` (measured ~190ms/28MB at that depth; because the
query's plan uses an index scan bounded by the limit, cost stays flat even against a 1,000,000-row
table underneath), verified with a real production-scale test — bulk-seeded past the limit via a
single SQL insert, called with the actual default with no injected override.

Every fix across all five rounds was verified by revert → confirm the specific test fails for the
right reason → restore, never by a green re-run alone.

## Verification

Final state: lint/typecheck clean, 821 unit, 53 contract, 208 integration (real Postgres), 71 e2e,
build clean, all three `check:*` scripts pass.

## Merged

PR #10 → `main` at `2e7345f` (squash).
