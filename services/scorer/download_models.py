"""Run once, at Docker **build** time — never at test or request time (F20 §4.1's "reaches no
network at test time"). Downloads both pinned model revisions into the image's local
Hugging Face cache, by exact commit SHA, so `AutoModel.from_pretrained(repo, revision=sha)` in
`models.py` finds them on disk at boot and container run never touches the network.

## Why this retries

This is the one network-dependent step in the image build, it pulls nine files unauthenticated,
and the Hub rate-limits anonymous traffic. A single `httpx.ConnectError: [Errno 104] Connection
reset by peer` here fails the whole build — observed in CI on a docs-only commit, where the
identical job passed in a concurrent run of the *same* SHA, which is what proves the failure is
transient rather than a defect.

Retrying a transient network error is not the same as tolerating a broken pin. The two are
deliberately separated below: a transport failure or a 5xx is retried, while a 401/403/404 —
a repository that does not exist, a revision that does not exist, a gated model — fails
immediately. Retrying those would turn a permanent, actionable error into a slow one, and the
whole point of pinning by commit SHA is that a wrong pin should be loud.
"""

from __future__ import annotations

import time

from huggingface_hub import snapshot_download
from huggingface_hub.errors import HfHubHTTPError

from pinning import PINNED_MODELS, PinnedModel, boot_check

MAX_ATTEMPTS = 5
BASE_DELAY_SECONDS = 2.0

# 408 Request Timeout and 429 Too Many Requests are the two 4xx codes that *are* worth retrying:
# both say "try again", unlike the rest of the 4xx range which says "this will never work".
RETRYABLE_STATUS = {408, 429}


def is_retryable(error: BaseException) -> bool:
    """A transport failure or a server-side error. Never a bad pin."""
    if isinstance(error, HfHubHTTPError):
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
        if status is None:
            return True  # An HTTP error that carries no status is not a decisive 4xx.
        return status in RETRYABLE_STATUS or status >= 500
    # Connection resets, DNS failures, timeouts: httpx and requests raise their own hierarchies,
    # and both ultimately derive from OSError or expose no shared base worth importing here.
    return isinstance(error, (OSError, TimeoutError))


def download_with_retry(
    model: PinnedModel,
    *,
    download=snapshot_download,
    sleep=time.sleep,
    max_attempts: int = MAX_ATTEMPTS,
) -> None:
    """`download` and `sleep` are injected so the retry policy is testable without a network."""
    for attempt in range(1, max_attempts + 1):
        try:
            download(repo_id=model.repo, revision=model.revision)
            return
        except BaseException as error:  # noqa: BLE001 — re-raised below unless retryable
            if not is_retryable(error) or attempt == max_attempts:
                raise
            delay = BASE_DELAY_SECONDS * (2 ** (attempt - 1))
            print(
                f"attempt {attempt}/{max_attempts} for {model.repo}@{model.revision} failed "
                f"({type(error).__name__}: {error}); retrying in {delay:.0f}s",
                flush=True,
            )
            sleep(delay)


if __name__ == "__main__":
    boot_check()  # never bake an unpinned revision into the image either
    for pinned in PINNED_MODELS:
        download_with_retry(pinned)
        print(f"cached {pinned.repo}@{pinned.revision}")
