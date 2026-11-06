#!/bin/sh
set -eu

crewstead &
api_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

terminate() {
  kill -TERM "$api_pid" "$caddy_pid" 2>/dev/null || true
}

trap terminate INT TERM

set +e
wait -n "$api_pid" "$caddy_pid"
status=$?
set -e

terminate
wait "$api_pid" "$caddy_pid" 2>/dev/null || true
exit "$status"
