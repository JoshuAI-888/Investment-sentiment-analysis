"""The retry policy in `download_models.py`.

No network: `download_with_retry` takes its downloader and its sleep as parameters precisely so
this suite can drive every branch deterministically.
"""

import unittest

from huggingface_hub.errors import HfHubHTTPError

from download_models import MAX_ATTEMPTS, download_with_retry, is_retryable
from pinning import PinnedModel

MODEL = PinnedModel("finbert", "ProsusAI/finbert", "a" * 40, 20)


class _Response:
    def __init__(self, status_code):
        self.status_code = status_code


class FakeHubError(HfHubHTTPError):
    """
    An `HfHubHTTPError` whose parent constructor is deliberately not called.

    `HfHubHTTPError.__init__` reaches into `response.headers`, `response.request` and more, and
    which attributes it touches differs between huggingface_hub versions — the image pins
    1.29.0. Reconstructing that surface in a stub would make this suite fail on a version bump
    for a reason unrelated to the retry policy it exists to test. `isinstance` still holds, which
    is all `is_retryable` inspects.
    """

    def __init__(self, status):
        self.response = _Response(status)


def http_error(status):
    return FakeHubError(status)


class IsRetryable(unittest.TestCase):
    def test_connection_reset_is_retryable(self):
        # The exact failure observed in CI: httpx raises a ConnectError deriving from OSError.
        self.assertTrue(is_retryable(ConnectionResetError(104, "Connection reset by peer")))

    def test_timeout_is_retryable(self):
        self.assertTrue(is_retryable(TimeoutError()))

    def test_server_errors_are_retryable(self):
        for status in (500, 502, 503, 504):
            self.assertTrue(is_retryable(http_error(status)), status)

    def test_rate_limit_and_request_timeout_are_retryable(self):
        # The two 4xx codes that mean "try again" rather than "this will never work".
        self.assertTrue(is_retryable(http_error(429)))
        self.assertTrue(is_retryable(http_error(408)))

    def test_a_bad_pin_is_never_retryable(self):
        # A repo or revision that does not exist, or a gated model. Retrying would turn a
        # permanent, actionable error into a slow one — and a wrong pin must be loud.
        for status in (401, 403, 404):
            self.assertFalse(is_retryable(http_error(status)), status)

    def test_a_programming_error_is_not_retryable(self):
        self.assertFalse(is_retryable(TypeError("wrong argument")))


class DownloadWithRetry(unittest.TestCase):
    def test_succeeds_first_time_without_sleeping(self):
        calls, sleeps = [], []
        download_with_retry(
            MODEL,
            download=lambda **kwargs: calls.append(kwargs),
            sleep=sleeps.append,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, [])
        self.assertEqual(calls[0], {"repo_id": MODEL.repo, "revision": MODEL.revision})

    def test_retries_a_transient_failure_then_succeeds(self):
        attempts, sleeps = [], []

        def flaky(**kwargs):
            attempts.append(kwargs)
            if len(attempts) < 3:
                raise ConnectionResetError(104, "Connection reset by peer")

        download_with_retry(MODEL, download=flaky, sleep=sleeps.append)
        self.assertEqual(len(attempts), 3)
        # Backoff grows rather than hammering a Hub that just rate-limited us.
        self.assertEqual(sleeps, [2.0, 4.0])

    def test_gives_up_after_max_attempts_and_raises_the_real_error(self):
        attempts, sleeps = [], []

        def always_fails(**kwargs):
            attempts.append(kwargs)
            raise ConnectionResetError(104, "Connection reset by peer")

        with self.assertRaises(ConnectionResetError):
            download_with_retry(MODEL, download=always_fails, sleep=sleeps.append)
        # Bounded: a build that can never reach the Hub must fail, not hang forever.
        self.assertEqual(len(attempts), MAX_ATTEMPTS)
        self.assertEqual(len(sleeps), MAX_ATTEMPTS - 1)

    def test_a_bad_pin_fails_on_the_first_attempt(self):
        attempts, sleeps = [], []

        def not_found(**kwargs):
            attempts.append(kwargs)
            raise http_error(404)

        with self.assertRaises(HfHubHTTPError):
            download_with_retry(MODEL, download=not_found, sleep=sleeps.append)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(sleeps, [])


if __name__ == "__main__":
    unittest.main()
