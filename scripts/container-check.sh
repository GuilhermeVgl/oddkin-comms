#!/bin/sh
set -eu

project="oddkin-smoke-$$"
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
  docker compose -p "$project" -f "$compose_file" logs api migrate >&2
  echo "API did not become ready" >&2
  exit 1
fi

tables=$(docker compose -p "$project" -f "$compose_file" exec -T postgres \
  psql -U oddkin_smoke -d oddkin_smoke -Atqc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('organization', 'goose_db_version', 'river_job')")
if [ "$tables" != 3 ]; then
  echo "Expected organization, Goose and River tables; found $tables" >&2
  exit 1
fi
worker_id=$(docker compose -p "$project" -f "$compose_file" ps -q worker)
if [ -z "$worker_id" ] || [ "$(docker inspect --format '{{.State.Running}}' "$worker_id")" != true ]; then
  echo "River worker container is not running" >&2
  exit 1
fi
echo "Container smoke passed: API ready, worker running, and application/River migrations applied"
