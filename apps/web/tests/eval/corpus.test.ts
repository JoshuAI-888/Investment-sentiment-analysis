/**
 * F12 §5 test plan, "Integration": "full harness against the frozen corpus." Loads every
 * committed pack and validates it against F10's real `EvidencePack` shape and this feature's own
 * label schema — the thing PR review step 5 ("confirm the corpus is frozen") depends on actually
 * existing as a check, not just a promise in the docs.
 */
import { describe, expect, it } from 'vitest';
import { loadCorpus, loadSeededErrorCorpus } from '@/services/eval';

describe('F12 corpus — frozen fixtures', () => {
  it('loads at least 30 packs, all five buckets represented at their minimum count', async () => {
    const packs = await loadCorpus();
    expect(packs.length).toBeGreaterThanOrEqual(30);

    const counts = new Map<string, number>();
    for (const pack of packs) counts.set(pack.meta.bucket, (counts.get(pack.meta.bucket) ?? 0) + 1);

    expect(counts.get('clear_stance') ?? 0).toBeGreaterThanOrEqual(10);
    expect(counts.get('sarcasm_ambiguity') ?? 0).toBeGreaterThanOrEqual(5);
    expect(counts.get('ticker_collision') ?? 0).toBeGreaterThanOrEqual(5);
    expect(counts.get('conflicting_source') ?? 0).toBeGreaterThanOrEqual(5);
    expect(counts.get('thin_evidence') ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('every pack discloses labelSource honestly, per D-35\'s pattern', async () => {
    const packs = await loadCorpus();
    for (const pack of packs) {
      expect(pack.meta.labelSource).toBe('llm_assisted_pending_human_audit');
    }
  });

  it('every pack carries exactly the three axis disclosures, in order (D-14)', async () => {
    const packs = await loadCorpus();
    for (const pack of packs) {
      expect(pack.pack.disclosures.map((d) => d.axis)).toEqual(['reddit', 'x', 'substack']);
    }
  });

  it('the thin-evidence bucket is labelled expectedAbstain, and only that bucket is', async () => {
    const packs = await loadCorpus();
    for (const pack of packs) {
      expect(pack.meta.labels.expectedAbstain).toBe(pack.meta.bucket === 'thin_evidence');
    }
  });

  it('the ticker-collision bucket excludes at least one item as an unconfirmed collision', async () => {
    const packs = await loadCorpus();
    const collisionPacks = packs.filter((p) => p.meta.bucket === 'ticker_collision');
    expect(collisionPacks.length).toBeGreaterThanOrEqual(5);
    for (const pack of collisionPacks) {
      expect(pack.pack.excluded.some((e) => e.reason === 'ticker_collision_unconfirmed')).toBe(true);
    }
  });

  it('loads at least 40 seeded-error answers across all nine fault classes', async () => {
    const answers = await loadSeededErrorCorpus();
    expect(answers.length).toBeGreaterThanOrEqual(40);

    const classes = new Set(answers.map((a) => a.meta.faultClass));
    expect(classes).toEqual(
      new Set([
        'wrong_number',
        'swapped_ticker',
        'unsupported_causal_claim',
        'stale_date',
        'buy_recommendation',
        'price_target',
        'citation_unrelated_evidence',
        'stance_on_thin_sample',
        'fabricated_evidence_id',
      ]),
    );
  });

  it('every seeded-error answer references a pack that actually exists in the corpus', async () => {
    const [answers, packs] = await Promise.all([loadSeededErrorCorpus(), loadCorpus()]);
    const packIds = new Set(packs.map((p) => p.meta.id));
    for (const answer of answers) {
      expect(packIds.has(answer.meta.packId)).toBe(true);
    }
  });

  it("every seeded-error answer's faulty claim is actually present in its output", async () => {
    const answers = await loadSeededErrorCorpus();
    for (const answer of answers) {
      const claimIds = answer.output.themes.flatMap((t) => t.claims.map((c) => c.claimId));
      expect(claimIds).toContain(answer.meta.faultyClaimId);
      for (const cleanId of answer.meta.cleanClaimIds) expect(claimIds).toContain(cleanId);
    }
  });
});
