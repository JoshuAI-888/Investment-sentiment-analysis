/**
 * F11's own method registry, mirroring `services/evidence/method-registry.ts`'s exact reasoning:
 * `calc/`'s numeric-only `analytics/registry.ts` (F05 §4.4) cannot describe an LLM call, so this
 * is the same idea — one place naming a method's id, version, task and limitations — cut down to
 * what F11's two LLM calls actually have. Not wired into the Inspector/Architecture Explorer
 * (SURFACE-owned surfaces) — follow-on integration work, same disclosed gap F10's own registry
 * already recorded for its two methods.
 */
import { SYNTHESIS_PROMPT_VERSION, VERIFY_PROMPT_VERSION, FOLLOWUP_PROMPT_VERSION } from './prompts';
import type { ResearchModelTask } from './model-tasks';

export type ResearchMethodDescriptor = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly task: ResearchModelTask;
  readonly promptVersion: string;
  readonly limitations: readonly string[];
};

export const RESEARCH_METHODS: readonly ResearchMethodDescriptor[] = [
  {
    id: 'research.synthesis',
    version: '1.0.0',
    title: 'Research synthesis',
    task: 'synthesis',
    promptVersion: SYNTHESIS_PROMPT_VERSION,
    limitations: [
      'Never computes a stance number — every number it cites is copied verbatim from an ' +
        'already-computed F06 metric (D-13).',
      'Cannot publish unless every deterministic check and the bounded model-verification pass ' +
        'both pass (F11 §4.5) — a schema-valid draft is not the same as a verified answer.',
    ],
  },
  {
    id: 'research.followup',
    version: '1.0.0',
    title: 'Follow-up answer synthesis',
    task: 'followup',
    promptVersion: FOLLOWUP_PROMPT_VERSION,
    limitations: [
      'Reuses the run\'s existing evidence pack and metrics only — never re-retrieves and never ' +
        'spends a second evidence-classification pass (F11 §4.7).',
      'Subject to the identical verification gate as the initial synthesis.',
    ],
  },
  {
    id: 'research.verify',
    version: '1.0.0',
    title: 'Bounded model verification pass',
    task: 'verify',
    promptVersion: VERIFY_PROMPT_VERSION,
    limitations: [
      'Runs on a different vendor from synthesis (D-34) — checked at runtime, not merely by ' +
        'convention (see `model-tasks.ts#assertDifferentVendors`).',
      'Judges only whether a citation supports its claim — the deterministic checks, not this ' +
        'pass, carry the load for everything code can check on its own (F11 §4.5, §8).',
      'A timeout or schema-invalid response here withholds the run\'s prose entirely; it is ' +
        'never treated as an implicit pass.',
    ],
  },
];

export function researchMethod(task: ResearchModelTask): ResearchMethodDescriptor {
  const entry = RESEARCH_METHODS.find((method) => method.task === task);
  if (entry === undefined) throw new Error(`no research method registered for task '${task}'`);
  return entry;
}
