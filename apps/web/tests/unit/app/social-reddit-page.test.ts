/**
 * `app/(app)/social/reddit/page.tsx` is a Next.js Server Component — no unit test rendered it
 * directly before this file, so nothing below e2e could catch a regression in what it actually
 * wires from `assembleAttentionLeaderboard`'s response into its child components. Two round-44
 * lane-review findings landed on exactly that gap:
 *
 * - **Finding 1:** `configVersionGapSymbols` reaches the page (contract + integration tests
 *   cover that) and `ConfigVersionGapBanner` renders correctly given `symbols` (a unit test
 *   covers that), but nothing checked that `page.tsx` actually passes one to the other. Deleting
 *   line 73 (`<ConfigVersionGapBanner symbols={leaderboard.configVersionGapSymbols} />`) left the
 *   whole gate green. Reaching this state via a real e2e seed needs a `deactivateConfigVersion`
 *   repository function that does not exist yet (`src/repositories/versions.ts` is SPINE-owned —
 *   a needed repository change is reported to the coordinator, not built here; recorded in
 *   `docs/progress/spine.md` on the coordinator's own state branch, not visible from this feature
 *   branch alone per this build's lane-ownership practice) — this file closes the gap within this
 *   lane's own boundary instead, by rendering the page directly.
 * - **Finding 2:** under `state === 'unavailable'` with `unavailableReason ===
 *   'no_active_config_version'` and a non-null `degradedReason`, `leaderboard.ts` composes a
 *   compound message naming both faults (`unavailableDegradedMessage`), but `page.tsx` never
 *   passed `leaderboard.degradedMessage` to `AttentionUnavailable` — the compound fact never
 *   reached the reader. This exercises the actual prop wiring, not just `AttentionUnavailable`
 *   rendering the string correctly once handed it (that half is `attention-unavailable.test.ts`).
 *
 * Round-47 lane-review finding 1 added a third case: `configVersionGapSymbols` alone
 * under-discloses the fault it exists to describe (see `ConfigVersionGapBanner.tsx`'s own doc),
 * so `page.tsx`'s wiring must pass `activeConfigVersionMissing` through too, not just `symbols`.
 *
 * Mocks only `requireUser` and `assembleAttentionLeaderboard` — the two inputs this page reads —
 * so this test isolates the page's own JSX wiring, the one thing no other test level reaches.
 * Auth itself is exercised for real elsewhere (F02's suite); leaderboard computation is exercised
 * for real in `tests/integration/attention-pipeline.test.ts`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AttentionLeaderboardResponse } from '@/services/attention/contract';

const { requireUser } = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('@/services/auth', () => ({
  requireUser,
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

const { assembleAttentionLeaderboard } = vi.hoisted(() => ({ assembleAttentionLeaderboard: vi.fn() }));
vi.mock('@/services/attention/leaderboard', () => ({ assembleAttentionLeaderboard }));

const { default: Page } = await import('../../../app/(app)/social/reddit/page');

const base: AttentionLeaderboardResponse = {
  state: 'ok',
  providerMethodologyVersion: 'v1',
  lastCollectedAt: new Date('2026-09-01T00:00:00Z'),
  rows: [],
  notableMovers: [],
  degraded: false,
  degradedMessage: null,
  degradedReason: null,
  unavailableReason: null,
  notableMoversExcludedForStaleness: false,
  boardSourceUrl: 'https://apewisdom.io/reddit/wallstreetbets',
  boardMethodologyUrl: 'https://apewisdom.io/methodology',
  neverCollectedMalformedSymbols: [],
  configVersionGapSymbols: [],
  activeConfigVersionMissing: false,
};

async function renderPage(leaderboard: AttentionLeaderboardResponse): Promise<string> {
  requireUser.mockResolvedValue({ userId: 'u1' });
  assembleAttentionLeaderboard.mockResolvedValue(leaderboard);
  const element = await Page();
  return renderToStaticMarkup(element);
}

describe('social/reddit page — round-44 lane-review finding 1: configVersionGapSymbols wiring', () => {
  it('renders the config-version-gap banner when the leaderboard reports affected symbols', async () => {
    const html = await renderPage({ ...base, activeConfigVersionMissing: true, configVersionGapSymbols: ['NVDA'] });
    expect(html).toContain('data-config-version-gap=""');
    expect(html).toContain('NVDA');
  });

  it('renders no config-version-gap banner when the config version is not missing', async () => {
    const html = await renderPage({ ...base, activeConfigVersionMissing: false, configVersionGapSymbols: [] });
    expect(html).not.toContain('data-config-version-gap');
  });
});

// Round-47 lane-review finding 1: `configVersionGapSymbols` alone under-discloses the fault — a
// run where every tracked security's Redis pointers are already warm builds every row
// successfully even with no active config version, so `symbols: []` used to mean this page-level
// wiring rendered nothing at all despite the collector having permanently stopped.
describe('social/reddit page — round-47 lane-review finding 1: activeConfigVersionMissing wiring', () => {
  it('renders the config-version-gap banner even when no specific symbol is affected', async () => {
    const html = await renderPage({ ...base, activeConfigVersionMissing: true, configVersionGapSymbols: [] });
    expect(html).toContain('data-config-version-gap=""');
    expect(html).toContain('An operator needs to activate one');
  });
});

describe('social/reddit page — round-44 lane-review finding 2: the compound unavailable message', () => {
  it('passes the compound degradedMessage through when a config gap coincides with a live outage', async () => {
    const html = await renderPage({
      ...base,
      state: 'unavailable',
      rows: [],
      unavailableReason: 'no_active_config_version',
      degraded: true,
      degradedReason: 'provider_unreachable',
      degradedMessage:
        'ApeWisdom could not be reached on the last collection run. There is also no active config version to record a calculation against, which may be hiding attention data this deployment has already collected.',
    });
    expect(html).toContain('could not be reached on the last collection run');
    expect(html).toContain('no active config version');
    expect(html).toContain('data-degraded-reason="provider_unreachable"');
  });

  it('falls back to the plain configuration-fault copy when there is no concurrent outage', async () => {
    const html = await renderPage({
      ...base,
      state: 'unavailable',
      rows: [],
      unavailableReason: 'no_active_config_version',
      degraded: false,
      degradedReason: null,
      degradedMessage: null,
    });
    expect(html).toContain('This is a configuration fault');
    expect(html).not.toContain('could not be reached on the last collection run');
  });
});
