# I08 PostgreSQL read services

`PostgresRniReadService` implements all seven frozen `RniReadService` methods.
`PostgresRniUniverseReadService` implements all three frozen universe read methods.
These are server-side internal services, not authenticated endpoints or client components.
The coordinator must instantiate them behind the existing authentication/authorization
boundary and inject a trusted environment, PostgreSQL pool, and current approved
`rightsPolicyVersion` resolver. The resolver receives the same read-only transaction.
No fixture, provider, model, route, or environment configuration is imported here.

Each request uses a repeatable-read, read-only PostgreSQL snapshot. Radar pagination
is bound to a run's immutable universe/manual-ticker scope and capped at 100 rows;
the universe membership load is capped at 600 and search uses literal substrings
with the frozen result limit. Search never synchronizes or activates a universe.

Publication reads reconstruct and replay the complete accepted E08 artifact through
the batch-scoped PostgreSQL evidence reader using the same transaction and active
rights authority. They bind request, model-input, verification, challenger and result
hashes to durable snapshots, terminal invocation plans, selected assessments, batch
manifests and the exact saved sentence-to-citation/summary projection. Both D-RNI-26
no-call paths remain valid; fabricated provider success cannot stand in for a skip.
Terminal plans use the explicit D-RNI-28 preparation envelope, with identical shared
preparation identity and exact descriptor/summary/convergence identity. Both must
contain hydrated `modelInput`; its canonical hash is the invocation input hash.
Bare model inputs and an unhydrated challenger cannot represent accepted publication.
The E07 component snapshot is bound to replayed E06 dimensions, effective attention,
windows, methodology and slice lineage. Overall stance is independently reproduced
from the committed E06 weights and matching E05 scores under D-RNI-23. Reads require
current display rights, native source URL and content integrity. Radar/detail require
dimension citations for every contributing source. No pooled Reddit/X score is made.
Missing, pending, failed, stale, or restricted evidence cannot produce a current
stance. A surviving source remains independently visible during provider failure.
Partial combined output is a coverage disclosure, not a new narrative conclusion.

`getSecuritySummary` returns the complete immutable published explanation (including
historical explanations); callers must render it with the run/platform freshness
returned by `getRun`/`getPlatformSlices`, not label it a current result. Radar/detail
apply the injected clock against the saved analytics freshness threshold.
Artifact source counts are historical calculation-time attention; fallback counts
include only currently active, eligible sources under the injected rights policy.
An absent or malformed execution scope fails closed and cannot imply a universe run.
Non-active source records are withheld because the frozen evidence DTO has no
availability/tombstone field. Public source metadata is deliberately empty and
provider request identifiers are omitted. Safe errors expose frozen codes only.

Integration tests require an **isolated disposable** `DATABASE_URL`: the existing
repository test helper resets the public schema and applies all committed migrations.
Tests create replayable calculation artifacts and real E08-generated constrained
publication graphs, including verifier-success/all-unverified and fully skipped plans.
Adversarial tests corrupt returned storage data without disabling database guards.
They do not call paid providers or validate live E08 model quality. Route/auth/UI wiring,
deployed credentials, and live refresh acceptance remain coordinator work.
