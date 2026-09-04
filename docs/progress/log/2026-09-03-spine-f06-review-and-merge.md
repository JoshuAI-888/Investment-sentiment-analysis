# 2026-09-03 — SPINE — F06, five rounds of adversarial review, one serious bug

**Picked up mid-build.** Every method in source §8.1–§8.7 was already registered and
golden-tested when this session started, including F06's own methodology-boundary amendment to
`attention.rank_change`. The work here was closing five rounds of `lane-review` to a genuine
`PASS`, and re-deriving the three abstention thresholds `PROGRESS.md` flagged as blocking this
merge.

## The off-by-N bug (round 3)

The sharpest finding of this build. `readSeries(ctx, prefix, count)` reads a **fixed positional**
slice — `${prefix}_0..${count-1}`, the *oldest* `count` of however many `${prefix}_N` inputs are
declared — not "the most recent `count`". Five methods (`price.regime`, `price.volatility_20`,
`technical.moving_average_{20,50}`, `technical.recent_{high,low}_20`, `technical.rsi_14`) guarded
only `available < WINDOW`, on the reasonable-looking assumption that handing in more history than
the window "just works." It does not: the reviewer constructed 25 closes (20 of one value, 5 of
another) and showed `technical.moving_average_20` returned the *wrong* figure with
`eligibility: 'ok'` — a stale window silently rendered as current, with no error or warning.
Fixed by changing the guard to `available !== WINDOW` in all five files and updating each
registry `eligibilityRules` entry to state the two-sided contract. Full reasoning in `MEMORY.md`
**B-25**.

The same round also found RSI's zero-loss/flat-window substitutions (RSI reported as 100 or 50
rather than computed) rendering as ordinary `status: 'applied'` steps despite the registry
already calling this behaviour a `clamp`, and a both-ends-absent case in
`attention.rank_change@1.1.0` that fell into the wrong abstention branch (`new_to_board` when a
security was never on the board at either end, not just the one).

**Rounds 4–5** closed gaps in rounds 1–3's own fixes: no test proved the *upper* half of the
off-by-N guard (every existing case supplied fewer closes than the window, never more); the
registry text describing the fix still stated only the lower bound; RSI's clamp `status` had no
assertion anywhere. Each was fixed and verified by deliberately reverting the fix and confirming
the corresponding new test fails, then restoring.

## Threshold re-derivation

`PROGRESS.md` required `min_items ≥ 5` (stance), `min_articles ≥ 3` (news) and
`display_floor ≥ 8` (display) to be re-derived before this merge, since all three were calibrated
against a sampling regime D-12 replaced. Full reasoning in `MEMORY.md` **B-26** — in short,
`min_items` cannot move on any axis (a locked product invariant, §6.3/B5, with a first draft's
attempt to lower it for X caught and reverted), `min_articles` is bound by Marketaux's own
free-tier request cap rather than independently chosen, and `display_floor` stays at Reddit's
original 8 for X and Substack too, with a named trigger to revisit once real collection data
exists. Two of three thresholds ended up unchanged — deliberately, not by default.

## Verification

lint / typecheck clean. 627 unit, 22 contract, 105 integration (real Postgres), build clean. No
e2e surface in this feature.

## Merged

[PR #5](https://github.com/JoshuAI-888/Investment-sentiment-analysis/pull/5), CI green, no
merge conflict.

## Deferred

None from this feature's own DoD.
