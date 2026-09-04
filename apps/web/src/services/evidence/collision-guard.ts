/**
 * `entity.collision_guard` — F10 §4.4. Runs only on items `candidates.ts` already found to
 * contain one of the four ambiguous tokens (`AI`, `ON`, `IT`, `ALL`) **and** a corroborating
 * company-name/alias/cashtag reference somewhere in the same text. Corroboration is necessary to
 * reach this method but not sufficient to skip it — a company name and the word "AI" can both
 * appear in one post about something else entirely, which is exactly the semantic judgment a
 * lexicon cannot make (F10 §4.4).
 */
import { z } from 'zod';
import type { AmbiguousToken } from './candidates';
import {
  classifyBatch,
  type BudgetGate,
  type ClassifyBatchOutcome,
  type ModelBackend,
} from './model-client';
import { COLLISION_GUARD_METHOD } from './method-registry';

export const collisionGuardRowSchema = z.object({
  itemId: z.string().min(1),
  /** `true` only when the ambiguous token genuinely refers to the security in this text. */
  aboutSecurity: z.boolean(),
  rationale: z.string().max(200),
});
export type CollisionGuardRow = z.infer<typeof collisionGuardRowSchema>;

export type CollisionCandidate = {
  readonly itemId: string;
  readonly text: string;
  readonly token: AmbiguousToken;
};

function buildPrompt(
  candidates: readonly CollisionCandidate[],
  context: { readonly symbol: string; readonly companyName: string },
  repair: boolean,
): { system: string; user: string } {
  const system =
    `You resolve ticker-collision ambiguity. The security's ticker symbol, "${context.symbol}", ` +
    'is also an ordinary English word. Each item below contains that word in all-caps AND some ' +
    "text that could be the company's name — decide whether the all-caps token genuinely refers " +
    'to the security in context, or whether the word and the company-name-like text are ' +
    'unrelated coincidences in the same post. You never judge sentiment or stance. Reply with a ' +
    'JSON array only, one object per item, shaped exactly as: {"itemId": string, ' +
    '"aboutSecurity": boolean, "rationale": string (<=200 chars)}. No prose outside the array.';

  const repairSuffix = repair
    ? '\n\nYour previous reply was not a valid JSON array matching that exact shape. Reply again, JSON array only.'
    : '';

  const user =
    `Security: ${context.companyName} (${context.symbol}).\n\n` +
    'Items:\n' +
    candidates.map((c) => `- itemId=${c.itemId} token="${c.token}": ${c.text}`).join('\n') +
    repairSuffix;

  return { system, user };
}

export async function runCollisionGuard(
  candidates: readonly CollisionCandidate[],
  context: { readonly symbol: string; readonly companyName: string },
  deps: {
    readonly backend: ModelBackend;
    readonly model: string;
    readonly checkBudget: () => Promise<BudgetGate>;
  },
): Promise<ClassifyBatchOutcome<CollisionGuardRow>> {
  if (candidates.length === 0) {
    return { admitted: new Map(), rejected: new Map(), records: [] };
  }

  return classifyBatch({
    methodId: COLLISION_GUARD_METHOD.methodId,
    methodVersion: COLLISION_GUARD_METHOD.version,
    promptVersion: COLLISION_GUARD_METHOD.promptVersion,
    model: deps.model,
    backend: deps.backend,
    checkBudget: deps.checkBudget,
    buildPrompt: (repair) => buildPrompt(candidates, context, repair),
    rowSchema: collisionGuardRowSchema,
    rowKey: (row) => row.itemId,
    requestedIds: candidates.map((c) => c.itemId),
  });
}
