"""F20 §4.1's `POST /score` HTTP surface.

Stateless, no database access (F20 §4.1). `create_app` takes its backends injected — the real
entry point (`main.py`, added when this service actually loads models) wires real
`transformers`-backed `ScoreBackend`s; tests wire fakes. Nothing in this module imports `torch`
or `transformers`, so importing it — including via `run-tests.sh` — never needs either.
"""

from __future__ import annotations

from flask import Flask, jsonify, request

from pinning import PINNED_MODELS, PinnedModel
from scoring import ScoreBackend, ScoreItem, score_batch


def create_app(
    backends: dict[str, ScoreBackend],
    runtime_version: str,
    models: dict[str, PinnedModel] | None = None,
) -> Flask:
    model_by_id = models if models is not None else {m.scorer_id: m for m in PINNED_MODELS}
    app = Flask(__name__)

    @app.get("/health")
    def health():
        # Liveness only — F20 §4.1 is stateless and makes no outbound call to answer this,
        # the same discipline F04 §4.5 states for `/api/health/providers`.
        return jsonify({"status": "ok", "scorers": sorted(model_by_id.keys())})

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
                model=model_by_id[kind],
                runtime_version=runtime_version,
            )

        # Reassemble in the caller's original order — `by_kind` grouped per-model for batching,
        # but the contract makes no promise about kind-major ordering, and a caller sending a
        # mixed batch reasonably expects its own order back.
        ordered_results = [results_by_kind[kind][index] for kind, index in order]
        return jsonify(ordered_results)

    return app
