#!/bin/sh
# Restores an encrypted backup into an EMPTY database. It never drops anything:
# restore into a fresh database, check it, then point the API at it.
#
#   restore.sh <backup.dump.enc> <postgres-url-of-empty-database>
#
# BACKUP_PASSPHRASE_FILE must hold the passphrase used by backup.sh.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <backup.dump.enc> <postgres-url>" >&2
  exit 2
fi
file=$1
url=$2
if [ -z "${BACKUP_PASSPHRASE_FILE:-}" ] || [ ! -s "$BACKUP_PASSPHRASE_FILE" ]; then
  echo "BACKUP_PASSPHRASE_FILE must point to a non-empty file" >&2
  exit 1
fi
tables=$(psql "$url" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$tables" != 0 ]; then
  echo "refusing to restore: the target database is not empty ($tables tables)" >&2
  exit 1
fi
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname "$url"
echo "restored $file; start the API against it (migrations are a no-op when current)"
