/**
 * `attention.rank_change@1.0.0` — frozen. F06 registers `1.1.0` (the methodology-boundary
 * amendment) as the version production code resolves to going forward
 * (`services/attention-rank-change.ts`'s `computeRankChange` calls `registry.latest(...)`), but
 * `1.0.0` stays registered, unedited, and independently exercised here: replaying an artifact
 * computed before the amendment must still reproduce it exactly, byte for byte.
 *
 * This calls `computeAttentionRankChange` directly (not through the service layer, which now
 * only builds `1.1.0`-shaped inputs) so the golden below is proof of `1.0.0`'s own arithmetic,
 * not of whatever `1.1.0` happens to do when the two methodology inputs agree.
 */
import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.rank_change.v1.0.0.json';
import { buildArtifact, type CalculationInputValue } from '../../../src/calc/artifact';
import { computeAttentionRankChange } from '../../../src/calc/methods/attention-rank-change';
import { METHOD_REGISTRY } from '../../../src/services/calculations';
import { replay } from '../../../src/calc/replay';

type GoldenCase = (typeof golden.cases)[number];

function boardInput(
  key: string,
  value: string,
  unit: string,
  providerField: string,
  dataType: CalculationInputValue['dataType'] = 'decimal',
): CalculationInputValue {
  return {
    key,
    value,
    unit,
    dataType,
    source: `apewisdom/${golden.reading.filter}`,
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'apewisdom',
      providerField,
      sourceUrl: golden.reading.sourceUrl,
      observedAt: golden.reading.observedAt,
      availableAt: golden.reading.availableAt,
      ingestedAt: golden.reading.ingestedAt,
      rawPayloadId: golden.reading.rawPayloadId,
      licenseClass: 'attribution_required',
      redactionClass: 'public',
    },
  };
}

function build(testCase: GoldenCase) {
  const entry = testCase.entry;
  const inputs: CalculationInputValue[] = [
    boardInput('rank_now', String(entry.rank), 'ranks', 'rank'),
    boardInput('rank_prior', entry.rank24hAgo, 'ranks', 'rank_24h_ago'),
    boardInput('mentions_now', entry.mentions, 'mentions', 'mentions'),
    boardInput('mentions_prior', entry.mentions24hAgo, 'mentions', 'mentions_24h_ago'),
    boardInput('source_identity', `apewisdom:${golden.reading.filter}`, '', 'endpoint', 'identity'),
  ];

  const entryDescriptor = METHOD_REGISTRY.get('attention.rank_change', '1.0.0');
  const withScenario = testCase as GoldenCase & { accountDefaults?: Record<string, string> };
  const minMentions = withScenario.accountDefaults?.['min_mentions'] ?? entryDescriptor.officialAssumptions['min_mentions'];

  return buildArtifact({
    method: {
      methodId: entryDescriptor.id,
      version: entryDescriptor.version,
      unit: entryDescriptor.unit,
      roundingRule: entryDescriptor.roundingRule,
      workingPrecision: entryDescriptor.workingPrecision,
      compute: computeAttentionRankChange,
    },
    subject: { kind: 'security', id: golden.securityId, label: entry.ticker },
    asOf: golden.asOf,
    inputs,
    assumptions: [
      {
        key: 'min_mentions',
        value: minMentions as string,
        unit: 'mentions',
        source: withScenario.accountDefaults === undefined ? 'official_default' : 'account_default',
        officialValue: entryDescriptor.officialAssumptions['min_mentions'] as string,
        min: '1',
        max: '1000',
        editable: true,
      },
      {
        key: 'board_size',
        value: entryDescriptor.officialAssumptions['board_size'] as string,
        unit: '',
        source: 'code_invariant',
        officialValue: entryDescriptor.officialAssumptions['board_size'] as string,
        min: null,
        max: null,
        editable: false,
      },
    ],
    configVersion: golden.configVersion,
    scenario: { kind: 'official' },
    calculationId: '00000000-0000-4000-8000-000000000000',
    computedAt: golden.computedAt,
  });
}

describe('attention.rank_change@1.0.0 — frozen golden fixtures', () => {
  it.each(golden.cases.map((c) => [c.name, c] as const))(
    'reproduces the golden for %s',
    (_name, testCase) => {
      const artifact = build(testCase);
      expect(artifact.eligibility).toBe(testCase.expected.eligibility);
      expect(artifact.result?.exact ?? null).toBe(testCase.expected.exact);
      expect(artifact.resultHash).toBe(testCase.expected.resultHash);
      expect(artifact.inputHash).toBe(testCase.expected.inputHash);
    },
  );

  it('replays to `match` for every golden case', () => {
    for (const testCase of golden.cases) {
      const artifact = build(testCase);
      expect(replay(artifact, METHOD_REGISTRY).outcome, testCase.name).toBe('match');
    }
  });
});
