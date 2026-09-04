/**
 * Round-42 lane-review finding 1. `activeConfig === null` does not, by itself, send a read to
 * `state: 'unavailable'` — a security with already-warm Redis pointers still builds a real row
 * through `buildRow`'s fast path, which never consults `configVersion` at all, so a *different*
 * security's real Postgres observation can silently drop out of `rows` with `state` still reading
 * `'ok'`, no `DegradedPanel`, and nothing on the page explaining the gap.
 *
 * **Extracted into its own component — round-43 lane-review finding 1.** The banner lived inline
 * in `page.tsx` (a Next.js Server Component, which cannot be rendered in a unit test), so nothing
 * at any level actually rendered it — deleting it left the full gate green. Every other piece of
 * copy this feature owns (`MethodologyBanner`, `AttentionUnavailable`, `NotableMovers`) already
 * lives in its own testable component for exactly this reason.
 *
 * **`activeConfigVersionMissing` — round-47 lane-review finding 1.** `symbols` alone can under-
 * disclose the fault it exists to describe: it only ever names a security whose *own* row failed
 * to build, but `buildRow`'s fast path never consults `configVersion` at all — a run where every
 * tracked security's Redis pointers are already warm (they carry no TTL) builds every row
 * successfully even with no active config version, leaving `symbols: []` while the collector has,
 * in fact, permanently stopped (`pipeline.ts`'s early return on a missing active config version
 * fires before it ever contacts ApeWisdom again). Under D-16 that is exactly the fault this
 * package ranks above every feature on the board, and an empty `symbols` array used to mean this
 * banner rendered nothing at all. `activeConfigVersionMissing` is `leaderboard.ts`'s own
 * page-level fact (`activeConfig === null`), independent of whether any individual row happened
 * to need it — a strict superset of "`symbols` is non-empty" — so this banner now renders
 * whenever it is true, with or without any specific security to name.
 *
 * **The remedy sentence — round-49 lane-review finding 2.** Said "the collector cannot run again
 * until an operator activates one" and "may grow increasingly stale in the meantime" — both read
 * as "activation resumes collection," which is not true of this deployment: `pipeline.ts`'s own
 * doc comment states plainly that nothing calls `runAttentionCollection` in production at all yet
 * (no dispatcher is wired — that is F16a). Activating a config version is necessary before the
 * collector can ever write a new observation, but it is not sufficient, and "in the meantime"
 * asserts a bounded window before automatic recovery that this deployment cannot back up — the
 * same class of claim round 48 removed from `AttentionUnavailable.tsx` one component over.
 * Restated to keep only the necessary-condition fact, with no claim about what happens after.
 */
export type ConfigVersionGapBannerProps = {
  readonly activeConfigVersionMissing: boolean;
  readonly symbols: readonly string[];
};

export function ConfigVersionGapBanner({ activeConfigVersionMissing, symbols }: ConfigVersionGapBannerProps) {
  if (!activeConfigVersionMissing) return null;

  return (
    <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-config-version-gap="">
      {symbols.length > 0 ? (
        <>
          {symbols.join(', ')} {symbols.length === 1 ? 'has' : 'have'} a recorded observation that
          could not be loaded because no active config version currently exists to record a
          calculation against. This may be hiding attention data this deployment has already
          collected.{' '}
        </>
      ) : null}
      There is no active config version to record a calculation against. An operator needs to
      activate one before the collector can record a new observation. Any data on this page may
      already be stale, and may grow more so.
    </p>
  );
}
