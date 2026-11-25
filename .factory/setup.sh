#!/usr/bin/env bash
# Runs once before the agent starts. Nothing to install: this is a static site
# with no package.json. The gate needs only Node (see node-version) and a
# Chrome or Chromium binary, which the runner image already has.
set -euo pipefail
