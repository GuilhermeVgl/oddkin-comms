#!/bin/sh
set -eu

project="oddkin-it-$$"
compose_file="infra/compose.test.yaml"

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --volumes
}
trap cleanup EXIT HUP INT TERM

docker compose -p "$project" -f "$compose_file" up -d --wait
database_address=$(docker compose -p "$project" -f "$compose_file" port postgres 5432)
database_port=${database_address##*:}
if [ -z "$database_port" ]; then
  echo "Could not determine test PostgreSQL port" >&2
  exit 1
fi
TEST_DATABASE_URL="postgres://oddkin_test:synthetic_test_password@127.0.0.1:$database_port/oddkin_test"
DATABASE_URL="$TEST_DATABASE_URL" go run ./cmd/migrate
if [ -n "${GO_COVER_PROFILE:-}" ]; then
  TEST_DATABASE_URL="$TEST_DATABASE_URL" go test -race -count=1 -tags=integration \
    -covermode=atomic \
    -coverpkg=./internal/commitcheck,./internal/httpapi,./internal/identity,./internal/installation,./internal/jobs,./internal/platform/migration \
    -coverprofile="$GO_COVER_PROFILE" \
    ./internal/commitcheck ./internal/httpapi ./internal/identity ./internal/installation ./internal/jobs ./tests/integration/...
else
  TEST_DATABASE_URL="$TEST_DATABASE_URL" go test -race -count=1 -tags=integration ./tests/integration/...
fi
