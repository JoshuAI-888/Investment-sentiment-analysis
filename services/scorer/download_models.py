"""Run once, at Docker **build** time — never at test or request time (F20 §4.1's "reaches no
network at test time"). Downloads both pinned model revisions into the image's local
Hugging Face cache, by exact commit SHA, so `AutoModel.from_pretrained(repo, revision=sha)` in
`models.py` finds them on disk at boot and container run never touches the network.

Not exercised in this environment — no Docker daemon; see `Dockerfile`.
"""

from __future__ import annotations

from huggingface_hub import snapshot_download

from pinning import PINNED_MODELS, boot_check

if __name__ == "__main__":
    boot_check()  # never bake an unpinned revision into the image either
    for model in PINNED_MODELS:
        snapshot_download(repo_id=model.repo, revision=model.revision)
        print(f"cached {model.repo}@{model.revision}")
