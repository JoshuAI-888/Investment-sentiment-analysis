"""F20 §4.1's `POST /score` HTTP surface.

Stateless, no database access (F20 §4.1). `create_app` takes its backends injected — the real
entry point (`main.py`, added when this service actually loads models) wires real
`transformers`-backed `ScoreBackend`s; tests wire fakes. Nothing in this module imports `torch`
or `transformers`, so importing it — including via `run-tests.sh` — never needs either.
"""

from __future__ import annotations

from flask import Flask, jsonify, request

from pinning import PinnedModel
from scoring import ScoreBackend, ScoreItem, score_batch


def create_app(
    backends: dict[str, ScoreBackend],
    runtime_version: str,
    models_by_kind: dict[str, PinnedModel],
) -> Flask:
    """
    `models_by_kind` is keyed by **item kind** (`substack_post`, `x_snippet`, ...), not by
    scorer id — the same keys `backends` uses, because `/score` looks both up by the kind on the
    incoming item. Several kinds legitimately map to one model: F20 §4.1 routes all long-form
    prose to FinBERT and all short social text to Twitter-RoBERTa.

    **It used to be optional, defaulting to `{m.scorer_id: m for m in PINNED_MODELS}`, and that
    default was keyed wrongly.** `/score` does `model_by_kind[kind]`, so any caller taking the
    default got a service that raised `KeyError` on every scoring request. Nothing caught it
    because every call site — `main.py` and all four test constructions — passes the argument, so
    the default was unexercised as well as wrong. It is now required: there is no sensible
    default anyway, since the kind-to-model mapping lives in `main.py` and is deployment
    knowledge this module does not have.
    """
    model_by_kind = models_by_kind
    app = Flask(__name__)

    @app.get("/health")
    def health():
        # Liveness only — F20 §4.1 is stateless and makes no outbound call to answer this,
        # the same discipline F04 §4.5 states for `/api/health/providers`.
        #
        # `scorers` reports the distinct pinned models, derived from each entry's own
        # `scorer_id` rather than from the dict's keys. Reading the keys is what made this
        # endpoint answer `["reddit_post", "substack_post", "x_snippet", ...]` under the label
        # "scorers" in the first production deploy — five item kinds presented as five scorers,
        # where there have only ever been two. `kinds` reports what the service actually
        # accepts, which is the other genuinely useful fact and was previously unavailable.
        return jsonify(
            {
                "status": "ok",
                "scorers": sorted({model.scorer_id for model in model_by_kind.values()}),
                "kinds": sorted(model_by_kind.keys()),
            }
        )

    @app.post("/score")
    def score():
        body = request.get_json(force=True, silent=False)
        if not isinstance(body, list):
            return jsonify({"error": "request body must be a JSON array of {itemId, text, kind}"}), 400

        by_kind: dict[str, list[ScoreItem]] = {}
        order: list[tuple[str, int]] = []  # (kind, index within that kind's list) per input, in input order
        for raw in body:
            if not isinstance(raw, dict) or "itemId" not in raw or "text" not in raw or "kind" not in raw:
                return jsonify({"error": "each item must have itemId, text and kind"}), 400
            kind = raw["kind"]
            if kind not in backends:
                return jsonify({"error": f"no scorer registered for kind {kind!r}"}), 400
            by_kind.setdefault(kind, []).append(ScoreItem(item_id=raw["itemId"], text=raw["text"], kind=kind))
            order.append((kind, len(by_kind[kind]) - 1))

        results_by_kind: dict[str, list[dict]] = {}
        for kind, items in by_kind.items():
            results_by_kind[kind] = score_batch(
                items=items,
                backend=backends[kind],
                model=model_by_kind[kind],
                runtime_version=runtime_version,
            )

        # Reassemble in the caller's original order — `by_kind` grouped per-model for batching,
        # but the contract makes no promise about kind-major ordering, and a caller sending a
        # mixed batch reasonably expects its own order back.
        ordered_results = [results_by_kind[kind][index] for kind, index in order]
        return jsonify(ordered_results)

    return app
