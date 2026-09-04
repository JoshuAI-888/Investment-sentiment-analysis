# `services/scorer/` — the pinned scorer service

**Owner:** the COLLECT lane (`../../docs/progress/collect.md`). **Feature:** F20.

## What is here today

The **service half** of F20 (§0's split): `POST /score`, both models pinned by commit SHA, the
boot assertion, and the HTTP contract — built and unit-tested against a fake backend, since this
environment has no Docker daemon to build or run the real container in. `contract.py` is F01's
original placeholder validator and does not go away: F20's real `/score` output is validated
against exactly these rules, unchanged.

| Module | What it does |
|---|---|
| `pinning.py` | The two pinned models (SHAs verified against each repo's own `huggingface.co/api/models/<repo>` `"sha"` field, 2026-09-03) and the boot assertion that fails on a tag or branch |
| `scoring.py` | Batching, truncation, input-hashing and `ScoreResult` assembly — against a `ScoreBackend` protocol, not a real model, so it needs no `torch` to test |
| `models.py` | The real `transformers`-backed `ScoreBackend`. **Not exercised in this environment** — see its own docstring |
| `app.py` | The Flask `POST /score` / `GET /health` routes, stateless, backend-injected |
| `main.py` | The real entry point: wires `models.py`'s backends into `app.py`, run by the Docker image once deployed |
| `download_models.py` | Build-time only: bakes both pinned revisions into the image so the container reaches no network at run time |
| `contract.py` | F01's wire-contract validator. Still the thing every `ScoreResult` this service produces is checked against |

`tests/test_gate_can_fail.py` is F01's other half of the CI-lane argument and is unchanged: it
runs a seeded failure in a subprocess and asserts the runner exits non-zero.

## What is not here yet — and why

**The determinism suite against a real model (Tier D2).** Every test here proves the *wrapping
logic* (batching, truncation, hashing, HTTP) is deterministic against a fake backend; none of
them prove `ProsusAI/finbert` or `cardiffnlp/twitter-roberta-base-sentiment-latest` themselves
produce byte-identical output at two batch sizes, because that needs the real weights loaded,
which needs Docker, which is not available in the session that wrote this. This is the load-
bearing gap: F20's actual guarantee is unverified until a session with Docker builds the image
and runs it. Recorded in `docs/progress/collect.md`'s Deferred table, not silently dropped.

**The label mapping is a declared assumption, not a discovery.** Both models classify into
`{"positive", "negative", "neutral"}` (verified against each repo's `config.json`); `models.py`
maps `positive → bullish`, `negative → bearish`, `neutral → neutral`. Worth a second look from
whoever owns F10's stance definitions before this ships, since "positive sentiment" and "bullish
stance" are related but not identical claims.

## The path is part of the contract

This directory is fixed at `services/scorer/` by `../../docs/features/F20-scorer-service.md`
§4.1, because F01's CI job is keyed on it. Build the service anywhere else and the job's path
filter never matches, the lane goes green by never running, and Tier D2 is gated by nothing.

## Boundaries

- **This lane never writes `.github/workflows/`.** F01 owns every workflow file, including this
  service's own job. COLLECT delivers the *command*; the coordinator wires the job.
- The service is stateless and touches no database (F20 §4.1). The queue and its persistence
  are the other half of F20 and depend on F03.

## Running it

```sh
pip install -r requirements.txt     # flask only, in practice — the suite never imports models.py
./run-tests.sh                      # the command CI runs
docker build -t scorer . && docker run --rm scorer
```
