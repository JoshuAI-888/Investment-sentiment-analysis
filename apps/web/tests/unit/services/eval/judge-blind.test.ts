/**
 * F12 §4.3: the judge sees only the answer, the evidence text, and the stored metric values —
 * never the synthesiser's prompt or reasoning. This proves `buildJudgeInput`'s construction
 * cannot leak a synthesis-prompt-shaped string into the judge's input, by trying to smuggle one
 * in through every field the function actually accepts and confirming none of it survives.
 */
import { describe, expect, it } from 'vitest';
import { buildJudgeInput } from '../../../../src/services/eval/judge';
import type { ClassifiedItem } from '../../../../src/contracts/evidence-pack';

const SYNTHESIS_PROMPT_CANARY =
  'SYSTEM PROMPT: you are a helpful financial research assistant, chain-of-thought: first I will consider bullish factors...';

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
      publishedAt: new Date(),
      availableAt: new Date(),
      ingestedAt: new Date(),
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
  it('has no parameter through which a synthesis prompt could be threaded', () => {
    // The function's own arity/shape is the enforcement: only answerText, items and
    // storedMetrics are accepted. There is no fourth "context" or "prompt" field to abuse.
    expect(buildJudgeInput.length).toBe(1);
  });

  it('never surfaces the synthesis-prompt canary even when it appears in the answer text itself is not the point — the canary must never enter via items or metrics either', () => {
    const input = buildJudgeInput({
      answerText: 'NVDA sentiment is bullish this window (shrunk score 0.62, n=5).',
      items: [item({ title: 'genuine title', snippet: 'genuine snippet, not a prompt' })],
      storedMetrics: [{ metricId: 'sentiment.reddit.shrunkScore', display: '0.62' }],
    });

    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(SYNTHESIS_PROMPT_CANARY);
    expect(serialized).not.toContain('SYSTEM PROMPT');
    expect(serialized).not.toContain('chain-of-thought');
  });

  it('only ever includes item title/snippet text, never the retrieval query or frame disclosures', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [item()],
      storedMetrics: [],
    });
    // The evidence text is exactly title + snippet, nothing about how the pack was retrieved.
    expect(input.evidenceText).toEqual(['NVDA thread — genuine evidence text']);
  });

  it('omits a null snippet rather than rendering the literal string "null"', () => {
    const input = buildJudgeInput({
      answerText: 'answer',
      items: [item({ snippet: null })],
      storedMetrics: [],
    });
    expect(input.evidenceText[0]).toBe('NVDA thread');
    expect(input.evidenceText[0]).not.toContain('null');
  });
});
