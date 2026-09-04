/**
 * F10's own method registry for the two LLM methods D-21 permits in v1 — `relevance.filter` and
 * `entity.collision_guard`. *"Registered as `MethodRegistry` entries with their own versions, so
 * the Inspector shows which method produced which field."*
 *
 * **This is deliberately not `analytics/registry.ts`.** That registry (F05 §4.4) is SPINE-owned,
 * numeric-only data — `symbolicFormula`, `roundingRule`, `workingPrecision` — for methods that
 * live in `calc/` and never do I/O. An LLM classify call cannot be one of those (it is I/O by
 * definition, and `calc`/`analytics` may import none), so it cannot be registered there without
 * either violating that boundary or contorting a numeric-shaped descriptor to fit a boolean
 * verdict it was never designed for. This module is the same *idea* — one place naming a
 * method's id, version and what it does, so a result can always say which one produced it — cut
 * down to what a classify call actually has: no formula, no rounding rule, a prompt version
 * instead of a working precision.
 *
 * **What this does not do.** It is not wired into the Inspector (`ui/CalculationInspector.tsx`)
 * or the Architecture Explorer — both are SURFACE-owned surfaces, and neither reads this file
 * today. Making them do so is follow-on integration work for whichever lane owns that surface
 * next; this module exists so that work has a well-defined source to read from, and so every
 * `ClassifiedItem` this feature produces already carries the `methodId`/`methodVersion` pair
 * that integration would need. Reported as a follow-up, not a defect: this feature's own DoD
 * only asks that "model/route/prompt version and cost" be *recorded per call*, which every
 * `ModelCallMeta` already does independent of whether a UI reads it yet.
 */

export type LlmMethodDescriptor = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  /** Matches `services/llm/ports.ts`'s `ModelTask` — the two are kept in lockstep by the tests. */
  readonly task: 'relevance' | 'entity_collision';
  readonly promptVersion: string;
  readonly limitations: readonly string[];
};

export const LLM_METHODS: readonly LlmMethodDescriptor[] = [
  {
    id: 'relevance.filter',
    version: '1.0.0',
    title: 'LLM relevance filter',
    task: 'relevance',
    promptVersion: 'relevance-v1',
    limitations: [
      'Judges aboutness only — never sentiment or stance (D-13). A relevant item carries no ' +
        'implication about direction.',
      'Deferred (D-21): sarcasm/irony is not modelled here and does not change a relevance ' +
        'verdict — a sarcastic post that is genuinely about the security is still relevant.',
      'A schema-invalid response is retried once with a repair instruction, then the item is ' +
        'excluded as unclear — never included by default.',
    ],
  },
  {
    id: 'entity.collision_guard',
    version: '1.0.0',
    title: 'Ticker-collision disambiguation guard',
    task: 'entity_collision',
    promptVersion: 'collision-v1',
    limitations: [
      'Only reached for a bare ambiguous-ticker token (`AI`/`ON`/`IT`/`ALL`, F10 §4.2) with no ' +
        'deterministic corroboration in the same text — every other match is decided without an ' +
        'LLM call at all.',
      'A schema-invalid response is retried once with a repair instruction, then the item is ' +
        'excluded as unclear — an unconfirmed collision is never assumed confirmed.',
    ],
  },
];

export function llmMethod(task: LlmMethodDescriptor['task']): LlmMethodDescriptor {
  const entry = LLM_METHODS.find((method) => method.task === task);
  if (entry === undefined) throw new Error(`no LLM method registered for task '${task}'`);
  return entry;
}
