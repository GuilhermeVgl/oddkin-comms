#!/bin/sh
# Daily PostgreSQL backup, encrypted before it leaves the host (SPEC 15.4).
#
#   BACKUP_DIR              where files go (default: ./backups)
#   BACKUP_PASSPHRASE_FILE  file holding the passphrase; keep it OFF this server
#   DATABASE_URL            connect directly (needs pg_dump); otherwise the
#                           Compose service "postgres" is used
#   KEEP_DAILY / KEEP_WEEKLY  retention, default 14 and 4
#
# The dump holds ciphertext, key envelopes, device directory, policies and the
# audit log: a restore also needs a device or recovery key that can decrypt.
set -eu

dir=${BACKUP_DIR:-./backups}
keep_daily=${KEEP_DAILY:-14}
keep_weekly=${KEEP_WEEKLY:-4}
if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "BACKUP_PASSPHRASE_FILE must point to a non-empty file" >&2
  exit 1
fi
mkdir -p "$dir/daily" "$dir/weekly"
umask 077

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$dir/daily/oddkin-$stamp.dump.enc"
partial="$target.partial"
trap 'rm -f "$partial"' EXIT HUP INT TERM

if [ -n "${DATABASE_URL:-}" ]; then
  dump() { pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"; }
else
  dump() { docker compose exec -T postgres pg_dump --format=custom --no-owner --no-privileges -U oddkin oddkin; }
fi
dump | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$partial"
if [ ! -s "$partial" ]; then
  echo "backup produced an empty file" >&2
  exit 1
fi
mv "$partial" "$target"

# Sundays also go to the weekly set.
if [ "$(date -u +%u)" = 7 ]; then
  cp "$target" "$dir/weekly/"
fi

prune() { # directory, how many to keep
  ls -1t "$1" 2>/dev/null | awk -v keep="$2" 'NR > keep' | while read -r old; do rm -f "$1/$old"; done
}
prune "$dir/daily" "$keep_daily"
prune "$dir/weekly" "$keep_weekly"
echo "backup written: $target"
