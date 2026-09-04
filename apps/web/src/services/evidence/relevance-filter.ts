/**
 * `relevance.filter` — F10 §4.4. Judges *aboutness* for every item the deterministic candidacy
 * pass (`candidates.ts`) or the collision guard (`collision-guard.ts`) already confirmed
 * mentions the security. It never judges an item that does not even name the security — that
 * would spend a model call on something the lexicon already answered for free.
 */
import { z } from 'zod';
import type { SocialAxis } from '@/contracts/primitives';
import {
  classifyBatch,
  type BudgetGate,
  type ClassifyBatchOutcome,
  type ModelBackend,
} from './model-client';
import { RELEVANCE_FILTER_METHOD } from './method-registry';

export const RELEVANCE_FLAG = z.enum(['promotional', 'off_topic']);

export const relevanceRowSchema = z.object({
  itemId: z.string().min(1),
  relevant: z.boolean(),
  /** Diagnostics only — never displayed as a certainty figure (F10 §7 step 4). */
  rationale: z.string().max(200),
  /** Set only when `relevant` is `false` and one of these two caveats explains why. */
  flag: RELEVANCE_FLAG.nullable().optional(),
});
export type RelevanceRow = z.infer<typeof relevanceRowSchema>;

export type RelevanceCandidate = {
  readonly itemId: string;
  readonly text: string;
  readonly axis: SocialAxis;
};

function buildPrompt(
  candidates: readonly RelevanceCandidate[],
  context: { readonly symbol: string; readonly companyName: string },
  repair: boolean,
): { system: string; user: string } {
  const system =
    'You judge whether a short social/news snippet is genuinely ABOUT a specific security, not ' +
    'merely mentioning it. Promotional spam and off-topic list-mentions are not "about" the ' +
    'security even if the ticker or company name appears. You never judge sentiment or stance. ' +
    'Reply with a JSON array only, one object per item, each shaped exactly as: ' +
    '{"itemId": string, "relevant": boolean, "rationale": string (<=200 chars), ' +
    '"flag": "promotional" | "off_topic" | null}. No prose outside the array.';

  const repairSuffix = repair
    ? '\n\nYour previous reply was not a valid JSON array matching that exact shape. Reply again, JSON array only.'
    : '';

  const user =
    `Security: ${context.companyName} (${context.symbol}).\n\n` +
    'Items:\n' +
    candidates.map((c) => `- itemId=${c.itemId} axis=${c.axis}: ${c.text}`).join('\n') +
    repairSuffix;

  return { system, user };
}

/**
 * Empty input never calls the backend — nothing to judge, and no cost to record.
 */
export async function runRelevanceFilter(
  candidates: readonly RelevanceCandidate[],
  context: { readonly symbol: string; readonly companyName: string },
  deps: {
    readonly backend: ModelBackend;
    readonly model: string;
    readonly checkBudget: () => Promise<BudgetGate>;
  },
): Promise<ClassifyBatchOutcome<RelevanceRow>> {
  if (candidates.length === 0) {
    return { admitted: new Map(), rejected: new Map(), records: [] };
  }

  return classifyBatch({
    methodId: RELEVANCE_FILTER_METHOD.methodId,
    methodVersion: RELEVANCE_FILTER_METHOD.version,
    promptVersion: RELEVANCE_FILTER_METHOD.promptVersion,
    model: deps.model,
    backend: deps.backend,
    checkBudget: deps.checkBudget,
    buildPrompt: (repair) => buildPrompt(candidates, context, repair),
    rowSchema: relevanceRowSchema,
    rowKey: (row) => row.itemId,
    requestedIds: candidates.map((c) => c.itemId),
  });
}
