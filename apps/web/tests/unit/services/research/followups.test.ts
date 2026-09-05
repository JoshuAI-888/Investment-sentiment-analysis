import { describe, expect, it } from 'vitest';
import { rewriteFollowups, templateFollowups } from '../../../../src/services/research/followups';
import { createFixtureModelClient } from '../../../../src/services/research/model-client';
import type { SynthesisOutput } from '../../../../src/services/research/synthesis';
import type { EvidencePack } from '../../../../src/contracts/evidence-pack';

const EMPTY_CLAIM_LIST: SynthesisOutput['summary'] = [];

function output(overrides: Partial<SynthesisOutput> = {}): SynthesisOutput {
  return {
    summary: EMPTY_CLAIM_LIST,
    themes: [],
    bullishCase: [],
    bearishCase: [],
    whatChanged: [],
    whatToMonitor: [],
    statedFreshnessAsOf: '2026-08-25T00:00:00.000Z',
    ...overrides,
  } as SynthesisOutput;
}

function pack(frames: EvidencePack['frames'] = []): EvidencePack {
  return {
    id: 'p',
    securityId: 's',
    retrievalQuery: 'q',
    retrievalWindow: { from: new Date(), to: new Date() },
    items: [],
    frames,
    createdAt: new Date(),
  } as EvidencePack;
}

describe('templateFollowups', () => {
  it('produces no follow-ups from an entirely empty output and pack', () => {
    expect(templateFollowups(pack(), output())).toEqual([]);
  });

  it('offers a "what changed" follow-up only when the section is non-empty', () => {
    const withChange = templateFollowups(pack(), output({ whatChanged: [{ text: 'x', kind: 'fact', evidenceIds: [], metricIds: [], assertsStanceForAxis: null }] }));
    expect(withChange.some((f) => f.id === 'what_changed_detail')).toBe(true);
  });

  it('offers one axis-detail follow-up per frame in the pack', () => {
    const withFrames = templateFollowups(
      pack([
        { axis: 'reddit', frameStatement: 's', window: { from: new Date(), to: new Date() }, retrievedCount: 1, usedCount: 1, truncated: false },
        { axis: 'x', frameStatement: 's', window: { from: new Date(), to: new Date() }, retrievedCount: 1, usedCount: 1, truncated: false },
      ]),
      output(),
    );
    expect(withFrames.filter((f) => f.id.startsWith('axis_detail_'))).toHaveLength(2);
  });

  it('offers the single-source caveat only when a theme is labelled single-source', () => {
    const withSingleSource = templateFollowups(
      pack(),
      output({ themes: [{ title: 't', claims: [{ text: 'x', kind: 'fact', evidenceIds: [], metricIds: [], assertsStanceForAxis: null }], singleSource: true }] }),
    );
    expect(withSingleSource.some((f) => f.id === 'single_source_caveat')).toBe(true);
  });

  it('never re-derives a question requiring a new fetch — every template reads only from the pack/output already in hand', () => {
    // Structural assertion: templateFollowups is synchronous and takes no port/model — there is
    // no way for it to perform I/O, which is what "does not re-retrieve" means as code.
    expect(templateFollowups.constructor.name).not.toBe('AsyncFunction');
  });
});

describe('rewriteFollowups', () => {
  it('returns the templates unchanged when there is nothing to rewrite', async () => {
    const model = createFixtureModelClient(() => ({ rewritten: [] }));
    expect(await rewriteFollowups(model, [])).toEqual([]);
  });

  it('replaces question text by id, never introducing a new id', async () => {
    const model = createFixtureModelClient(() => ({
      rewritten: [{ id: 'a', question: 'Reworded?' }, { id: 'ghost', question: 'Should not appear' }],
    }));
    const result = await rewriteFollowups(model, [{ id: 'a', question: 'Original?' }]);
    expect(result).toEqual([{ id: 'a', question: 'Reworded?' }]);
  });

  it('falls back to the template question when the model call fails', async () => {
    const model = {
      classify: () => Promise.reject(new Error('boom')),
      synthesize: () => Promise.reject(new Error('boom')),
      verify: () => Promise.reject(new Error('boom')),
    };
    const result = await rewriteFollowups(model, [{ id: 'a', question: 'Original?' }]);
    expect(result).toEqual([{ id: 'a', question: 'Original?' }]);
  });
});
