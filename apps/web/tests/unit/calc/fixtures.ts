/**
 * Shared builders for the kernel's unit tests. Nothing here fabricates a provider response —
 * these are artifact *arguments*, not payloads.
 */
import type {
  BuilderMethod,
  BuildArtifactArgs,
  CalculationInputValue,
  MethodCompute,
  ResolvedAssumption,
} from '../../../src/calc/artifact';
import type { MethodDescriptor } from '../../../src/calc/registry';

export const AS_OF = '2026-08-30T12:00:00.000Z';
export const COMPUTED_AT = '2026-08-30T12:00:01.000Z';
export const CALCULATION_ID = '11111111-2222-4333-8444-555555555555';

export function input(
  key: string,
  value: string,
  overrides: Partial<CalculationInputValue> = {},
): CalculationInputValue {
  return {
    key,
    value,
    unit: 'ranks',
    dataType: 'decimal',
    source: 'apewisdom',
    quality: 'ok',
    freshness: 'fresh',
    provenance: {
      provider: 'apewisdom',
      providerField: key,
      sourceUrl: 'https://apewisdom.io/api/v1.0/filter/all-stocks/page/1',
      // Six-digit microsecond form — what a value stored and re-read from Postgres actually
      // looks like (lane-review finding 6), which matters for `tests/contract/artifact-round-
      // trip.test.ts`'s byte-for-byte comparison; the plain unit tests here don't touch a
      // database and would be equally correct with three digits.
      observedAt: '2026-08-30T11:55:00.000000Z',
      availableAt: '2026-08-30T11:55:00.000000Z',
      ingestedAt: '2026-08-30T11:56:00.000000Z',
      rawPayloadId: null,
      licenseClass: 'attribution_required',
      redactionClass: 'public',
    },
    ...overrides,
  };
}

export function assumption(
  key: string,
  value: string,
  overrides: Partial<ResolvedAssumption> = {},
): ResolvedAssumption {
  return {
    key,
    value,
    unit: '',
    source: 'official_default',
    officialValue: value,
    min: null,
    max: null,
    editable: false,
    ...overrides,
  };
}

export function method(compute: MethodCompute, overrides: Partial<BuilderMethod> = {}): BuilderMethod {
  return {
    methodId: 'test.metric',
    version: '1.0.0',
    unit: 'ranks',
    roundingRule: 'int_0dp_half_even',
    workingPrecision: 34,
    compute,
    ...overrides,
  };
}

export function args(
  compute: MethodCompute,
  overrides: Partial<BuildArtifactArgs> = {},
): BuildArtifactArgs {
  return {
    method: method(compute),
    subject: { kind: 'security', id: 'sec-1', label: 'EXMPL' },
    asOf: AS_OF,
    inputs: [input('a', '10'), input('b', '4')],
    assumptions: [assumption('k', '2')],
    configVersion: '1',
    scenario: { kind: 'official' },
    calculationId: CALCULATION_ID,
    computedAt: COMPUTED_AT,
    ...overrides,
  };
}

/** A descriptor good enough to parse, for tests about validation rather than about a method. */
export function descriptor(overrides: Partial<MethodDescriptor> = {}): MethodDescriptor {
  return {
    id: 'test.metric',
    version: '1.0.0',
    title: 'Test metric',
    subjectKind: 'security',
    unit: 'ranks',
    symbolicFormula: 'x = a - b',
    officialAssumptions: { min_mentions: '25', board_size: '100' },
    editableAssumptions: [
      { key: 'min_mentions', min: '1', max: '1000', unit: 'mentions', label: 'Minimum mentions' },
    ],
    workingPrecision: 34,
    roundingRule: 'int_0dp_half_even',
    eligibilityRules: ['always'],
    failureBehaviour: 'abstain',
    externalComparator: null,
    limitations: ['it is a test'],
    goldens: ['none.json'],
    stalenessMinutes: null,
    ...overrides,
  };
}
