#!/bin/sh
set -eu

project="oddkin-local-check-$$"
cleanup() {
  ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" down --volumes
}
trap cleanup EXIT HUP INT TERM

ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" config -q
ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" up -d --wait --build
address=$(ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" port web 8080)
port=${address##*:}
if [ -z "$port" ]; then
  echo "Web port was not published" >&2
  exit 1
fi
page=$(curl --fail --silent --show-error "http://127.0.0.1:$port/")
case "$page" in
  *'<title>ODDKIN</title>'*) ;;
  *) echo "Compose did not serve the web app" >&2; exit 1 ;;
esac
code=$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/api/v1/health/ready")
if [ "$code" != 204 ]; then
  echo "Compose API readiness through web proxy returned $code" >&2
  exit 1
fi
echo "Local Compose passed: web and API available through one port"
