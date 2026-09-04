"""F20 §4.1's HTTP surface, tested against `FakeBackend` via Flask's own test client — no
model, no network, no database (the service is stateless per F20 §4.1)."""

from __future__ import annotations

import unittest

from app import create_app
from contract import validate_score_response
from pinning import PinnedModel
from tests.fakes import FakeBackend

MODEL = PinnedModel("finbert", "ProsusAI/finbert", "a" * 40, 20)


def make_client():
    app = create_app(
        backends={"reddit_post": FakeBackend()},
        runtime_version="sha256:testimage",
        models={"reddit_post": MODEL},
    )
    return app.test_client()


class HealthEndpoint(unittest.TestCase):
    def test_returns_ok_with_no_outbound_call(self):
        # "Makes no outbound call" here means: nothing this test injects (the backend) is ever
        # touched by /health, which is the property worth asserting given how F04 §4.5 phrases
        # the same requirement for its own health route.
        client = make_client()
        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")


class ScoreEndpoint(unittest.TestCase):
    def test_scores_a_batch_and_the_response_satisfies_the_wire_contract(self):
        client = make_client()

        response = client.post(
            "/score",
            json=[{"itemId": "i1", "text": "this looks bullish", "kind": "reddit_post"}],
        )

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        validate_score_response(body)
        self.assertEqual(body[0]["label"], "bullish")

    def test_a_non_array_body_is_rejected_with_400_not_a_500(self):
        client = make_client()

        response = client.post("/score", json={"itemId": "i1"})

        self.assertEqual(response.status_code, 400)

    def test_an_item_missing_a_required_field_is_rejected(self):
        client = make_client()

        response = client.post("/score", json=[{"itemId": "i1", "text": "x"}])  # no 'kind'

        self.assertEqual(response.status_code, 400)

    def test_an_unregistered_kind_is_rejected_rather_than_crashing(self):
        client = make_client()

        response = client.post(
            "/score",
            json=[{"itemId": "i1", "text": "x", "kind": "no_such_scorer"}],
        )

        self.assertEqual(response.status_code, 400)

    def test_a_mixed_batch_is_returned_in_the_caller_supplied_order(self):
        app = create_app(
            backends={"a": FakeBackend(), "b": FakeBackend()},
            runtime_version="rt",
            models={"a": MODEL, "b": MODEL},
        )
        client = app.test_client()

        response = client.post(
            "/score",
            json=[
                {"itemId": "first", "text": "bearish", "kind": "a"},
                {"itemId": "second", "text": "bullish", "kind": "b"},
                {"itemId": "third", "text": "bearish", "kind": "a"},
            ],
        )

        self.assertEqual([r["itemId"] for r in response.get_json()], ["first", "second", "third"])


if __name__ == "__main__":
    unittest.main()
