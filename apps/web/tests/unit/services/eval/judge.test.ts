import { describe, expect, it } from 'vitest';
import { meanScore, renderAnswerText, judgeSystemPrompt } from '@/services/eval/judge';

describe('meanScore', () => {
  it('averages the four axes as a decimal string', () => {
    expect(meanScore({ c1: 5, c2: 5, c3: 5, c4: 5 })).toBe('5.0000');
    expect(meanScore({ c1: 4, c2: 3, c3: 5, c4: 4 })).toBe('4.0000');
    expect(meanScore({ c1: 1, c2: 1, c3: 1, c4: 2 })).toBe('1.2500');
  });
});

describe('renderAnswerText', () => {
  it('joins summary, theme claims, and every non-empty section into readable prose', () => {
    const text = renderAnswerText({
      summary: 'Summary line.',
      themes: [{ title: 'Theme one', claims: [{ text: 'Claim A.' }, { text: 'Claim B.' }] }],
      bullishCase: [{ text: 'Bull point.' }],
      bearishCase: [],
      whatChanged: [],
      whatToMonitor: [{ text: 'Watch this.' }],
    });

    expect(text).toContain('Summary line.');
    expect(text).toContain('Theme one: Claim A. Claim B.');
    expect(text).toContain('Bullish case: Bull point.');
    expect(text).not.toContain('Bearish case:');
    expect(text).not.toContain('What changed:');
    expect(text).toContain('What to monitor: Watch this.');
  });
});

describe('judgeSystemPrompt', () => {
  it('names all four Tier C axes and says nothing about seeing the synthesiser\'s prompt', () => {
    const prompt = judgeSystemPrompt();
    expect(prompt).toContain('C1 Direction');
    expect(prompt).toContain('C2 Groundedness');
    expect(prompt).toContain('C3 Restraint');
    expect(prompt).toContain('C4 Actionability');
    expect(prompt.toLowerCase()).not.toContain('synthesis prompt');
  });
});
