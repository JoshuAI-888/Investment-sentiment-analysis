# 2026-09-03 — COLLECT — F20, the pinned scorer service (service half)

**Selected after F04's adapter roster ran dry.** Reddit needs MT-13; X needs a deferred governed
cohort; FMP's fundamentals endpoints need a schema this session declined to guess three times
running. F20's service half was the next genuinely unblocked feature per SELECT — source §0's
split makes it depend on nothing in `src/`, and unlike the adapters, this session could actually
verify its two pinned model revisions directly rather than reasoning from documentation mirrors.

## What was built

Six modules replace F01's placeholder in `services/scorer/`:

| Module | What it does |
|---|---|
| `pinning.py` | The two pinned models and the boot assertion that fails on a tag or branch |
| `scoring.py` | Batching, truncation, input-hashing, `ScoreResult` assembly — against a `ScoreBackend` protocol |
| `app.py` | Flask `POST /score` / `GET /health`, stateless, backend-injected |
| `models.py` | The real `transformers`-backed backend |
| `main.py` | The real entry point |
| `download_models.py` | Build-time model baking |

40 Python tests (was 18). Full local suite green with no `torch` installed at all — the entire
test path runs against `tests/fakes.py`'s `FakeBackend`, never importing `models.py`.

## Verification, the part worth dwelling on

Two things needed checking before writing a line of pinning code, and this session could check
both directly rather than reasoning from a third party's writeup, which is new for this session
— every prior schema check this session did (SEC EDGAR, Marketaux, FRED) had to settle for a
documentation mirror or a search summary because the real endpoint was inaccessible without a
key or blocked outright.

**The commit SHAs.** `huggingface.co/api/models/<repo>` returns each repo's current `"sha"` as
plain JSON. Fetched independently for both `ProsusAI/finbert` and `cardiffnlp/
twitter-roberta-base-sentiment-latest`, and fetched a second time for finbert via a different
page (the commit history view) — both agreed. Two independent fetches landing on the same
40-character value is meaningfully stronger evidence than one fetch, given `WebFetch` itself
goes through a summarizing model that could in principle confabulate a plausible-looking hash.

**The label mapping.** Both models' `config.json` `id2label` fields were fetched raw (not
rendered HTML) and both use `{"positive", "negative", "neutral"}`. Mapping that to F20's
`{"bullish", "bearish", "neutral"}` is a real modelling decision — "positive sentiment" and
"bullish stance" are related claims, not identical ones — so `models.py`'s docstring states it
as a declared assumption rather than letting a future reader infer it from behaviour, and
`collect.md`'s Deferred table flags it for F10's owner to review.

## The genuinely unverified part, named plainly

**No test here proves the real models are deterministic.** That is F20's actual point — Tier D2,
byte-identical output at two batch sizes — and every test in this session's suite proves the
*wrapping logic* has that property against a fake, not that `ProsusAI/finbert` does. Proving the
real thing needs the real weights loaded, which needs Docker, which this session's environment
does not have (unchanged from F01's own note). This is stated in `README.md` and `collect.md`
rather than left to be discovered later as a gap nobody flagged.

## What CI proved that this session could not

Pushed the branch with real uncertainty about whether `pip install -r requirements.txt` and
`download_models.py`'s Hub calls would even succeed in the scorer job's `Build the scorer image`
step — nothing like it had run anywhere in this session. It came back green in under two
minutes: torch, transformers and huggingface_hub installed; both pinned revisions downloaded and
baked into the image; `docker run --rm --network none scorer:ci` then ran the full 40-test suite
with no network reachable, and it passed. This is the first time this session's own untested
assumption (that the Dockerfile changes were correct) was checked by something other than local
reasoning, and it held.

## Next

The real-model determinism suite — needs a Docker daemon or a dedicated CI job, neither
available to drive from this session directly. After that, F20's queue-and-persistence half:
F01 and F03 are both merged, so it is genuinely unblocked, not merely "next in line."
