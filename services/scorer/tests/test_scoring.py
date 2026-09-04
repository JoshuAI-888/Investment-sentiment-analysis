"""F20 §4.1's `score_batch`, tested against `FakeBackend` — no model, no network, deterministic
by construction. Every `ScoreResult` produced is also checked against `contract.py`'s own
validator, so a drift between what this service produces and what the wire contract requires
is caught here rather than only in an F04-style integration test later."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from contract import validate_score_response
from pinning import PinnedModel
from scoring import ScoreItem, score_batch
from tests.fakes import BrokenCountBackend, FakeBackend

MODEL = PinnedModel("finbert", "ProsusAI/finbert", "a" * 40, 20)
NOW = datetime(2026, 8, 30, 12, 0, 0, tzinfo=timezone.utc)


class ScoreBatch(unittest.TestCase):
    def test_produces_output_the_wire_contract_accepts(self):
        items = [ScoreItem("i1", "this looks bullish to me", "reddit_post")]
        results = score_batch(items, FakeBackend(), MODEL, "img@sha256:deadbeef", now=NOW)

        validate_score_response(results)  # must not raise

    def test_preserves_input_order(self):
        items = [
            ScoreItem("a", "bullish take", "x"),
            ScoreItem("b", "bearish take", "x"),
            ScoreItem("c", "no opinion", "x"),
        ]
        results = score_batch(items, FakeBackend(), MODEL, "rt", now=NOW)

        self.assertEqual([r["itemId"] for r in results], ["a", "b", "c"])
        self.assertEqual([r["label"] for r in results], ["bullish", "bearish", "neutral"])

    def test_scores_are_decimal_strings_not_floats(self):
        results = score_batch([ScoreItem("i1", "bullish", "x")], FakeBackend(), MODEL, "rt", now=NOW)

        for value in results[0]["scores"].values():
            self.assertIsInstance(value, str)

    def test_truncation_is_recorded_and_hash_is_over_the_truncated_text(self):
        backend = FakeBackend(window=5)
        long_text = "0123456789"  # truncates to "01234"
        results = score_batch([ScoreItem("i1", long_text, "x")], backend, MODEL, "rt", now=NOW)

        self.assertTrue(results[0]["truncated"])
        import hashlib

        expected_hash = hashlib.sha256("01234".encode("utf-8")).hexdigest()
        self.assertEqual(results[0]["inputHash"], expected_hash)

    def test_short_text_is_not_marked_truncated(self):
        results = score_batch([ScoreItem("i1", "short", "x")], FakeBackend(window=20), MODEL, "rt", now=NOW)

        self.assertFalse(results[0]["truncated"])

    def test_scorer_identity_carries_the_pinned_version(self):
        results = score_batch([ScoreItem("i1", "text", "x")], FakeBackend(), MODEL, "rt", now=NOW)

        self.assertEqual(results[0]["scorer"]["scorerVersion"], f"ProsusAI/finbert@{'a' * 40}")

    def test_identical_input_at_two_batch_sizes_is_byte_identical(self):
        # F20's determinism requirement (Tier D2), exercised here at the level this module
        # controls. The FakeBackend is itself deterministic, so this proves score_batch does
        # not introduce batch-size sensitivity of its own — it does not prove a real model is
        # deterministic, which needs the real backend and is out of this module's reach.
        items = [ScoreItem(f"i{i}", "bullish signal" if i % 2 == 0 else "bearish signal", "x") for i in range(6)]

        whole = score_batch(items, FakeBackend(), MODEL, "rt", now=NOW)
        halves = score_batch(items[:3], FakeBackend(), MODEL, "rt", now=NOW) + score_batch(
            items[3:], FakeBackend(), MODEL, "rt", now=NOW
        )

        self.assertEqual(whole, halves)

    def test_a_backend_returning_the_wrong_count_raises(self):
        with self.assertRaises(AssertionError):
            score_batch([ScoreItem("i1", "text", "x")], BrokenCountBackend(), MODEL, "rt", now=NOW)

    def test_scored_at_is_iso8601_utc(self):
        results = score_batch([ScoreItem("i1", "text", "x")], FakeBackend(), MODEL, "rt", now=NOW)

        self.assertTrue(results[0]["scoredAt"].endswith("Z"))


if __name__ == "__main__":
    unittest.main()
