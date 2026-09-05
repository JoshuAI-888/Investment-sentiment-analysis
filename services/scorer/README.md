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

## Deploying it as a service

Vercel cannot host this — it is a Docker image with two transformer checkpoints baked in, not a
serverless function. It needs its own target. The deploy target of record is **Render**.

**The image's `CMD` is `./run-tests.sh` and stays that way.** That is deliberate (see
`Dockerfile`: "the test command is the image's own entry point, so CI cannot drift from local"),
and it is also why a Render service that takes the image's default command answers **502** — it
runs the unit suite, exits 0, and never binds a port. A serving deploy **overrides the command**
rather than changing the image's default:

```
gunicorn --bind 0.0.0.0:$PORT --workers 1 --timeout 300 --graceful-timeout 30 main:app
```

Each flag is load-bearing:

| Flag | Why |
|---|---|
| `--bind 0.0.0.0:$PORT` | Render assigns the port at runtime. Binding a fixed port is the second-most-common 502 after the one above |
| `--workers 1` | `main.py` loads **both** pinned checkpoints at import, so every worker holds its own full copy. Two workers is roughly 2–3 GB resident and an OOM kill on anything under a 4 GB instance. Scale the instance before the worker count, and only against a measured queue depth |
| `--timeout 300` | Model loading happens during worker boot. Gunicorn's 30 s default kills the worker mid-load and retries forever, which presents as a service that never becomes healthy |
| `--graceful-timeout 30` | An in-flight batch finishes rather than being cut off mid-score on a redeploy |

Also set:

- **Health Check Path:** `/health` — `app.py` serves it, liveness-only, no outbound call.
- **`RUNTIME_VERSION`:** the image digest, per `main.py`'s docstring. `ScorerIdentity.runtimeVersion`
  exists so a bad *image* is distinguishable from a bad *model pin*, which means it has to come
  from the deploy pipeline. It defaults to `"unknown"`, and an artifact carrying `"unknown"`
  cannot answer the question the field was added for.
- **Instance type:** 2 GB minimum. Below that the checkpoints do not fit.
- **No spin-down on idle.** `adapters/scorer.ts` sets `SCORER_TIMEOUT_MS` to 30 s; a cold start
  that reloads both models exceeds that, and the queue would read the timeout as a scorer outage
  and abstain — a correct response to a wrong signal.

### The Hugging Face rate-limit warning during the build

```
Warning: You are sending unauthenticated requests to the HF Hub.
Please set a HF_TOKEN to enable higher rate limits and faster downloads.
```

Expected, and benign as long as the build succeeds. `download_models.py` fetches both
checkpoints **by pinned commit SHA at build time only**; the image then sets `HF_HUB_OFFLINE=1`,
so nothing reaches the Hub at runtime. The warning is about download speed and rate limits, not
correctness — the SHA pin is what makes the fetch reproducible, and it is unaffected.

Set a build-time `HF_TOKEN` in Render only if the build actually starts failing on HTTP 429.
Note it belongs to **this service's build environment**, never to `apps/web`: F-21 removed every
`HF_*` variable from the application, and `tests/unit/codebase-invariants.test.ts` fails the
build if one reappears there. D-13 reintroduced pinned models *in this service*, pinned by
commit SHA in the image rather than configured by environment — which is precisely the
difference between D-13 and what F-21 cut.
