# 2026-09-04 — coordinator — deployment health check, a production-blocking CVE fix, and stale-doc correction

Started as a status check (Vercel/Upstash health, what's testable, what's left) and surfaced two
things worth a permanent record: a live production outage with an already-verified fix nobody had
merged, and three coordinator-owned state files that had drifted five merged PRs behind `main`.

## Production had never deployed successfully (merged PR #11)

Every Vercel deployment for this project, back to its creation, had errored with
`VULNERABLE_NEXTJS_VERSION` — Vercel hard-blocks builds on Next.js 15.0–16.0.6 (CVE-2025-66478),
and `main` stayed pinned to 15.5.4 through every feature PR merged since. Build logs showed the
compile itself succeeding every time; the block happens at Vercel's own deploy-outputs stage,
after `next build` completes — easy to miss if you only check `pnpm build` locally.

Two fixes already existed, unmerged: a prior session's verified bump to 15.5.7 (preview-deployed
clean, sitting on a stray branch), and Vercel's own bot-opened PR #11 (bump to 15.5.9, patches
`react-server-dom-*` too), CI-green across `verify`/`scorer`/`eval` and already proven in a clean
preview deploy — but left as a draft PR, never merged. Marked it ready for review and squash-merged
it (`46b37eb`). Vercel's GitHub integration picked up the push and built production automatically;
`investment-sentiment-analysis.vercel.app` aliased to a `READY` deployment for the first time.
Verified serving: `/api/health/providers` returns 200 (`state: fixture`), `/dashboard` correctly
redirects to a rendering `/sign-in` page with the fixture-mode banner showing.

**Not fixed, only surfaced:** the build log's own `[F02 boot]` assertion shows
`ADMIN_EMAIL_ALLOWLIST` is empty in Vercel, so no admin can sign in against production yet, and
Upstash Redis' provisioning state is unconfirmed this session (no Upstash MCP access; a prior
session's commit flagged it "still outstanding"). Both are `DEPLOY.md` MT-03 items, not touched
here.

Recorded to `MEMORY.md` **B-30** (part 1).

## Three lane files had fallen five merged PRs behind `main`

While checking "where are we," `PROGRESS.md` and `progress/surface.md` described F08 as "in
progress, 32 rounds, not yet merged" and F09 as "not started." `git log main` showed both merged
(PR #15, 55 rounds; PR #16, 4 rounds), along with F04's X adapter (PR #14), F04's market-data
collector (PR #13) and SPINE's jobs repository (PR #12) — none reflected in any of the three
coordinator-owned files. CI is green on `main`'s current HEAD across all five.

A stray branch (`claude/repo-build-loop-4ohbrp`) turned out to hold an entire independent,
unmerged rebuild of the whole application from an earlier common ancestor, including its own
(also-unmerged) doc updates narrating that branch's own commit history — not usable as a source
for `main`'s real state despite superficially matching prose, so its doc content was not imported
wholesale. One piece of genuine, code-independent research on that branch — a second MT-15
Substack research pass — was ported by hand after checking it stood on its own (see below).

Corrected `PROGRESS.md`'s Phase narrative and "Next work, in order" list, `progress/surface.md`'s
F08/F09 Features-table rows and "In flight" section, and `progress/collect.md`'s F04 Features-table
row and Blocked table, all against `main`'s real PR/commit history directly. Recorded to
`MEMORY.md` **B-30** (part 2).

## MT-15 confirmed: 13 Substack publications, 10 of 11 sectors

The owner confirmed the 2026-09-03 draft candidate list as final. Ported the stray branch's
second-pass Utilities research (eleven further candidates checked and rejected, closest match
*Explaining the Grid* rejected for cadence) and its redirect-following confirmation (Doomberg/Net
Interest 301s work with no adapter change — Fetch's default `redirect: "follow"` already covers
it) into `DEPLOY.md`, since that research was self-contained and independently verifiable. Updated
`DEPLOY.md`'s MT-15 section, checklist row, and priority-order table; recorded to `MEMORY.md`
**D-36**; updated `progress/collect.md`'s F04 entry and Blocked table to reflect Substack
collection no longer waiting on an owner decision, only on config wiring.

## Verification

No application code changed. Doc edits cross-checked against `git log main`, the GitHub PR list
(`mcp__github__list_pull_requests`), each merged PR's check-run status, and live Vercel deployment
state (`mcp__Vercel__get_deployment`, `get_deployment_build_logs`, `web_fetch_vercel_url` against
the live production URL).

## Merged

- PR #11 → `main` at `46b37eb` (squash, Vercel bot's Next.js CVE fix).

No PR opened for the doc corrections — pushed directly per this session's branch instructions.
