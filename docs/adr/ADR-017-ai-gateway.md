# ADR-017 — An AI gateway is recommended, and a provider-neutral client is mandatory

**Status:** Accepted, **amended by D-34.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

Keep a provider-neutral `ModelClient` interface and versioned task routes. Direct
OpenAI / Anthropic / Google / Azure adapters remain supported and can be selected globally or
per task. **Deterministic application cost controls remain authoritative regardless of gateway.**

## Amendment (D-34)

The original called the gateway "recommended but not mandatory". D-34 **selects it**: Vercel AI
Gateway is the default transport — one integration, provider fallback, no token markup, and
unified spend visibility across providers.

The spend visibility is the load-bearing part, and it became so for a reason outside this ADR:
D-11 and D-32 leave the **global ceiling as the only budget control**, so a single place that
reports what was actually spent is now the control surface, not a convenience.

**D-34 also splits the verifier from synthesis: the verifier runs on a different vendor.** This
is a direct answer to `../00-ADVERSARIAL-REVIEW.md` F-10 — an unmeasured LLM checking an LLM.
Two models from the same family share failure modes, so a same-vendor verifier agrees with
synthesis for reasons that have nothing to do with the answer being right.

## Consequences

- `MODEL_TRANSPORT_DEFAULT` defaults to `vercel_gateway`, and F01's env schema requires the key
  belonging to whichever transport is selected — naming the transport in the error, because the
  requirement is conditional and an unconditional "missing key" message would be misleading.
- **D-06:** no LLM access is provisioned yet. Wave 3 (F10, F11, F12) is blocked on it.
