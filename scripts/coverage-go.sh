#!/usr/bin/env bash
set -euo pipefail

actual=$(go list ./internal/... | LC_ALL=C sort)
expected=$(printf '%s\n' \
  github.com/GuilhermeVgl/oddkin-comms/internal/commitcheck \
  github.com/GuilhermeVgl/oddkin-comms/internal/httpapi \
  github.com/GuilhermeVgl/oddkin-comms/internal/httpapi/gen \
	github.com/GuilhermeVgl/oddkin-comms/internal/identity \
  github.com/GuilhermeVgl/oddkin-comms/internal/jobs \
  github.com/GuilhermeVgl/oddkin-comms/internal/platform/migration \
  github.com/GuilhermeVgl/oddkin-comms/internal/platform/resendmail \
  github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc | LC_ALL=C sort)
if [[ "$actual" != "$expected" ]]; then
  printf 'New internal Go package requires an explicit coverage decision:\n%s\n' "$actual" >&2
  exit 1
fi

profile=$(mktemp)
trap 'rm "$profile"' EXIT
GO_COVER_PROFILE="$profile" ./scripts/test-integration.sh
percentage=$(go tool cover -func="$profile" | awk '/^total:/ { gsub(/%/, "", $3); print $3 }')
if [[ -z "$percentage" ]]; then
  echo 'Go coverage report has no total' >&2
  exit 1
fi
awk -v value="$percentage" 'BEGIN { if (value < 80) exit 1 }' || {
  printf 'Go statement coverage %.1f%% is below 80%%\n' "$percentage" >&2
  exit 1
}
printf 'Go statement coverage: %s%%\n' "$percentage"
