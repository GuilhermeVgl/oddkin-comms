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
address=$(ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" port web 5173)
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
if [ "$account_code" != 200 ]; then
  rm -f "$cookie_jar"
  echo "Compose authenticated account returned $account_code" >&2
  exit 1
fi
csrf_token=$(awk '$6 == "oddkin_csrf" { print $7 }' "$cookie_jar")
invite_code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --cookie "$cookie_jar" \
  --header "Content-Type: application/json" \
  --header "Origin: $origin" \
  --header "X-CSRF-Token: $csrf_token" \
  --data '{"email":"invited@compose.test","membershipKind":"external"}' \
  "$origin/api/v1/invitations")
rm -f "$cookie_jar"
if [ "$invite_code" != 201 ]; then
  echo "Compose invitation returned $invite_code" >&2
  exit 1
fi
storage_address=$(ODDKIN_WEB_BIND='127.0.0.1:' docker compose -p "$project" port storage 9000)
storage_port=${storage_address##*:}
storage_ready=false
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent "http://127.0.0.1:$storage_port/minio/health/live" >/dev/null; then
    storage_ready=true
    break
  fi
  sleep 1
done
if [ "$storage_ready" != true ]; then
  echo "Compose file storage (MinIO) did not become healthy" >&2
  exit 1
fi
echo "Local Compose passed: web, API (migrated and bootstrapped itself) and file storage are up"
