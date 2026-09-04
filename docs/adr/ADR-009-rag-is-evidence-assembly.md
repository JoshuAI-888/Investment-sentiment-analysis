# ADR-009 — RAG is evidence assembly before it is vector search

**Status:** Accepted, unamended.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Use a small, normalized evidence pack selected by SQL and deterministic filters. **Do not add a
vector database** unless basic delivery is complete. Production may later add pgvector or a
managed search service.

## Why it survived the re-lock unchanged

The re-lock changed the sources, the scorer, the schedule and the retention policy. It did not
change this, because the argument does not depend on any of them: at this corpus size a
deterministic SQL selection is both cheaper and *auditable*, and auditability is the product
(D-03). An embedding-ranked evidence pack cannot explain why an item was included, which
directly weakens product invariant §6.3 — every material claim resolving to an `evidence_item`.

## Consequences

- Evidence selection is a pure function of stored rows and is therefore replayable, which is
  what lets F12's evaluation harness re-run a past answer against the pack it actually saw.
