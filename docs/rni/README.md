# Retail Narrative Intelligence specification pack

**Status:** binding integration package for the isolated RNI build lane.  
**Owner and production approver:** `joshuai`.  
**Frozen implementation contract:** [`../features/RNI-00-CONTRACT.md`](../features/RNI-00-CONTRACT.md).

This pack extends the existing application without redefining its legacy product. When an RNI
document conflicts with an existing document, the RNI contract wins only for paths, tables,
routes and UI explicitly namespaced to RNI. [`INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md) records
the conflict analysis and closure path.

## Product and architecture

- [`PRD.md`](PRD.md) — product requirements and success criteria.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime, deterministic/LLM boundaries and flows.
- [`DATA_MODEL_AND_LINEAGE.md`](DATA_MODEL_AND_LINEAGE.md) — tables, fields and lineage.
- [`UI_SPEC.md`](UI_SPEC.md) — portal, evidence explorer, citations, freshness and controls.
- [`MCP_SPEC.md`](MCP_SPEC.md) — read-only MCP resources, tools and security.
- [`AGENTS.md`](AGENTS.md) — agent definitions, tools and prompts.
- [`EVALS_AND_GUARDRAILS.md`](EVALS_AND_GUARDRAILS.md) — tests, evals and publication gates.
- [`OPENAI_AND_TOKEN_OPTIMISATION.md`](OPENAI_AND_TOKEN_OPTIMISATION.md) — routing, caching and cost controls.

## Delivery

- [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) — independently owned workstreams and acceptance tests.
- [`RNI_BUILD_LOOP.md`](RNI_BUILD_LOOP.md) — coordinator protocol and merge order.
- [`PROGRESS.md`](PROGRESS.md) — coordinator-owned gate status.
- [`progress/DATA.md`](progress/DATA.md), [`progress/ENGINE.md`](progress/ENGINE.md),
  [`progress/SURFACE.md`](progress/SURFACE.md), [`progress/INTEGRATION.md`](progress/INTEGRATION.md)
  — single-writer lane trackers.
- [`DEPLOY.md`](DEPLOY.md) — human intervention and live gates.
- [`INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md) — repository convergence and risk closure matrix.
- [`ARCHITECTURAL_REVIEW.md`](ARCHITECTURAL_REVIEW.md) — final adversarial review.

The documents are specifications, not evidence that the runtime has been implemented. Only
merged code, passing tests and the progress gates establish completion.

