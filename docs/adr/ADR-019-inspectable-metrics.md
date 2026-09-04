# ADR-019 — Every deterministic metric is inspectable and replayable

**Status:** Accepted, **amended by F-07** — artifact granularity is defined and binding on F05.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Every displayed calculated value links to an immutable Calculation Inspector showing the
versioned formula, actual normalized and provider inputs, transformations, intermediate steps,
full precision, displayed rounding, provenance, assumptions and result hash.

Authenticated users may view rights-sanitized provider payloads, persist bounded assumption
overrides, reset to official defaults, create explicitly shared scenario snapshots, and report
issues. **User scenarios never overwrite official snapshots or source data.**

## Amendment (F-07) — the granularity rule

The original DoD promised an artifact for "every rendered deterministic metric **and historical
chart point**". That does not fit the infrastructure, and the arithmetic is not close:

100 symbols × 180 sessions = 18,000 artifacts for **one** series. At ~4 inputs and ~6 steps per
point and ~150 bytes/row, that is ~30 MB for one series before indexes — and the same was
promised for attention, sentiment aggregates, composites, technicals, valuation and even cost
and freshness outputs. Ten such series exhausts the tier. Write volume is the worse half:
materialising per-point artifacts on every refresh is a sustained insert load on a scale-to-zero
database.

**Ruling, binding on F05:**

- **The unit of an artifact is a computation invocation, not a rendered pixel.** A 180-point
  return series is **one** artifact, whose inputs are the price-series reference and whose steps
  describe the vectorised transform, with a per-point derivation table.
- A chart point links to `{calculation_id, point_index}`; the Inspector resolves the point from
  the artifact. This satisfies "every chart point is inspectable" **without** an artifact per
  point.
- Artifacts carry the same 90-day retention as normalized data, **plus permanent retention** for
  any artifact referenced by a claim-ledger entry, a share grant, or an open issue.
- F05's DoD includes a **measured storage projection at 100 symbols**. If it exceeds 300 MB, the
  granularity rule is revisited before Wave 2 starts.

D-33's move to Neon Launch relieves the pressure that produced this ruling but does not repeal
it: the write-volume argument is independent of the storage tier.

## Interaction with the corpus

Product invariant §6.8 retains the **normalized social corpus and its derived scores
indefinitely** — they are the asset. The 90-day retention above applies to raw provider payloads
and superseded artifacts, not to the corpus.

## Consequences

- Artifacts are **never recomputed in place**. Fresh data creates a successor (§6.2), and
  re-scoring writes a successor too (F20 §4.4).
