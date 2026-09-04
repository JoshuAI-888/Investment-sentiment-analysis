#!/usr/bin/env sh
# The command F01's CI job runs. F20 replaces the service; this entry point stays.
set -eu
cd "$(dirname "$0")"
python3 -m unittest discover -s tests -t . -v
