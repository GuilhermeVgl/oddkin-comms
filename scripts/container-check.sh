#!/bin/sh
set -eu

project="crewstead-smoke-$$"
compose_file="infra/compose.smoke.yaml"

cleanup() {
  docker compose -p "$project" -f "$compose_file" down --volumes
}
trap cleanup EXIT HUP INT TERM

docker compose -p "$project" -f "$compose_file" config -q
docker compose -p "$project" -f "$compose_file" up -d --wait --build
address=$(docker compose -p "$project" -f "$compose_file" port api 8080)
port=${address##*:}
if [ -z "$port" ]; then
  echo "Could not determine API smoke port" >&2
  exit 1
fi

ready=0
attempt=0
while [ "$attempt" -lt 30 ]; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/api/v1/health/ready" || true)
  if [ "$status" = 204 ]; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker compose -p "$project" -f "$compose_file" logs api >&2
  echo "API did not become ready" >&2
  exit 1
fi

tables=$(docker compose -p "$project" -f "$compose_file" exec -T postgres \
  psql -U crewstead_smoke -d crewstead_smoke -Atqc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('organization', 'organization_invitation', 'goose_db_version', 'river_job')")
if [ "$tables" != 4 ]; then
  echo "Expected organization, invitation, Goose and River tables; found $tables" >&2
  exit 1
fi
echo "Container smoke passed: API ready, and application and River migrations applied by the API"
