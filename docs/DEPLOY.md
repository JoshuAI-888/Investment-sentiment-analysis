# Deploy — Manual Tasks for the Owner

> **RNI scope (2026-09-05):** use `rni/DEPLOY.md` for RNI. MT-13 and Reddit Data API approval
> continue to gate the legacy collector but do **not** gate RNI, whose Reddit acquisition path is
> OpenAI Web Search. RNI's live gates are OpenAI source-first capture, independent X access, FMP
> S&P 500 entitlement/activation and `joshuai` production approval.

Everything here needs a human. The build agent cannot do these, and it must not fake them —
a stubbed key is a lie the tests will later believe.

**Re-ordered 2026-09-03** by the re-lock (`MEMORY.md` §1b).

**Legend:** 🔴 blocking (a feature cannot merge without it) · 🟡 needed by a named wave ·
🟢 optional or later.

## Do these first, in this order

**Re-ordered 2026-09-03.** MT-00 and MT-07 are closed (D-26, D-27), and **MT-13 moves to the
top**: it is the only remaining item whose lead time is outside the owner's control.

| # | Task | Why it is first |
|---|---|---|
| 1 | **MT-13 — file the Reddit Data API application** | **Confirmed not filed.** $0, and the only item here with an **external queue**: slow, opaque, and able to reject without explanation. Nothing downstream shortens it, and it gates the largest channel in the product. Every other task on this list completes when you decide to do it; this one completes when someone else decides |
| 2 | ~~MT-15 — name the Substack publications~~ | **Confirmed 2026-09-04.** 13 publications, 10/11 sectors. **This is the only channel that can collect today** — no key, no approval — so it is what actually starts the forward-only clock, once F04's config is wired to the confirmed list |
| 3 | **MT-04 — create the QStash schedule** | Re-scoped to **Wave 1**: MT-08 runs on it. Needs a stable deploy URL first, which is the only reason it is not higher |
| ✅ | ~~MT-07's symbol list~~ | **Done 2026-09-03.** Ranking pulled, ETFs excluded, committed as `migrations/seed/universe-v1.json` (B-21) |
| 5 | **MT-08 — start the collector** | Still the highest-value outcome in the plan, but **not executable until F04 and F16a exist** (`PROGRESS.md`). It is a milestone, not a task you can do this afternoon |
| 6 | **MT-06 — set the LLM keys** | Transport decided (Vercel AI Gateway, D-34); the keys and the different-vendor verify route are still to provision. Unblocks Wave 3 |
| ✅ | ~~MT-00~~ · ~~MT-07 size~~ · ~~MT-12~~ · ~~MT-14~~ · ~~MT-01~~ | Closed by **D-26** (admin email), **D-27**/**D-30** (universe), **D-32** (budgets, X at zero), **D-31** (daily bars), **D-25** (flatten) |

**Why MT-08 dropped from first to fifth, and it is not a change of priority.** Under D-16 a
missed day is still permanent loss, and starting the collector is still the most valuable thing
that can happen. But MT-08 was listed as though it were a manual task the owner could do
immediately, and it is not: the collector needs F04's adapters and F16a's dispatcher to exist.
Listing it first made the plan feel actionable while the genuinely blocking items — an external
approval queue and two provisioning decisions — sat below it. **The fastest route to a running
collector is the four items now above it.**

---

## MT-00 ✅ — RESOLVED 2026-09-03 (D-26)

**Answer: `joshuaifang@gmail.com`** — the source PRD's spelling, with the `i`. It was **not** a
typo: it matches the `joshuai.nz` domain handle. The correction this task proposed would have
been the error.

```
ADMIN_EMAIL_ALLOWLIST="joshuaifang@gmail.com"
```

**F02 is unblocked.** Set this in Vercel before the first authenticated deploy, and check F02's
boot assertion logs it at startup — that assertion exists so a later regression appears in the
deployment log rather than at the first admin click.

<details><summary>Original task, retained for the record</summary>

### MT-00 (resolved) — Confirm the administrator email

**Blocks:** F02 (and therefore every authenticated surface).

The source PRD specifies `ADMIN_EMAIL_ALLOWLIST="joshuaifang@gmail.com"`. The account driving
this project is `joshuafang@gmail.com` — without the `i`. The PRD's spelling matches the
`joshuai.nz` domain handle, so it may well be deliberate, but if it is a typo the deployed
application will have **no reachable administrator**: no universe activation, no config, no
budgets, recoverable only by redeploying with a corrected variable.

**Action:** state which address is correct. If both mailboxes exist, say which one you will
actually sign in with.

**Answer:** `joshuaifang@gmail.com` (2026-09-03, D-26)

> F02 also adds a boot assertion that logs the configured admin address at startup, so a
> later regression is visible in the first deployment log rather than at the first admin click.

</details>

---

## MT-01 ✅ — RESOLVED 2026-09-03 (D-25)

**Was:** migrate `barebones/` to its own repository, because the host repository's unrelated
Python/Databricks pipeline would confuse agents and CI (`MEMORY.md` D-01).

**Resolved differently, and the problem it named is gone.** The package was flattened to the
repository root and the pipeline — **finsent** — was archived at `archive/finsent/`. The
collision D-01 worried about no longer exists: there is one project at the root, one `docs/`,
one `README.md`, and a `CLAUDE.md` that describes only this build. A separate repository would
now add a migration and remove nothing.

**Overtaken 2026-09-04: `archive/` (including `finsent/`) is gone.** The owner reset the
repository's git history and dropped `archive/` entirely, confirmed deliberate. The paragraph
above described why it mattered while it existed; it no longer applies. D-18's port from
`archive/finsent/src/backtest/{engine,pit}.py` has no source left to port from — see `MEMORY.md`
D-18's superseding note. F12's evaluation harness will be built from scratch, not ported.

**Still outstanding from the original task:** set branch protection on `main` to require the CI
check once **F01** creates it. That is the one item here the flatten did not do, and it cannot
be done until the check exists.

---

## MT-02 🟡 — Verify the Resend sending domain end to end

**Needed by:** F02. **Status per D-06:** provisioned — this is verification, not setup.

1. Confirm `accounts.joshuai.nz` shows SPF, DKIM and DMARC verified in Resend.
2. Send a live test to **three** mailboxes: Gmail, Outlook, and one corporate address.
3. Confirm each lands in the inbox, not spam. OTP in spam is indistinguishable from broken
   auth for a first-time user.
4. Note the free-tier limits (100/day, 3,000/month) — F02's send cap must sit below the daily
   figure, so a burst of code requests cannot exhaust the allowance and lock you out.

**`OTP_DAILY_GLOBAL_LIMIT` is void under D-11** (F01 §4.2). Nothing to configure here: with one
allowlisted address the cap is a constant in F02 §4.2, derived from the figure above. Recorded
rather than deleted because this blank previously asked you for a value.

### Step-by-step, assuming no prior Resend experience

1. Go to [resend.com](https://resend.com) and sign in (D-06 says an account already exists —
   use it rather than creating a second one).
2. In the left sidebar, click **Domains** → find `accounts.joshuai.nz` in the list (or click
   **Add Domain** and enter it if it isn't there yet).
3. Click into the domain. Resend shows a table of DNS records (usually one SPF `TXT`, one or
   two DKIM `CNAME`/`TXT`, and one DMARC `TXT`), each with a status of *Pending* or *Verified*.
4. Log in to wherever `joshuai.nz`'s DNS is managed (your domain registrar, or Cloudflare if
   you use it) and add each record exactly as Resend displays it — same **type**, same
   **name/host**, same **value**. Do not paraphrase the value; copy-paste it.
5. Back in Resend, click **Verify** (or wait — DNS changes can take anywhere from a few minutes
   to ~48 hours to propagate). Refresh until every row reads *Verified*.
6. Click **API Keys** in the sidebar → **Create API Key** → give it a name (e.g.
   `investment-sentiment-prod`) → copy the key immediately (Resend shows it once). This is
   `RESEND_API_KEY` — set it in Vercel (see MT-03's step-by-step for where that setting lives).
7. Once verified, send the three test emails from the Resend dashboard's **Emails** → **Send
   test email** panel, or with `curl`:
   ```bash
   curl -X POST 'https://api.resend.com/emails' \
     -H "Authorization: Bearer $RESEND_API_KEY" \
     -H 'Content-Type: application/json' \
     -d '{"from":"otp@accounts.joshuai.nz","to":"your-gmail@gmail.com","subject":"test","text":"test"}'
   ```
   Repeat for the Outlook and corporate addresses. Check each inbox (and its spam folder) —
   record here whether all three landed clean: ______________

---

## MT-03 🟡 — Confirm infrastructure and record connection details

**Needed by:** F03, F04. **Status:** provisioned.

| Service | Confirm | Into |
|---|---|---|
| Neon | **Launch tier, not Free** (D-33) — Free's 0.5 GB is exhausted in 3–4 months at 120–180 MB/month and never recovers, because D-17 makes the corpus permanent. Confirming only that "a project exists" is what let this gap survive three review passes. Plus the **pooled** connection string (serverless needs the pooler) | `DATABASE_URL` |
| Upstash Redis | database created; REST URL and token | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| Vercel | project linked to the repository from MT-01; preview deployments enabled | — |

Set every value in Vercel's environment settings for Preview and Production separately. Never
commit a key.

### Step-by-step, assuming no prior experience with any of these three services

**A. Vercel — connect the repository and get a live URL**

1. Go to [vercel.com](https://vercel.com), sign up or log in with GitHub (using the GitHub
   account that owns/has access to this repository).
2. Click **Add New...** → **Project**. Vercel lists your GitHub repos — find
   `Investment-sentiment-analysis` and click **Import**.
3. On the configuration screen, set **Root Directory** to `apps/web` (the app lives in a
   subfolder, not the repo root) — click **Edit** next to Root Directory to change it.
   Framework Preset should auto-detect as **Next.js**; leave build/output settings default.
4. Don't worry about environment variables yet — click **Deploy**. It will fail or half-work
   without `DATABASE_URL` etc., and that's fine; this first deploy exists only to get you a
   stable `*.vercel.app` URL (needed by MT-04) and a **Project Settings** page to add variables
   to.
5. Once deployed (or failed-but-created), go to **Project → Settings → Environment Variables**.
   This is where every `VARIABLE_NAME` mentioned anywhere in this document gets pasted, once for
   **Preview** and once for **Production** (tick both checkboxes, or add it twice).
6. After adding variables in later steps, go to **Deployments** → click the **⋯** menu on the
   latest deployment → **Redeploy**, so the new variables take effect.

**B. Neon — the Postgres database**

1. Go to [neon.tech](https://neon.tech), sign up or log in.
2. Click **Create Project** (or open the existing one if D-06's provisioning already made one).
   Name it anything (e.g. `investment-sentiment`).
3. **Confirm the plan is Launch, not Free** — in the project's **Billing**/**Plan** settings.
   Free's storage ceiling is exhausted in 3–4 months under this project's collection rate
   (D-33) and cannot be recovered from, so this check matters more than it looks.
4. On the project dashboard, find **Connection Details** (sometimes called **Connect** or shown
   directly on the Overview page). There is a toggle or dropdown for **Pooled connection** —
   turn it on. Serverless platforms like Vercel need the pooled string, not the direct one.
5. Copy the full connection string (starts `postgres://...` and its hostname contains
   `-pooler`). Paste it into Vercel as `DATABASE_URL` (step A.5 above).

**C. Upstash — the Redis database**

1. Go to [upstash.com](https://upstash.com), sign up or log in.
2. Click **Redis** in the sidebar → **Create Database**.
3. Give it a name, pick a **Regional** database (not Global — this app doesn't need
   multi-region), and choose a region close to where Vercel deploys (e.g. `us-east-1` if
   unsure — Vercel's default region is US East).
4. Once created, open the database. Find the **REST API** section (not the Redis CLI/TCP
   details — this app talks to Redis over HTTPS). Copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. Paste both into Vercel (step A.5).

At the end of A–C you should have `DATABASE_URL`, `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` all set in Vercel, and a working `https://<your-project>.vercel.app`
URL — which MT-04 needs next.

---

## MT-04 🔴 — Create the QStash schedule

**Blocks:** **F16a — and therefore MT-08.** Re-scoped 2026-09-03: F16's dispatch core moved to
**Wave 1** (D-15, D-16), so this is no longer a Wave 4 task. The collector cannot run on a
schedule that does not exist, and under forward-only collection a late start is permanent loss.
**Do this in the first week, not before the first deploy** — see the ordering note below.

Exactly **one** schedule, created once, by hand. The admin console must never be able to
create, edit or delete it (ADR-013).

1. In Upstash QStash, create a schedule: destination `https://<app>/api/cron/dispatch`,
   cron `*/5 * * * *`, method POST.
2. Copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` into Vercel.
3. Generate a random `INTERNAL_DISPATCH_SECRET` (32+ bytes).
4. Note the capacity: 288 messages/day, 8,640/month — within the free allowance. A cadence
   change is a cost decision.

**Do this after** the app has a stable deployment URL, so the schedule does not fire into
nothing for days.

### Step-by-step, assuming no prior experience with QStash

1. Prerequisite: finish MT-03 part A first — you need a live `https://<your-app>.vercel.app`
   URL before this schedule means anything.
2. Go to [console.upstash.com](https://console.upstash.com) (same Upstash account as MT-03's
   Redis, if you used one account for both) and click the **QStash** tab in the sidebar.
3. On the QStash overview page, copy the three credentials shown there — labeled roughly
   **QSTASH_TOKEN**, **Current Signing Key** and **Next Signing Key**. Paste all three into
   Vercel's Environment Variables (MT-03 step A.5) as `QSTASH_TOKEN`,
   `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
4. Still in the QStash console, find **Schedules** (a tab or a button near the top) → **Create
   Schedule** (sometimes labeled **New Schedule**).
5. Fill in the form:
   - **Destination URL**: `https://<your-app>.vercel.app/api/cron/dispatch` (replace
     `<your-app>` with your real Vercel subdomain, or your custom domain if you set one up).
   - **Cron expression**: `*/5 * * * *` (runs every 5 minutes).
   - **Method**: `POST`.
   - Leave body empty; leave headers default unless the app's route requires a specific header
     (it doesn't — QStash signs the request automatically and `/api/cron/dispatch` verifies
     that signature).
6. Click **Create**. You should see the schedule listed with a "next run" time a few minutes
   out.
7. Generate the internal secret on your own machine's terminal (not in any web console):
   ```bash
   openssl rand -hex 32
   ```
   Copy the output and set it in Vercel as `INTERNAL_DISPATCH_SECRET`.
8. Redeploy the Vercel project (MT-03 step A.6) so all the new variables take effect.
9. After the next 5-minute mark, check the QStash console's **Logs** or **Activity** tab for
   the schedule — it should show a delivery attempt with a 200 (success) or, if the route isn't
   built/deployed yet, an error you can safely ignore until F16a merges.

---

## MT-05 🟡 — Confirm provider keys and quotas

**Needed by:** F04. **Status:** provisioned.

**Re-based 2026-09-03 by D-12.** The adapter set changed; this table changed with it.

| Provider | Confirm | Note |
|---|---|---|
| **Reddit Data API** | **approval status** — see MT-13 | **The largest channel.** Free non-commercial tier, 100 QPM. Not yet applied for |
| **Substack RSS** | nothing to provision — `https://<publication>.substack.com/feed` | Free, officially supported, **zero lead time**. Build against this while MT-13 waits. Publication set is MT-15 |
| **X API** | pay-per-use account funded; note the balance; set `X_BEARER_TOKEN` | **$0.005/Post read, no free tier.** Ceilings in MT-12. Trigger-sampled only (D-15). `X_BEARER_TOKEN` is required in `PROVIDER_MODE=live` even though nothing dispatches it yet (matches `ALPHA_VANTAGE_API_KEY`'s row) |
| **Market data (intraday)** | tier, price, delay, call limit — see MT-14 | D-15's trigger depends on it. **Wave 1** |
| FMP Starter | key active; **which plan tier**, exactly | Fundamentals and filings. Entitlement probe still applies, but OQ-2's urgency drops with D-19 |
| ApeWisdom | no key | **Demoted to an independent cross-check** on the Reddit attention axis (D-12). No longer load-bearing |
| Marketaux | key active; free tier 100 req/day | Development shares this quota — F04's ledger and fixture-default mode exist for this reason |
| Alpha Vantage | key active | Demoted to `CONGRESS_TRADES` only (`MEMORY.md` R-07) |
| ~~Linkup~~ | — | **Dropped by D-12.** Cancel the account if funded |
| FRED | free key | |
| SEC EDGAR | no key; set `SEC_USER_AGENT` to a **real** product name and contact address | SEC blocks generic agents |

**Watch for:** two consecutive days of Marketaux quota exhaustion in the ledger is the trigger
to consider the Basic tier (`01-PRODUCT-SPEC.md` §5).

---

## MT-06 🔴 — Provision LLM access

**Blocks:** F10, F11, F12 — the entire agentic research feature, i.e. the product's thesis.
**Status:** **not provisioned.** This is the largest single blocker in the plan.

**Transport decided 2026-09-03 (D-34): Vercel AI Gateway.** Set `AI_GATEWAY_API_KEY` and
`MODEL_TRANSPORT_DEFAULT=vercel_gateway`. One integration, unified spend visibility, provider
fallback, no token markup. The spend visibility is load-bearing now that D-11 and D-32 leave the
**global** ceiling as the only budget control.

**The verifier runs on a different vendor from synthesis (D-34)** — not merely a different model.
Two models from one vendor share training lineage and therefore share blind spots, and the
failure this verifier exists to catch (F-22's fluent, well-cited, subtly wrong prose) is exactly
what correlated models miss together.

Then choose three task routes. **Do not paste model IDs from memory** — the build agent fetches
current IDs from the transport at implementation time (ADR-017), and they belong in versioned
config, not in code.

> **Route table corrected 2026-09-03.** It previously assigned `AI_MODEL_FAST` to *stance
> classification (batched, high volume)*. **D-13 moved stance classification to the pinned scorer
> service** (FinBERT / Twitter-RoBERTa, reproducible indefinitely) and **D-21 limits LLM methods
> in v1 to relevance filtering and ticker-collision disambiguation only.** The old row described
> a v1 the decisions had already removed, and it materially oversized the route: relevance and
> collision are a far smaller load than scoring every item.

| Route | Used for | Wants |
|---|---|---|
| `AI_MODEL_FAST` | **relevance filtering and ticker-collision disambiguation** (D-21) — *not* stance, which is F20's pinned scorer | cheap, fast, reliable structured output. Collection is not latency-sensitive, so the Batches API (50% cost) fits this route |
| `AI_MODEL_SYNTHESIS` | the explanation | strongest available |
| `AI_MODEL_VERIFY` | verification and the judge | **a different vendor from synthesis** (D-34) — a model checking itself is not a check, and same-vendor models share blind spots |

Set a spend limit at the provider as a backstop independent of the application's own budgets.

---

## MT-07 ✅ — FULLY RESOLVED 2026-09-03 (D-27, D-30, B-21)

**The symbol list itself is now pulled and committed** —
`apps/web/migrations/seed/universe-v1.json`, 100 symbols, `seededAt: 2026-09-03`. ApeWisdom's
raw top-100 was filtered to exclude broad-market/sector ETFs (owner call, 2026-09-03) and
backfilled with the next-ranked individual companies; every exchange was resolved against SEC's
own ticker registry rather than guessed. `MEMORY.md` **B-21** has the detail, including two ETFs
(`IGV`, `SOXX`) that a name-only filter would have missed. **F03's seed script can now run** —
the only remaining step is executing `pnpm seed:universe` against a real `DATABASE_URL` (MT-03),
which is part of MT-08.

<details><summary>Prior state, retained for the record</summary>

**Answer: 100 symbols** — the top of D-15's re-based band.

**No storage re-derivation is required.** The warning below — that every pre-2026-09-03
projection was computed at 30 symbols — does **not** apply to the storage figure: `SPEC-REVIEW.md`
§11.4 computed ~120–180 MB/month on 2026-09-03 against "~10 heavy names, ~90 thin", i.e. already
at 100. That projection stands, and Neon Launch holds roughly five years at it. Any *other*
figure in this package dated before 2026-09-03 is still suspect and still needs re-deriving.

**Still outstanding for this task:** the 100 symbols themselves are not yet named. Record the list
and its **selection basis** — the basis is a disclosed selection bias under R-21, the same
treatment MT-15's Substack set gets. "The 100 most-discussed names on r/wallstreetbets in July"
and "the S&P 100" are different instruments and produce different findings.

**Final count: 100.** **Symbol list:** ______________________________ **Basis:** ______________

**Superseded by the block above — the list has since been pulled and committed** (B-21). This
"open question before pulling it" language is kept for the record of what had to be decided:
ApeWisdom's raw ranking mixes individual companies with index ETFs, which wasn't settled by
D-27/D-30 and was resolved 2026-09-03 (exclude ETFs, backfill with the next equity).

**F03's seed is unblocked once the list exists — it now does.**

<details><summary>Original task, retained for the record</summary>

### MT-07 (resolved) — Decide the initial universe

**Needed by:** F03's seed, and by MT-08 — **the collector cannot start without a universe**, so
this is now on the critical path rather than optional.

**Re-based 2026-09-03 by D-15: 50–100 symbols**, not the 30-symbol default. Broad-watch is the
whole point of the trigger-driven strategy — Reddit and Substack cost nothing to watch widely,
and X reads are spent only where the price trigger fires.

**Note the cost asymmetry, because it decides how wide to go:**

| Adding a symbol costs | |
|---|---|
| Reddit, Substack, market data | ~nothing — flat-rate or free |
| **X** | nothing directly. X spend is governed by the **trigger**, not by universe size |
| Storage | ~1–2 MB/month for a thin name, more for a heavy one |

So universe breadth is close to free under D-15, which is why it moved from 30 to 50–100. **It
is the trigger thresholds, not the universe size, that govern X spend** (MT-12).

Every quota, storage and cost projection written in this package before 2026-09-03 was computed
against 30 symbols and must be re-derived at the real number.

After the one-time seed, membership changes come **only** through the operator selector, and a
redeployment must never resurrect a symbol you removed. **Adding a symbol mid-series is a
coverage change** and is recorded as one (F22) — its history begins when it was added, not when
the collector started.

**Decision:** ☑ **100 symbols** (2026-09-03, D-27) — top of the D-15 band
**Final count:** **100**

</details>

</details>

---

## MT-08 🔴🔴 — Start the collector. This is the first task in the plan.

**Blocks:** the entire product thesis, permanently and irreversibly.
**Timing: today. Not "14 days before a demo" — today.**

**Re-scoped 2026-09-03.** This was a warm-up task about demo quality
(`00-ADVERSARIAL-REVIEW.md` F-06). Under **D-16 it is the single most consequential item in the
plan.** There is no backfill and there will not be. The corpus accrues in wall-clock time only.

- Every day not collecting is a **permanent hole**. It is recorded as a `CoverageGap` and
  rendered forever (F22).
- D-09's return-predictivity promotion needs roughly **twelve months** of accrued dates. The
  clock starts when the collector starts, not when the build finishes.
- Rank change still needs ≥ 14 comparable snapshots before the z-score renders.

**Action:** deploy the collector against the seed universe as the first thing that reaches
production, before the UI exists and before most of Wave 1 is written. Then do not stop it, and
do not reset the database.

A minimal collector — Reddit API → raw store, nothing else — is worth deploying **ahead of F04's
full adapter platform** if that shortens the wall-clock delay. Full bodies from day one (D-17):
what is not captured cannot be re-scored later.

**Collector start date:** ______________ **Depth ≥ 14 on:** ______________
**12-month corpus milestone (Tier D4 becomes runnable):** ______________

### Step-by-step, once F04 + F16a are merged and MT-02/03/04/13/15 are done

This is a milestone, not a single click — it's what happens once everything above is in place.
There is nothing to do here today if F16a hasn't been built yet; come back to this section once
the coordinator reports F16a merged.

1. Confirm every environment variable from MT-02, MT-03, MT-04 and MT-05 is set in Vercel for
   **Production** (not just Preview).
2. Trigger a fresh production deploy (Vercel → Deployments → Redeploy, or push to `main`).
3. Visit `https://<your-app>.vercel.app/api/health` (or the specific health route F16a exposes)
   in a browser — confirm it returns a healthy status, not an error.
4. Wait for the next 5-minute QStash tick (check QStash's **Logs** tab for a successful `200`
   delivery to `/api/cron/dispatch`).
5. Confirm data is actually landing: this needs someone with database access to run a quick
   count query against the raw provider payload table (ask this session to do this once it has
   a `DATABASE_URL` to connect with) — row counts should be non-zero and growing after the
   first few dispatch cycles.
6. The moment you see the first successful collection cycle, **write down today's date** in the
   blank above. That date is permanent — it is the floor every future "coverage begins" label
   in the product will cite (D-16), so record it the day it happens, not retroactively.
7. Do not reset, pause, or point the app at a different database after this. Under D-16 there is
   no backfill — a gap here is a gap forever.

---

## MT-09 ⬛ — VOID (D-11)

**Closed 2026-09-03.** D-11 makes this a single-operator system with no public signup, so the
Hobby terms question and the FMP display-licensing question both fall away. Vercel Pro remains a
*performance* decision with its own trigger (`01-PRODUCT-SPEC.md` §5: the first sustained p99
timeout), not a terms or licensing gate. **OQ-3 closed.**

<details><summary>Original task, retained for the record</summary>

### MT-09 (superseded) — Decide on Vercel Pro before any public demo

**Needed by:** Wave 5 / any demo to someone not personally invited. Relates to **OQ-3**.

Vercel Hobby is a personal, non-commercial plan. A publicly-signed-up user base on a custom
domain is not what it is for, and Hobby's function limits leave no headroom above the 30 s p95
research target (`00-ADVERSARIAL-REVIEW.md` F-12).

Until Pro: the app stays private, signup stays `pending`-gated, and only invited accounts are
promoted. Pro is $20/month against a $100 budget that already carries FMP at $22.

**Also required for a public demo:** an FMP data-display/licensing agreement (ADR-002). Market
data displayed to third parties is a licensing question, not a technical one.

**Decision:** ☐ stays private indefinitely ☐ Pro + FMP display agreement before demo on ______

</details>

---

## MT-10 ⬛ — VOID (D-11)

**Closed 2026-09-03.** The fact pattern that required a legal read was *open signup across
NZ/US for a financial-content product*. Under D-11 there is one account, held by the owner, with
no signup path and no third-party data subjects. **OQ-4 closed.**

The obligation would return the moment anyone else gets an account. It is recorded here so that
reopening signup is understood to reopen this.

<details><summary>Original task, retained for the record</summary>

### MT-10 (superseded) — Privacy policy, terms, and a legal read

**Needed by:** Wave 5. Relates to **OQ-4**.

The product will hold account emails, sessions, assumption profiles, share grants and issue
reports, and it publishes financial content. F02 delivers a `user-data.md` describing exactly
what is stored, for how long, and what deletion does — use it as the input.

**This package cannot give legal advice, and does not.** What is flagged is that the fact
pattern — financial content, open signup, an NZ sending domain, US equities, third-party
market data — is one where a person qualified to advise should read the terms before anyone
outside your invited circle uses it.

**Action:** ☐ commissioned ☐ drafted, awaiting review ☐ reviewed by ______________

</details>

---

## MT-11 🟢 — Calibrate the LLM judge (about 30 minutes, once)

**Needed by:** any claim that the Tier C gate means something. Non-blocking to the loop.

You chose an automated LLM judge as the quality bar (`MEMORY.md` D-07). An LLM judge is
systematically forgiving of fluent, well-cited, subtly wrong prose — the exact failure this
product exists to prevent. One session of hand-scoring makes it falsifiable.

1. F12 produces a script that samples 20 research answers.
2. Score each 1–5 on the four Tier C axes (direction, groundedness, restraint, actionability).
3. The script reports Spearman correlation against the judge.
4. Below 0.7, the judge's thresholds are raised rather than trusted, and the fact goes in
   `MEMORY.md`.

**Calibration done:** ______________ **Spearman:** ______

---

## MT-12 🔴 — Set budget thresholds

**Needed by:** F18. **Defaults from the PRD:** monthly hard $100, warn $80, reduce optional
work $90, block noncritical paid work $100.

**Re-based 2026-09-03 by D-20, and the contradiction removed 2026-09-03.** This section used to
ask you to "also set the per-account limits, which are the ones that actually contain the risk"
and then say two lines later that per-account limits are void under D-11. Both cannot be true.

**Per-account limits are void (D-11) — there is one account.** F-04's objection that "a global
hard stop is a damage report, not a defence" was correct against a population of accounts and
does not hold against one: **with a single actor the global ledger *is* the per-account ledger.**
The global check is now the only budget control, which makes it more load-bearing, not less.

**Decided 2026-09-03 (D-32): D-20's thresholds as written, with the X line starting at zero.**

| Setting | D-20 value | **Set to (D-32)** |
|---|---|---|
| Global monthly hard budget | **$350** | **$350** |
| Warn at | $290 | **$290** |
| Reduce optional work at | $320 | **$320** |
| **`X_MONTHLY_READ_CEILING`** | **30,000** | **0 until the trigger fires** |
| `X_DAILY_READ_CEILING` | 1,430 | **0 until the trigger fires** |
| `X_READS_PER_TRIGGER_EVENT` | 100 | **0 until the trigger fires** |

**Why the X ceilings start at zero.** X reads are spent *only* on trigger (D-15). Until the price
trigger exists and fires correctly there is nothing to spend them on, and any X sampling before
then is *untriggered* — which is precisely the broad continuous sampling FIND-3 proved
unaffordable. Starting run rate is therefore **~$200/month**.

**Switch-on trigger:** the price trigger (D-31, F16a §4.1b) is deployed and demonstrably firing on
real price movement. Set the D-20 values above at that point; the run rate returns to ~$350.
**X deferred is not X dropped** — if it is never switched on, that is a scope decision and needs
its own `MEMORY.md` entry.

**The X ceilings are the ones that matter.** X is the only per-unit-priced source and, at
~$150/month, the only line that converts directly into statistical power. A read spent on a quiet
ticker is a read unavailable when something moves.

Indicative allocation (D-20):

| Item | Allocation |
|---|---:|
| Market data — delayed intraday tier + fundamentals | ~$80 |
| Neon Launch (the corpus is permanent; Free does not survive it) | ~$19 |
| Pinned scorer service | ~$15 |
| Claude — relevance, collision, narration | ~$80 |
| X API — ~30,000 reads/month | ~$150 |
| Reddit · Substack · Vercel Hobby | $0 |
| Reserve | ~$6 |
| **Total** | **~$350** |

---

## MT-13 🔴🔴 — File the Reddit Data API application. **Confirmed not filed as of 2026-09-03.**

> **Escalated 2026-09-03.** The owner confirmed this has not been submitted. With MT-00 and MT-07
> now closed, **this is the longest pole in the plan** — every other blocker above was closed by a
> sentence; this one cannot be. It costs $0 and nothing downstream shortens the queue.


**Blocks:** F04's Reddit adapter, F10, and the largest channel in the product.
**Cost: $0.** **Lead time: unknown and possibly long.**

Self-service registration closed in late 2025. The non-commercial tier now requires **manual
approval** through a queue that is slow, opaque, and can reject without explanation. D-11's
single-operator, non-commercial posture is what qualifies this project for it.

1. Apply for Reddit Data API access, non-commercial / personal research use.
2. Describe the use accurately: one person, personal investment research, no redistribution, no
   commercial product.
3. Record the application date and any reference number below.
4. **While waiting, build against Substack RSS** — free, officially supported, no approval, and
   collectable today (D-12). It is the only channel with zero lead time.

### Step-by-step, assuming no prior experience with Reddit's developer platform

1. Log in to (or create) the Reddit account you intend to use as the application's owner — this
   should be your personal account, since D-11 makes this a single-operator, non-commercial
   project and the application should say so honestly.
2. Go to Reddit's developer/API documentation site (search "Reddit Data API access" from
   reddit.com if the direct link has moved — Reddit restructured this portal in late 2025 when
   self-service registration closed, so the exact page name may differ from what's described
   here) and look for an application form for **Data API access**, not the old
   `reddit.com/prefs/apps` OAuth-app page (that page still exists but is for building apps
   against *already-approved* access, not for requesting the access itself).
3. Select the **non-commercial** / **personal research** tier.
4. Fill out the form. Answer plainly and match D-11's actual posture — do not embellish:
   - **Who is using this**: one individual, personal use.
   - **What for**: personal investment research — tracking discussion volume and sentiment
     about publicly traded stocks.
   - **Redistribution**: none. Data is stored and analyzed for personal use only, never
     published or resold.
   - **Commercial use**: none.
   - **Expected volume**: modest — polling a fixed watchlist of up to 100 tickers, well under
     the free tier's 100 requests/minute.
5. Submit. Reddit's confirmation page or email usually gives an application ID or reference
   number — write it down.
6. **Record below immediately after submitting** — don't wait for approval to fill this in,
   since the point of this task is to get the application into the queue as early as possible:

**Applied:** ______________ **Reference:** ______________ **Approved:** ______________

**While this is pending, there is nothing further to do here** — no amount of following up
shortens an opaque approval queue. Move on to MT-15 (Substack) and MT-03/MT-04
(infrastructure), which do not depend on this.

**If rejected:** the Reddit axis can fall back to scraping reddit.com (§6.1's scraping
prohibition for Reddit has been lifted); D-16's forward-only ruling still rules out historical
archive backfill. That path carries the accepted ToS risk and is an engineering decision, not a
re-scoping conversation.

---

## MT-14 ✅ — RESOLVED 2026-09-03 (D-31)

**Answer: no new vendor. The D-15 price trigger runs on FMP Starter's daily bars**, which the
project already pays for. Wave 1 is unblocked at zero additional spend and OQ-6 is closed.

**What this trims, stated rather than absorbed.** D-15 asks whether a name is moving *unusually
right now*; daily bars answer at daily resolution, so a name that spikes and reverts intraday does
not trigger. D-20 already relied on the mitigating fact — social reaction lags price by minutes to
hours, so the trigger samples what people said *after* the move. **What is genuinely lost is
intraday spike detection**, a further trim of I5 on top of D-20's.

**Named upgrade trigger:** when daily bars are shown to miss spikes the corpus should have
sampled — a price move a 15-minute bar would have caught, that the daily bar did not, on a name
that generated social volume. An evidence trigger, deliberately, because a calendar trigger fires
whether or not anything justifies it, which is how deferred spend becomes permanent.

<details><summary>Original task, retained for the record</summary>

### MT-14 (resolved) — Choose the market-data tier

**Blocks:** F04 (Wave 1), and therefore D-15's price trigger — which is a Wave 1 deliverable.
**Budget: ~$80/month combined for intraday context and fundamentals** (D-20).

D-20 deliberately trades real-time SIP (~$199) for **3.3× the X sample**. What is needed is a
delayed intraday tier good enough to answer *"is this name moving unusually right now?"* — social
reaction lags price by minutes to hours, so delay costs almost nothing here.

1. Confirm the tier, its price, its call limits and its delay. **OQ-6 is open until this is done.**
2. Confirm it covers the full universe (up to 100 symbols) without per-symbol pricing.
3. Confirm intraday bars at a resolution that supports the trigger (15-minute or better).
4. Keep fundamentals separate if the intraday vendor is weak there.

**Chosen:** **FMP Starter daily bars (already held)** — 2026-09-03, D-31

</details>

**Named upgrade trigger (D-20):** any intention to act intraday off this system. ~$120/month, no
rebuild — the adapter interface is unchanged, only the tier.

---

## MT-15 🟡 — Choose the Substack publication set

**Needed by:** F04's Substack adapter, F10's disclosure.

D-12 puts Substack in as a distinct **expert-narrative** axis. The research note leaves discovery
unsolved — "20–50 curated feeds," curated by whom, on what basis.

**This is a selection-bias decision, not an operational one.** Whatever set is chosen becomes the
population the Substack axis describes, and §6.1 requires the basis to be disclosed on every
Substack aggregate.

1. List 20–50 publications with a stated selection basis (sector coverage, readership, cited by
   others, personally read — any basis is defensible; an unstated one is not).
2. Record the basis verbatim. It renders in the Inspector as a limitation.
3. Confirm each exposes `https://<publication>.substack.com/feed`.
4. Note that additions later change the axis's composition — **a publication added mid-series is
   a coverage change and must be recorded as one** (F22).

**Basis decided 2026-09-03 (D-29): sector coverage.** One to two publications per GICS sector
represented in the seed universe, selected for coverage rather than readership, personal
familiarity, or citation frequency.

**Rejected: "publications I already read."** It was available and would have started collecting
sooner, but the Substack axis measures *expert narrative* — and a set drawn from your own reading
measures your existing information diet, so the axis would agree with you by construction. That is
worse than no axis, because it reads as corroboration. **The research time this costs is corpus
under D-16, and the trade was made knowingly.**

**Basis, verbatim for the Inspector:** *"One to two Substack publications per GICS sector
represented in the seed universe, selected for sector coverage rather than readership, personal
familiarity, or citation frequency."*

**Confirmed by the owner 2026-09-04.** The candidate list below is now the disclosed set — no
longer a draft. **Count: 13 publications, covering 10 of the 11 GICS sectors** in the seed
universe (Utilities has no dedicated pick — accepted as a disclosed gap, see below). **Recorded
in config version:** ______ (still pending — F04's Substack collection config has not been wired
to a named publication list yet; that wiring, not this sign-off, is what's left).

### Step-by-step, assuming no prior research into financial Substacks

1. Get the list of the ~11 GICS sectors represented in the 100-symbol seed universe (this
   depends on MT-07's symbol list existing — do this after that list is pulled). GICS sectors
   are: Energy, Materials, Industrials, Consumer Discretionary, Consumer Staples, Health Care,
   Financials, Information Technology, Communication Services, Utilities, Real Estate.
2. For each sector actually represented in your 100 symbols, find 1–2 Substack publications
   that write about that sector specifically (not general-market commentary) — search
   `<sector name> substack finance` or browse Substack's own Finance/Business category pages.
   Prioritize publications that publish regularly (weekly or more) so the RSS feed has content
   to poll.
3. For each candidate, confirm it's actually on Substack's own platform (not a newsletter that
   merely looks similar) by checking that `https://<publication>.substack.com/feed` returns XML
   in a browser or via:
   ```bash
   curl -s "https://<publication>.substack.com/feed" | head -c 300
   ```
   You should see `<?xml version...` and `<rss` near the top. If you get an error page, the
   subdomain is wrong or the publication isn't hosted on Substack's own domain.
4. Write the final list into a simple table: publication name, subdomain, sector it covers.
   This becomes the input to F04's Substack collection config (COLLECT will wire it in).
5. Fill in the count and basis confirmation above once the list is final.

**If you'd rather not do the sector research yourself:** ask this session to draft a candidate
list against the seed universe's sectors for you to sanity-check and edit — the mechanical part
(finding candidates, verifying each `/feed` URL resolves) can be done in an assistant session;
only the final sign-off on "this is the disclosed set" needs to be yours, since it becomes a
permanent, disclosed selection-bias statement in the product (§6.1).

### Confirmed candidate list — signed off 2026-09-04, this is the disclosed set

All 11 GICS sectors are represented in the committed 100-symbol universe. Every subdomain below
was checked live — `curl https://<sub>.substack.com/feed` returned `200` and an RSS `<title>`
matching the publication name — nothing here is guessed. **13 publications across 10 of 11
sectors, owner-confirmed** — this is now the basis disclosed on every Substack aggregate, not a
proposal.

| Sector | Candidate | Feed | Verified | Note |
|---|---|---|---|---|
| Energy | Doomberg | `doomberg.substack.com/feed` | ✅ 200, redirects to `newsletter.doomberg.com` | Largest finance Substack; broad energy/geopolitics/commodities focus, not narrowly Energy-only |
| Financials | Net Interest (Marc Rubinstein) | `netinterest.substack.com/feed` | ✅ 200, redirects to `www.netinterest.co` | Banking, credit markets, fintech — well-matched to Financials |
| Information Technology | The Semiconductor Newsletter | `thesemiconductornewsletter.substack.com/feed` | ✅ 200, no redirect | Weekly, semiconductor-industry-specific |
| Information Technology | Bits and Bytes | `semiconductor.substack.com/feed` | ✅ 200, no redirect | Second IT pick — semiconductor/computing focus |
| Health Care | Boutique Biotech | `boutiquebiotech.substack.com/feed` | ✅ 200, no redirect | Oncology/immunology/cardiovascular public-equity focus |
| Health Care | Bio Brief | `thebiobrief.substack.com/feed` | ✅ 200, no redirect | Weekly healthcare/biotech/pharma news recap |
| Consumer Staples | As the Consumer Turns (Adam Josephson) | `adamjosephson.substack.com/feed` | ✅ 200, no redirect | Consumer staples-specific commentary |
| Consumer Staples | Matt McClintock Retail/Consumer Research | `matthewmcclintock.substack.com/feed` | ✅ 200, no redirect | Former 15+ yr sell-side retail/consumer analyst |
| Real Estate | REIT Dividends | `reits.substack.com/feed` | ✅ 200, no redirect | REIT-specific |
| Industrials | Industrial Tech Stock Analyst | `industrialanalyst.substack.com/feed` | ✅ 200, no redirect | Robotics/drones/digital manufacturing, sell-side background |
| Materials | Metals and Miners | `metalsandminers.substack.com/feed` | ✅ 200, no redirect | Metals/mining-specific, large subscriber base |
| Communication Services | The Entertainment Strategy Guy | `entertainment.substack.com/feed` | ✅ 200, no redirect | Media/streaming/gaming strategy — closest fit found for this sector |
| Consumer Discretionary | Consumer Spec | `consumerspec.substack.com/feed` | ✅ 200, no redirect | Institutional-style consumer-sector trading desk newsletter |
| **Utilities** | **— no dedicated candidate; owner-accepted gap, disclosed under §6.1 — see research below** | — | — | Two search passes (2026-09-03, 2026-09-03) found nothing that clears both bars every other sector holds: genuinely Utilities/power-sector-specific *and* weekly-or-better cadence. **Owner confirmed 2026-09-04: run the axis at 10 of 11 sectors, gap disclosed** rather than force a weak pick |

**Second-pass Utilities research (2026-09-03) — why it's a disclosed gap, not an open task.**
Eleven further candidates were checked live and rejected: Prinsights, Crack The Market, David
Blackmon's Energy Additions, ETF Investments, Dick Capital, The Surge (feed dead since Sept 2025),
The Power Line, Texas Energy and Power, The Grid Brief (placeholder only), and
`qualityatafairprice` (re-confirmed general dividend-growth, not utilities-specific). The closest
topical match, **Explaining the Grid** (`mestes.substack.com/feed`, PJM capacity markets, grid
reliability, nuclear economics — exactly the drivers of utility-stock sentiment) was rejected for
cadence: ~monthly (9 items over Dec 2025–Aug 2026), well under the weekly-or-more bar every other
pick meets. DTE, ES and SO remain in the seed universe with no Substack coverage on this axis —
the accepted trade-off, not an oversight.

**Redirect-following — checked 2026-09-03, resolved, no code change needed.** Doomberg and Net
Interest still 301-redirect `.substack.com/feed` to their custom domains
(`newsletter.doomberg.com/feed`, `www.netinterest.co/feed`, both confirmed 200 with valid RSS).
`apps/web/src/adapters/substack.ts` calls plain `fetch(request.url, ...)` with no `redirect`
option, and the Fetch/undici default is `redirect: "follow"` — so both `.substack.com` slugs work
as-is, exactly as listed in the table above.

---

## Checklist

| ID | Task | Priority | State |
|---|---|---|---|
| MT-00 | ~~Confirm admin email~~ — `joshuaifang@gmail.com` | ✅ | ☑ **D-26** |
| MT-01 | ~~Migrate to its own repository~~ — resolved by the flatten, not a migration | ✅ | ☑ **D-25** |
| MT-02 | Verify Resend domain and deliverability | 🟡 | ☐ |
| MT-03 | Confirm Neon (**Launch tier**, D-33) / Upstash / Vercel | 🟡 | ☐ |
| MT-04 | Create the QStash schedule — **re-scoped to Wave 1** (was Wave 4); MT-08 runs on it | 🔴 | ☐ |
| MT-05 | Confirm provider keys and quotas | 🟡 | ☐ |
| MT-06 | **Provision LLM access** — transport decided (Vercel AI Gateway, D-34); keys still to set | 🔴 | ☐ |
| MT-07 | Initial universe = **100** (D-27); symbol list pulled and committed, ETFs excluded (B-21) | ✅ | ☑ **fully resolved** |
| **MT-08** | **START THE COLLECTOR — today. Corpus lost is not recoverable (D-16)** | 🔴🔴 | ☐ |
| **MT-13** | **File the Reddit Data API application — confirmed NOT FILED; now the longest pole** | 🔴🔴 | ☐ |
| **MT-14** | ~~Choose the market-data tier~~ — FMP Starter daily bars; intraday deferred with an evidence trigger | ✅ | ☑ **D-31** |
| MT-15 | Substack set — **fully confirmed 2026-09-04**: 13 publications, 10/11 GICS sectors (Utilities a disclosed gap). Still needs wiring into F04's collection config | ✅ | ☑ **owner-confirmed** |
| MT-09 | ~~Vercel Pro + FMP display agreement~~ | ⬛ | **void (D-11)** |
| MT-10 | ~~Privacy, terms, legal read~~ | ⬛ | **void (D-11)** |
| MT-11 | Calibrate the judge | 🟢 | ☐ |
| MT-12 | ~~Set budget thresholds~~ — D-20 values adopted, X ceilings start at 0 (D-32) | ✅ | ☑ **D-32** |
