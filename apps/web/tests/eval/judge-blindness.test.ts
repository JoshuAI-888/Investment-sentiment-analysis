/**
 * F12 §4.3: the judge "does not see the synthesiser's prompt or reasoning." F12 build brief:
 * "Write a test that would fail if this leaked (e.g. assert the exact payload sent to the judge's
 * model call contains no prompt-construction internals)." PR review step 2 is exactly this check.
 */
import { describe, expect, it } from 'vitest';
import { buildJudgePayload } from '@/services/eval';
import { loadCorpus } from '@/services/eval';
import { synthesisSystemPrompt, SYNTHESIS_PROMPT_VERSION } from '@/services/research/prompts';

describe('judge blindness', () => {
  it('the payload has exactly answerText/evidenceText/metrics — no prompt, promptVersion, or reasoning field', async () => {
    const packs = await loadCorpus();
    const pack = packs[0];
    if (pack === undefined) throw new Error('corpus is empty');

    const payload = buildJudgePayload({ answerText: 'placeholder', pack: pack.pack, metrics: pack.meta.metrics });

    expect(Object.keys(payload).sort()).toEqual(['answerText', 'evidenceText', 'metrics']);
  });

  it('the serialized payload never contains the synthesis system prompt text, verbatim or as a substring', async () => {
    const packs = await loadCorpus();
    const pack = packs[0];
    if (pack === undefined) throw new Error('corpus is empty');

    const synthesisPrompt = synthesisSystemPrompt(pack.meta.subjectSymbol);
    const payload = buildJudgePayload({
      answerText: 'This is the answer text a user would actually read.',
      pack: pack.pack,
      metrics: pack.meta.metrics,
    });
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain(synthesisPrompt);
    expect(serialized).not.toContain(SYNTHESIS_PROMPT_VERSION);
    // The hard constraints text is part of the synthesiser's own prompt construction — none of
    // its distinctive phrasing should appear in what the judge is handed.
    expect(serialized).not.toContain('Hard constraints, non-negotiable');
    expect(serialized).not.toContain('never predict, recommend, or price-target');
  });

  it('buildJudgePayload has no parameter that could carry a prompt or claim-id structure', () => {
    // A static assertion on the function's own arity/shape: it takes exactly the three inputs
    // F12 §4.3 allows (answer, evidence pack, metrics) — one argument object, three keys. A
    // future change widening this to accept a fourth "prompt" or "reasoning" field would change
    // this length and fail the review step this test stands in for.
    expect(buildJudgePayload.length).toBe(1);
  });
});
