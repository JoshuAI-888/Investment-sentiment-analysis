/**
 * The eight deterministic verifier checks — F11 §4.5, `05-TEST-STRATEGY.md` §6. **Deterministic
 * code, not an LLM call** (F11 build brief, verbatim). Every one of these runs on every
 * production answer, and each is unit-tested here independently, positive and negative.
 *
 * A failure of any check means the run's prose is withheld and its state becomes
 * `verification_failed` — enforced by `state-machine.ts`, not by this module (this module only
 * reports violations; it has no state to transition).
 */
import type { SynthesisClaim, SynthesisOutput } from './schema';
import type { MetricFact } from './metrics';
import type { EvidencePack } from '@/services/evidence';
import { BANNED_VOCABULARY, PREDICTIVE_VOCABULARY } from './prompts';

export type CheckId =
  | 'numeric_tokens_match_metrics'
  | 'citations_resolve'
  | 'citations_within_window'
  | 'no_banned_vocabulary'
  | 'no_thin_sample_stance'
  | 'no_ticker_outside_subject'
  | 'date_claims_consistent'
  | 'stated_freshness_matches_oldest_input';

export type CheckViolation = {
  readonly check: CheckId;
  readonly claimId: string | null;
  readonly detail: string;
};

export type CheckResult = { readonly ok: boolean; readonly violations: readonly CheckViolation[] };

export type VerifyContext = {
  readonly output: SynthesisOutput;
  readonly pack: EvidencePack;
  readonly metrics: readonly MetricFact[];
  readonly subjectSymbol: string;
};

export function allClaims(output: SynthesisOutput): readonly SynthesisClaim[] {
  return [
    ...output.themes.flatMap((theme) => theme.claims),
    ...output.bullishCase,
    ...output.bearishCase,
    ...output.whatChanged,
    ...output.whatToMonitor,
  ];
}

function evidenceById(pack: EvidencePack): ReadonlyMap<string, EvidencePack['items'][number]> {
  return new Map(pack.items.map((item) => [item.stableId, item]));
}

function metricById(metrics: readonly MetricFact[]): ReadonlyMap<string, MetricFact> {
  return new Map(metrics.map((metric) => [metric.metricId, metric]));
}

// ── Check 1 — every numeric token string-matches a stored metric at its display rounding ───────

/**
 * Scoped to decimal and percentage-formatted tokens in claim *text* (not titles, not the free
 * summary) — a documented, deliberate narrowing, not an oversight. Every registered metric's
 * `display` is a rounded decimal or a percentage (`services/ticker/snapshot.ts#projectAxisMetric`
 * reads it straight off `CalculationArtifact.result.display`); a bare small integer in prose
 * ("three themes", "two sources") is exactly the shape of ordinary counting language this check
 * would otherwise flag as an unbacked "metric" and is not what this check exists to catch. A
 * hallucinated or mis-rounded statistic is what it exists to catch, and that is where it appears.
 */
const NUMERIC_TOKEN = /-?\d+(?:,\d{3})*\.\d+%?|-?\d+%/g;

function normalizeNumericToken(token: string): string {
  return token.replace(/,/g, '');
}

export function checkNumericTokensMatchMetrics(ctx: VerifyContext): CheckResult {
  const displays = new Set(ctx.metrics.map((metric) => normalizeNumericToken(metric.display) + (metric.unit === '%' ? '%' : '')));
  // Also accept the bare number without a trailing '%' the metric's own unit may add separately.
  const bareDisplays = new Set(ctx.metrics.map((metric) => normalizeNumericToken(metric.display)));

  const violations: CheckViolation[] = [];
  for (const claim of allClaims(ctx.output)) {
    const tokens = claim.text.match(NUMERIC_TOKEN) ?? [];
    for (const raw of tokens) {
      const token = normalizeNumericToken(raw);
      const bare = token.endsWith('%') ? token.slice(0, -1) : token;
      if (displays.has(token) || bareDisplays.has(bare) || bareDisplays.has(token)) continue;
      violations.push({
        check: 'numeric_tokens_match_metrics',
        claimId: claim.claimId,
        detail: `numeric token '${raw}' in claim '${claim.claimId}' does not string-match any stored metric's display value`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 2 — every citation marker resolves to an evidence_item in this run's pack ─────────────

export function checkCitationsResolve(ctx: VerifyContext): CheckResult {
  const byEvidence = evidenceById(ctx.pack);
  const byMetric = metricById(ctx.metrics);
  const violations: CheckViolation[] = [];

  for (const claim of allClaims(ctx.output)) {
    for (const evidenceId of claim.evidenceIds) {
      if (!byEvidence.has(evidenceId)) {
        violations.push({
          check: 'citations_resolve',
          claimId: claim.claimId,
          detail: `evidenceId '${evidenceId}' does not resolve to any evidence_item in this run's pack`,
        });
      }
    }
    for (const metricId of claim.metricIds) {
      if (!byMetric.has(metricId)) {
        violations.push({
          check: 'citations_resolve',
          claimId: claim.claimId,
          detail: `metricId '${metricId}' does not resolve to any metric gathered for this run`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 3 — every cited item's retrievedAt is within the run's declared window ────────────────

/**
 * "`retrievedAt`" (F11 §4.5's wording) maps to `EvidenceItem.availableAt` — the PIT field the
 * pack's own `retrievalWindow` is built against (`services/evidence/pack.ts`); `contracts/
 * evidence.ts#evidenceItem` has no field literally named `retrievedAt` (see this feature's
 * CONTRACTS note).
 */
export function checkCitationsWithinWindow(ctx: VerifyContext): CheckResult {
  const byEvidence = evidenceById(ctx.pack);
  const from = ctx.pack.retrievalWindow.from === null ? null : new Date(ctx.pack.retrievalWindow.from).getTime();
  const to = ctx.pack.retrievalWindow.to === null ? null : new Date(ctx.pack.retrievalWindow.to).getTime();

  const violations: CheckViolation[] = [];
  for (const claim of allClaims(ctx.output)) {
    for (const evidenceId of claim.evidenceIds) {
      const item = byEvidence.get(evidenceId);
      if (item === undefined) continue; // reported by check 2
      const at = item.item.availableAt.getTime();
      const tooEarly = from !== null && at < from;
      const tooLate = to !== null && at > to;
      if (tooEarly || tooLate) {
        violations.push({
          check: 'citations_within_window',
          claimId: claim.claimId,
          detail: `evidence '${evidenceId}' (availableAt ${item.item.availableAt.toISOString()}) falls outside the run's declared window`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 4 — no banned vocabulary ───────────────────────────────────────────────────────────────

const ALL_BANNED = [...BANNED_VOCABULARY, ...PREDICTIVE_VOCABULARY].map((phrase) => phrase.toLowerCase());

function textFieldsOf(output: SynthesisOutput): readonly { readonly claimId: string | null; readonly text: string }[] {
  const out: { readonly claimId: string | null; readonly text: string }[] = [
    { claimId: null, text: output.summary },
  ];
  for (const theme of output.themes) out.push({ claimId: null, text: theme.title });
  for (const claim of allClaims(output)) out.push({ claimId: claim.claimId, text: claim.text });
  return out;
}

export function checkBannedVocabulary(ctx: VerifyContext): CheckResult {
  const violations: CheckViolation[] = [];
  for (const field of textFieldsOf(ctx.output)) {
    const lower = field.text.toLowerCase();
    for (const phrase of ALL_BANNED) {
      if (lower.includes(phrase)) {
        violations.push({
          check: 'no_banned_vocabulary',
          claimId: field.claimId,
          detail: `banned phrase '${phrase}' found in ${field.claimId === null ? 'summary/theme title' : `claim '${field.claimId}'`}`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 5 — no stance score asserted where n < 5 ───────────────────────────────────────────────

export function checkNoThinSampleStance(ctx: VerifyContext): CheckResult {
  const byMetric = metricById(ctx.metrics);
  const violations: CheckViolation[] = [];
  for (const claim of allClaims(ctx.output)) {
    for (const metricId of claim.metricIds) {
      if (!metricId.startsWith('social.stance_')) continue;
      const metric = byMetric.get(metricId);
      if (metric === undefined) continue; // reported by check 2
      if (metric.n === null || metric.n < 5) {
        violations.push({
          check: 'no_thin_sample_stance',
          claimId: claim.claimId,
          detail: `claim '${claim.claimId}' cites stance metric '${metricId}' with n=${String(metric.n)} (< 5, `
            + "the product's own abstention floor — 01-PRODUCT-SPEC.md §6.3)",
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 6 — no claim references a ticker outside the run's subject set ────────────────────────

export function checkNoTickerOutsideSubject(ctx: VerifyContext): CheckResult {
  const subject = ctx.subjectSymbol.toUpperCase();
  const violations: CheckViolation[] = [];
  for (const claim of allClaims(ctx.output)) {
    for (const ticker of claim.relatedTickers) {
      if (ticker.toUpperCase() !== subject) {
        violations.push({
          check: 'no_ticker_outside_subject',
          claimId: claim.claimId,
          detail: `claim '${claim.claimId}' references '${ticker}', outside this run's subject set ({${subject}})`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 7 — date claims are consistent with cited evidence timestamps ─────────────────────────

/** Generous on purpose — "consistent with" is not "identical to"; a week-scale claim citing a mid-week article is legitimately consistent. */
const DATE_CONSISTENCY_TOLERANCE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function checkDateClaimsConsistent(ctx: VerifyContext): CheckResult {
  const byEvidence = evidenceById(ctx.pack);
  const byMetric = metricById(ctx.metrics);
  const violations: CheckViolation[] = [];

  for (const claim of allClaims(ctx.output)) {
    if (claim.assertedDate === null) continue;
    const asserted = new Date(claim.assertedDate).getTime();
    if (Number.isNaN(asserted)) {
      violations.push({
        check: 'date_claims_consistent',
        claimId: claim.claimId,
        detail: `claim '${claim.claimId}' has an unparseable assertedDate '${claim.assertedDate}'`,
      });
      continue;
    }

    const candidateTimes: number[] = [];
    for (const evidenceId of claim.evidenceIds) {
      const item = byEvidence.get(evidenceId);
      if (item === undefined) continue;
      candidateTimes.push((item.item.publishedAt ?? item.item.availableAt).getTime());
    }
    for (const metricId of claim.metricIds) {
      const metric = byMetric.get(metricId);
      if (metric?.observedAt !== null && metric?.observedAt !== undefined) {
        candidateTimes.push(metric.observedAt.getTime());
      }
    }

    if (candidateTimes.length === 0) continue; // nothing to check consistency against

    const withinTolerance = candidateTimes.some(
      (time) => Math.abs(time - asserted) <= DATE_CONSISTENCY_TOLERANCE_DAYS * DAY_MS,
    );
    if (!withinTolerance) {
      violations.push({
        check: 'date_claims_consistent',
        claimId: claim.claimId,
        detail: `claim '${claim.claimId}' asserts date ${claim.assertedDate}, more than ${String(DATE_CONSISTENCY_TOLERANCE_DAYS)} days from every citation it names`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Check 8 — stated freshness matches the oldest input's observed_at ───────────────────────────

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The true oldest input across everything given to synthesis — computed by code, never trusted from the model. */
export function trueOldestInputAt(ctx: Pick<VerifyContext, 'pack' | 'metrics'>): Date | null {
  const times: number[] = [];
  for (const item of ctx.pack.items) times.push(item.item.availableAt.getTime());
  for (const metric of ctx.metrics) if (metric.observedAt !== null) times.push(metric.observedAt.getTime());
  if (times.length === 0) return null;
  return new Date(Math.min(...times));
}

export function checkStatedFreshnessMatchesOldestInput(ctx: VerifyContext): CheckResult {
  const trueOldest = trueOldestInputAt(ctx);
  if (trueOldest === null) return { ok: true, violations: [] }; // nothing to compare against (empty pack/metrics)

  const stated = new Date(ctx.output.statedFreshness);
  if (Number.isNaN(stated.getTime())) {
    return {
      ok: false,
      violations: [
        {
          check: 'stated_freshness_matches_oldest_input',
          claimId: null,
          detail: `statedFreshness '${ctx.output.statedFreshness}' is not a parseable timestamp`,
        },
      ],
    };
  }

  if (dayOf(stated) !== dayOf(trueOldest)) {
    return {
      ok: false,
      violations: [
        {
          check: 'stated_freshness_matches_oldest_input',
          claimId: null,
          detail: `statedFreshness (${dayOf(stated)}) does not match the true oldest input observed at ${dayOf(trueOldest)}`,
        },
      ],
    };
  }
  return { ok: true, violations: [] };
}

// ── Aggregate ─────────────────────────────────────────────────────────────────────────────────

export const ALL_CHECKS: readonly ((ctx: VerifyContext) => CheckResult)[] = [
  checkNumericTokensMatchMetrics,
  checkCitationsResolve,
  checkCitationsWithinWindow,
  checkBannedVocabulary,
  checkNoThinSampleStance,
  checkNoTickerOutsideSubject,
  checkDateClaimsConsistent,
  checkStatedFreshnessMatchesOldestInput,
];

export function runDeterministicChecks(ctx: VerifyContext): CheckResult {
  const violations = ALL_CHECKS.flatMap((check) => check(ctx).violations);
  return { ok: violations.length === 0, violations };
}
