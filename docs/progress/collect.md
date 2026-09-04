# Lane COLLECT — scoring and collection

**Written by:** the coordinator only (`../06-PARALLEL-LANES.md` §4). A lane agent reports;
it never edits this file.
**Owns these source paths:** `services/scorer/` (F20's service — its own deploy target, its own
language, fixed in `../features/F20-scorer-service.md` §4.1), `apps/web/src/adapters/`,
`apps/web/src/services/jobs/`, `apps/web/fixtures/`
**Never touches:** any path owned by SPINE or SURFACE (`./spine.md`, `./surface.md`), and
**never `.github/workflows/`** — F01 owns every workflow file, including the scorer's own CI job
(F01 §4.4b). This lane delivers the *command* that job runs; it does not write the job. Two
accounts editing one workflow file is the collision the lane split exists to prevent.

**This lane holds the only irreversible clock in the plan.** Under D-16 collection is
forward-only with no backfill, so every day this lane is not collecting is corpus that
cannot be recovered (`../DEPLOY.md` MT-08).

## Features

| ID | Feature | Wave | Status | PR | Notes |
|---|---|---|---|---|---|
| F20 | Pinned scorer service and queue | 1 | **`merged`** 2026-09-03 | [#4](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/4) | **New (D-13).** Breaks the old "no Python service" rule, narrowly and by name. **Service half merged 2026-09-03**: `POST /score`, both models pinned by real, verified commit SHA, boot assertion, HTTP contract — built against a `ScoreBackend` protocol so the wrapping logic is unit-tested with no `torch` import (`services/scorer/README.md`). CI's Docker build ran for real — pip-installed torch/transformers, downloaded both pinned models by SHA, baked them into the image, ran the suite `--network none`, all green. **Queue-and-persistence half merged 2026-09-03**: lease/drain/attempt-budget machinery, re-score writing a successor artifact while the predecessor stays hash-verifiable, and the stance-availability outage-abstention path. Five rounds of adversarial `lane-review` converged the charging/attribution model (`../MEMORY.md` **B-24**) and fixed a real bug in the drain loop's outage stop condition (`../MEMORY.md` **B-23**). 590 unit + 39 contract + 114 integration, all green. **Not yet built: the real-model determinism suite (Tier D2)** — every test proves the wrapping logic is deterministic against a fake backend, none proves the real pinned weights are; tracked as this feature's one open DoD item |
| F04 | Provider platform | 1 | `7 adapters merged (substack, market, apewisdom, sec_edgar, marketaux, fred, x); Reddit discarded (D-39)` | [#14](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/14) (X), [#13](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/13) (market-data) | **2026-09-05 (D-39): the Reddit adapter is discarded, not blocked.** The legacy product does not source Reddit from its Data API at all; RNI's OpenAI Web Search path is the only Reddit acquisition this repository has. §4.3's nine-provider table is now an eight-provider table for this lane's purposes — Reddit is struck, not deferred. **Updated 2026-09-04 — corrected against the git tree, which this file had fallen behind:** the X adapter (PR #14, 5 review rounds) and the market-data collector service (PR #13, 5 review rounds) both merged 2026-09-03/04 and this file had not been updated to reflect either. **The `attention_snapshot` repository this feature's persistence half needs now exists** — merged 2026-09-04 as a standalone SPINE gap-fill (`../progress/spine.md`, `../MEMORY.md` B-27), since `repositories/` is SPINE-owned and this lane could not write it. Adapter set replaced (D-12). ~~Reddit still blocked on MT-13~~ — **superseded 2026-09-05: Reddit is discarded (D-39), not blocked; see this row's opening note.** **MT-14 is closed** — D-31 runs the trigger on FMP Starter's daily bars. Universe size is settled at **100** (D-27); the symbol list itself is committed (`migrations/seed/universe-v1.json`, B-21) — only the seed script run against a live `DATABASE_URL` (part of MT-08) remains. **§4.1's wrapper, §4.2's fixture harness, and §4.3's Substack/market-data/ApeWisdom/SEC EDGAR/Marketaux/FRED/X adapters are all merged.** **MT-15 (the Substack publication set) is now fully confirmed** (`../DEPLOY.md`: 13 publications, 10/11 GICS sectors, Utilities a disclosed gap) — collection is no longer blocked on an owner decision, only on wiring the confirmed list into this adapter's config, which is an engineering task, not a manual task. **Everything left in the roster now needs either a schema this lane has declined to guess against an unverified live response — FMP fundamentals is the standing example — or a governed cohort decision (X); Reddit is off the roster entirely (D-39).** DoD §6 says "six adapters"; seven are now merged, but against §4.3's nine-provider table, not the roster the DoD prose presumably meant (`MEMORY.md` B-18) |
| F16a | Dispatch core and trigger path | 1 | `merged 2026-09-05` | — | **Wave 1 half of F16** (`../features/F16-scheduler-dispatcher.md` §0): QStash signature verification (via `@upstash/qstash`'s `Receiver`), Redis lock, idempotency, `JobService.execute` shared by scheduled/triggered paths, the price-trigger path (writes a `CalculationArtifact` on every evaluation, incl. non-firing), X-budget refusal recorded as a `CoverageGap`, daily Vercel Cron heartbeat. Migration `0014` seeds `market_data_poll`/`attention_poll`/`x_sampling_window` (Reddit not seeded — D-39; Substack not seeded — no collector service exists yet; `x_sampling_window` seeded `enabled=false`). **No UI**, as specced. Coordinator-verified independently (not just the build agent's report): lint/typecheck clean, unit 1273/1273, contract 104/104, integration 374/374 against a real local Postgres, build clean. **Cross-lane addition, flagged for SPINE:** `src/calc/methods/market-spike-detection.ts` — a minimal v1.0.0 method, not yet wired into `analytics/registry.ts`'s `MethodRegistry`. **Real gap found and disclosed:** `job_definition.config_version` is a NOT-NULL FK and this codebase has no production `config_version` bootstrap path — migration 0014 seeds zero rows until one exists. See `progress/log/2026-09-05-f16a-dispatch-core.md` |

Registry estimate for this lane: **38–50 h** (`../03-ROADMAP.md` §2).

## Wave 1 sequencing

Under F-11's D-24 carve-out, only two pieces of this lane run parallel to SPINE's skeleton:
**F20's service half** and **F04's adapter and fixture layer** — neither consumes a domain
contract. F20's queue-and-persistence half, F04's persistence wiring and all of F16a wait for
F03 (`../06-PARALLEL-LANES.md` §1b).

**F01 merged 2026-09-03, so both carve-outs are now startable** — F04's adapter layer needed
F01's toolchain and no longer waits on anything.

**What F01 left in `services/scorer/`, and what it is not.** A **placeholder**, per F01 §4.4b:
`contract.py` is F20 §3's wire contract as an executable validator, and the CI lane that runs it
is green from F01 so that it has gated something by the time it has something to gate.

Three things F20 inherits rather than replaces:

1. **`contract.py` does not go away.** F20's real `POST /score` output is validated against
   exactly these rules — decimal strings not JSON numbers, `<repo>@<40-hex-sha>` not a tag,
   ISO-8601 UTC, truncation as a boolean.
2. **`tests/test_gate_can_fail.py` stays.** It runs a seeded failure in a subprocess and asserts
   a non-zero exit. Deleting it removes the only evidence the lane can go red.
3. **The container installs nothing.** "Reaches no network at test time" is a DoD item; F20 adds
   its models at **build** time, by commit SHA, baked into the layer.

**The Dockerfile has never been built** — no Docker daemon in the session that authored F01. CI's
`scorer` job is its first execution.

## Blocked

Nothing in this lane is blocked as of 2026-09-05.

| Feature | Blocker | What unblocks it |
|---|---|---|
| ~~F04 (Reddit)~~ | ~~MT-13~~ | **Discarded, not unblocked (D-39, 2026-09-05).** The legacy product does not build a Reddit adapter; RNI's OpenAI Web Search path covers Reddit for the repository. Not in this table as a live blocker |
| ~~F16a~~ | ~~MT-04~~ | **Merged 2026-09-05.** See the Features table above |

**Resolved 2026-09-03:** F04 (trigger) was blocked on MT-14 (market-data tier not chosen). D-31
closed it — FMP Starter's daily bars, no new vendor — and the market-data adapter merged the
same day. It is not in this table any more because it is not blocked any more.

**Resolved 2026-09-04:** F04 (Substack) — *collection* was blocked on MT-15 (publications
unnamed). The owner confirmed the 13-publication, 10/11-sector set (`../DEPLOY.md`). Not in this
table any more because the manual task is closed — what's left (wiring the confirmed list into
this adapter's config) is engineering work, not an owner blocker.

**Not blocked:** F20's service half, and **F04's Substack and market-data *adapters*** — feed
parsing, daily-bars parsing, the `ProviderResult` wrapper, fixtures and tests all build against
any URL, real key or not.

**The distinction, because this file previously asserted both sides of it.** The adapter is
unblocked; *collection* is blocked on MT-15, because you cannot poll publications nobody has
named. Under D-16 that second half is the one with a clock on it — the adapter can be written any
week, the corpus can only be collected in real time.

## Counters owned by this lane

| Counter | Value | Needed | Feature |
|---|---|---|---|
| Scorer determinism (identical inputs, two batch sizes) | not measured | byte-identical (Tier D2) | F20 |
| Scorer provenance completeness | not measured | 100% (Tier D3) | F20 |

## In flight

**F20's service half — merged 2026-09-03.** Picked as the next SELECT after F04's adapter
roster ran out of slices with both a named zero-blocker and a verifiable schema — F20's service
half genuinely has neither prerequisite: source §0's split makes it depend on nothing in `src/`,
and (unlike a provider API) this session could verify the two model pins directly against
`huggingface.co/api/models/<repo>`'s own `"sha"` field, independently and twice each.

`services/scorer/` replaces F01's placeholder with six modules: `pinning.py` (the two pinned
models and the boot assertion), `scoring.py` (batching/truncation/hashing against a
`ScoreBackend` protocol — mirrors `apps/web/src/adapters/wrapper.ts`'s ports pattern so none of
it needs `torch` to test), `app.py` (Flask `POST /score` / `GET /health`, backend-injected),
`models.py` (the real `transformers` backend — not exercised locally), `main.py` (the real entry
point) and `download_models.py` (build-time model baking). 40 Python tests, up from 18.

**CI's Docker build actually ran, for the first time.** This session has no Docker daemon —
`Dockerfile`'s own note, unchanged since F01 — so the build-time `pip install` and the
`download_models.py` step (real network calls to PyPI and the Hub) were untested until pushed.
Both jobs came back green: the image built, both pinned revisions downloaded and baked in, and
`docker run --rm --network none scorer:ci` ran the full suite with no network reachable at all.

**What is not done, stated rather than implied by "merged."** The determinism suite against the
*real* models (Tier D2) does not exist yet — every test here proves the wrapping logic is
deterministic against a fake backend, none of them load `ProsusAI/finbert` or
`cardiffnlp/twitter-roberta-base-sentiment-latest` and prove the real weights produce
byte-identical output at two batch sizes. That is F20's actual headline guarantee, and it is
still unverified. The label mapping (`positive/negative/neutral` → `bullish/bearish/neutral`,
verified against each model's own `config.json`) is a declared assumption `README.md` flags for
F10's owner to review, not something this session is positioned to rule on.

**Next in F20:** the real-model determinism suite, which needs a session with a Docker daemon
or CI itself to run against — this session cannot verify it beyond what already ran. After that,
the queue-and-persistence half waits on F01 and F03, both already merged, so it is genuinely
next once someone picks it up.

**F04 §4.2, the fixture harness — merged 2026-09-03.** Generic plumbing only, since no adapter
exists yet to carry provider-specific fixture knowledge (`fixtures.ts`): `readFixture` loads a
frozen `{status, headers, body}` file from `fixtures/<provider>/<endpoint>/<case>.json`;
`createFixtureFetcher` turns that into the wrapper's `Fetcher` port, reading the case name off
an `x-fixture-case` request header rather than the URL — a fixture has no URL to route on, and
two adapters can share an endpoint name against different hosts; `createFetcher` is the one
place `PROVIDER_MODE` decides fixture vs. live, stripping the fixture-case header before a live
request is ever built so it can never reach a real HTTP call. A missing or malformed fixture
throws (`FixtureNotFoundError` or a shape error) rather than inventing a response. 10 new unit
tests against a scratch fixture tree (`mkdtemp`), so the harness's own tests never touch the
committed `fixtures/` namespace. Full gate green: lint, typecheck, 264 unit tests, build,
`check:bundle`.

**What it does not do:** no fixture files exist yet under `apps/web/fixtures/` — there is no
adapter to record real payloads for. The nine-case matrix per adapter (§4.3) stays deferred,
now genuinely unblocked rather than waiting on this slice.

**F04 §4.1, the wrapper — merged 2026-09-03.** The nine-stage pipeline every adapter call passes
through, built against ports rather than modules: `02-ARCHITECTURE-CONTRACTS.md` §3 allows
`adapters` to import `contracts` and nothing else, so the quota ledger, budget gate, cache, call
log and cost sink all arrive as injected interfaces and are implemented in `services/` later.
That is what let this slice be built and tested with no database, no Redis and no network — and
it is what makes the order assertions possible, since a wrapper that checked the budget last
would return identical values to one that checked it first.

**What it closes of F04's DoD (3 of 11):**

- *A 403 is never retried; a test proves it.* Proven at both layers — see B-17, which is the
  finding that the obvious test could not fail.
- *Budget pre-check hook is called before every priced request.* Asserted on the port call
  sequence, which is what F04 §7 step 2 reviews.
- *`costUsd` is `null` for unpriced calls and never `0`.* Including on a cache hit, where the
  request never happened.

**F04 §4.3, the Substack RSS adapter — merged 2026-09-03.** `fetchSubstackFeed` (`substack.ts`)
passes `https://<publication>.substack.com/feed` through the wrapper — schema is `z.string()`
since RSS has no zod-checkable shape at stage 8 — then `parseSubstackFeed` turns the XML into
`SubstackEntry[]`. A feed that doesn't parse as RSS at all (wrong host, an HTML error page) is
reported as `{kind:'contract'}`, the same taxonomy a JSON adapter uses. **Never priced** — RSS
is a flat, free poll, so `costUsd` stays `null` unconditionally. **CDATA content stays raw**
(D-17): `content:encoded`/`description` get no entity decoding, since CDATA is how Substack
already protects its HTML from that; plain elements (`title`) decode normally. Six real
fixtures recorded against §4.2's harness under `apps/web/fixtures/substack/feed/`. Added
`fast-xml-parser` (no runtime deps) — the first dependency any adapter has needed.

Dedup/entry-shift handling across polls (`05-TEST-STRATEGY.md` §2.1's two-snapshot pair) needs
persisted state — which guids were already seen — so it is the collector's job (F16a), not this
adapter's, and stays deferred to that slice.

**F04 §4.3, the market-data adapter — merged 2026-09-03.** `fetchDailyBars` (`market.ts`) calls
FMP's `historical-price-full` endpoint under `provider: 'market'`, kept distinct from
`provider: 'fmp'` despite sharing a vendor — `rate-limit.ts`'s `BUCKETS` already separates them
(continuous polling vs. scheduled fundamentals), and merging the tag would let one starve the
other's quota. **Runs on FMP Starter's daily bars, not the intraday tier §4.3's table assumed**
— D-31 closed MT-14 with "no new vendor," trading resolution for zero additional spend; the
named cost is that a spike which reverts intraday will not fire D-15's trigger. **The full
nine-case fixture matrix is closed for this adapter** — the first one where it is — including
FMP's real 200-with-an-error-body quirk as the `malformed` case. Never priced (flat-tier
subscription).

**F04 §4.3, the ApeWisdom adapter — merged 2026-09-03.** `fetchApeWisdomRanking(filter, page)`
(`apewisdom.ts`) is picked ahead of FMP's fundamentals endpoints because it is **the mechanism
D-30 names to close MT-07** — the universe's 100 symbols are "the tickers ranked most-discussed
by ApeWisdom on the seed date," and MT-07's list itself is still outstanding
(`../DEPLOY.md`). This adapter does not populate `migrations/seed/universe-v1.json` itself — that
still needs a script run deliberately against it, recording the seed date as the methodological
commitment D-27 calls it — but it is the piece that made pulling that ranking possible at all.
Numeric-string fields (`mentions`, `upvotes`, the two `_24h_ago` fields) are kept as strings
rather than coerced, so a future shape change is a contract violation, not a silently-accepted
`NaN`. **Full nine-case matrix closed.** Never priced (free, keyless). Per D-30/D-12, the module
doc notes it is no longer an independent cross-check on the axis it now selects.

**F04 §4.3, the SEC EDGAR adapter — merged 2026-09-03.** `fetchCompanySubmissions(cik)`
(`sec-edgar.ts`) calls `data.sec.gov/submissions/CIK##########.json`. Zips EDGAR's real
column-of-arrays filings shape (parallel arrays keyed by index — `accessionNumber[i]`,
`filingDate[i]`, ... all describe filing *i*) into one row per filing, dropping an index if any
column is short there rather than failing the whole response. **Schema not live-verified** —
this session's own attempts to confirm the shape (`WebFetch` against SEC directly, and against
FMP's docs for the *next* candidate adapter) were both blocked, SEC's rejection being the exact
"undeclared automated tool" message now sitting in the `malformed` fixture. Documented in the
module doc as a standing note for whoever runs F04 §4.4's entitlement probe: confirm this shape
against a real response before anything depends on it. Requires a real `SEC_USER_AGENT` in live
mode, required-in-practice the same way `market.ts`'s `apiKey` is — nothing in `adapters/` reads
`env.ts`. Eight of nine fixture cases apply; `null-where-number` doesn't, since nothing in this
schema is a required number, and the deferred table says so rather than faking a ninth case.

**Correction to this file's own prior record.** The "persistence wiring… needs a migration"
line below was stale: `provider_call_log`, `cost_event` and `raw_provider_payload` all exist
already (migrations 0007–0008), landed with SPINE's F03/F22 work before this lane checked. The
real blocker for wiring the wrapper's `CallLogSink`/`CostSink`/`ContractViolationSink` ports to
real persistence is that the SQL to do it belongs in `repositories/`, which `CLAUDE.md` reserves
for SPINE — this lane can consume a repository function, not add one. Only the quota-ledger's
restart-survival table is genuinely unbuilt.

**F04 §4.3, the Marketaux adapter — merged 2026-09-03.** `fetchMarketauxNews(symbols)`
(`marketaux.ts`) calls `/v1/news/all` and returns articles with per-entity sentiment, kept
nullable — Marketaux does not score every entity in every article. **Never priced**: the
100-requests/day ledger is the real constraint (`DEPLOY.md`: "development shares this quota…
F04's ledger and fixture-default mode exist for this reason"), not a per-call charge. **Schema
also not fully live-verified** — two independent sources disagreed on the per-entity sentiment
field name (`sentiment_score` vs. `score`) during this session's check, so most of the article
shape stays optional rather than asserting a field name seen only once. Same discipline as SEC
EDGAR's note; §4.4's probe settles both. Eight of nine fixture cases apply directly;
`null-where-number` is represented as a null on a required string (`entity.symbol`) instead,
since nothing in this schema is a non-nullable number — named as such in the deferred table
rather than mislabeled.

**F04 §4.3, the FRED adapter — merged 2026-09-03.** `fetchFredSeriesObservations(seriesId)`
(`fred.ts`) is this session's **highest-confidence schema** — corroborated against FRED's own
documentation's worked example, not a third-party mirror. Maps FRED's `"."` missing-value
sentinel to `null` (a present observation with no value, not an absent one); keeps `value` as a
decimal string for the same reason `costUsd` is one. Free, keyed, no blocker. Nine fixtures;
`null-where-number` again represented as a null on a required string (`observation.date`), since
`value` is a string by design.

**Six of the roster's adapters now return `ProviderResult` and never throw** — Substack, market
data, ApeWisdom, SEC EDGAR, Marketaux and FRED. `docs/MEMORY.md` B-18 already flags that F04's
DoD miscounts the roster at six against §4.3's nine; six are now merged, satisfying the DoD's
literal number while leaving three of the table's nine providers (Reddit, X, FMP) unwritten —
worth flagging to whoever next reconciles B-18, since "six done" and "the DoD item closed" are
not the same claim.

**This session's adapter run ends here.** What's left in the roster: **Reddit** needs MT-13
(the plan's longest pole); **X** needs a governed cohort the plan has deliberately deferred;
**FMP's fundamentals endpoints** need a schema this lane has three times now (this session)
declined to guess rather than verify against a live response — 403s and a 401 blocked every
verification attempt, for a paid, keyed vendor where a wrong guess is a worse trade than for the
free, well-documented providers this session could actually confirm. The persistence wiring
stays out of this lane's reach until either SPINE writes the repository functions or the
coordinator explicitly authorizes crossing the boundary for a solo session.

**This slice does not unblock F05 or F16a, nor does it close MT-07.** F05/F16a need data and a
`JobService`, not adapters in isolation; MT-07 needs the seed script run and its output recorded,
which is a deliberate act, not a byproduct of the adapter existing. Nothing on the board moved.

**Since this section was written: the market-data collector and X adapter both merged** (PRs #13
and #14, five adversarial `lane-review` rounds each — see the merge commits for the round-by-round
findings; this file was not updated at the time, which is why the Features table above carries a
2026-09-04 correction note). Both close the same way every prior adapter slice did: `ProviderResult`
returned, never thrown, full fixture matrix, never priced or explicitly priced per §4.3's table.

## Deferred from a DoD

| Item | Why it is not closed | Trigger |
|---|---|---|
| **F20: the real-model determinism suite (Tier D2)** | The wrapping logic (batching, truncation, hashing, HTTP) is unit-tested against a fake backend; no test yet loads the real pinned weights and proves byte-identical output at two batch sizes. Needs a Docker daemon this session does not have | A session with Docker, or a CI-only test job added to the workflow |
| F20: label-mapping review | `models.py` maps positive/negative/neutral → bullish/bearish/neutral, verified against each model's own `config.json` but not reviewed against F10's stance definitions | Whoever owns F10 |
| F20: queue and persistence half | Depends on F01 and F03, both merged — genuinely unblocked, not yet started | Next COLLECT pickup |
| The remaining adapters, each returning `ProviderResult` and never throwing | Substack, market data, ApeWisdom, SEC EDGAR, Marketaux and FRED merged 2026-09-03 (six — the DoD's literal count, against three of §4.3's nine providers, not all nine); X and FMP (fundamentals) are not. **Reddit is discarded (D-39), not remaining** | X needs a governed cohort (deferred); FMP needs a verified schema |
| The full nine-case fixture matrix | **Closed for market data and ApeWisdom, both 2026-09-03.** SEC EDGAR closes eight of nine — no required numeric field exists to null out, so `null-where-number` doesn't apply to this adapter and is noted as such rather than faked. Substack's own matrix is narrower (RSS has no per-field contract to violate the way JSON does; §2.1 governs it instead) | The remaining adapter slices |
| Quota ledger **survives a restart** | The port is defined and the wrapper reserves and releases against it. Survival is a property of the *implementation* — Redis with a Postgres mirror — and no ledger table exists yet | The persistence slice; needs a migration, which is SPINE's to write |
| `docs/provider-entitlements.md` | The probe calls live endpoints. It is a one-shot script run deliberately, and it needs adapters and keys. **MT-14 no longer blocks it; Reddit is off the roster (D-39)** — only live keys for the remaining providers do now | the remaining adapter slices |
| `/api/health/providers` makes no outbound call | The route shell exists from F01; it has no provider state to report until the stores are real | The persistence slice |
| ApeWisdom methodology version captured per snapshot | The adapter is written and returns the ranking; capturing a version/date **per persisted snapshot** (R-03) is a persistence-layer concern — no snapshot table exists yet | The persistence slice |
| A contract failure is logged at error level with the payload reference | The `ContractViolationSink` port fires and is tested; `payloadRef` is always `null` until the sink is wired to a repository | **Correction, 2026-09-03: `raw_provider_payload`, `provider_call_log` and `cost_event` all already exist** (migrations 0007–0008, from SPINE's F03/F22 work) — this row previously implied a missing migration was the blocker. The actual blocker is that writing the repository functions over those tables is `repositories/`, which this lane does not own (`CLAUDE.md`: "Never edit a path another lane owns"); only the quota-ledger table is genuinely unbuilt |
| **F16a: production `config_version` bootstrap** | `job_definition.config_version` is a NOT-NULL FK; this codebase has no path that ever creates a production `config_version` row (confirmed by grep — `insertConfigVersion`/`activateConfigVersion` are called only from tests). Migration 0014 seeds zero rows on a fresh/real DB as a result | SPINE bootstraps the first production `config_version`, then a follow-up migration or manual insert seeds F16a's job rows against it |
| **F16a: `market.spike_detection` promotion into the real registry** | Built as the one explicitly-authorized cross-lane addition to `calc/methods/` (F16a needed *a* spike verdict to satisfy F16 §4.1b's "every evaluation writes a CalculationArtifact" DoD item); not wired into `analytics/registry.ts`'s `MethodRegistry`, so it is invisible to `check:calc-coverage` and the Inspector's formula catalogue | F06's owner reviews and promotes it (or replaces it) when F06 next picks up spike detection |
| **F16a: attempt/backoff-aware retry scheduling** | A failed `job_run` currently advances to the next ordinary interval rather than retrying sooner per `job_definition.backoff_policy`/`max_attempts` | Whoever next touches `job-service.ts` |
| **F16a: heartbeat route auth is best-effort** | Vercel Cron's automatic `Authorization` header injection only fires for a variable literally named `CRON_SECRET`, not `INTERNAL_DISPATCH_SECRET` — documented in the route's own comment, not silently assumed secure | Rename to `CRON_SECRET`, or add an explicit Vercel Cron secret-header configuration, whichever `DEPLOY.md`'s owner prefers |

## Resolved defects

| Defect | Where it came from | Recorded |
|---|---|---|
| The end-to-end "one attempt on a 403" test could not fail from any single-point regression — two independent layers block the retry, and breaking either left it green | Found by mutating each layer separately rather than by reading the code | B-17 |
| A cache hit consumed a day's quota unit for a call it never made — invisible on most providers, four days of lost collection on Marketaux's 100/day | §4.1 orders the ledger before the cache; correct under concurrency, wrong without a release path | B-16 |
