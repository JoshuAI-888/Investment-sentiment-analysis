import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  resolveSecurityMentions,
  type RniBareTickerAmbiguityPolicy,
  type RniSecurityResolutionCandidate,
} from '@/rni/observations';

const ambiguityPolicy: RniBareTickerAmbiguityPolicy = {
  version: 'rni-test-ambiguity-v1',
  bareTickerSymbols: ['A', 'AI', 'IT', 'ON'],
};

const sourceItemId = '00000000-0000-4000-8000-000000000601';
const nvdaId = '00000000-0000-4000-8000-000000000602';
const amdId = '00000000-0000-4000-8000-000000000603';
const aiId = '00000000-0000-4000-8000-000000000604';
const candidates: readonly RniSecurityResolutionCandidate[] = [
  {
    id: nvdaId,
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NASDAQ',
    aliases: ['NVIDIA'],
    active: true,
  },
  {
    id: amdId,
    symbol: 'AMD',
    name: 'Advanced Micro Devices, Inc.',
    exchange: 'NASDAQ',
    aliases: ['Advanced Micro Devices'],
    active: true,
  },
  {
    id: aiId,
    symbol: 'AI',
    name: 'C3.ai, Inc.',
    exchange: 'NYSE',
    aliases: ['C3.ai'],
    active: true,
  },
];

const cases = [
  { text: 'NVDA has execution momentum; AMD is still catching up.', expected: [nvdaId, amdId] },
  { text: '$nvda leads $amd.', expected: [nvdaId, amdId] },
  { text: 'NVIDIA leads Advanced Micro Devices.', expected: [nvdaId, amdId] },
  { text: 'AI is changing every industry.', expected: [] },
  { text: 'Semiconductor execution remains mixed.', expected: [] },
] as const;

describe('RNI security-resolution synthetic smoke eval', () => {
  it('has exact security recall and no false positives on the bounded v1 challenge cases', () => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const testCase of cases) {
      const actual = resolveSecurityMentions(
        { sourceItemId, boundedContent: testCase.text, candidates, ambiguityPolicy },
        () => randomUUID(),
      ).mentions.map((mention) => mention.securityId);
      const expected = new Set<string>(testCase.expected);
      truePositives += actual.filter((id) => expected.has(id)).length;
      falsePositives += actual.filter((id) => !expected.has(id)).length;
      falseNegatives += [...expected].filter((id) => !actual.includes(id)).length;
    }
    const precision = truePositives / (truePositives + falsePositives);
    const recall = truePositives / (truePositives + falseNegatives);
    expect({ precision, recall }).toEqual({ precision: 1, recall: 1 });
  });
});
