/**
 * F18 §4.1 — the real budget policy F04's pre-dispatch hook calls. This is where
 * `docs/00-ADVERSARIAL-REVIEW.md` F-04 (unmetered cost liability) is actually closed for the
 * scopes D-11 leaves standing: **the global monthly ceiling is the only budget control** —
 * D-11 cut per-account budgets outright (`docs/MEMORY.md` D-11: "per-account budgets" is in the
 * cut list; F18-cost-degradation.md's own amendment banner: "per-account budgets are void under
 * D-11 — the global check is now the only budget control"). So `BudgetPolicy` below evaluates
 * one scope, `'global'`, at three tiers, not two scopes as the spec's un-amended §4.1 table
 * still literally reads.
 *
 * **Threshold figures.** D-20's ceiling is $350/month; D-32 completes it with the tiered
 * figures actually in force: **$290 warn / $320 reduce-optional / $350 hard**
 * (`docs/MEMORY.md` D-32, "D-20's thresholds are adopted as written"). The feature spec's own
 * §4.1 table still quotes the source PRD's literal, pre-D-20 **$80/$90/$100** — a staleness F15
 * already found and flagged rather than silently followed (`progress/log/
 * 2026-09-05-f15-admin-control-plane.md`: "Known design tradeoff... Settings budget defaults
 * were seeded to D-32's $290/$320/$350... not F15 §4.7's own literal text"). This module reads
 * those same three keys F15 already seeded (`services/admin/settings-catalogue.ts`:
 * `budget.warn_usd` / `budget.reduce_usd` / `budget.hard_usd`) rather than inventing a third set
 * of numbers — the single source of truth for "what the default is" stays the catalogue F15
 * built, not a fourth copy of the figures here.
 *
 * **Live, operator-editable, with a safe fallback.** `resolveBudgetThresholds` reads the
 * *currently active* `config_version`'s settings first (F15's own admin UI can already version
 * and roll these back) and falls back to the catalogue's own `defaultValue` only when no active
 * config version has ever carried the key — the same fallback shape `services/admin/reads.ts`'s
 * `budgetThreshold()` already uses for the read-only ledger view, so the enforcement path here
 * and the view F15 already built can never silently disagree about what the current threshold
 * is.
 */
import { z } from 'zod';
import { dec, exact, isDecimalString } from '@/calc/decimal';
import { findActiveAppSetting } from '@/repositories/settings';
import { spendInWindow } from '@/repositories/cost';
import { getPool, type Queryable } from '@/repositories/client';
import { findCatalogueEntry } from '@/services/admin/settings-catalogue';
import { ADMIN_ENVIRONMENT } from '@/services/admin/constants';
import { monthWindow } from '@/services/dashboard/budget';

/**
 * F18 §3's produced contracts, as real zod schemas — not merely TypeScript types — so a
 * `BudgetDecision` can be validated wherever one crosses a boundary (a test, a future admin
 * surface), the same discipline `services/ticker/contract.ts` and every other `contract.ts` in
 * this codebase already follow.
 */
const decimalUsd = z.string().refine(isDecimalString, 'must be a decimal USD amount');

export const budgetThresholds = z.object({
  warnUsd: decimalUsd,
  reduceUsd: decimalUsd,
  hardUsd: decimalUsd,
});
export type BudgetThresholds = z.infer<typeof budgetThresholds>;

export const budgetTier = z.enum(['ok', 'warn', 'reduce', 'block']);
export type BudgetTier = z.infer<typeof budgetTier>;

export const budgetDecision = z.object({
  tier: budgetTier,
  spentUsd: decimalUsd,
  thresholds: budgetThresholds,
  asOf: z.string().datetime(),
});
export type BudgetDecision = z.infer<typeof budgetDecision>;

/**
 * D-32's own named figures, used only when no active `config_version` has ever carried the
 * settings key (F16a's own log records that no production `config_version` bootstrap path
 * exists yet — see `progress/log/2026-09-05-f16a-dispatch-core.md`). Sourced from the same
 * catalogue F15 seeded (`findCatalogueEntry`) rather than re-declared here, so a future change to
 * the seeded default cannot silently diverge from what this module falls back to.
 */
function catalogueDefault(key: string): string {
  const entry = findCatalogueEntry(key);
  if (entry === undefined) {
    throw new Error(`No settings-catalogue entry for '${key}' — settings-catalogue.ts and this module have drifted.`);
  }
  return String(entry.defaultValue);
}

async function thresholdValue(key: string, db: Queryable): Promise<string> {
  const setting = await findActiveAppSetting(ADMIN_ENVIRONMENT, key, db);
  const value = setting?.value;
  return typeof value === 'string' ? value : catalogueDefault(key);
}

/**
 * The three D-32 threshold figures, live from the active `config_version` where one has ever
 * carried them, falling back to the catalogue's seeded default otherwise. Never throws on a
 * missing config version — an unconfigured environment gets D-32's own real numbers, not a
 * crash on the one path (budget enforcement) that must never fail open by accident.
 */
export async function resolveBudgetThresholds(db: Queryable = getPool()): Promise<BudgetThresholds> {
  const [warnUsd, reduceUsd, hardUsd] = await Promise.all([
    thresholdValue('budget.warn_usd', db),
    thresholdValue('budget.reduce_usd', db),
    thresholdValue('budget.hard_usd', db),
  ]);
  return { warnUsd, reduceUsd, hardUsd };
}

function geq(a: string, b: string): boolean {
  return dec(a).greaterThanOrEqualTo(dec(b));
}

/**
 * Pure, decimal-safe (F18 build discipline: "a raw JS `number` in a budget threshold comparison
 * is a named review failure"). Threshold behaviour, F18 §4.1:
 * - `spent >= hardUsd`   → `'block'`  — all noncritical paid work refused; core paths continue.
 * - `spent >= reduceUsd` → `'reduce'` — optional work stops (shadow work, non-essential
 *   refreshes, background enrichment); core paths continue.
 * - `spent >= warnUsd`   → `'warn'`   — admin alert only; no behaviour change.
 * - otherwise            → `'ok'`.
 */
export function classifyBudgetTier(spentUsd: string, thresholds: BudgetThresholds): BudgetTier {
  if (geq(spentUsd, thresholds.hardUsd)) return 'block';
  if (geq(spentUsd, thresholds.reduceUsd)) return 'reduce';
  if (geq(spentUsd, thresholds.warnUsd)) return 'warn';
  return 'ok';
}

export function evaluateBudgetPolicy(
  spentUsd: string,
  thresholds: BudgetThresholds,
  now: Date = new Date(),
): BudgetDecision {
  return {
    tier: classifyBudgetTier(spentUsd, thresholds),
    spentUsd: exact(spentUsd),
    thresholds,
    asOf: now.toISOString(),
  };
}

/**
 * The live decision for the current calendar month's global spend — the one scope D-11 leaves
 * standing. `spendInWindow` is `cost_event`-derived, the same read `repositories/
 * cost-breakdown.ts`'s ledger view uses, so enforcement and the ledger can never disagree about
 * what "this month's spend" means (F18 §2 Out: "the ledger view (F15)" — this reuses it rather
 * than adding a second read).
 */
export async function getGlobalBudgetDecision(
  now: Date = new Date(),
  db: Queryable = getPool(),
): Promise<BudgetDecision> {
  const { from, to } = monthWindow(now);
  const [{ totalUsd }, thresholds] = await Promise.all([spendInWindow(from, to, db), resolveBudgetThresholds(db)]);
  return evaluateBudgetPolicy(totalUsd, thresholds, now);
}

/**
 * F18 §4.1's two named categories of priced-and-optional work, distinct from the "core" paths
 * (the dashboard refresh's own hard-ceiling gate in `services/dashboard/budget.ts`, and every
 * read/admin path, none of which route through this classifier at all — they are simply never
 * gated).
 *
 * - `'optional'`    — "shadow work, non-essential refreshes, background enrichment." Stops at
 *   `'reduce'` and `'block'`.
 * - `'noncritical'` — everything else priced that is not a core path. Stops at `'block'` only.
 */
export type WorkClassification = 'optional' | 'noncritical';

export function isWorkAllowed(classification: WorkClassification, decision: BudgetDecision): boolean {
  if (decision.tier === 'block') return false;
  if (classification === 'optional' && decision.tier === 'reduce') return false;
  return true;
}

/**
 * The `BudgetGate` port shape (`adapters/ports.ts`) — kept local so this module has no import on
 * `adapters/` beyond the type it is implementing structurally.
 */
export type BudgetGateResult = { readonly allowed: true } | { readonly allowed: false; readonly scope: 'global' };

/**
 * Builds a real `BudgetGate` (`adapters/ports.ts`) for a `WorkClassification` — the pre-dispatch
 * hook F04's `callProvider` stage 1 already calls (`adapters/wrapper.ts`: "Stage 1. Budget
 * pre-check. Before everything, because it is the only stage whose whole purpose is to prevent a
 * spend that cannot be undone once made."). This is F18 supplying the policy that hook calls —
 * F04's wrapper mechanics are untouched (F18 spec §2 Out).
 *
 * `estimatedCostUsd` is accepted for the port's shape but not added to `spentUsd` before
 * deciding — the tier reflects money already spent (`cost_event`), not a worst-case reservation,
 * matching `checkGlobalBudget`'s existing pre-dispatch semantics for the one other real gate in
 * this codebase.
 */
export function budgetGateFor(
  classification: WorkClassification,
  db: Queryable = getPool(),
): { check: (input: { estimatedCostUsd: string | null }) => Promise<BudgetGateResult> } {
  return {
    check: async () => {
      const decision = await getGlobalBudgetDecision(new Date(), db);
      if (isWorkAllowed(classification, decision)) return { allowed: true };
      return { allowed: false, scope: 'global' };
    },
  };
}
