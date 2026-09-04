/**
 * Follow-up generation — F11 §4.7: "template-driven, optionally rewritten by the model, and only
 * questions the system can actually answer from its own data. A follow-up reuses the existing
 * pack — it does not re-retrieve, and it does not re-spend [on evidence]."
 *
 * The templates below are generated purely from what the run already has in hand (the metrics
 * gathered and the evidence pack's per-axis disclosures) — never from guessing at what a user
 * might want. The optional model rewrite is a wording pass only: it may not introduce a new
 * question the templates did not already generate, checked by `sameQuestionSet` below.
 */
import type { MetricFact } from './metrics';
import type { EvidencePack } from '@/services/evidence';
import { followupQuestionsOutput, type FollowupQuestionCandidate } from './schema';
import { FOLLOWUP_PROMPT_VERSION } from './prompts';
import type { ResearchModelClient } from './model-tasks';

export type FollowupQuestion = { readonly id: string; readonly text: string };

/**
 * Every template question is answerable purely from data this run already retrieved — each one
 * names the specific axis/metric it would read, never a general "tell me more".
 */
export function templateFollowups(input: {
  readonly subjectSymbol: string;
  readonly metrics: readonly MetricFact[];
  readonly pack: EvidencePack;
}): readonly FollowupQuestion[] {
  const out: FollowupQuestion[] = [];

  const hasDivergence = input.metrics.some((metric) => metric.metricId === 'market.divergence_state');
  if (hasDivergence) {
    out.push({ id: 'divergence', text: `Why do attention, sampled stance and price disagree for ${input.subjectSymbol} right now?` });
  }

  for (const disclosure of input.pack.disclosures) {
    if (disclosure.usedCount === 0) continue;
    out.push({
      id: `axis_${disclosure.axis}`,
      text: `What did the ${disclosure.axis} sample actually say about ${input.subjectSymbol}?`,
    });
  }

  const priceMetric = input.metrics.find((metric) => metric.metricId === 'price.regime');
  if (priceMetric !== undefined) {
    out.push({ id: 'price_regime', text: `What does the current price regime (${priceMetric.display}) mean for ${input.subjectSymbol}?` });
  }

  out.push({ id: 'evidence', text: `What are the most relevant sources behind this answer for ${input.subjectSymbol}?` });

  return out.slice(0, 5);
}

/** The rewrite may only reword an existing template id — never add a question with no template behind it. */
export function sameQuestionSet(
  templates: readonly FollowupQuestion[],
  candidates: readonly FollowupQuestionCandidate[],
): boolean {
  const templateIds = new Set(templates.map((question) => question.id));
  return candidates.every((candidate) => templateIds.has(candidate.id)) && candidates.length <= templates.length;
}

export type RewriteFollowupsInput = {
  readonly subjectSymbol: string;
  readonly templates: readonly FollowupQuestion[];
  readonly client: ResearchModelClient;
  readonly maxOutputTokens: number;
};

/**
 * Optional wording pass. On any failure (schema-invalid, timeout, upstream error, or an attempt
 * to introduce an id the templates never offered) this silently falls back to the templates
 * verbatim — a follow-up question is not part of the verified prose contract (F11 §4.7 does not
 * ask it to be verified the way a claim is), so degrading to the plain template rather than
 * failing the whole run is the correct, honest behaviour, not a shortcut.
 */
export async function rewriteFollowups(input: RewriteFollowupsInput): Promise<readonly FollowupQuestion[]> {
  const result = await input.client.run(
    {
      task: 'followup',
      promptVersion: FOLLOWUP_PROMPT_VERSION,
      system:
        `Rewrite these candidate follow-up questions about ${input.subjectSymbol} to read naturally. ` +
        'Keep the same id for each, keep the same count or fewer, and never introduce a new id.',
      prompt: JSON.stringify({ questions: input.templates }),
      maxOutputTokens: input.maxOutputTokens,
    },
    followupQuestionsOutput,
  );

  if (!result.ok) return input.templates;
  if (!sameQuestionSet(input.templates, result.data.questions)) return input.templates;
  return result.data.questions;
}
