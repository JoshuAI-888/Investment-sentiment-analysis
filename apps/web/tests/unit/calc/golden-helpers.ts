/**
 * Shared plumbing for F06's "lean" golden fixtures (`attention.mention_delta` and onward — every
 * method except `attention.rank_change`, which keeps F05's richer step-and-hash format because
 * F05 already built it).
 *
 * These goldens pin `eligibility`, `exact`, `display` and `abstention` as **exact strings** —
 * `05-TEST-STRATEGY.md` §3's requirement — without also pinning `inputHash`/`resultHash` or the
 * full step trace, which for a method with a 5–30-element series input would make the fixture
 * unreviewable. The hash mechanism itself is exercised generically, once, in `calc/canonical.ts`'s
 * own tests and in `attention.rank_change`'s fixtures; what a lean fixture proves is that *this*
 * formula, transcribed from source §8, produces *this* number for *these* inputs.
 */
import type { CalculationArtifact, CalculationInputValue } from '../../../src/calc/artifact';
import { buildArtifact } from '../../../src/calc/artifact';
import { METHOD_REGISTRY } from '../../../src/services/calculations';

export const AS_OF = '2026-08-30T12:00:00.000Z';
export const COMPUTED_AT = '2026-08-30T12:00:01.000Z';

function provenance(key: string) {
  return {
    provider: 'fixture',
    providerField: key,
    sourceUrl: 'https://fixture.test/golden',
    observedAt: '2026-08-30T11:55:00.000000Z',
    availableAt: '2026-08-30T11:55:00.000000Z',
    ingestedAt: '2026-08-30T11:56:00.000000Z',
    rawPayloadId: null,
    licenseClass: 'internal_fixture',
    redactionClass: 'public',
  };
}

export function decimalInput(key: string, value: string, unit = ''): CalculationInputValue {
  return {
    key,
    value,
    unit,
    dataType: 'decimal',
    source: 'fixture',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance(key),
  };
}

export function identityInput(key: string, value: string): CalculationInputValue {
  return {
    key,
    value,
    unit: null,
    dataType: 'identity',
    source: 'fixture',
    quality: 'ok',
    freshness: 'fresh',
    provenance: provenance(key),
  };
}

/** Every `${prefix}_0 .. ${prefix}_{n-1}` as decimal inputs, from a plain array of strings. */
export function seriesInputs(prefix: string, values: readonly string[], unit = ''): CalculationInputValue[] {
  return values.map((value, index) => decimalInput(`${prefix}_${index}`, value, unit));
}

export type LeanGoldenCase = {
  readonly name: string;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly identityInputs?: Readonly<Record<string, string>>;
  readonly assumptions?: Readonly<Record<string, string>>;
  readonly seriesInputs?: Readonly<Record<string, readonly string[]>>;
  readonly expected: {
    readonly eligibility: CalculationArtifact['eligibility'];
    readonly exact: string | null;
    readonly display: string | null;
    readonly abstention: { readonly reason: string; readonly message: string } | null;
    readonly warnings: readonly string[];
  };
};

/** Builds an artifact for a lean golden case against a registered method's latest version. */
export function buildLean(methodId: string, testCase: LeanGoldenCase): CalculationArtifact {
  const entry = METHOD_REGISTRY.latest(methodId);

  const inputs: CalculationInputValue[] = [
    ...Object.entries(testCase.inputs ?? {}).map(([key, value]) => decimalInput(key, value)),
    ...Object.entries(testCase.identityInputs ?? {}).map(([key, value]) => identityInput(key, value)),
    ...Object.entries(testCase.seriesInputs ?? {}).flatMap(([prefix, values]) =>
      seriesInputs(prefix, values),
    ),
  ];

  const assumptions = Object.entries(entry.officialAssumptions).map(([key, officialValue]) => {
    const editable = entry.editableAssumptions.find((candidate) => candidate.key === key);
    const override = testCase.assumptions?.[key];
    return {
      key,
      value: override ?? officialValue,
      unit: editable?.unit ?? '',
      source: (override === undefined ? 'official_default' : 'account_default') as
        | 'official_default'
        | 'account_default',
      officialValue,
      min: editable?.min ?? null,
      max: editable?.max ?? null,
      editable: editable !== undefined,
    };
  });

  return buildArtifact({
    method: {
      methodId: entry.id,
      version: entry.version,
      unit: entry.unit,
      roundingRule: entry.roundingRule,
      workingPrecision: entry.workingPrecision,
      compute: entry.compute,
    },
    subject: { kind: 'security', id: 'sec-golden', label: 'GOLD' },
    asOf: AS_OF,
    inputs,
    assumptions,
    configVersion: '1',
    scenario: { kind: 'official' },
    calculationId: '00000000-0000-4000-8000-000000000001',
    computedAt: COMPUTED_AT,
  });
}

/** The one assertion every lean golden case runs — exact strings, no tolerance. */
export function assertLean(artifact: CalculationArtifact, expected: LeanGoldenCase['expected']): void {
  if (artifact.eligibility !== expected.eligibility) {
    throw new Error(
      `eligibility: expected ${expected.eligibility}, got ${artifact.eligibility} ` +
        `(abstention: ${JSON.stringify(artifact.abstention)})`,
    );
  }
  if ((artifact.result?.exact ?? null) !== expected.exact) {
    throw new Error(`exact: expected ${String(expected.exact)}, got ${String(artifact.result?.exact ?? null)}`);
  }
  if ((artifact.result?.display ?? null) !== expected.display) {
    throw new Error(
      `display: expected ${String(expected.display)}, got ${String(artifact.result?.display ?? null)}`,
    );
  }
  if (expected.abstention !== null) {
    if (artifact.abstention?.reason !== expected.abstention.reason) {
      throw new Error(
        `abstention.reason: expected ${expected.abstention.reason}, got ${String(artifact.abstention?.reason)}`,
      );
    }
    if (artifact.abstention?.message !== expected.abstention.message) {
      throw new Error(
        `abstention.message: expected "${expected.abstention.message}", got "${String(artifact.abstention?.message)}"`,
      );
    }
  } else if (artifact.abstention !== null) {
    throw new Error(`abstention: expected none, got ${JSON.stringify(artifact.abstention)}`);
  }
  const warningsMatch =
    artifact.warnings.length === expected.warnings.length &&
    artifact.warnings.every((warning, index) => warning === expected.warnings[index]);
  if (!warningsMatch) {
    throw new Error(
      `warnings: expected ${JSON.stringify(expected.warnings)}, got ${JSON.stringify(artifact.warnings)}`,
    );
  }
}
