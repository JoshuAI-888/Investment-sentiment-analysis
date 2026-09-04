# `scorer` fixtures — how these were recorded

Every other fixture tree here holds a payload recorded from a live vendor. This one cannot be:
the scorer is **our own service** (F20 §4.1), it runs in a container this repository builds, and
there is no third-party endpoint to record from.

So `success.json` is recorded from the **service's own code**, not written by hand. The
recording script ran `services/scorer/scoring.py`'s real `score_batch` against
`services/scorer/tests/fakes.py`'s `FakeBackend` — the same fake the service's own unit tests
use, and the reason the wrapping logic is testable without `torch`. Everything F20 §3's contract
actually asserts is therefore produced by the real code path:

| Field | Where the recorded value comes from |
|---|---|
| `scorer.scorerVersion` | `pinning.py`'s `PINNED_MODELS` — the real, Hub-verified commit SHAs |
| `inputHash` | `scoring.py`'s sha256 of the **truncated** text |
| `scores` | `scoring.py`'s `_decimal_string` formatting (six places, never a float) |
| `truncated` | `FakeBackend`'s window, tripped deliberately by the second item |
| `scoredAt` | `scoring.py`'s ISO-8601 UTC formatting |

**What is faked, stated plainly:** the label and the probability *values*, because those come
from model weights. Nothing in `apps/web/` asserts on them — the app records what it is told and
never recomputes it. The claim that the real weights produce byte-identical output at two batch
sizes is Tier D2's, it belongs to the service half, and it is still open
(`docs/progress/collect.md`, deferred table).

`runtimeVersion` is a plausible image digest, not a real one — the app treats it as an opaque
string and only ever stores it.

## The cases

The nine-case matrix in `docs/05-TEST-STRATEGY.md` §2 is shaped for a third-party HTTP vendor.
Four of its cases do not exist for a service we deploy ourselves, and are absent rather than
faked:

| Case | Recorded | Why |
|---|---|---|
| `success` | yes | Three items across both pinned models; one truncated |
| `empty` | yes | A batch the service answered with nothing — the correspondence check must reject it |
| `float_score` | yes | A `scores.bullish` as a JSON **number**. The one defect this contract exists to catch |
| `unpinned_version` | yes | `ProsusAI/finbert@main` — a moveable revision where a commit SHA belongs |
| `wrong_item` | yes | Parses, but answers for an `itemId` nobody asked about |
| `unexpected_field` | yes | The service grew a field. Must not break the read |
| `server_error` | yes | 503. **The outage case** — the one every §4.2 rule turns on |
| `bad_request` | yes | `app.py`'s own 400 for a batch item missing `kind` |
| `success_rescored` | yes | The same batch under a **second, synthetic** pin — see below |
| `entitlement_403` | no | There is no account and no key. A 403 from our own service is not a condition that exists |
| `rate_limited_*` | no | No vendor rate limit. Back-pressure here is queue depth, which is the worker's concern, not the wire's |
| `null_where_number` | no | No field in `ScoreResult` is a JSON number. `float_score` is the inverse defect, and it is the one that matters |

## The one deliberately synthetic value, and why

`success_rescored.json` carries `scorerVersion` values that are **not real Hub revisions**:
`ProsusAI/finbert@0123456789abcdef0123456789abcdef01234567` and a matching one for
Twitter-RoBERTa. Every other pin in this tree is real and Hub-verified.

The re-score path (F20 §4.4) cannot be exercised with one pin. Its entire purpose is to write a
successor **under a different revision**, and the worker refuses a successor whose actual
revision is not the one the operator asked for — so testing it needs two, and there is exactly
one real commit per model today. The synthetic value is well-formed (40 hex, so it passes the
pinning rule that matters) and is deliberately not a revision that exists, so it can never be
mistaken for one this project has verified.

`success.json` remains the "the service was not redeployed" case for the same tests: re-scoring
against it must produce **no successor at all** and report a stale revision, which is the
regression lane-review found.
