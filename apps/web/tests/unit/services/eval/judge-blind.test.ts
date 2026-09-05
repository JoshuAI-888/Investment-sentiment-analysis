/**
 * F12 §4.3: the judge sees only the answer, the evidence (text, id, dates), and the stored
 * metric values — never the synthesiser's prompt or reasoning. Proves `buildJudgeInput`'s
 * construction by planting a canary in every field it actually reads and confirming it
 * surfaces only where expected, and in every field it does *not* read and confirming it never
 * surfaces at all.
 *
 * **Review finding (lane-review round 1 finding 5).** The previous version of this test checked
 * `buildJudgeInput.length === 1` (parameter *count*, not fields) and asserted a canary that was
 * never inserted anywhere doesn't appear in the output — an assertion that is unconditionally
 * true regardless of what the function does, so the test could never fail. Replaced below with
 * assertions that plant the canary through real inputs and would fail if the implementation
 * leaked (or dropped) the wrong field.
 */
import { describe, expect, it } from 'vitest';
import { buildJudgeInput } from '../../../../src/services/eval/judge';
import type { ClassifiedItem } from '../../../../src/contracts/evidence-pack';

const CANARY = 'CANARY-3f9a1c-should-only-appear-where-expected';

function item(overrides: Partial<ClassifiedItem['item']> = {}): ClassifiedItem {
  return {
    item: {
      id: '11111111-1111-1111-1111-111111111111',
      securityId: '22222222-2222-2222-2222-222222222222',
      evidenceType: 'social_result',
      provider: 'reddit',
      title: 'NVDA thread',
      snippet: 'genuine evidence text',
      sourceUrl: null,
      publisher: null,
      authorRef: null,
      stanceLabel: 'bullish',
      stanceScore: '0.8',
      relevanceScore: '0.9',
      publishedAt: new Date('2026-08-01T00:00:00.000Z'),
      availableAt: new Date('2026-08-01T00:00:00.000Z'),
      ingestedAt: new Date('2026-08-01T00:00:00.000Z'),
      lastCheckedAt: null,
      availability: 'available',
      licenseClass: 'standard',
      coverageClass: 'sampled',
      rawHash: 'a'.repeat(64),
      metadata: {},
      ...overrides,
    },
    axis: 'reddit',
    relevant: true,
    relevanceMethodVersion: 'relevance.filter@1',
    stanceConfidence: '0.7',
    flags: [],
    excludedReason: null,
  };
}

describe('buildJudgeInput blindness', () => {
  it('carries a canary planted in an item title into evidence[].text, and nowhere else', () => {
    const input = buildJudgeInput({
      answerText: 'answer with no canary',
      items: [item({ title: CANARY, snippet: 'plain snippet' })],
      storedMetrics: [{ metricId: 'm', display: '0.5' }],
    });
    expect(input.evidence[0]!.text).toContain(CANARY);
    expect(input.answerText).not.toContain(CANARY);
    expect(JSON.stringify(input.storedMetrics)).not.toContain(CANARY);
  });

  it('carries a canary planted in an item snippet into evidence[].text', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [item({ title: 'plain title', snippet: CANARY })],
      storedMetrics: [],
    });
    expect(input.evidence[0]!.text).toContain(CANARY);
  });

  it('carries a canary planted in storedMetrics.display into storedMetrics, and nowhere else', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [item()],
      storedMetrics: [{ metricId: 'm', display: CANARY }],
    });
    expect(input.storedMetrics[0]!.display).toBe(CANARY);
    expect(input.evidence.every((e) => !e.text.includes(CANARY))).toBe(true);
    expect(input.answerText).not.toContain(CANARY);
  });

  it('carries a canary planted in the answer text into answerText only', () => {
    const input = buildJudgeInput({
      answerText: CANARY,
      items: [item()],
      storedMetrics: [{ metricId: 'm', display: '0.5' }],
    });
    expect(input.answerText).toBe(CANARY);
    expect(input.evidence.every((e) => !e.text.includes(CANARY))).toBe(true);
    expect(JSON.stringify(input.storedMetrics)).not.toContain(CANARY);
  });

  it('never surfaces a canary planted in metadata, sourceUrl, publisher, authorRef or rawHash — fields buildJudgeInput does not read', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [
        item({
          metadata: { synthesisReasoning: CANARY },
          sourceUrl: 'https://example.com/canary-path',
          publisher: CANARY,
          authorRef: CANARY,
          rawHash: CANARY.padEnd(64, '0'),
        }),
      ],
      storedMetrics: [],
    });
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain('example.com/canary-path');
  });

  it('exposes each evidence item\'s id and dates (needed to detect a fabricated citation or a stale-date claim), never anything else about retrieval', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [
        item({
          id: '99999999-9999-9999-9999-999999999999',
          publishedAt: new Date('2026-07-15T00:00:00.000Z'),
          availableAt: new Date('2026-07-16T00:00:00.000Z'),
        }),
      ],
      storedMetrics: [],
    });
    expect(input.evidence[0]!.id).toBe('99999999-9999-9999-9999-999999999999');
    expect(input.evidence[0]!.publishedAt).toEqual(new Date('2026-07-15T00:00:00.000Z'));
    expect(input.evidence[0]!.availableAt).toEqual(new Date('2026-07-16T00:00:00.000Z'));
  });

  it('omits a null snippet rather than rendering the literal string "null"', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [item({ snippet: null })],
      storedMetrics: [],
    });
    expect(input.evidence[0]!.text).toBe('NVDA thread');
    expect(input.evidence[0]!.text).not.toContain('null');
  });
});
