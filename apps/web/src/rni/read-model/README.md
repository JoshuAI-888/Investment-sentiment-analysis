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

Publication reads require the saved sentence-to-citation graph, current display
rights, native source URL and content integrity, and exact section/citation coverage.
Radar/detail additionally replay the persisted E06/E07 calculations and require
dimension citations for every contributing source. No pooled Reddit/X score is made.
Missing, pending, failed, stale, or restricted evidence cannot produce a current
stance. A surviving source remains independently visible during provider failure.
Partial combined output is a coverage disclosure, not a new narrative conclusion.

`getSecuritySummary` returns the complete immutable published explanation (including
historical explanations); callers must render it with the run/platform freshness
returned by `getRun`/`getPlatformSlices`, not label it a current result. Radar/detail
apply the injected clock against the saved analytics freshness threshold.
Non-active source records are withheld because the frozen evidence DTO has no
availability/tombstone field. Public source metadata is deliberately empty and
provider request identifiers are omitted. Safe errors expose frozen codes only.

Integration tests require an **isolated disposable** `DATABASE_URL`: the existing
repository test helper resets the public schema and applies all committed migrations.
Tests create replayable calculation artifacts and the real constrained publication
graph, but do not execute models or validate E08 model quality. Route/auth/UI wiring,
deployed credentials, and live refresh acceptance remain coordinator work.
