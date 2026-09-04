import { describe, expect, it } from 'vitest';
import golden from '../../../src/analytics/goldens/attention.rank_change.v1.1.0.json';
import type { ApeWisdomEntry } from '../../../src/adapters/apewisdom';
import { computeRankChange, inputsFromBoardEntry } from '../../../src/services/attention-rank-change';
import { replay } from '../../../src/calc/replay';
import { METHOD_REGISTRY } from '../../../src/services/calculations';

type GoldenCase = (typeof golden.cases)[number];

const reading = golden.reading;

function build(entry: ApeWisdomEntry, extras: Partial<Parameters<typeof computeRankChange>[0]> = {}) {
  return computeRankChange({
    entry,
    reading,
    securityId: golden.securityId,
    asOf: golden.asOf,
    configVersion: golden.configVersion,
    calculationId: '00000000-0000-4000-8000-000000000000',
    computedAt: golden.computedAt,
    // Production code no longer defaults this (lane-review: a default here disables the
    // boundary-crossed guard it exists to drive). This *test* convenience — "no boundary
    // crossed unless a case says otherwise" — belongs here, in fixture code, not silently in
    // `inputsFromBoardEntry` itself.
    priorMethodologyVersion: reading.methodologyVersion,
    ...extras,
  });
}

function buildFromCase(testCase: GoldenCase) {
  const withScenario = testCase as GoldenCase & {
    scenario?: { kind: 'personal'; userId: string; profileId: string };
    accountDefaults?: Record<string, string>;
    priorMethodologyVersion?: string;
  };
  return build(testCase.entry as ApeWisdomEntry, {
    ...(withScenario.scenario === undefined ? {} : { scenario: withScenario.scenario }),
    ...(withScenario.accountDefaults === undefined
      ? {}
      : { accountDefaults: withScenario.accountDefaults }),
    ...(withScenario.priorMethodologyVersion === undefined
      ? {}
      : { priorMethodologyVersion: withScenario.priorMethodologyVersion }),
  });
}

describe('attention.rank_change — golden fixtures', () => {
  it('has a golden for the outcomes that matter, not just the happy one', () => {
    const outcomes = new Set(golden.cases.map((c) => c.expected.eligibility));
    expect(outcomes).toContain('ok');
    expect(outcomes).toContain('insufficient_data');
    expect(outcomes).toContain('not_applicable');
    expect(golden.cases.some((c) => c.expected.warnings.length > 0)).toBe(true);
  });

  it.each(golden.cases.map((c) => [c.name, c] as const))(
    'reproduces the golden for %s',
    (_name, testCase) => {
      const artifact = buildFromCase(testCase);

      expect(artifact.eligibility).toBe(testCase.expected.eligibility);
      expect(artifact.result?.exact ?? null).toBe(testCase.expected.exact);
      expect(artifact.result?.display ?? null).toBe(testCase.expected.display);
      expect(artifact.abstention).toEqual(testCase.expected.abstention);
      expect(artifact.warnings).toEqual(testCase.expected.warnings);
      expect(artifact.resultHash).toBe(testCase.expected.resultHash);
      expect(
        artifact.steps.map((step) => ({
          key: step.key,
          expression: step.expression,
          substituted: step.substituted,
          exactValue: step.exactValue,
          displayValue: step.displayValue,
          status: step.status,
        })),
      ).toEqual(testCase.expected.steps);
    },
  );

  it('pins the input hash of every golden case', () => {
    // A golden that pins only the output would still pass if the *provenance* of an input
    // changed — and a value whose provenance changed is a different fact.
    for (const testCase of golden.cases) {
      expect(buildFromCase(testCase).inputHash, testCase.name).toBe(testCase.expected.inputHash);
    }
  });
});

describe('attention.rank_change — the method itself', () => {
  const aapl: ApeWisdomEntry = {
    rank: 2,
    ticker: 'AAPL',
    name: 'Apple Inc.',
    mentions: '980',
    upvotes: '4021',
    rank24hAgo: '3',
    mentions24hAgo: '870',
  };

  it('reports a positive change for a move toward rank 1', () => {
    expect(build(aapl).result?.exact).toBe('1');
  });

  it('reports a negative change for a move away from rank 1', () => {
    expect(build({ ...aapl, rank: 8, rank24hAgo: '3' }).result?.exact).toBe('-5');
  });

  it('reports zero for no change, rather than abstaining', () => {
    // Zero is a measured value. Abstaining on it would hide the most common observation.
    const artifact = build({ ...aapl, rank: 3, rank24hAgo: '3' });
    expect(artifact.result?.exact).toBe('0');
    expect(artifact.eligibility).toBe('ok');
  });

  it('abstains below the mention floor and says by how much', () => {
    const artifact = build({ ...aapl, mentions: '24' });
    expect(artifact.eligibility).toBe('insufficient_data');
    expect(artifact.abstention?.reason).toBe('below_sample_threshold');
    expect(artifact.abstention?.message).toContain('24 time(s)');
    expect(artifact.abstention?.message).toContain('At least 25');
  });

  it('computes at exactly the floor rather than one above it', () => {
    // Off-by-one at a threshold is the defect nobody sees in review.
    expect(build({ ...aapl, mentions: '25' }).eligibility).toBe('ok');
    expect(build({ ...aapl, mentions: '24' }).eligibility).toBe('insufficient_data');
  });

  it('treats absence from the board as not applicable, at either end, distinguishing which end', () => {
    // Distinct reasons, not one collapsed `not_applicable` (lane-review): a UI wanting to say
    // "New" or "dropped off" needs a field to read that from, not a re-derivation of
    // `rank_prior`/`rank_now` from the artifact's raw inputs.
    const newToBoard = build({ ...aapl, rank24hAgo: '0' });
    expect(newToBoard.eligibility).toBe('not_applicable');
    expect(newToBoard.abstention?.reason).toBe('new_to_board');

    const droppedFromBoard = build({ ...aapl, rank: 0 });
    expect(droppedFromBoard.eligibility).toBe('not_applicable');
    expect(droppedFromBoard.abstention?.reason).toBe('dropped_from_board');
  });

  it('treats absence at both ends as not applicable, not as new-to-board', () => {
    // Neither single-ended reason is true here — the security never held a tracked position at
    // either observation. Found by a third lane-review pass: the two checks above were written
    // as independent `if`s, so this case silently fell into the first one (`new_to_board`).
    const neverOnBoard = build({ ...aapl, rank: 0, rank24hAgo: '0' });
    expect(neverOnBoard.eligibility).toBe('not_applicable');
    expect(neverOnBoard.abstention?.reason).toBe('not_applicable');
  });

  it('clamps a move larger than the board and marks the step as clamped', () => {
    const artifact = build({ ...aapl, rank: 5, rank24hAgo: '400' });
    expect(artifact.result?.exact).toBe('100');
    expect(artifact.steps.at(-1)?.status).toBe('clamped');
    expect(artifact.warnings).toHaveLength(1);
    expect(artifact.warnings[0]).toContain('clamped to the board size');
  });

  it('clamps in the negative direction too', () => {
    const artifact = build({ ...aapl, rank: 400, rank24hAgo: '5' });
    expect(artifact.result?.exact).toBe('-100');
  });

  it('carries the board identity as a hashed input that enters no arithmetic', () => {
    const inputs = inputsFromBoardEntry(aapl, reading, reading.methodologyVersion);
    const identity = inputs.find((i) => i.key === 'source_identity');
    expect(identity?.dataType).toBe('identity');
    expect(identity?.value).toBe('apewisdom:all-stocks');

    const otherBoard = build(aapl, {
      reading: { ...reading, filter: 'wallstreetbets' },
    });
    expect(otherBoard.result?.exact).toBe('1');
    expect(otherBoard.inputHash).not.toBe(build(aapl).inputHash);
  });

  it('attaches provenance to every input', () => {
    // §4.8 §3. An input with no provider, no source and no observed_at is a number the reader
    // has to take on trust, which is the thing the Inspector exists to avoid.
    for (const input of inputsFromBoardEntry(aapl, reading, reading.methodologyVersion)) {
      expect(input.provenance.provider, input.key).toBe('apewisdom');
      expect(input.provenance.observedAt).toBe(reading.observedAt);
      expect(input.provenance.availableAt).toBe(reading.availableAt);
      expect(input.provenance.sourceUrl).toBe(reading.sourceUrl);
      expect(input.provenance.licenseClass).not.toBe('');
    }
  });

  it('replays to `match` for every golden case', () => {
    for (const testCase of golden.cases) {
      const artifact = buildFromCase(testCase);
      expect(replay(artifact, METHOD_REGISTRY).outcome, testCase.name).toBe('match');
    }
  });
});

describe('F05 §4.5 — a personal scenario differs in exactly one variable', () => {
  const entry: ApeWisdomEntry = {
    rank: 2,
    ticker: 'AAPL',
    name: 'Apple Inc.',
    mentions: '30',
    upvotes: '40',
    rank24hAgo: '3',
    mentions24hAgo: '20',
  };

  it('computes a personal result from the same frozen inputs, with no provider call', () => {
    const official = build(entry);
    const personal = build(entry, {
      scenario: { kind: 'personal', userId: 'u1', profileId: 'p1' },
      accountDefaults: { min_mentions: '100' },
    });

    // Same inputs, byte for byte — the mapping is the only thing that touches a payload, and
    // it ran once. The two artifacts differ only in the assumption and what follows from it.
    expect(personal.inputs).toEqual(official.inputs);
    expect(official.eligibility).toBe('ok');
    expect(personal.eligibility).toBe('insufficient_data');
    expect(personal.assumptions.find((a) => a.key === 'min_mentions')).toMatchObject({
      value: '100',
      officialValue: '25',
      source: 'account_default',
    });
  });

  it('ignores the same override on an official run', () => {
    const official = build(entry, { accountDefaults: { min_mentions: '100' } });
    expect(official.eligibility).toBe('ok');
    expect(official.assumptions.find((a) => a.key === 'min_mentions')?.value).toBe('25');
  });

  it('refuses a personal override of a non-editable parameter', () => {
    const artifact = build(entry, {
      scenario: { kind: 'personal', userId: 'u1', profileId: 'p1' },
      subjectOverrides: { board_size: '2' },
    });
    expect(artifact.assumptions.find((a) => a.key === 'board_size')?.value).toBe('100');
  });
});
