"""A `ScoreBackend` with no model at all — deterministic by construction, so the batching,
truncation and hashing logic in `scoring.py` can be tested without `torch` or a network call."""

from __future__ import annotations

from scoring import RawPrediction


class FakeBackend:
    """Truncates to `window` characters (not tokens — a real backend truncates to the model's
    token window; the unit under test here is the wrapping logic, not tokenization) and always
    predicts 'neutral' unless the text contains a marker word, so tests can pick a label."""

    def __init__(self, window: int = 20):
        self.window = window
        self.predict_calls: list[list[str]] = []

    def truncate(self, text: str) -> tuple[str, bool]:
        if len(text) <= self.window:
            return text, False
        return text[: self.window], True

    def predict(self, texts: list[str]) -> list[RawPrediction]:
        self.predict_calls.append(list(texts))
        predictions = []
        for text in texts:
            if "bullish" in text:
                predictions.append(RawPrediction("bullish", {"bullish": 0.9, "bearish": 0.05, "neutral": 0.05}))
            elif "bearish" in text:
                predictions.append(RawPrediction("bearish", {"bullish": 0.05, "bearish": 0.9, "neutral": 0.05}))
            else:
                predictions.append(RawPrediction("neutral", {"bullish": 0.2, "bearish": 0.2, "neutral": 0.6}))
        return predictions


class BrokenCountBackend:
    """Returns the wrong number of predictions — for testing `score_batch`'s own guard."""

    def truncate(self, text: str) -> tuple[str, bool]:
        return text, False

    def predict(self, texts: list[str]) -> list[RawPrediction]:
        return []
