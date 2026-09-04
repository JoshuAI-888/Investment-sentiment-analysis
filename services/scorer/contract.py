"""The F20 §3 wire contract, as an executable validator.

**This is F01's placeholder, not F20's service.** F01 §4.4b ships the *lane*; F20 ships the
service that runs in it. Until F20 lands, this module and its tests are what the scorer job
executes — "a placeholder container whose only test asserts the contract in §3".

The reason the lane exists before the service does is in §4.4b: a lane introduced at F20 is a
lane that has never gated anything. This file gives it something real to assert in the
meantime, and it does not go away when F20 lands — F20's real `/score` output is validated
against exactly these rules.

No third-party imports, by design. The scorer job must reach no network at test time
(F01 DoD), and a container with nothing to install cannot accidentally depend on one.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterable

LABELS = frozenset({"bullish", "bearish", "neutral"})

SCORE_KEYS = ("bullish", "bearish", "neutral")

#: `<hf-repo>@<commit-sha>`. A 40-hex SHA and nothing else — never a tag, never `latest`.
#: D-13's entire guarantee rests on this one pattern: a hosted model whose ID can be retired
#: may not produce a score that enters the corpus (product invariant §6.7).
SCORER_VERSION = re.compile(r"^[A-Za-z0-9._\-]+/[A-Za-z0-9._\-]+@[0-9a-f]{40}$")

#: A decimal string. `0.87`, not `0.8700000000000001`. `02-ARCHITECTURE-CONTRACTS.md` §4.2.
DECIMAL_STRING = re.compile(r"^-?\d+(\.\d+)?$")

PROVENANCE = frozenset({"pinned", "capacity_fallback"})


class ContractError(AssertionError):
    """A payload that does not satisfy F20 §3."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def validate_scorer_identity(identity: Any) -> None:
    _require(isinstance(identity, dict), "scorer must be an object")

    for key in ("scorerId", "scorerVersion", "runtimeVersion"):
        _require(key in identity, f"scorer.{key} is required")
        _require(isinstance(identity[key], str), f"scorer.{key} must be a string")
        _require(identity[key] != "", f"scorer.{key} must not be empty")

    version = identity["scorerVersion"]
    _require(
        SCORER_VERSION.match(version) is not None,
        # The message says why, because this is the assertion most likely to be argued with
        # under deadline pressure.
        f"scorer.scorerVersion {version!r} must be '<hf-repo>@<40-hex-commit-sha>'. "
        "A tag or a branch can be moved after the fact, which makes every score it produced "
        "unreproducible and silently breaks Tier D2 (F20 §4.1, product invariant §6.7).",
    )


def validate_score_result(result: Any) -> None:
    _require(isinstance(result, dict), "each ScoreResult must be an object")

    for key in ("itemId", "label", "scores", "scorer", "scoredAt", "inputHash", "truncated"):
        _require(key in result, f"{key} is required on ScoreResult")

    _require(isinstance(result["itemId"], str) and result["itemId"] != "", "itemId must be a non-empty string")
    _require(result["label"] in LABELS, f"label must be one of {sorted(LABELS)}")
    _require(isinstance(result["truncated"], bool), "truncated must be a boolean")
    _require(isinstance(result["inputHash"], str) and result["inputHash"] != "", "inputHash must be a non-empty string")

    scores = result["scores"]
    _require(isinstance(scores, dict), "scores must be an object")
    for key in SCORE_KEYS:
        _require(key in scores, f"scores.{key} is required")
        value = scores[key]
        # Checked before the string check so the error names the actual mistake. A JSON number
        # here is *the* defect this contract exists to catch; a malformed string is a typo.
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            raise ContractError(
                f"scores.{key} is a JSON number. Scores are decimal strings, never JS numbers "
                "(02-ARCHITECTURE-CONTRACTS.md §4.2) — a float round-trips differently on "
                "different platforms, and Tier D2 requires byte-identical output across runs "
                "and across batch sizes."
            )
        _require(isinstance(value, str), f"scores.{key} must be a decimal string")
        _require(DECIMAL_STRING.match(value) is not None, f"scores.{key} {value!r} is not a decimal string")

    validate_scorer_identity(result["scorer"])
    validate_scored_at(result["scoredAt"])


def validate_scored_at(value: Any) -> None:
    _require(isinstance(value, str), "scoredAt must be a string")
    _require(value.endswith("Z"), "scoredAt must be ISO-8601 UTC and end with 'Z'")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        try:
            datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        except ValueError as error:
            raise ContractError(f"scoredAt {value!r} is not ISO-8601 UTC") from error


def validate_score_response(payload: Iterable[Any]) -> None:
    """`POST /score` returns `ScoreResult[]`."""
    _require(isinstance(payload, list), "POST /score must return an array of ScoreResult")
    for result in payload:
        validate_score_result(result)


def validate_provenance(value: Any) -> None:
    """F20 §4.3. v1 only ever writes 'pinned'; the column exists so a future fallback's rows
    are distinguishable from day one rather than retrofitted."""
    _require(value in PROVENANCE, f"scorer_provenance must be one of {sorted(PROVENANCE)}")
