import { describe, expect, it } from 'vitest';
import { fetchApeWisdomRanking } from '../../src/adapters/apewisdom';
import { buildAttentionSnapshotInput } from '../../src/services/attention/collector';
import { matchBoardEntriesToSecurities } from '../../src/services/attention/match';
import { harness } from '../unit/adapters/fakes';

/**
 * F08 §5 contract test: "ApeWisdom fixture → normalized rows, including the uppercase-ticker
 * rule and an unmapped symbol." Runs the real adapter (`fetchApeWisdomRanking`) against the
 * committed `fixtures/apewisdom/filter/success.json` fixture (F04), then this feature's own
 * matching and normalization (`match.ts`, `collector.ts`) — the whole path from a real recorded
 * provider payload to a normalized `attention_snapshot` input.
 */
describe('F08 §5 — ApeWisdom fixture to normalized attention_snapshot input', () => {
  it('matches a tracked security case-insensitively and drops an unmapped one', async () => {
    const result = await fetchApeWisdomRanking({ filter: 'all-stocks' }, 'fixture', harness().deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // `fixtures/apewisdom/filter/success.json` carries GME (rank 1) and AAPL (rank 2). Only GME
    // is registered as tracked here, in lower case — proving the match is case-insensitive
    // (F08 §8's uppercase-ticker rule) while the returned identity keeps the security master's
    // own casing. AAPL matches nothing tracked and must be dropped, never guessed.
    const securities = [{ id: 'sec-gme', symbol: 'gme', active: true }];
    const { matched } = matchBoardEntriesToSecurities(result.data, securities);

    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ securityId: 'sec-gme', symbol: 'gme' });
    expect(matched[0]?.entry.ticker).toBe('GME');

    const observedAt = new Date('2026-09-01T00:00:00Z');
    const result2 = buildAttentionSnapshotInput(matched[0] as NonNullable<(typeof matched)[0]>, observedAt);
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(result2.input).toMatchObject({
      securityId: 'sec-gme',
      source: 'apewisdom',
      rank: 1,
      rankPrior: 1,
      mentions: 1204,
      mentionsPrior: 1350,
      engagement: 8213,
    });
  });

  it('produces no matches at all when nothing on the board is tracked', async () => {
    const result = await fetchApeWisdomRanking({ filter: 'all-stocks' }, 'fixture', harness().deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { matched } = matchBoardEntriesToSecurities(result.data, [
      { id: 'sec-unrelated', symbol: 'UNRELATED', active: true },
    ]);
    expect(matched).toHaveLength(0);
  });
});
