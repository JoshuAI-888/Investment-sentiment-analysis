import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import pg from 'pg';

/**
 * F08 §5 e2e cases: the leaderboard renders; source and methodology link present; sorting
 * works; a thin-sample row is excluded from notable; every cell opens an Inspector;
 * ApeWisdom-down renders the degraded mode with a working path onward. Plus the feature-specific
 * copy assertion: banned phrases absent from the rendered DOM, not just the source.
 *
 * States 'fresh' and 'degraded' are driven through `POST /api/social/reddit/e2e-seed`
 * (`src/services/attention/testing.ts`), which — unlike F07's own seeding — runs the *real*
 * registry arithmetic against real, controlled `attention_snapshot` rows, so this suite proves
 * the actual computation path, not just the read path. All three states, including cold-start
 * ("unavailable"), need `DATABASE_URL` — `assembleAttentionLeaderboard` has queried Postgres
 * unconditionally since round 2 lane-review made "unavailable" a fact about the database, not
 * about a Redis bookkeeping key (an earlier version of this comment claimed the cold-start case
 * returned before touching storage; that stopped being true the moment that fix landed).
 *
 * **The whole file runs serially, on one worker, in declaration order — lane-review round 3
 * finding 2.** `test.describe.configure({ mode: 'serial' })` called at the top of a file, outside
 * any `describe`, applies to every test in it. This file is the only one in the suite that ever
 * writes an `attention_snapshot` row, so this ordering plus `global-setup.ts`'s one-time truncate
 * are what make the cold-start test's "nothing has ever been collected" premise genuinely true:
 * it runs, in the order below, before either seeded state ever inserts a row — never dependent on
 * `fullyParallel`'s scheduler happening to keep it off a worker that is mid-seeding.
 */
test.describe.configure({ mode: 'serial' });

async function readFixtureOtp(request: APIRequestContext, email: string, exclude?: string): Promise<string> {
  const deadline = Date.now() + 2000;
  let lastOtp: string | null = null;
  while (Date.now() < deadline) {
    const response = await request.get(`/api/auth/fixture-otp?email=${encodeURIComponent(email)}`);
    const body = (await response.json()) as { otp: string | null };
    lastOtp = body.otp;
    if (lastOtp !== null && lastOtp !== exclude) return lastOtp;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(lastOtp, `no fresh OTP was ever recorded for ${email}`).not.toBeNull();
  return lastOtp as string;
}

async function signIn(page: Page, request: APIRequestContext, email: string, exclude?: string): Promise<string> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByLabel('Enter the six-digit code')).toBeVisible();
  const otp = await readFixtureOtp(request, email, exclude);
  await page.getByLabel('Enter the six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/dashboard');
  return otp;
}

async function seed(
  request: APIRequestContext,
  state: 'fresh' | 'unavailable' | 'degraded' | 'stale' | 'degraded_no_new_data' | 'never_collected_malformed',
): Promise<void> {
  const response = await request.post('/api/social/reddit/e2e-seed', { data: { state } });
  expect(response.status(), 'the e2e-seed route only answers in fixture mode').toBe(200);
}

const BANNED_PHRASES = ['all Reddit', 'Reddit-wide', 'retail sentiment', 'consensus'];

/**
 * Lane-review round 4 finding 3. `global-setup.ts`'s truncate runs once per whole Playwright
 * invocation, but CI's `retries: 1` re-runs this file's entire serial group from the top on a
 * failure — so a retried cold-start test executes against rows the *first* attempt's later
 * seeded-state tests already wrote, and fails for a reason with nothing to do with cold start.
 * Truncating again here, scoped to just this describe block and its own `beforeAll`, makes the
 * premise retry-safe rather than depending on a once-per-invocation global step. Gated on the
 * identical opt-in `global-setup.ts` uses — never on `DATABASE_URL`'s mere presence, which is not
 * evidence this database is disposable (D-16: forward-only collection, no backfill).
 */
async function ensureNoAttentionSnapshots(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '' || process.env['E2E_ALLOW_ATTENTION_TRUNCATE'] !== '1') return;
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('truncate table attention_snapshot restart identity cascade');
  } finally {
    await pool.end();
  }
}

test.describe('F08 — attention leaderboard: unauthenticated visitor', () => {
  test('is redirected to sign-in rather than seeing the leaderboard', async ({ page }) => {
    const response = await page.goto('/social/reddit');
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/sign-in');
  });
});

// Must run before either seeded state ever writes an `attention_snapshot` row — guaranteed by
// this file's top-level serial mode (declaration order) plus `global-setup.ts`'s one-time
// truncate, not by luck of which worker `fullyParallel` happens to assign it to (lane-review
// round 3 finding 2). `seedAttentionUnavailable` itself only clears Redis bookkeeping keys (the
// `degraded`/`notableMovers` fields a prior test in this same server process may have left set) —
// it cannot make Postgres empty on its own, and does not claim to.
test.describe('F08 — attention leaderboard: cold start', () => {
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — reads real attention_snapshot rows');

  // Lane-review round 4 finding 3: retry-safe re-assertion of the cold-start premise, not a
  // replacement for `global-setup.ts`'s own one-time truncate — see `ensureNoAttentionSnapshots`'s
  // doc for why a CI retry needs this scoped here rather than relying on a once-per-invocation step.
  test.beforeAll(async () => {
    await ensureNoAttentionSnapshots();
  });

  test('unavailable: states attention data cannot be shown and points elsewhere', async ({
    page,
    request,
  }) => {
    await signIn(page, request, 'e2e-attention-cold@example.com');
    await seed(request, 'unavailable');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('unavailable');
    await expect(page.locator('[data-attention-unavailable]')).toBeVisible();
    // Round-46 lane-review finding: pins the actual reason, not just the rendered copy — this
    // is a *genuine* cold start (an active config version, an empty corpus), not the distinct
    // config-gap fault, which has its own heading and copy since round 46 and no e2e coverage of
    // its own (see `seedAttentionUnavailable`'s own doc for why).
    expect(await page.locator('[data-attention-unavailable]').getAttribute('data-unavailable-reason')).toBe(
      'never_collected',
    );
    // Round-50 lane-review finding 1: the heading no longer says "not available yet" for any
    // reason — nothing self-resolves without a human in this deployment (no dispatcher is wired
    // yet — F16a), so the wait-it-out framing was removed everywhere on this component.
    await expect(page.locator('[data-attention-unavailable]')).toContainText('cannot be shown');
    await expect(page.locator('[data-attention-unavailable]')).toContainText('No observation from ApeWisdom');
    await expect(page.locator('[data-attention-table]')).toHaveCount(0);
    // Round-19 lane-review finding 2: this test's own name promises "and points elsewhere" but
    // never checked the onward path — it had drifted false (two of the three listed destinations
    // were F09 placeholders with no real data). The one link this page actually offers must be
    // real and working, not merely present in the DOM.
    const dashboardLink = page.locator('[data-attention-unavailable] a', { hasText: 'The dashboard' });
    await expect(dashboardLink).toHaveAttribute('href', '/dashboard');
    await dashboardLink.click();
    await page.waitForURL('**/dashboard');
  });
});

test.describe('F08 — attention leaderboard states', () => {
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — real attention_snapshot rows');
  test.describe.configure({ mode: 'serial' });
  const email = 'e2e-attention@example.com';
  let previousOtp: string | undefined;

  test.beforeEach(async ({ page, request }) => {
    previousOtp = await signIn(page, request, email, previousOtp);
  });

  test('fresh: renders the board, names ApeWisdom and its methodology, and opens an Inspector from every cell', async ({
    page,
    request,
  }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('ok');
    await expect(page.locator('[data-source-link="apewisdom"]')).toContainText('ApeWisdom');
    await expect(page.locator('[data-methodology-link]')).toBeVisible();
    await expect(page.locator('[data-methodology-version]')).toContainText('apewisdom-2026-09');
    await expect(page.locator('[data-methodology-subtitle]')).toHaveText('observed Reddit sample — coverage-limited');
    // A successful run's own movers are attributed to "this run" — the degraded state's own test
    // (below) pins the opposite copy for exactly the case where that claim would be false.
    await expect(page.locator('[data-notable-movers-caption]')).toContainText('this run');

    // Round-27 lane-review finding 3: F08 §4.2 requires both the page title AND the table header
    // to name ApeWisdom as the source — the h1 always did, but the board's own section header
    // named neither until this round.
    await expect(page.getByRole('heading', { name: /Full board.*ApeWisdom/ })).toBeVisible();

    // Round-28 lane-review finding 1: `GET /api/social/reddit` (F08 §2) had no test at any
    // level — `routes.ts`'s own comment documents that a `requireUser()`-gated route replacing a
    // former fixture shell needs its own dedicated case, the same way `/api/dashboard`'s does in
    // `auth.spec.ts`, and F08 never added one. Deleting `await requireUser()` from the handler
    // body left the entire suite green while an unauthenticated caller got the full payload —
    // symbols, mentions, ranks, every calculation_id. `request` (unlike `page.request`) carries no
    // session cookie, so it stands in for that unauthenticated caller here.
    const unauthenticated = await request.get('/api/social/reddit');
    expect(unauthenticated.status()).toBe(401);

    const authenticated = await page.request.get('/api/social/reddit');
    expect(authenticated.status()).toBe(200);
    const body = (await authenticated.json()) as {
      state?: string;
      rows?: unknown[];
      degraded?: boolean;
      boardSourceUrl?: string;
    };
    expect(body.state).toBe('ok');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.boardSourceUrl).toBe('https://apewisdom.io/');

    await expect(page.locator('[data-attention-row]')).toHaveCount(5);

    // No banned phrase anywhere in the rendered page, not just the source.
    const bodyText = await page.locator('body').innerText();
    for (const phrase of BANNED_PHRASES) {
      expect(bodyText.toLowerCase()).not.toContain(phrase.toLowerCase());
    }

    // Every InspectableMetric on the page opens a real Inspector.
    const firstMetric = page.locator('[data-inspectable-metric]').first();
    const calculationId = await firstMetric.getAttribute('data-calculation-id');
    expect(calculationId).not.toBeNull();
    const link = firstMetric.getByRole('link', { name: 'How this was calculated' });
    await expect(link).toHaveAttribute('href', `/calculations/${String(calculationId)}`);
  });

  test('NEW and thin-sample rows render distinctly, and a thin sample is excluded from notable', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    const newRow = page.locator('[data-attention-row][data-symbol="BBBY"]');
    await expect(newRow.locator('[data-new-badge]')).toBeVisible();

    const thinRow = page.locator('[data-attention-row][data-symbol="THNQ"]');
    await expect(thinRow).toHaveAttribute('data-thin-sample', 'true');
    await expect(thinRow.locator('[data-thin-sample-badge]')).toBeVisible();

    await expect(page.locator('[data-notable-mover][data-symbol="THNQ"]')).toHaveCount(0);
  });

  test('a methodology-version boundary renders not_applicable, never a number', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    const boundaryRow = page.locator('[data-attention-row][data-symbol="MVBD"]');
    await expect(boundaryRow).toHaveAttribute('data-methodology-boundary', 'true');
    const rankChangeMetric = boundaryRow.locator('[data-metric="attention.rank_change"]');
    await expect(rankChangeMetric).toHaveAttribute('data-eligibility', 'not_applicable');
    await expect(rankChangeMetric.locator('[data-abstained]')).toBeVisible();

    // Lane-review finding 4: the mention-count methods have no boundary awareness of their own
    // and must be suppressed here too — before the fix this cell rendered "+20" on the exact row
    // where Δ Rank correctly abstains.
    const mentionDeltaMetric = boundaryRow.locator('[data-metric="attention.mention_delta"]');
    await expect(mentionDeltaMetric).toHaveCount(0);
  });

  test('a rank change genuinely computed from local history is never captioned "provider-defined" (lane-review finding 1)', async ({
    page,
    request,
  }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    // GME has 14 comparable prior days — depth reaches F06 §4.1's floor, so the caption carries
    // no warm-up qualifier at all, just the plain "own comparison" wording.
    const deepRow = page.locator('[data-attention-row][data-symbol="GME"]');
    await expect(deepRow).toHaveAttribute('data-attention-row', '');
    const deepSource = deepRow.locator('[data-rank-change-source]');
    await expect(deepSource).toHaveAttribute('data-rank-change-source', 'own_history');
    await expect(deepSource).not.toContainText('provider-defined');

    // AMC has a local predecessor too, but only two comparable days — still "own_history" (the
    // arithmetic used AMC's own prior observation, not ApeWisdom's bundled field), labelled with
    // a warm-up qualifier rather than mislabelled as the provider's.
    const shallowRow = page.locator('[data-attention-row][data-symbol="AMC"]');
    const shallowSource = shallowRow.locator('[data-rank-change-source]');
    await expect(shallowSource).toHaveAttribute('data-rank-change-source', 'own_history');
    await expect(shallowSource).not.toContainText('provider-defined');
    await expect(shallowSource).toContainText('warm-up');
  });

  test('mention growth is rendered, not merely computed and persisted unread (lane-review finding 7)', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    // GME and AMC both have a real prior-mentions figure at or above F06's 5-mention floor, so
    // `attention.mention_growth` is eligible and must appear as its own real number, not merely
    // exist in storage with nothing on the page ever reading it.
    const gmeGrowth = page.locator('[data-attention-row][data-symbol="GME"] [data-metric="attention.mention_growth"]');
    await expect(gmeGrowth).toBeVisible();
    await expect(gmeGrowth).toHaveAttribute('data-eligibility', 'ok');
  });

  test('the z-score is hidden below 14 comparable snapshots and shown at or above it', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    const shallowRow = page.locator('[data-attention-row][data-symbol="AMC"]');
    await expect(shallowRow.locator('[data-zscore-warming-up]')).toBeVisible();

    const deepRow = page.locator('[data-attention-row][data-symbol="GME"]');
    await expect(deepRow.locator('[data-zscore-warming-up]')).toHaveCount(0);
    await expect(deepRow.locator('[data-metric="attention.mentions_zscore"]')).toBeVisible();
    // §6.1 / lane-review round 3 finding 4: the one thing that tells a reader "computed over how
    // much history" must not disappear exactly when the number becomes visible — `n` stays shown
    // via the shared `CoverageLabel`, not only while the metric was hidden behind "warming up".
    const zscoreCoverage = deepRow.locator('[data-coverage-label]');
    await expect(zscoreCoverage).toBeVisible();
    await expect(zscoreCoverage.locator('[data-coverage-n]')).toContainText('n=');
    await expect(zscoreCoverage.locator('[data-coverage-source]')).toContainText('apewisdom');
  });

  test('sorting by Δ Rank and Δ Mentions actually reorders the table in the direction each sort claims (lane-review finding 6)', async ({
    page,
    request,
  }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');

    async function symbolOrder(): Promise<string[]> {
      const symbols = await page.locator('[data-attention-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-symbol')));
      return symbols.filter((symbol): symbol is string => symbol !== null);
    }

    // Before any sort: alphabetical (the default order `assembleAttentionLeaderboard` returns).
    expect(await symbolOrder()).toEqual(['AMC', 'BBBY', 'GME', 'MVBD', 'THNQ']);

    await page.locator('[data-sort-button="rank_change"]').click();
    // Round-30 lane-review finding 1: this is a magnitude sort, never ascending/descending —
    // `aria-sort="other"` on the now-active header (not the two conventional values) states that
    // rather than leaving assistive tech to assume a plain numeric order.
    await expect(page.locator('th:has([data-sort-button="rank_change"])')).toHaveAttribute('aria-sort', 'other');
    await expect(page.locator('[data-sort-button="rank_change"]')).toHaveAttribute('data-sort-active', 'true');
    await expect(page.locator('[data-sort-button="mention_change"]')).toHaveAttribute('data-sort-active', 'false');
    const byRank = await symbolOrder();
    expect(byRank).toHaveLength(5);
    // GME's own comparison (Δ Rank magnitude 18) outranks AMC's (5); both outrank every row whose
    // rank_change could not be computed at all (BBBY: new to the board; MVBD: a methodology
    // boundary; THNQ: below the 25-mention floor) — real magnitude first, un-computable rows
    // last. A deleted handler, an inverted comparator, or the two sort keys swapped would all
    // leave the row *count* at 5 (what this test used to assert) while failing every check below.
    expect(byRank.indexOf('GME')).toBeLessThan(byRank.indexOf('AMC'));
    for (const uncomputable of ['BBBY', 'MVBD', 'THNQ']) {
      expect(byRank.indexOf('AMC')).toBeLessThan(byRank.indexOf(uncomputable));
    }

    await page.locator('[data-sort-button="mention_change"]').click();
    await expect(page.locator('th:has([data-sort-button="mention_change"])')).toHaveAttribute('aria-sort', 'other');
    await expect(page.locator('[data-sort-button="mention_change"]')).toHaveAttribute('data-sort-active', 'true');
    await expect(page.locator('[data-sort-button="rank_change"]')).toHaveAttribute('data-sort-active', 'false');
    const byMentions = await symbolOrder();
    expect(byMentions).toHaveLength(5);
    // GME (+790) > AMC (+40) > THNQ (−1, magnitude 1) > the two rows with no computable mention
    // delta at all (BBBY: bootstrap with no prior mentions; MVBD: suppressed across the
    // methodology boundary, lane-review finding 4).
    expect(byMentions.indexOf('GME')).toBeLessThan(byMentions.indexOf('AMC'));
    expect(byMentions.indexOf('AMC')).toBeLessThan(byMentions.indexOf('THNQ'));
    for (const uncomputable of ['BBBY', 'MVBD']) {
      expect(byMentions.indexOf('THNQ')).toBeLessThan(byMentions.indexOf(uncomputable));
    }

    // The two sorts genuinely differ from each other — proof the mention-change button is not
    // secretly wired to the same comparator as the rank-change one.
    expect(byRank).not.toEqual(byMentions);
  });

  test('degraded: ApeWisdom-down renders the last snapshot with an explicit marker and a working path onward', async ({
    page,
    request,
  }) => {
    await seed(request, 'degraded');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('degraded');
    await expect(page.locator('[data-degraded-panel]')).toBeVisible();
    await expect(page.locator('[data-degraded-provider="apewisdom"]')).toBeVisible();
    // Round-12 lane-review finding 1: `leaderboard.degradedMessage` was computed but never
    // rendered anywhere — the page showed only `DegradedPanel`'s generic, shared copy.
    await expect(page.locator('[data-degraded-message]')).toBeVisible();
    await expect(page.locator('[data-degraded-message]')).toContainText('could not be reached');
    // The page is still useful: the board from the last successful run still renders.
    await expect(page.locator('[data-attention-row]')).toHaveCount(5);
    // Round-14 lane-review finding 3: "this run" would misattribute any movers shown here — no
    // run succeeded this time, so whatever renders is carried over from an earlier one.
    await expect(page.locator('[data-notable-movers-caption]')).toContainText('last successful collection');
    await expect(page.locator('[data-notable-movers-caption]')).not.toContainText('this run');
    // Round-14 lane-review finding 4: the banned-phrase scan below (the 'fresh' test, above) never
    // ran on `degradedMessage`'s own rendered text — a real user-facing string built entirely in
    // `leaderboard.ts`, not covered by `check:copy`'s scan roots at the time either.
    const degradedBodyText = await page.locator('body').innerText();
    for (const phrase of BANNED_PHRASES) {
      expect(degradedBodyText.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  // Round-13 lane-review finding 4: rendering `DegradedPanel` unconditionally under `state ===
  // 'degraded'` stated its "a provider is currently unavailable" claim right above
  // `degradedMessage`'s own accurate text for a cause where that claim is false — an operator
  // reading the amber panel was still told to wait out an outage that was not happening.
  test('degraded (no new data): never shows the provider-unavailable panel for a reached-but-unusable response', async ({
    page,
    request,
  }) => {
    await seed(request, 'degraded_no_new_data');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('degraded');
    await expect(page.locator('[data-degraded-panel]')).toHaveCount(0);
    await expect(page.locator('[data-degraded-message]')).toBeVisible();
    await expect(page.locator('[data-degraded-message]')).not.toContainText('could not be reached');
    await expect(page.locator('[data-degraded-message]')).toContainText('was reached');
    // Still useful: the last successful run's rows still render.
    await expect(page.locator('[data-attention-row]')).toHaveCount(5);
  });

  // Round-37 lane-review finding 3: `neverCollectedMalformedSymbols` (round-36 lane-review
  // finding 1) had no test at any level that actually rendered the page's own banner for it.
  test('never-collected-malformed: a security with no row at all is disclosed, not silently absent', async ({
    page,
    request,
  }) => {
    await seed(request, 'never_collected_malformed');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('ok');
    await expect(page.locator('[data-never-collected-malformed]')).toBeVisible();
    await expect(page.locator('[data-never-collected-malformed]')).toContainText('MLFD');
    await expect(page.locator('[data-never-collected-malformed]')).toContainText('could not be parsed');
    // Round-38 lane-review finding 2: round 37's own "successful" fix had no test that would fail
    // if it regressed — pinned directly, on the actual rendered banner.
    await expect(page.locator('[data-never-collected-malformed]')).toContainText('successful collection run');
    // MLFD has no attention_snapshot row, so no board row for it exists — the banner is its only
    // disclosure. The five ordinarily-seeded securities render exactly as they do in `seed(fresh)`.
    await expect(page.locator('[data-attention-row][data-symbol="MLFD"]')).toHaveCount(0);
    await expect(page.locator('[data-attention-row]')).toHaveCount(5);

    // Round-38 lane-review finding 2: the only test that renders this banner had no banned-
    // vocabulary scan, unlike every other seeded state in this file — `check:copy` cannot reach
    // this copy either (every text node in it is JSX-interpolation-bounded), so this DOM scan is
    // the one place a future edit introducing banned vocabulary here would ever be caught.
    const bodyText = await page.locator('body').innerText();
    for (const phrase of BANNED_PHRASES) {
      expect(bodyText.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  test('axe finds no violations on the fresh state', async ({ page, request }) => {
    await seed(request, 'fresh');
    await page.goto('/social/reddit');
    // Round-38 lane-review finding 3: `seedAttentionNeverCollectedMalformed` (the immediately
    // preceding test) sets `KEYS.malformedTickers()` and nothing but `seedAttentionFresh` itself
    // ever clears it — Redis's in-memory fallback is one singleton per server process, not per
    // test, the same class of leak round 13 already fixed for `degradedReason`. This is the one
    // place that leak would actually surface: the very next seed in file order.
    await expect(page.locator('[data-never-collected-malformed]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('main').analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

// Isolated with its own truncate, run last in this file's serial order: the "states" block above
// leaves several securities (GME, AMC, …) freshly re-seeded by its own final tests, and this
// scenario needs the whole board to be stale — not just one new security among several still-fresh
// ones — to prove `selectNotableMovers` empties out and `NotableMovers`' copy states why.
test.describe('F08 — attention leaderboard: stale collection', () => {
  test.skip(process.env['DATABASE_URL'] === undefined, 'needs DATABASE_URL — reads real attention_snapshot rows');

  test.beforeAll(async () => {
    await ensureNoAttentionSnapshots();
  });

  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, 'e2e-attention-stale@example.com');
  });

  // Round-10 lane-review finding 3: `selectNotableMovers` (round 9 finding 2) correctly excludes
  // every stale row, but the empty-state copy did not follow — it blamed §4.4's ordinary
  // notable-mover bar even when the true cause was a page-wide-stale board. `seedAttentionStale`
  // seeds one security with a real, large, `eligibility: 'ok'` rank change ten hours in the past
  // — well past the six-hour staleness floor, so it would clear the bar were it not stale.
  test('excludes every mover from "Notable rank changes" and states why, not the ordinary bar', async ({
    page,
    request,
  }) => {
    await seed(request, 'stale');
    await page.goto('/social/reddit');

    expect(await page.locator('main').getAttribute('data-state')).toBe('stale');
    // Never the provider-outage panel — this is not a degraded/unreachable-provider state.
    await expect(page.locator('[data-degraded-panel]')).toHaveCount(0);
    await expect(page.locator('[data-notable-movers-empty]')).toBeVisible();
    await expect(page.locator('[data-notable-movers-empty]')).toContainText('stale');
    await expect(page.locator('[data-notable-movers-empty]')).not.toContainText('clears the notable-mover bar');
    // The seeded row itself still renders, disclosed as stale rather than hidden or excluded.
    const staleRow = page.locator('[data-attention-row][data-symbol="STAL"]');
    await expect(staleRow).toBeVisible();
    await expect(staleRow.locator('[data-freshness="stale"]')).toBeVisible();
    // Round-17 lane-review finding 1: the shared FreshnessBadge's "refresh failed" wording is
    // false here (`leaderboard.degraded` is false) — never assert a collection failure that never
    // happened. Round-18 lane-review finding 1, correcting round 17's own fix: this scenario is
    // page `state: 'stale'` (the whole collection has gone stale, not just this one row from
    // board churn), so "the collector is running normally" is an unverifiable, likely-false claim
    // in the other direction — the row must state the gap without asserting a cause either way.
    await expect(staleRow.locator('[data-freshness="stale"]')).not.toContainText('refresh failed');
    await expect(staleRow.locator('[data-freshness="stale"]')).not.toContainText('running normally');
    await expect(staleRow.locator('[data-freshness="stale"]')).toContainText('no newer collection run has completed');

    // Round-14 lane-review finding 4: the banned-phrase scan (the 'fresh' test, above) never ran
    // on this state either.
    const staleBodyText = await page.locator('body').innerText();
    for (const phrase of BANNED_PHRASES) {
      expect(staleBodyText.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });
});
