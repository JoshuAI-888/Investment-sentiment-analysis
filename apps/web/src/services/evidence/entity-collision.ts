/**
 * `entity.collision_guard` (D-21, F10 §4.2) — resolves the `AI` / `ON` / `IT` / `ALL` problem.
 *
 * **Only reached when the deterministic matcher (`matching.ts`) cannot resolve it itself** — a
 * bare ambiguous ticker token with no cashtag, company-name or alias corroborating it in the
 * same text (`DeterministicVerdict.corroborated === false`). Every other match — a cashtag, a
 * name hit, or a non-ambiguous symbol — never reaches this module at all, which is deliberate:
 * an LLM call is not spent where a lexical rule already has the answer.
 *
 * Same retry-once-then-drop discipline as `relevance.ts`. An unconfirmed or unclear collision is
 * excluded, never assumed confirmed — a false negative here costs a sample size; a false
 * positive costs Tier B's B1 gate.
 */
import { z } from 'zod';
import type { ModelCallMeta, ModelClient } from '../llm/ports';
import { llmMethod } from './method-registry';

export const collisionVerdictSchema = z.object({
  itemId: z.string().min(1),
  token: z.string().min(1),
  /** True only when the text's context genuinely refers to the security, not the common word. */
  confirmed: z.boolean(),
  corroboration: z.enum(['company_name', 'cashtag', 'context', 'none']),
  reason: z.string().max(200),
});
export type CollisionVerdict = z.infer<typeof collisionVerdictSchema>;

export type CollisionCallOutcome =
  | { readonly kind: 'ok'; readonly verdict: CollisionVerdict; readonly meta: ModelCallMeta }
  | { readonly kind: 'unclear'; readonly detail: string; readonly meta: ModelCallMeta };

const SYSTEM_PROMPT =
  'A ticker symbol also spells an ordinary English word or abbreviation. You judge, from ' +
  'context alone, whether an occurrence of that token genuinely refers to the named company\'s ' +
  'stock rather than the ordinary word. Respond with strict JSON only, matching the requested ' +
  'schema exactly. No prose outside the JSON object.';

export type CollisionInput = {
  readonly itemId: string;
  readonly token: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly text: string;
  readonly fixtureCase?: string;
};

function prompt(input: CollisionInput): string {
  return (
    `Ambiguous token: "${input.token}" — could be the stock ticker for ${input.symbol} ` +
    `(${input.companyName}), or the ordinary word/abbreviation.\n` +
    `Text:\n"""\n${input.text}\n"""\n\n` +
    'Respond with JSON: {"itemId": string, "token": string, "confirmed": boolean, ' +
    '"corroboration": "company_name" | "cashtag" | "context" | "none", "reason": string, at ' +
    'most 200 characters}.'
  );
}

export async function classifyCollision(
  input: CollisionInput,
  client: ModelClient,
): Promise<CollisionCallOutcome> {
  const method = llmMethod('entity_collision');
  const baseCase = input.fixtureCase ?? 'success';

  const first = await client.classify(
    {
      task: 'entity_collision',
      promptVersion: method.promptVersion,
      system: SYSTEM_PROMPT,
      prompt: prompt(input),
      maxOutputTokens: 200,
      fixtureCase: baseCase,
    },
    collisionVerdictSchema,
  );
  if (first.ok) return { kind: 'ok', verdict: first.data, meta: first.meta };
  if (first.error.kind !== 'schema_invalid') {
    return { kind: 'unclear', detail: `model call failed: ${first.error.kind}`, meta: first.meta };
  }

  const repaired = await client.classify(
    {
      task: 'entity_collision',
      promptVersion: method.promptVersion,
      system: SYSTEM_PROMPT,
      prompt:
        `${prompt(input)}\n\nYour previous response did not match the required JSON schema ` +
        `(${first.error.issues.join('; ')}). Respond again with ONLY the corrected JSON object.`,
      maxOutputTokens: 200,
      fixtureCase: `${baseCase}_repair`,
    },
    collisionVerdictSchema,
  );
  if (repaired.ok) return { kind: 'ok', verdict: repaired.data, meta: repaired.meta };
  return {
    kind: 'unclear',
    detail: 'schema-invalid twice; excluded rather than assumed confirmed',
    meta: repaired.meta,
  };
}
