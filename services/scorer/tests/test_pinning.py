"""F20 §4.1's boot assertion — the mechanism, tested independent of any real model."""

from __future__ import annotations

import unittest

from pinning import PINNED_MODELS, PinnedModel, UnpinnedRevisionError, boot_check, require_pinned, scorer_version


class RequirePinned(unittest.TestCase):
    def test_a_40_hex_sha_passes(self):
        model = PinnedModel("finbert", "ProsusAI/finbert", "a" * 40, 512)
        require_pinned(model)  # must not raise

    def test_a_tag_is_rejected(self):
        model = PinnedModel("finbert", "ProsusAI/finbert", "main", 512)
        with self.assertRaises(UnpinnedRevisionError):
            require_pinned(model)

    def test_latest_is_rejected(self):
        model = PinnedModel("finbert", "ProsusAI/finbert", "latest", 512)
        with self.assertRaises(UnpinnedRevisionError):
            require_pinned(model)

    def test_a_short_sha_is_rejected(self):
        model = PinnedModel("finbert", "ProsusAI/finbert", "4556d13", 512)
        with self.assertRaises(UnpinnedRevisionError):
            require_pinned(model)

    def test_uppercase_hex_is_rejected(self):
        # git's own SHAs are lowercase; accepting uppercase would accept a value no real
        # commit hash takes, silently widening what "pinned" means.
        model = PinnedModel("finbert", "ProsusAI/finbert", "A" * 40, 512)
        with self.assertRaises(UnpinnedRevisionError):
            require_pinned(model)

    def test_empty_string_is_rejected(self):
        model = PinnedModel("finbert", "ProsusAI/finbert", "", 512)
        with self.assertRaises(UnpinnedRevisionError):
            require_pinned(model)


class TheConfiguredModels(unittest.TestCase):
    def test_both_named_models_are_present(self):
        ids = {m.scorer_id for m in PINNED_MODELS}
        self.assertEqual(ids, {"finbert", "tweet-roberta"})

    def test_both_configured_revisions_are_pinned(self):
        boot_check()  # must not raise — this is what actually runs at service startup

    def test_scorer_version_matches_contracts_pattern(self):
        # Mirrors contract.py's SCORER_VERSION regex exactly, so a drift between the two files
        # is caught here rather than only at the wire on the first real request.
        import re

        pattern = re.compile(r"^[A-Za-z0-9._\-]+/[A-Za-z0-9._\-]+@[0-9a-f]{40}$")
        for model in PINNED_MODELS:
            self.assertRegex(scorer_version(model), pattern)


if __name__ == "__main__":
    unittest.main()
