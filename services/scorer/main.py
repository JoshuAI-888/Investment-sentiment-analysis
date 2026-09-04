"""The real entry point — what the Docker image actually runs once F20 replaces the placeholder
CMD. Not exercised in this environment (no Docker daemon; see `Dockerfile`).

`RUNTIME_VERSION` is meant to be the image digest (F20 §3's `runtimeVersion`), injected as an
environment variable at deploy time rather than computed here — a running container cannot
learn its own digest from the outside without a registry call, and `ScorerIdentity.runtimeVersion`
exists precisely so a bad *image* is distinguishable from a bad *model pin*, which means it must
come from the deploy pipeline, not be derived from something the pin could also affect.
"""

from __future__ import annotations

import os

from models import TransformersBackend
from pinning import PINNED_MODELS, boot_check

# The two kinds F20 §4.1 names: long-form prose to FinBERT, short social text to
# Twitter-RoBERTa. A real dispatch table (kind -> scorer_id) belongs in the queue/worker half
# of F20 (F03-dependent); this is the minimal mapping the HTTP layer needs to route a request.
_KIND_TO_SCORER_ID = {
    "substack_post": "finbert",
    "reddit_post": "finbert",
    "reddit_comment_long": "finbert",
    "x_snippet": "tweet-roberta",
    "reddit_comment_short": "tweet-roberta",
}


def build_app():
    boot_check()  # fails fast on an unpinned revision, before any weights load

    models_by_id = {m.scorer_id: m for m in PINNED_MODELS}
    loaded_backends = {scorer_id: TransformersBackend(model) for scorer_id, model in models_by_id.items()}

    backends_by_kind = {kind: loaded_backends[scorer_id] for kind, scorer_id in _KIND_TO_SCORER_ID.items()}
    models_by_kind = {kind: models_by_id[scorer_id] for kind, scorer_id in _KIND_TO_SCORER_ID.items()}

    from app import create_app

    runtime_version = os.environ.get("RUNTIME_VERSION", "unknown")
    return create_app(backends=backends_by_kind, runtime_version=runtime_version, models=models_by_kind)


app = build_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
