"""F20 §4.1's boot assertion — the mechanism, not the placeholder.

**Verified 2026-09-03, not guessed.** Both commit SHAs below were fetched from
`huggingface.co/api/models/<repo>`'s own `"sha"` field, independently, twice each, with both
fetches agreeing — the same discipline `apps/web/src/adapters/sec-edgar.ts` and `marketaux.ts`
document for their schemas. Neither this file's author nor the reviewer has run these models;
what is verified is that the revision exists and is a real commit, not that the model behaves
as F20 §4.1 describes. That is what the determinism suite (§4.1, not yet built — see
`README.md`) still has to prove, against a real container this environment cannot build (no
Docker daemon available in this session, matching F01's own note in `Dockerfile`).

A tag or a branch name can move after the merge that pinned it; a commit SHA cannot. That is
the entirety of what this module checks, and it is deliberately not more than that — see
`contract.py`'s `SCORER_VERSION` pattern, which this module exists to satisfy at boot rather
than only at the wire.
"""

from __future__ import annotations

import re
from typing import NamedTuple

_FORTY_HEX = re.compile(r"^[0-9a-f]{40}$")


class PinnedModel(NamedTuple):
    scorer_id: str
    repo: str
    revision: str
    window_tokens: int


class UnpinnedRevisionError(AssertionError):
    """Raised at boot when a configured revision is not a 40-hex commit SHA (F20 §4.1)."""


def require_pinned(model: PinnedModel) -> None:
    if _FORTY_HEX.match(model.revision) is None:
        raise UnpinnedRevisionError(
            f"{model.scorer_id}: revision {model.revision!r} for {model.repo} is not a 40-hex "
            "commit SHA. A tag or a branch can move after the fact, which makes every score "
            "produced under it unreproducible (F20 §4.1, product invariant §6.7). Pin an exact "
            "commit — e.g. via huggingface.co/api/models/<repo>'s 'sha' field — never 'main', "
            "'latest', or a version tag."
        )


#: The two models F20 §4.1 names. Both SHAs fetched from the Hub's own API, 2026-09-03 — see
#: the module docstring. `require_pinned` runs against both at import time, below.
PINNED_MODELS: tuple[PinnedModel, ...] = (
    PinnedModel(
        scorer_id="finbert",
        repo="ProsusAI/finbert",
        revision="4556d13015211d73dccd3fdd39d39232506f3e43",
        window_tokens=512,
    ),
    PinnedModel(
        scorer_id="tweet-roberta",
        repo="cardiffnlp/twitter-roberta-base-sentiment-latest",
        revision="3216a57f2a0d9c45a2e6c20157c20c49fb4bf9c7",
        window_tokens=512,
    ),
)


def scorer_version(model: PinnedModel) -> str:
    """`<hf-repo>@<commit-sha>` — exactly the shape `contract.py`'s `SCORER_VERSION` checks."""
    return f"{model.repo}@{model.revision}"


def boot_check() -> None:
    """Run at service startup. Fails fast and loudly rather than loading a model that would
    later produce scores `contract.py` will reject at the wire — cheaper to fail before the
    first request than after."""
    for model in PINNED_MODELS:
        require_pinned(model)
