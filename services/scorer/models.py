"""The real `ScoreBackend` implementations — the module `scoring.py` and `app.py` deliberately
do not import, so that testing the batching/HTTP logic never needs `torch` (see `scoring.py`'s
docstring).

**Not exercised in this environment.** There is no Docker daemon available in the session that
wrote this file (`../Dockerfile`'s own note), and downloading either pinned model's weights —
gigabytes, over the network — is not something to do from an interactive coding session. This
module is CI-build-verified, the same boundary F01 already drew around the Dockerfile itself.

**The label mapping is a declared product decision, not the model's own vocabulary.** Both
pinned models classify into `{"positive", "negative", "neutral"}` — verified against each
repo's own `config.json` `id2label` field, 2026-09-03:

- `ProsusAI/finbert`:  `{0: "positive", 1: "negative", 2: "neutral"}`
- `cardiffnlp/twitter-roberta-base-sentiment-latest`: `{0: "negative", 1: "neutral", 2: "positive"}`

Neither model has ever heard of "bullish" or "bearish" — those are F20 §3's vocabulary, and
`_SENTIMENT_TO_STANCE` below is where "positive" becomes "bullish". That mapping is exactly as
defensible as calling positive-sentiment prose "bullish" is, which is to say it is a modelling
assumption this file makes explicit rather than one buried in a dict a future reader has to
reverse-engineer from behaviour.
"""

from __future__ import annotations

from pinning import PinnedModel
from scoring import RawPrediction, ScoreBackend

_SENTIMENT_TO_STANCE = {
    "positive": "bullish",
    "negative": "bearish",
    "neutral": "neutral",
}


class TransformersBackend(ScoreBackend):
    """Wraps a `transformers` sequence-classification pipeline, loaded once at boot by pinned
    commit SHA. Deterministic: eval mode, no sampling — `model.eval()` and a `torch.no_grad()`
    context are both required for Tier D2, not optional performance tuning."""

    def __init__(self, model: PinnedModel):
        # Imported here, not at module level, so `import models` never pulls in torch unless a
        # backend is actually constructed — the same reason app.py doesn't import this module
        # except from the real entry point.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._model_config = model
        self._tokenizer = AutoTokenizer.from_pretrained(model.repo, revision=model.revision)
        self._torch_model = AutoModelForSequenceClassification.from_pretrained(
            model.repo, revision=model.revision
        )
        self._torch_model.eval()
        self._id2label = {
            int(k): _SENTIMENT_TO_STANCE[v] for k, v in self._torch_model.config.id2label.items()
        }
        self._torch = torch

    def truncate(self, text: str) -> tuple[str, bool]:
        tokens = self._tokenizer.encode(text, add_special_tokens=True)
        if len(tokens) <= self._model_config.window_tokens:
            return text, False
        truncated_tokens = tokens[: self._model_config.window_tokens]
        return self._tokenizer.decode(truncated_tokens, skip_special_tokens=True), True

    def predict(self, texts: list[str]) -> list[RawPrediction]:
        if len(texts) == 0:
            return []

        inputs = self._tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=self._model_config.window_tokens,
        )
        with self._torch.no_grad():
            logits = self._torch_model(**inputs).logits
            probabilities = self._torch.nn.functional.softmax(logits, dim=-1)

        predictions: list[RawPrediction] = []
        for row in probabilities:
            scores = {self._id2label[i]: float(row[i]) for i in range(row.shape[0])}
            label = max(scores, key=scores.get)
            predictions.append(RawPrediction(label=label, scores=scores))
        return predictions
