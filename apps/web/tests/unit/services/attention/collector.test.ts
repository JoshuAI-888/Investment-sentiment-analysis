import { describe, expect, it } from 'vitest';
import {
  APEWISDOM_METHODOLOGY_VERSION,
  APEWISDOM_WINDOW_HOURS,
  buildAttentionSnapshotInput,
} from '../../../../src/services/attention/collector';
import type { MatchedBoardEntry } from '../../../../src/services/attention/match';
import type { ApeWisdomEntry } from '../../../../src/adapters/apewisdom';
import type { NewAttentionSnapshot } from '../../../../src/repositories/attention';

function matched(overrides: Partial<ApeWisdomEntry> = {}): MatchedBoardEntry {
  const entry: ApeWisdomEntry = {
    rank: 3,
    ticker: 'GME',
    name: 'GameStop Corp.',
    mentions: '1204',
    upvotes: '8213',
    rank24hAgo: '1',
    mentions24hAgo: '1350',
    ...overrides,
  };
  return { entry, securityId: 'sec-1', symbol: 'GME' };
}

const OBSERVED_AT = new Date('2026-09-01T00:00:00Z');

/** Unwraps the `ok: true` case, failing loudly (not silently returning `undefined`) otherwise. */
function unwrapInput(entryOverrides: Partial<ApeWisdomEntry> = {}): NewAttentionSnapshot {
  const result = buildAttentionSnapshotInput(matched(entryOverrides), OBSERVED_AT);
  if (!result.ok) throw new Error(`expected ok:true, got rejection: ${result.reason}`);
  return result.input;
}

describe('buildAttentionSnapshotInput — F08 §4.1', () => {
  it('carries rank, mentions and engagement straight through for an ordinary reading', () => {
    const input = unwrapInput();
    expect(input).toMatchObject({
      securityId: 'sec-1',
      source: 'apewisdom',
      rank: 3,
      rankPrior: 1,
      mentions: 1204,
      mentionsPrior: 1350,
      engagement: 8213,
      windowHours: APEWISDOM_WINDOW_HOURS,
      coverageClass: 'pov_index',
      providerMethodologyVersion: APEWISDOM_METHODOLOGY_VERSION,
      observedAt: OBSERVED_AT,
    });
  });

  it('translates ApeWisdom\'s "0" sentinel to null for a security new to the board', () => {
    const input = unwrapInput({ rank24hAgo: '0', mentions24hAgo: '500' });
    expect(input.rankPrior).toBeNull();
    // mentionsPrior is nulled alongside it: a mention count paired with an untracked rank is not
    // a fact this collector can vouch for either (collector.ts's own doc).
    expect(input.mentionsPrior).toBeNull();
  });

  it('hashes identically for two identical readings and differently when a field changes', () => {
    const first = unwrapInput();
    const second = unwrapInput();
    const changed = unwrapInput({ mentions: '1205' });

    expect(second.rawHash).toBe(first.rawHash);
    expect(changed.rawHash).not.toBe(first.rawHash);
  });

  it('is a real, positive rank straight from the board — never sentinel-translated (only the prior end can be absent)', () => {
    const input = unwrapInput({ rank: 1 });
    expect(input.rank).toBe(1);
  });

  // Lane-review round 7 finding 3: `adapters/apewisdom.ts` deliberately keeps these fields as
  // strings rather than coercing them itself. A malformed one must be rejected explicitly, never
  // silently coerced to a fabricated value (`Number('')` is `0`) or left to throw an uncaught
  // Postgres error (`Number('1,204')` is `NaN`).
  describe('rejects a malformed numeric field rather than fabricating or NaN-ing a value', () => {
    it('an empty mentions string is rejected, not silently coerced to 0', () => {
      const result = buildAttentionSnapshotInput(matched({ mentions: '' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a thousands-separated mentions string is rejected, not left to become NaN', () => {
      const result = buildAttentionSnapshotInput(matched({ mentions: '1,204' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('an empty upvotes string is rejected', () => {
      const result = buildAttentionSnapshotInput(matched({ upvotes: '' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a malformed rank24hAgo is rejected before the new-to-board sentinel check ever runs', () => {
      const result = buildAttentionSnapshotInput(matched({ rank24hAgo: 'n/a' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a malformed mentions24hAgo is rejected only when the security is not new to the board', () => {
      const result = buildAttentionSnapshotInput(
        matched({ rank24hAgo: '1', mentions24hAgo: 'n/a' }),
        OBSERVED_AT,
      );
      expect(result.ok).toBe(false);
    });

    it('a malformed mentions24hAgo is irrelevant, and the entry accepted, when the security IS new to the board', () => {
      // ApeWisdom's own sentinel path: rank24hAgo '0' means mentionsPrior is nulled regardless of
      // whatever mentions24hAgo says, so a malformed value there must not reject the whole entry.
      const result = buildAttentionSnapshotInput(
        matched({ rank24hAgo: '0', mentions24hAgo: 'n/a' }),
        OBSERVED_AT,
      );
      expect(result.ok).toBe(true);
    });

    // Round-8 lane-review finding 1: a negative `rank24hAgo` is not the "0" sentinel and is out
    // of `attentionSnapshot`'s domain (`rankPrior` is `.positive()`) — committing it would throw
    // on every later read of the row, forever, under D-16's no-delete-path rule. This replaces a
    // prior version of this test that asserted the format check's minus-sign tolerance was
    // correct behaviour; it was the bug round 8 found.
    it('a negative rank24hAgo (not the "0" sentinel) is rejected, not accepted as a bare integer', () => {
      const result = buildAttentionSnapshotInput(matched({ rank24hAgo: '-1' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a negative mentions is rejected even though it parses as a bare integer', () => {
      const result = buildAttentionSnapshotInput(matched({ mentions: '-5' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a negative upvotes is rejected even though it parses as a bare integer', () => {
      const result = buildAttentionSnapshotInput(matched({ upvotes: '-5' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a negative mentions24hAgo is rejected when the security is not new to the board', () => {
      const result = buildAttentionSnapshotInput(
        matched({ rank24hAgo: '1', mentions24hAgo: '-5' }),
        OBSERVED_AT,
      );
      expect(result.ok).toBe(false);
    });

    it('rank 0 is rejected — the "0" sentinel exists only on the prior end, never on the current reading', () => {
      const result = buildAttentionSnapshotInput(matched({ rank: 0 }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a fractional rank is rejected', () => {
      const result = buildAttentionSnapshotInput(matched({ rank: 1.5 }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a negative rank is rejected', () => {
      const result = buildAttentionSnapshotInput(matched({ rank: -1 }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    // Round-24 lane-review finding 1: format and sign were checked, but not magnitude.
    // `attention_snapshot`'s numeric columns are Postgres `integer` — a format-valid,
    // non-negative count past int4's range reached `insertAttentionSnapshot` uncaught and threw
    // `22003 value out of range for type integer` mid-board, the exact failure mode rounds 7/8
    // closed the format/sign halves of.
    it('a mentions count past int4\'s range is rejected, not left to throw out of Postgres', () => {
      const result = buildAttentionSnapshotInput(matched({ mentions: '9999999999' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('an upvotes count past int4\'s range is rejected', () => {
      const result = buildAttentionSnapshotInput(matched({ upvotes: '9999999999' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a rank24hAgo past int4\'s range is rejected', () => {
      const result = buildAttentionSnapshotInput(matched({ rank24hAgo: '9999999999' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a mentions24hAgo past int4\'s range is rejected when the security is not new to the board', () => {
      const result = buildAttentionSnapshotInput(matched({ mentions24hAgo: '9999999999' }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });

    it('a rank past int4\'s range is rejected — a number field, not a string, so the format check alone would not catch it', () => {
      const result = buildAttentionSnapshotInput(matched({ rank: 9_999_999_999 }), OBSERVED_AT);
      expect(result.ok).toBe(false);
    });
  });
});
