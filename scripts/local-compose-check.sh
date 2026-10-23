#!/bin/sh
set -eu

project="oddkin-local-check-$$"
export ODDKIN_ADMIN_EMAIL="admin@compose.test"
export ODDKIN_ADMIN_PASSWORD="synthetic-compose-password"
export ODDKIN_TIMEZONE="UTC"
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
  *'<title>ODDKIN · Pequenos passos. Grandes entregas.</title>'*) ;;
  *) echo "Compose did not serve the web app" >&2; exit 1 ;;
esac
code=$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$port/api/v1/health/ready")
if [ "$code" != 204 ]; then
  echo "Compose API readiness through web proxy returned $code" >&2
  exit 1
fi
cookie_jar=$(mktemp)
origin="http://127.0.0.1:$port"
login_code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cookie-jar "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "Origin: $origin" \
  --data '{"email":"admin@compose.test","password":"synthetic-compose-password"}' \
  "$origin/api/v1/auth/login")
if [ "$login_code" != 204 ]; then
  rm -f "$cookie_jar"
  echo "Compose login returned $login_code" >&2
  exit 1
fi
account_code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cookie "$cookie_jar" "$origin/api/v1/auth/me")
rm -f "$cookie_jar"
if [ "$account_code" != 200 ]; then
  echo "Compose authenticated account returned $account_code" >&2
  exit 1
fi
echo "Local Compose passed: web and API available through one port"
