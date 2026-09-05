/**
 * F11 §4.7 — follow-ups.
 *
 * "Template-driven, optionally rewritten by the model, and only questions the system can
 * actually answer from its own data. A follow-up reuses the existing pack — it does not
 * re-retrieve, and it does not re-spend."
 *
 * The templates below are the only source of *what* is asked; the model, when used, may only
 * reword a template's output, never invent a new question — which is the structural form of
 * "only questions the system can actually answer": every template is built from data already in
 * hand (the pack and the synthesis output), so there is no question this function can produce
 * that requires a new fetch to answer.
 */
import { z } from 'zod';
import type { SocialAxis } from '@/contracts/primitives';
import type { EvidencePack } from '@/contracts/evidence-pack';
import type { SynthesisOutput } from './synthesis';
import type { ModelClient } from './ports';

export type FollowupTemplate = {
  id: string;
  question: string;
};

const AXIS_LABEL: Record<SocialAxis, string> = {
  reddit: 'Reddit',
  x: 'X',
  substack: 'Substack',
};

/**
 * Pure and synchronous — no model, no I/O — so "does not re-retrieve, does not re-spend" is
 * true by construction for the templated path, with or without the optional rewrite step below.
 */
export function templateFollowups(pack: EvidencePack, output: SynthesisOutput): readonly FollowupTemplate[] {
  const templates: FollowupTemplate[] = [];

  if (output.whatChanged.length > 0) {
    templates.push({ id: 'what_changed_detail', question: 'What specifically changed, and when?' });
  }
  if (output.whatToMonitor.length > 0) {
    templates.push({ id: 'what_to_monitor_detail', question: 'What should I watch for next?' });
  }
  for (const frame of pack.frames) {
    templates.push({
      id: `axis_detail_${frame.axis}`,
      question: `What does the ${AXIS_LABEL[frame.axis]} sample specifically say?`,
    });
  }
  if (output.themes.some((theme) => theme.singleSource)) {
    templates.push({
      id: 'single_source_caveat',
      question: 'Which parts of this answer rest on only one source?',
    });
  }

  return templates;
}

export const followupRewrite = z.object({
  rewritten: z.array(z.object({ id: z.string().min(1), question: z.string().min(1) })),
});
export type FollowupRewrite = z.infer<typeof followupRewrite>;

/**
 * Optional cosmetic pass: the model may only reword each template's `question` text, keyed by
 * the same `id` list it was given — it is never asked to produce new `id`s, so a rewrite that
 * hallucinates a new question is filtered out below rather than trusted.
 */
export async function rewriteFollowups(
  model: ModelClient,
  templates: readonly FollowupTemplate[],
): Promise<readonly FollowupTemplate[]> {
  if (templates.length === 0) return templates;

  const prompt = [
    'Reword each question below to read naturally, without changing what it asks or adding new questions.',
    'Return exactly one rewritten entry per id below, and no other ids.',
    ...templates.map((template) => `${template.id}: ${template.question}`),
  ].join('\n');

  try {
    const rewrite = await model.synthesize('followup', { prompt, context: {} }, followupRewrite);
    const rewrittenById = new Map(rewrite.rewritten.map((entry) => [entry.id, entry.question]));
    return templates.map((template) => ({
      id: template.id,
      question: rewrittenById.get(template.id) ?? template.question,
    }));
  } catch {
    // A rewrite failure is cosmetic — the templated question is already a fully valid answer,
    // so this falls back to it silently rather than failing the whole run over prose polish.
    return templates;
  }
}
