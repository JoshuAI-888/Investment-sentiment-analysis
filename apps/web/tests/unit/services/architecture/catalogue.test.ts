import { describe, expect, it } from 'vitest';
import type { MethodRegistryEntry } from '@/calc/registry';
import type { CalculationArtifact } from '@/calc/artifact';
import { buildCatalogue, catalogueKey, searchCatalogue } from '@/services/architecture/catalogue';

function fakeEntry(overrides: Partial<MethodRegistryEntry> = {}): MethodRegistryEntry {
  return {
    id: 'attention.mention_delta',
    version: '1.0.0',
    title: 'Attention mention count, change (24 h)',
    subjectKind: 'security',
    unit: 'mentions',
    symbolicFormula: 'mention_delta = mentions_current - mentions_prior',
    officialAssumptions: {},
    editableAssumptions: [],
    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',
    eligibilityRules: ['Always computable.'],
    failureBehaviour: 'clamp',
    externalComparator: null,
    limitations: ['A limitation.'],
    goldens: ['x.json'],
    stalenessMinutes: 360,
    compute: () => ({ value: { exact: '1' as never, display: '1', unit: 'mentions', status: 'applied' } }),
    ...overrides,
  } as MethodRegistryEntry;
}

function fakeArtifact(overrides: Partial<CalculationArtifact> = {}): CalculationArtifact {
  return {
    calculationId: 'calc-1',
    methodId: 'attention.mention_delta',
    methodVersion: '1.0.0',
    subject: { kind: 'security', id: 'sec-1', label: 'EX' },
    asOf: '2026-08-30T12:00:00.000Z',
    inputs: [],
    assumptions: [],
    steps: [],
    result: { exact: '1', display: '1', roundingRule: 'int_0dp_half_even', unit: 'mentions' },
    abstention: null,
    eligibility: 'ok',
    inputHash: 'h1',
    resultHash: 'h2',
    configVersion: '1',
    scenario: { kind: 'official' },
    points: null,
    warnings: [],
    retentionClass: 'permanent',
    computedAt: '2026-08-30T12:00:01.000Z',
    ...overrides,
  } as CalculationArtifact;
}

describe('buildCatalogue', () => {
  it('pairs each registry entry with its example artifact and flags the latest version', () => {
    const entries = [fakeEntry(), fakeEntry({ version: '0.9.0' })];
    const artifacts = new Map([
      [catalogueKey('attention.mention_delta', '1.0.0'), fakeArtifact()],
      [catalogueKey('attention.mention_delta', '0.9.0'), fakeArtifact({ calculationId: 'calc-2', methodVersion: '0.9.0' })],
    ]);
    const catalogue = buildCatalogue(entries, new Map([['attention.mention_delta', '1.0.0']]), artifacts);

    expect(catalogue).toHaveLength(2);
    const latest = catalogue.find((c) => c.version === '1.0.0');
    const superseded = catalogue.find((c) => c.version === '0.9.0');
    expect(latest?.isLatestVersion).toBe(true);
    expect(superseded?.isLatestVersion).toBe(false);
    expect(latest?.example.calculationId).toBe('calc-1');
  });

  it('drops a registry entry with no example artifact, rather than rendering a fabricated one', () => {
    const entries = [fakeEntry()];
    const catalogue = buildCatalogue(entries, new Map([['attention.mention_delta', '1.0.0']]), new Map());
    expect(catalogue).toHaveLength(0);
  });

  it('renders an abstained example honestly rather than hiding it', () => {
    const entries = [fakeEntry()];
    const artifacts = new Map([
      [
        catalogueKey('attention.mention_delta', '1.0.0'),
        fakeArtifact({
          eligibility: 'insufficient_data',
          result: null,
          abstention: { reason: 'below_sample_threshold', message: 'Not enough data.' },
        }),
      ],
    ]);
    const [entry] = buildCatalogue(entries, new Map([['attention.mention_delta', '1.0.0']]), artifacts);
    expect(entry?.example.eligibility).toBe('insufficient_data');
    expect(entry?.example.display).toBeNull();
    expect(entry?.example.abstentionReason).toBe('Not enough data.');
  });
});

describe('searchCatalogue', () => {
  const entries = buildCatalogue(
    [fakeEntry(), fakeEntry({ id: 'technical.rsi_14', title: 'Relative strength index', symbolicFormula: 'RSI_14 = ...' })],
    new Map([
      ['attention.mention_delta', '1.0.0'],
      ['technical.rsi_14', '1.0.0'],
    ]),
    new Map([
      [catalogueKey('attention.mention_delta', '1.0.0'), fakeArtifact()],
      [catalogueKey('technical.rsi_14', '1.0.0'), fakeArtifact({ calculationId: 'calc-3', methodId: 'technical.rsi_14' })],
    ]),
  );

  it('an empty query returns every entry', () => {
    expect(searchCatalogue(entries, '')).toHaveLength(entries.length);
  });

  it('finds a method by a substring of its id', () => {
    expect(searchCatalogue(entries, 'rsi').map((e) => e.methodId)).toEqual(['technical.rsi_14']);
  });

  it('finds a method by a substring of its title, case-insensitively', () => {
    expect(searchCatalogue(entries, 'RELATIVE STRENGTH').map((e) => e.methodId)).toEqual(['technical.rsi_14']);
  });

  it('a query matching nothing returns an empty list, not every entry', () => {
    expect(searchCatalogue(entries, 'not-a-real-method-xyz')).toEqual([]);
  });
});
