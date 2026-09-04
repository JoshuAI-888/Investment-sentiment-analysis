/**
 * `relevance.filter` (D-21) — the LLM judges aboutness, never sentiment or stance (D-13). Tier
 * B's B1 ≥ 0.95 precision gate is why this exists at all: the deterministic matcher
 * (`matching.ts`) tells you a symbol or name appeared in the text, not that the text is actually
 * about the company — "Apple's new orchard" and "Apple's new iPhone" both match the string
 * `Apple`.
 *
 * **Retry-once-then-drop, kept from the superseded single-call design (F10 §4.4).** A response
 * that fails the strict schema is retried exactly once with a repair instruction; a second
 * failure drops the item to `unclear` — excluded from the pack, never coerced into a verdict.
 */
import { z } from 'zod';
import type { ModelCallMeta, ModelClient } from '../llm/ports';
import { llmMethod } from './method-registry';

export const relevanceVerdictSchema = z.object({
  itemId: z.string().min(1),
  relevant: z.boolean(),
  /** Continuous, 0–1 — `calc/methods/social-stance.ts` and `news-sentiment.ts` weight on this. */
  relevanceScore: z.number().min(0).max(1),
  reason: z.string().max(200),
});
export type RelevanceVerdict = z.infer<typeof relevanceVerdictSchema>;

export type RelevanceCallOutcome =
  | { readonly kind: 'ok'; readonly verdict: RelevanceVerdict; readonly meta: ModelCallMeta }
  | { readonly kind: 'unclear'; readonly detail: string; readonly meta: ModelCallMeta };

const SYSTEM_PROMPT =
  'You judge whether a short piece of text is genuinely about a specific publicly traded ' +
  'security — aboutness, not sentiment or opinion. Respond with strict JSON only, matching the ' +
  'requested schema exactly. No prose outside the JSON object.';

export type RelevanceInput = {
  readonly itemId: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly text: string;
  /** Fixture-mode case selection (`services/llm/model-client.ts`). Ignored in live mode. */
  readonly fixtureCase?: string;
};

function prompt(input: RelevanceInput): string {
  return (
    `Security: ${input.symbol} (${input.companyName})\n` +
    `Text:\n"""\n${input.text}\n"""\n\n` +
    'Respond with JSON: {"itemId": string, "relevant": boolean, "relevanceScore": number ' +
    '0..1, "reason": string, at most 200 characters}.'
  );
}

export async function classifyRelevance(
  input: RelevanceInput,
  client: ModelClient,
): Promise<RelevanceCallOutcome> {
  const method = llmMethod('relevance');
  const baseCase = input.fixtureCase ?? 'success';

  const first = await client.classify(
    {
      task: 'relevance',
      promptVersion: method.promptVersion,
      system: SYSTEM_PROMPT,
      prompt: prompt(input),
      maxOutputTokens: 200,
      fixtureCase: baseCase,
    },
    relevanceVerdictSchema,
  );
  if (first.ok) return { kind: 'ok', verdict: first.data, meta: first.meta };
  if (first.error.kind !== 'schema_invalid') {
    return { kind: 'unclear', detail: `model call failed: ${first.error.kind}`, meta: first.meta };
  }

  const repaired = await client.classify(
    {
      task: 'relevance',
      promptVersion: method.promptVersion,
      system: SYSTEM_PROMPT,
      prompt:
        `${prompt(input)}\n\nYour previous response did not match the required JSON schema ` +
        `(${first.error.issues.join('; ')}). Respond again with ONLY the corrected JSON object.`,
      maxOutputTokens: 200,
      fixtureCase: `${baseCase}_repair`,
    },
    relevanceVerdictSchema,
  );
  if (repaired.ok) return { kind: 'ok', verdict: repaired.data, meta: repaired.meta };
  return {
    kind: 'unclear',
    detail: 'schema-invalid twice; excluded rather than coerced into a relevance verdict',
    meta: repaired.meta,
  };
}
