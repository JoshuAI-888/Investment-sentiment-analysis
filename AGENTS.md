# Repository agent guide

Read [`CLAUDE.md`](CLAUDE.md) for the existing product's cold-start sequence and global
engineering rules.

## Retail Narrative Intelligence (RNI)

For work below `apps/web/src/rni/`, `apps/web/app/(rni)/`, `apps/web/tests/**/rni/`, or
`docs/rni/`, read these in order:

1. [`docs/features/RNI-00-CONTRACT.md`](docs/features/RNI-00-CONTRACT.md)
2. [`docs/rni/AGENTS.md`](docs/rni/AGENTS.md)
3. [`docs/rni/RNI_BUILD_LOOP.md`](docs/rni/RNI_BUILD_LOOP.md)
4. [`docs/rni/PROGRESS.md`](docs/rni/PROGRESS.md) and the assigned lane file

The RNI contract takes precedence only inside the RNI scope. Existing feature contracts remain
binding elsewhere. Builders must not edit shared contracts, historical migrations, historical
seeds, or another lane's progress file. Contract changes go through the RNI coordinator.
