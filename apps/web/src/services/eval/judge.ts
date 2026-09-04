/**
 * The LLM judge — F12 §4.3. Scores one already-produced answer against the four Tier C axes
 * (`01-PRODUCT-SPEC.md` §4): C1 direction, C2 groundedness, C3 restraint, C4 actionability.
 *
 * **Blind by construction.** `buildJudgePayload` is the one function that decides what the judge
 * ever sees, and it takes only an `answer` (the rendered prose the user would read — a plain
 * string, not a `SynthesisOutput` with claim ids and internal structure), the evidence *text*
 * (title/snippet, not the pack's methods/classification internals), and the stored metric values.
 * It has no parameter for a system prompt, a synthesis prompt version, or anything from
 * `services/research/prompts.ts` — there is nothing in this module's call graph that *could* leak
 * the synthesiser's prompt or reasoning, which is the strongest version of "blind" available
 * short of running the judge in a wholly separate process. `tests/eval/judge-blindness.test.ts`
 * asserts the exact payload shape has no such field.
 */
import { D } from '@/calc/decimal';
import type { EvidencePack } from '@/services/evidence';
import { judgeOutput, type JudgeOutput } from './schema';
import type { EvalModelClient, EvalModelInput } from './judge-model';

export const JUDGE_PROMPT_VERSION = 'judge-v1';

export function judgeSystemPrompt(): string {
  return (
    'You are an independent quality judge for a research answer about a publicly traded ' +
    'security. You did not write the answer and you have not seen how it was produced — you ' +
    'judge only what is given to you below: the answer text, the evidence it could have drawn ' +
    'on, and the stored metric values. Score each of the four axes 1 (worst) to 5 (best):\n' +
    '- C1 Direction: does the answer state the attention/price/stance directions the stored ' +
    'metrics actually show?\n' +
    '- C2 Groundedness: does each narrative claim follow from the cited evidence, judged ' +
    'against the evidence text only?\n' +
    '- C3 Restraint: does it avoid asserting causation, prediction, or confidence the data does ' +
    'not support?\n' +
    '- C4 Actionability: is "what to monitor next" specific, observable, and derived from this ' +
    "ticker's situation?\n" +
    'List any Tier-B violation you notice (a recommendation, a price target, certainty language, ' +
    'a number that does not match a stored metric, a claim with no citation) in `violations`. Be ' +
    'strict on C2 — an answer that reads well but overstates a thin evidence base is not a 5.'
  );
}

/** What a blind judge call is ever allowed to see. No prompt, no reasoning, no claim ids. */
export type JudgePayload = {
  readonly answerText: string;
  readonly evidenceText: readonly { readonly id: string; readonly text: string }[];
  readonly metrics: readonly { readonly metricId: string; readonly label: string; readonly display: string; readonly unit: string }[];
};

/** Renders a `SynthesisOutput`-shaped answer as the plain prose a user would actually read —
 * exactly what the deterministic checks already treat as the answer's text surface
 * (`services/research/deterministic-checks.ts#textFieldsOf`), reused in spirit but not imported
 * (that function is `research/`-internal, not exported — re-deriving the same small join here
 * keeps this module's blindness independent of research/'s internals staying exported). */
export function renderAnswerText(output: {
  readonly summary: string;
  readonly themes: readonly { readonly title: string; readonly claims: readonly { readonly text: string }[] }[];
  readonly bullishCase: readonly { readonly text: string }[];
  readonly bearishCase: readonly { readonly text: string }[];
  readonly whatChanged: readonly { readonly text: string }[];
  readonly whatToMonitor: readonly { readonly text: string }[];
}): string {
  const sections: string[] = [output.summary];
  for (const theme of output.themes) {
    sections.push(`${theme.title}: ${theme.claims.map((c) => c.text).join(' ')}`);
  }
  if (output.bullishCase.length > 0) sections.push(`Bullish case: ${output.bullishCase.map((c) => c.text).join(' ')}`);
  if (output.bearishCase.length > 0) sections.push(`Bearish case: ${output.bearishCase.map((c) => c.text).join(' ')}`);
  if (output.whatChanged.length > 0) sections.push(`What changed: ${output.whatChanged.map((c) => c.text).join(' ')}`);
  if (output.whatToMonitor.length > 0) sections.push(`What to monitor: ${output.whatToMonitor.map((c) => c.text).join(' ')}`);
  return sections.join('\n\n');
}

export function buildJudgePayload(input: {
  readonly answerText: string;
  readonly pack: EvidencePack;
  readonly metrics: readonly { readonly metricId: string; readonly label: string; readonly display: string; readonly unit: string }[];
}): JudgePayload {
  return {
    answerText: input.answerText,
    evidenceText: input.pack.items.map((item) => ({
      id: item.stableId,
      text: item.item.snippet === null ? item.item.title : `${item.item.title}\n${item.item.snippet}`,
    })),
    metrics: input.metrics.map((m) => ({ metricId: m.metricId, label: m.label, display: m.display, unit: m.unit })),
  };
}

export type JudgeCallResult =
  | { readonly ok: true; readonly output: JudgeOutput; readonly modelId: string }
  | { readonly ok: false; readonly detail: string };

export async function runJudge(
  payload: JudgePayload,
  client: EvalModelClient,
  maxOutputTokens = 1500,
  /** Fixture-mode case selection, mirrors `services/research/model-tasks.ts`'s identical
   * parameter — in fixture mode each corpus item picks its own recorded response by id. */
  fixtureCase?: string,
): Promise<JudgeCallResult> {
  // `exactOptionalPropertyTypes`: only include the key when a case was actually given, rather
  // than assigning `fixtureCase: undefined` — the two are different things under this tsconfig.
  const input: EvalModelInput = {
    task: 'judge',
    promptVersion: JUDGE_PROMPT_VERSION,
    system: judgeSystemPrompt(),
    prompt: JSON.stringify(payload),
    maxOutputTokens,
    ...(fixtureCase !== undefined ? { fixtureCase } : {}),
  };
  const result = await client.run(input, judgeOutput);
  if (!result.ok) {
    return { ok: false, detail: `${result.error.kind}: ${JSON.stringify(result.error)}` };
  }
  return { ok: true, output: result.data, modelId: result.meta.modelId };
}

/** F12 §4.3: "mean ≥ 4.0" — the arithmetic average of one answer's four axis scores. Decimal, not
 * float, per `CLAUDE.md`'s "analytics modules ... use decimals, never floats" — this is a scoring
 * computation over a fixed small corpus rather than a `calc/`/`analytics/`-layer metric (so the
 * `no-float-in-analytics` lint rule does not govern this file at all — see `layers.ts`), but the
 * underlying reasoning (IEEE 754 rounding invisible in review) applies just as much to a gate a
 * PR can be blocked on, so this module holds the same discipline anyway rather than leaning on
 * the lint boundary to justify not doing so.
 */
export function meanScore(output: Pick<JudgeOutput, 'c1' | 'c2' | 'c3' | 'c4'>): string {
  return new D(output.c1).plus(output.c2).plus(output.c3).plus(output.c4).dividedBy(4).toFixed(4);
}
