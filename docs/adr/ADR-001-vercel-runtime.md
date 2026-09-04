# ADR-001 — Vercel App Router is the application and backend runtime

**Status:** Accepted, **amended by D-13 and D-33.**
**Source:** `../reference/SOURCE-PRD-v1.5.md` §1.1.

## Decision

One Next.js App Router project — Server Components, Route Handlers, Vercel Functions, the AI
SDK. Do not introduce Azure, Databricks, Kafka or Kubernetes. Do not rely on Hobby Cron for
intraday work (ADR-013 supplies the dispatcher instead).

## Amendments

**D-13 admits exactly one separate Python service, by name.** The original text forbade "a
separate Python service" on the critical path. D-13 introduces `services/scorer/` — F20's
pinned scorer — and the exception is narrow and deliberate:

- It exists because the stance engine must be **pinned to a commit SHA** to be reproducible
  (product invariant §6.7), and the model runtimes that support that are Python.
- It is one small container, stateless, with **no database access**.
- It is a second **deploy target**, so CI spans two lanes and either red blocks the merge
  (`../05-TEST-STRATEGY.md` §8, F01 §4.4b).

The prohibition stands for everything else. This is not a precedent for a second service.

**D-02 removed the 48-hour framing** the original clause was written against: scope was kept
and the timeline re-baselined to five waves. "Do not introduce X into the 48-hour critical
path" is therefore read as "do not introduce X", full stop — the deadline that justified the
carve-out no longer exists to be argued from.

**D-33 sets the database tier to Neon Launch, not Free.** Recorded here because the runtime
decision and the storage decision are usually made together and were not: Neon Free's 0.5 GB
looks healthy through the whole of Wave 1 and is exhausted three to four months in, at which
point D-16's forward-only corpus is the thing that stops.

## Consequences

- Two deploy targets, two CI jobs, two runbooks.
- `services/scorer/` is owned by the COLLECT lane and is the one path outside `apps/web/`
  that carries application code.
