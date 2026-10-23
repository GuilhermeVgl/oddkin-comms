#!/bin/sh
set -eu

temporary=$(mktemp -d)
cleanup() {
  rm -r "$temporary"
}
trap cleanup EXIT HUP INT TERM
printf 'module oddkin-actionlint-check\n\ngo 1.27.3\n' > "$temporary/go.mod"
root=$(pwd)
(cd "$temporary" && go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 -oneline "$root/.github/workflows/gate.yaml")
