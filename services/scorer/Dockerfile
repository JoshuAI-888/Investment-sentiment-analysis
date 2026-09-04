# F20 §4.1. F01's placeholder occupied this file until 2026-09-03 — see git history for it.
#
# Two properties this image must keep, carried over unchanged from the placeholder:
#   1. No network at test time. Models are downloaded at BUILD time (below), by commit SHA,
#      baked into the layer — a Hugging Face outage must not turn every merge red for a reason
#      unrelated to the diff.
#   2. The test command is the image's own entry point, so CI cannot drift from local. The unit
#      suite (contract, pinning, scoring, app) never imports `models.py`, so it exercises no
#      model and needs no network even before considering point 1 — see `scoring.py`'s docstring
#      for why the backend is a protocol. `download_models.py` still fails the build outright if
#      a revision is unpinned, so a bad pin cannot even reach the layer this step bakes.
FROM python:3.11-slim

WORKDIR /srv/scorer

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY pinning.py scoring.py app.py models.py main.py download_models.py contract.py run-tests.sh ./
COPY tests ./tests

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/srv/scorer/.cache/huggingface \
    HF_HUB_OFFLINE=1

# Network reachable here (build time only); baked into this layer, gone from every layer after.
RUN HF_HUB_OFFLINE=0 python3 download_models.py

CMD ["./run-tests.sh"]
