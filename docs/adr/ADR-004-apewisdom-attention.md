# ADR-004 — ApeWisdom

**Status:** **Amended twice** — demoted by D-12, and its remaining role retired by D-30.
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Original decision

ApeWisdom is a PoV-only attention index: a keyless API of ticker rank, mentions, upvotes,
prior rank and prior mentions, scanning selected investing subreddits twice hourly. **No
published commercial data license or SLA**, so it must not become the production source of
record.

## Amendment 1 — the methodology-version pin (F01 §4.5, R-14)

ApeWisdom's methodology — which subreddits, at what cadence — is **not versioned by the
provider**. A change to it silently changes the meaning of every series built on it.

So: the methodology as observed is pinned as a recorded value, and a detected change is a
**version boundary**. Series are not compared across a boundary without saying so. This is the
same discipline F22 applies to coverage gaps — a discontinuity is rendered, never interpolated.

## Amendment 2 — demoted, then its replacement role retired

**D-12** replaced the source stack. ApeWisdom stopped being the primary attention source (the
Reddit Data API is) and was retained only as an **independent cross-check** on attention rank.
F-05's original ruling — accept the dependency because there is no licensed alternative at this
budget — was **reversed**: the Reddit Data API's free non-commercial tier exists and this
project qualifies for it under D-11's posture.

**D-30 then retired the cross-check role.** The universe is the 100 most-discussed on Reddit,
**ranked via ApeWisdom**. An instrument that *selected* the universe cannot then *validate*
attention rank on it — it would be checking its own work, and the check would pass for that
reason rather than because the axis is right.

## Where that leaves it

ApeWisdom is a **universe-selection instrument only**. Two costs are carried forward openly
rather than resolved:

1. The attention axis has **no independent cross-check**. It either finds a genuinely
   independent one or carries the gap under product invariant §6.1.
2. The selection is **circular with the headline metric** — selecting symbols by social
   attention and then measuring social attention on them. Level is therefore not
   interpretable; **rank change is**. The disclosure must say so.

## Consequences

- MT-07 records the seed date and the observed ranking. The universe is versioned; historical
  results are never rewritten when it changes (ADR-015).
