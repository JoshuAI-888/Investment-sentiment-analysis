import { describe, expect, it } from 'vitest';
import {
  buildSynthesisPrompt,
  flattenSynthesis,
  runSynthesis,
  synthesisOutput,
  type SynthesisClaim,
  type SynthesisOutput,
} from '../../../../src/services/research/synthesis';
import { createFixtureModelClient } from '../../../../src/services/research/model-client';
import { createFakeClock } from '../../../../src/services/research/testing';

const EVIDENCE_ID = '11111111-1111-1111-1111-111111111111';

function validClaim(overrides: Partial<SynthesisClaim> = {}): SynthesisClaim {
  return {
    text: 'Mentions rose this week.',
    kind: 'fact',
    evidenceIds: [EVIDENCE_ID],
    metricIds: [],
    assertsStanceForAxis: null,
    ...overrides,
  };
}

function validOutput(overrides: Partial<SynthesisOutput> = {}): SynthesisOutput {
  return {
    summary: [validClaim()],
    themes: [
      {
        title: 'Rising attention',
        claims: [
          validClaim(),
          validClaim({
            text: 'Confirmed by a second source.',
            evidenceIds: ['22222222-2222-2222-2222-222222222222'],
          }),
        ],
        singleSource: false,
      },
    ],
    bullishCase: [validClaim()],
    bearishCase: [validClaim()],
    whatChanged: [validClaim()],
    whatToMonitor: [validClaim()],
    statedFreshnessAsOf: '2026-08-25T00:00:00.000Z',
    ...overrides,
  } as SynthesisOutput;
}

describe('synthesisOutput schema', () => {
  it('accepts a well-formed output', () => {
    expect(synthesisOutput.safeParse(validOutput()).success).toBe(true);
  });

  it('rejects a theme with two distinct evidence ids labelled singleSource', () => {
    const output = validOutput({
      themes: [
        {
          title: 'x',
          claims: [validClaim(), validClaim({ evidenceIds: ['22222222-2222-2222-2222-222222222222'] })],
          singleSource: true,
        },
      ],
    });
    expect(synthesisOutput.safeParse(output).success).toBe(false);
  });

  it('rejects a theme with one distinct evidence id NOT labelled singleSource', () => {
    const output = validOutput({
      themes: [{ title: 'x', claims: [validClaim()], singleSource: false }],
    });
    expect(synthesisOutput.safeParse(output).success).toBe(false);
  });

  it('accepts a theme with one distinct evidence id correctly labelled singleSource', () => {
    const output = validOutput({
      themes: [{ title: 'x', claims: [validClaim()], singleSource: true }],
    });
    expect(synthesisOutput.safeParse(output).success).toBe(true);
  });

  it('rejects more than three themes', () => {
    const theme = { title: 'x', claims: [validClaim()], singleSource: true };
    const output = validOutput({ themes: [theme, theme, theme, theme] });
    expect(synthesisOutput.safeParse(output).success).toBe(false);
  });
});

describe('flattenSynthesis', () => {
  it('tags every claim with a section label and preserves total count', () => {
    const output = validOutput();
    const flat = flattenSynthesis(output);
    // summary(1) + theme claims(2) + bullish(1) + bearish(1) + whatChanged(1) + whatToMonitor(1)
    expect(flat).toHaveLength(7);
    expect(flat.every((claim) => claim.section.length > 0)).toBe(true);
  });
});

describe('buildSynthesisPrompt', () => {
  it('includes the hard constraints and the question', () => {
    const prompt = buildSynthesisPrompt({
      question: 'What is happening with NVDA?',
      securitySymbol: 'NVDA',
      evidenceSummary: '- item',
      metricsSummary: '- metric',
    });
    expect(prompt).toContain('No investment recommendation');
    expect(prompt).toContain('What is happening with NVDA?');
    expect(prompt).toContain('single-source');
  });
});

describe('runSynthesis', () => {
  it('returns ok with the parsed output on a well-formed fixture response', async () => {
    const clock = createFakeClock(new Date());
    const model = createFixtureModelClient(() => validOutput());
    const result = await runSynthesis(model, 'prompt', {}, clock, 10_000);
    expect(result).toEqual({ outcome: 'ok', output: validOutput() });
  });

  it('returns timeout when the model never responds within budget', async () => {
    const clock = createFakeClock(new Date());
    const model = {
      classify: () => new Promise<never>(() => undefined),
      synthesize: () => new Promise<never>(() => undefined),
      verify: () => new Promise<never>(() => undefined),
    };
    const result = await runSynthesis(model, 'prompt', {}, clock, 10_000);
    expect(result.outcome).toBe('timeout');
  });

  it('returns error when the model response fails its schema', async () => {
    const clock = createFakeClock(new Date());
    const model = createFixtureModelClient(() => ({ summary: 'not an array' }));
    const result = await runSynthesis(model, 'prompt', {}, clock, 10_000);
    expect(result.outcome).toBe('error');
  });
});
