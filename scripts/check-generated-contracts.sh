#!/usr/bin/env bash
set -euo pipefail

go tool oapi-codegen -generate types,std-http -package gen api/openapi.yaml |
  cmp - internal/httpapi/gen/openapi.gen.go

corepack pnpm exec openapi-typescript api/openapi.yaml |
  corepack pnpm exec prettier --stdin-filepath packages/api-client/src/openapi.gen.ts |
  cmp - packages/api-client/src/openapi.gen.ts

actual=$(rg --files --hidden --no-ignore internal/httpapi/gen packages/api-client/src \
  -g '*.gen.go' -g '*.gen.ts' | LC_ALL=C sort)
expected=$(printf '%s\n' internal/httpapi/gen/openapi.gen.go packages/api-client/src/openapi.gen.ts |
  LC_ALL=C sort)
if [[ "$actual" != "$expected" ]]; then
  printf 'Unexpected generated files:\n%s\n' "$actual" >&2
  exit 1
fi

temporary=$(mktemp -d)
trap 'rm -r "$temporary"' EXIT
root=$(pwd)
relative_root=$(python3 -c 'import os, sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$root" "$temporary")
sed \
  -e "s|schema: db/migrations|schema: $relative_root/db/migrations|" \
  -e "s|queries: db/queries|queries: $relative_root/db/queries|" \
  -e "s|out: internal/store/sqlc|out: sqlc|" \
  sqlc.yaml > "$temporary/sqlc.yaml"
go tool sqlc generate -f "$temporary/sqlc.yaml"
diff -r "$temporary/sqlc" internal/store/sqlc
