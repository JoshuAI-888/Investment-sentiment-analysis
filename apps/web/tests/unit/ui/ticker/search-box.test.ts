import { describe, expect, it } from 'vitest';
import { isIneligibleForDisplay } from '../../../../src/ui/ticker/SearchBox';

/**
 * Round-4 lane-review finding 5: `resolve.ts`'s `INELIGIBLE_STATES` and this predicate must name
 * the same states — round 3 added `'inactive'` to the former without updating the latter, so a
 * delisted security appeared as an ordinary, clickable search result and was refused only on
 * click. This pins the full set so a future addition to one side and not the other fails here
 * instead of drifting silently again.
 */
describe('isIneligibleForDisplay — must match services/ticker/resolve.ts INELIGIBLE_STATES', () => {
  it.each(['unsupported', 'rights_blocked', 'inactive'])('flags %s as ineligible', (state) => {
    expect(isIneligibleForDisplay(state)).toBe(true);
  });

  it.each(['ready', 'partial', null])('does not flag %s as ineligible', (state) => {
    expect(isIneligibleForDisplay(state)).toBe(false);
  });
});
