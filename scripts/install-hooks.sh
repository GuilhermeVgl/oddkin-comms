#!/bin/sh
set -eu

existing=$(git config --local --get core.hooksPath || true)
if [ -n "$existing" ] && [ "$existing" != ".githooks" ]; then
  echo "core.hooksPath is already set to $existing; leaving it unchanged" >&2
  exit 1
fi
git config --local core.hooksPath .githooks
echo "Local commit-msg hook installed from .githooks"
