"""F20 §4.1's `POST /score` logic, independent of any actual model.

**Why a backend protocol.** The real backends (`ProsusAI/finbert`, `cardiffnlp/
twitter-roberta-base-sentiment-latest`) need `torch` and `transformers`, multi-gigabyte weights,
and — per the Dockerfile's own comment — download those weights **at image build time**, not at
test time. None of that is available in an interactive session with no Docker daemon (F01's
`Dockerfile` already notes this constraint). Structuring the batching, truncation and hashing
logic against a `ScoreBackend` protocol is what lets all of it be unit-tested here, deterministically,
against a fake — the same reason `apps/web/src/adapters/wrapper.ts` is built against ports
rather than a real `fetch`. The real `transformers`-backed implementation is a separate module
(`models.py`) that this one does not import, so importing `scoring` never pulls in `torch`.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

from pinning import PinnedModel, scorer_version

LABELS = ("bullish", "bearish", "neutral")


@dataclass(frozen=True)
class ScoreItem:
    item_id: str
    text: str
    kind: str  # e.g. 'reddit_post', 'x_snippet' — selects which pinned model scores it


@dataclass(frozen=True)
class RawPrediction:
    """What a `ScoreBackend` returns for one (already-truncated) text: raw label probabilities."""

    label: str
    scores: dict[str, float]


class ScoreBackend(Protocol):
    """One pinned model. `models.py`'s real implementation wraps a loaded transformers pipeline;
    tests use a fake that returns fixed predictions with no model at all."""

    def truncate(self, text: str) -> tuple[str, bool]:
        """Returns (possibly-shortened text, whether it was shortened)."""
        ...

    def predict(self, texts: list[str]) -> list[RawPrediction]:
        """Batch predict. Order-preserving; batch size must not change the result (F20 §4.1)."""
        ...


def _decimal_string(value: float) -> str:
    """A fixed-precision decimal string, never a JS/Python float round-trip.

    `02-ARCHITECTURE-CONTRACTS.md` §4.2 and `contract.py`'s `DECIMAL_STRING` pattern both treat
    this as a hard requirement, not a formatting preference — Tier D2 needs the *string* to be
    byte-identical across runs, and `str(0.1 + 0.2)` is exactly the kind of value that is not.
    Six decimal places is more precision than any consumer of a stance score has asked for, and
    fixing it removes the platform-dependent tail `repr(float)` would otherwise carry.
    """
    return f"{value:.6f}"


def _input_hash(text: str) -> str:
    """Hashes the **truncated** text, so a re-score of the same stored body reproduces the same
    hash even after a truncation-window change (F20 §4.1)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def score_batch(
    items: list[ScoreItem],
    backend: ScoreBackend,
    model: PinnedModel,
    runtime_version: str,
    now: datetime | None = None,
) -> list[dict]:
    """Scores `items` against one pinned model's backend, returning `ScoreResult` dicts shaped
    exactly to `contract.py`'s `validate_score_result`. Order-preserving and, given the same
    backend and inputs, must be called with the same result regardless of `len(items)` — that
    invariant lives in the backend, not here, but this function never reorders or batches
    differently depending on count, so it does not accidentally break it.
    """
    scored_at = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    truncated_texts: list[str] = []
    truncated_flags: list[bool] = []
    for item in items:
        text, was_truncated = backend.truncate(item.text)
        truncated_texts.append(text)
        truncated_flags.append(was_truncated)

    predictions = backend.predict(truncated_texts)
    if len(predictions) != len(items):
        raise AssertionError(
            f"backend.predict returned {len(predictions)} predictions for {len(items)} inputs — "
            "a backend must return exactly one prediction per input, in order."
        )

    version = scorer_version(model)
    results: list[dict] = []
    for item, text, was_truncated, prediction in zip(items, truncated_texts, truncated_flags, predictions):
        results.append(
            {
                "itemId": item.item_id,
                "label": prediction.label,
                "scores": {label: _decimal_string(prediction.scores[label]) for label in LABELS},
                "scorer": {
                    "scorerId": model.scorer_id,
                    "scorerVersion": version,
                    "runtimeVersion": runtime_version,
                },
                "scoredAt": scored_at,
                "inputHash": _input_hash(text),
                "truncated": was_truncated,
            }
        )
    return results
