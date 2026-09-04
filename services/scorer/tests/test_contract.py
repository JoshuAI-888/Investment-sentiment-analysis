"""The placeholder's only assertion: F20 §3's contract (F01 §4.4b).

When F20 lands it replaces the service, not this file — its real `POST /score` output is
validated against exactly these rules.
"""

from __future__ import annotations

import copy
import unittest

from contract import ContractError, validate_provenance, validate_score_response

SHA = "a" * 40

VALID = {
    "itemId": "reddit_t1_abc123",
    "label": "bullish",
    "scores": {"bullish": "0.8712", "bearish": "0.0431", "neutral": "0.0857"},
    "scorer": {
        "scorerId": "finbert",
        "scorerVersion": f"ProsusAI/finbert@{SHA}",
        "runtimeVersion": "sha256:9f2c1e",
    },
    "scoredAt": "2026-09-03T12:00:00Z",
    "inputHash": "sha256:2b1f...",
    "truncated": False,
}


def mutate(**changes):
    payload = copy.deepcopy(VALID)
    payload.update(changes)
    return payload


class ScoreResultContract(unittest.TestCase):
    def test_a_conforming_batch_passes(self):
        validate_score_response([VALID, mutate(itemId="i2", label="neutral")])

    def test_an_empty_batch_passes(self):
        validate_score_response([])

    def test_scores_must_be_decimal_strings_not_numbers(self):
        payload = copy.deepcopy(VALID)
        payload["scores"]["bullish"] = 0.8712
        with self.assertRaises(ContractError) as caught:
            validate_score_response([payload])
        self.assertIn("decimal strings", str(caught.exception))

    def test_a_model_pinned_to_a_tag_is_rejected(self):
        # The single assertion D-13 exists for. A tag can be moved after the fact, which makes
        # every score it produced unreproducible.
        payload = copy.deepcopy(VALID)
        payload["scorer"]["scorerVersion"] = "ProsusAI/finbert@main"
        with self.assertRaises(ContractError) as caught:
            validate_score_response([payload])
        self.assertIn("commit-sha", str(caught.exception))

    def test_a_model_pinned_to_latest_is_rejected(self):
        payload = copy.deepcopy(VALID)
        payload["scorer"]["scorerVersion"] = "ProsusAI/finbert@latest"
        with self.assertRaises(ContractError):
            validate_score_response([payload])

    def test_a_bare_repo_with_no_revision_is_rejected(self):
        payload = copy.deepcopy(VALID)
        payload["scorer"]["scorerVersion"] = "ProsusAI/finbert"
        with self.assertRaises(ContractError):
            validate_score_response([payload])

    def test_an_unknown_label_is_rejected(self):
        with self.assertRaises(ContractError):
            validate_score_response([mutate(label="very bullish")])

    def test_every_required_key_is_required(self):
        for key in ("itemId", "label", "scores", "scorer", "scoredAt", "inputHash", "truncated"):
            payload = copy.deepcopy(VALID)
            del payload[key]
            with self.subTest(key=key), self.assertRaises(ContractError):
                validate_score_response([payload])

    def test_truncated_must_be_a_boolean(self):
        # Truncation is recorded, not hidden (F20 §4.1). A truthy string would read as
        # recorded while carrying no information.
        with self.assertRaises(ContractError):
            validate_score_response([mutate(truncated="yes")])

    def test_scored_at_must_be_utc(self):
        with self.assertRaises(ContractError):
            validate_score_response([mutate(scoredAt="2026-09-03T12:00:00+02:00")])

    def test_the_response_must_be_an_array(self):
        with self.assertRaises(ContractError):
            validate_score_response(VALID)


class ProvenanceContract(unittest.TestCase):
    def test_v1_writes_pinned(self):
        validate_provenance("pinned")

    def test_the_fallback_value_exists_but_is_not_v1_behaviour(self):
        # F20 §4.3: the column exists so that rows a future capacity fallback produces are
        # distinguishable from day one rather than retrofitted.
        validate_provenance("capacity_fallback")

    def test_an_unknown_provenance_is_rejected(self):
        with self.assertRaises(ContractError):
            validate_provenance("guessed")


if __name__ == "__main__":
    unittest.main()
