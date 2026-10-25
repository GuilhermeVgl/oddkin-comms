#!/bin/sh
set -eu

project="oddkin-e2e-$$"
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
export TEST_DATABASE_URL
# The API migrates and creates the administrator itself; the E2E suite starts it.
export DATABASE_URL="$TEST_DATABASE_URL" ODDKIN_ADMIN_EMAIL="admin@example.test" ODDKIN_ADMIN_PASSWORD="synthetic-admin-password" ODDKIN_TIMEZONE="UTC"
corepack pnpm test:e2e
