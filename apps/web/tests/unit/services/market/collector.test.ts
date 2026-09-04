import { describe, expect, it } from 'vitest';
import type { DailyBar } from '@/adapters/market';
import { buildMarketSnapshotInput, mostRecentBar } from '@/services/market/collector';

const security = { id: '11111111-1111-1111-1111-111111111111', symbol: 'AAPL' };

function bar(overrides: Partial<DailyBar> = {}): DailyBar {
  return {
    date: '2026-08-28',
    open: 230.12,
    high: 233.4,
    low: 229.8,
    close: 232.1,
    volume: 54321000,
    ...overrides,
  };
}

describe('mostRecentBar', () => {
  it('picks the newest date regardless of input order', () => {
    const oldest = bar({ date: '2026-08-01', close: 100 });
    const newest = bar({ date: '2026-08-28', close: 232.1 });
    const middle = bar({ date: '2026-08-15', close: 150 });

    expect(mostRecentBar([oldest, newest, middle])).toEqual(newest);
    // Reversed input order must not change the answer — the function must not trust array
    // position (this module's own doc: "nothing in adapters/market.ts's contract promises one").
    expect(mostRecentBar([newest, middle, oldest])).toEqual(newest);
  });

  it('throws on an empty array rather than returning undefined silently', () => {
    expect(() => mostRecentBar([])).toThrow(/empty array/);
  });
});

describe('buildMarketSnapshotInput', () => {
  it('builds a valid input from a well-formed bar', () => {
    const result = buildMarketSnapshotInput(security, bar(), 'fmp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      securityId: security.id,
      price: '232.1',
      session: 'eod',
      provider: 'fmp',
      observedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
  });

  // Post-review finding 5: `changePercent` used to be recomputed locally from open/close — but
  // FMP's own `changePercent` field is stripped by `adapters/market.ts`'s schema before this
  // function ever sees it, so the recomputed value was never the vendor's own figure. It was a
  // same-day intraday ratio this collector invented, persisted at ~34 significant digits of
  // spurious precision. Declining to compute it locally (leaving it `null`, the same honest
  // option `price_return_snapshot`'s deferral already uses) is the fix.
  it('never computes changePercent locally — it is always null', () => {
    const result = buildMarketSnapshotInput(security, bar({ open: 230.12, close: 232.1 }), 'fmp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.changePercent).toBeNull();
  });

  it('is a decimal string, never a float, for price', () => {
    const result = buildMarketSnapshotInput(security, bar(), 'fmp');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input.price).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('rejects a date that is not YYYY-MM-DD shaped', () => {
    const result = buildMarketSnapshotInput(security, bar({ date: 'Aug 28, 26' }), 'fmp');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('date') });
  });

  // Post-review findings 1/2: shape-only validation let an impossible date reach
  // `insertMarketSnapshot`'s timestamp binding (`"2026-13-45"`, throwing uncaught and aborting the
  // whole collector run) or, worse, let JS's own date-rollover behavior silently normalize a
  // nonexistent-but-plausible date (`"2026-02-30"` → `2026-03-02`) into a permanently persisted,
  // wrong observation. Both must be rejected as malformed, not merely shape-valid.
  it('rejects a YYYY-MM-DD-shaped string with an out-of-range month or day', () => {
    const result = buildMarketSnapshotInput(security, bar({ date: '2026-13-45' }), 'fmp');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('date') });
  });

  it('rejects a YYYY-MM-DD-shaped string naming a day that does not exist in that month, rather than silently rolling it forward', () => {
    const result = buildMarketSnapshotInput(security, bar({ date: '2026-02-30' }), 'fmp');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('date') });
  });

  it('accepts a genuine leap-day date', () => {
    // 2028 is a real leap year — confirms the calendar check does not just reject every Feb 29.
    const result = buildMarketSnapshotInput(security, bar({ date: '2028-02-29' }), 'fmp');
    expect(result.ok).toBe(true);
  });

  it('rejects a non-finite field — a null-where-number reaching this layer as NaN or Infinity', () => {
    // `adapters/market.ts`'s own zod schema (`z.number()`) admits `Infinity` and rejects `NaN` —
    // confirmed directly against zod (NaN fails, Infinity passes) — so this collector cannot rely
    // on the adapter to have already excluded every non-finite value a `DailyBar` might carry.
    const result = buildMarketSnapshotInput(security, bar({ close: Number.POSITIVE_INFINITY }), 'fmp');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('close') });
  });

  it('rejects a zero or negative close — a real market print never has one', () => {
    const zero = buildMarketSnapshotInput(security, bar({ close: 0 }), 'fmp');
    expect(zero).toMatchObject({ ok: false, reason: expect.stringContaining('close') });

    const negative = buildMarketSnapshotInput(security, bar({ close: -5 }), 'fmp');
    expect(negative).toMatchObject({ ok: false, reason: expect.stringContaining('close') });
  });

  it('rejects a zero or negative open — a real market print never opens at zero or negative', () => {
    const zero = buildMarketSnapshotInput(security, bar({ open: 0 }), 'fmp');
    expect(zero).toMatchObject({ ok: false, reason: expect.stringContaining('open') });

    const negative = buildMarketSnapshotInput(security, bar({ open: -5 }), 'fmp');
    expect(negative).toMatchObject({ ok: false, reason: expect.stringContaining('open') });
  });

  it('hashes identically for an identical bar, and differently for a revised one', () => {
    const first = buildMarketSnapshotInput(security, bar(), 'fmp');
    const repeat = buildMarketSnapshotInput(security, bar(), 'fmp');
    const revised = buildMarketSnapshotInput(security, bar({ close: 233 }), 'fmp');
    expect(first.ok && repeat.ok && revised.ok).toBe(true);
    if (!first.ok || !repeat.ok || !revised.ok) return;

    expect(repeat.input.rawHash).toBe(first.input.rawHash);
    expect(revised.input.rawHash).not.toBe(first.input.rawHash);
  });
});
