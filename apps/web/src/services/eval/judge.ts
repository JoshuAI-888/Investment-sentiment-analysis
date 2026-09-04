/**
 * The LLM judge (F12 §4.3). A different model from the synthesiser, on its own task route,
 * temperature 0, blind to the synthesiser's prompt or reasoning.
 *
 * **Why this is a port, not an adapter call.** F11's `ModelClient` (`02-ARCHITECTURE-CONTRACTS.md`
 * §4.6) is not merged yet — `src/agent/` does not exist in this tree — and this lane does not own
 * `src/services/research/` or any adapter wiring. `JudgeModelClient` below is the seam: whatever
 * calls the real judge model in production implements this interface, and every test here drives
 * it with a fixture. See the lane report's CONTRACTS/DEFERRED fields for what a real
 * implementation needs from F11 once it merges.
 *
 * **Blindness is enforced by construction, not by convention.** `buildJudgeInput` takes only an
 * answer string, an evidence-pack's items, and stored metric values — there is no
 * `synthesisPrompt` parameter anywhere in this file's signatures for a caller to accidentally
 * thread through. `tests/unit/services/eval/judge-blind.test.ts` asserts this by construction:
 * it plants a canary in every field this module actually reads and confirms it surfaces only
 * where it should, and plants one in every field it does *not* read (`metadata`, `sourceUrl`,
 * `publisher`, `authorRef`) and confirms it never appears at all.
 *
 * **Review finding (lane-review round 1).** The evidence the judge saw used to be bare title +
 * snippet strings, with no id and no date. That made two of `05-TEST-STRATEGY.md` §5.2's nine
 * fault classes structurally undetectable: `fabricated_evidence_id` (there was no set of real
 * ids to check a citation against) and `stale_date` (there was no date to compare a freshness
 * claim to). `JudgeEvidenceItem` (`contracts.ts`) now carries `id`, `publishedAt` and
 * `availableAt` alongside the text, so both are checkable in principle from the input the judge
 * actually receives.
 */
import type { ClassifiedItem } from '@/contracts/evidence-pack';
import { judgeInput, judgeResponse, type JudgeInput, type JudgeResponse, type StoredMetricValue } from './contracts';

export type JudgeModelClient = {
  /** Temperature 0 is the client's own contract, not this function's — see `02-ARCHITECTURE-CONTRACTS.md` §4.6. */
  judge(input: JudgeInput): Promise<unknown>;
};

/**
 * The evidence text the judge is allowed to see: item titles and snippets, as retrieved — never
 * the retrieval query, the frame disclosures, or anything that looks like the pipeline's own
 * reasoning about the evidence. `item.snippet` can be `null` (F10's shape allows it); an item
 * with no snippet contributes its title only rather than a literal "null" string.
 */
function evidenceItemText(item: ClassifiedItem): string {
  const parts = [item.item.title, item.item.snippet].filter(
    (part): part is string => part !== null && part.length > 0,
  );
  return parts.join(' — ');
}

/**
 * Builds exactly what F12 §4.3 allows the judge to see. There is no code path from a
 * synthesiser's prompt or chain-of-thought into this object — the function's parameter list is
 * the enforcement, and only `id`, text, and the two dates are read off each item; `sourceUrl`,
 * `publisher`, `authorRef`, `rawHash` and `metadata` never enter it.
 */
export function buildJudgeInput(input: {
  answerText: string;
  items: readonly ClassifiedItem[];
  storedMetrics: readonly StoredMetricValue[];
}): JudgeInput {
  return judgeInput.parse({
    answerText: input.answerText,
    evidence: input.items.map((classifiedItem) => ({
      id: classifiedItem.item.id,
      text: evidenceItemText(classifiedItem),
      publishedAt: classifiedItem.item.publishedAt,
      availableAt: classifiedItem.item.availableAt,
    })),
    storedMetrics: input.storedMetrics,
  });
}

/**
 * Calls the judge client and validates its response against the strict schema (F12 §4.3). A
 * malformed judge response is a contract failure, not a score — it throws rather than coercing
 * a partial or shape-invalid answer into something `evaluateTierCGate` could silently misread.
 */
export async function runJudge(client: JudgeModelClient, input: JudgeInput): Promise<JudgeResponse> {
  const raw = await client.judge(input);
  const parsed = judgeResponse.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `runJudge: judge response failed its schema — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

/** The adversarial-validation floor (F12 §4.2 / §4.3): a seeded-error answer must never pass as well-grounded. */
export const ADVERSARIAL_C2_CEILING = 4;

export type AdversarialResult = {
  answerId: string;
  faultClass: string;
  c2: number;
};

export type AdversarialVerdict = {
  passed: boolean;
  offenders: AdversarialResult[];
};

/**
 * "A judge scoring a seeded-error answer ≥ 4 on groundedness is itself a defect and fails the
 * harness" (F12 §4.2). This is the check that makes that true mechanically rather than by
 * someone remembering to look.
 */
export function checkAdversarialValidation(
  scored: readonly { answerId: string; faultClass: string; response: JudgeResponse }[],
): AdversarialVerdict {
  const offenders = scored
    .filter((entry) => entry.response.c2 >= ADVERSARIAL_C2_CEILING)
    .map((entry) => ({ answerId: entry.answerId, faultClass: entry.faultClass, c2: entry.response.c2 }));

  return { passed: offenders.length === 0, offenders };
}
