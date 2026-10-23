.PHONY: doctor generate check-generated fmt-check lint test-unit test-integration test-e2e coverage-check security-check build container-check commit-check gate-docs gate test-commitcheck generate-go generate-ts generate-sqlc check-generated-go check-generated-contracts fmt-go-check fmt-ts-check lint-ts test-go test-ts build-api build-web build-bootstrap build-migrate build-worker build-email-smoke

COMMIT_BASE ?=
COMMIT_HEAD ?=
COMMIT_MSG_FILE ?=

doctor:
	node scripts/doctor.mjs

commit-check:
	@if [ -n "$(COMMIT_MSG_FILE)" ]; then \
		if [ -n "$(COMMIT_BASE)" ] || [ -n "$(COMMIT_HEAD)" ]; then \
			echo "Use COMMIT_MSG_FILE or COMMIT_BASE/COMMIT_HEAD, not both" >&2; exit 1; \
		fi; \
		go run ./cmd/commitcheck -message-file "$(COMMIT_MSG_FILE)"; \
	else \
		if [ -z "$(COMMIT_BASE)" ] || [ -z "$(COMMIT_HEAD)" ]; then \
			echo "Set COMMIT_BASE and COMMIT_HEAD (or COMMIT_MSG_FILE)" >&2; exit 1; \
		fi; \
		go run ./cmd/commitcheck -base "$(COMMIT_BASE)" -head "$(COMMIT_HEAD)"; \
	fi

test-commitcheck:
	go test -race -count=1 ./internal/commitcheck

generate-go:
	go tool oapi-codegen -generate types,std-http -package gen -o internal/httpapi/gen/openapi.gen.go api/openapi.yaml

check-generated-go:
	@bash -o pipefail -c 'go tool oapi-codegen -generate types,std-http -package gen api/openapi.yaml | cmp - internal/httpapi/gen/openapi.gen.go'

generate-ts:
	corepack pnpm generate:api

generate-sqlc:
	go tool sqlc generate -f sqlc.yaml

generate: generate-go generate-ts generate-sqlc

check-generated-contracts:
	./scripts/check-generated-contracts.sh

check-generated: check-generated-contracts

fmt-go-check:
	@test -z "$$(gofmt -l $$(rg --files -g '*.go'))" || { echo "Go source needs gofmt" >&2; exit 1; }

fmt-ts-check:
	corepack pnpm format:check

fmt-check: fmt-go-check fmt-ts-check

lint-ts:
	corepack pnpm lint

lint:
	go vet ./...
	go tool golangci-lint run ./...
	./scripts/check-workflow.sh
	corepack pnpm lint
	corepack pnpm typecheck

test-go:
	go test -race -count=1 ./internal/... ./cmd/bootstrap ./cmd/email-smoke

test-ts:
	corepack pnpm test:unit

test-unit: test-go test-ts

test-integration:
	./scripts/test-integration.sh

test-e2e:
	./scripts/test-e2e.sh

coverage-check:
	./scripts/coverage-go.sh
	corepack pnpm coverage:check

build-api:
	go build -o /dev/null ./cmd/api

build-bootstrap:
	go build -o /dev/null ./cmd/bootstrap

build-migrate:
	go build -o /dev/null ./cmd/migrate

build-worker:
	go build -o /dev/null ./cmd/worker

build-email-smoke:
	go build -o /dev/null ./cmd/email-smoke

build-web:
	corepack pnpm build

build: build-api build-bootstrap build-worker build-migrate build-email-smoke build-web

container-check:
	./scripts/container-check.sh
	./scripts/local-compose-check.sh

security-check:
	node scripts/security-check.mjs

gate-docs:
	corepack pnpm exec prettier --check README.md PRODUCT.md docs
	node scripts/check-doc-links.mjs
	node scripts/security-check.mjs --secrets-only
	$(MAKE) test-commitcheck
	git diff --check

gate: doctor check-generated fmt-check lint test-unit test-integration test-e2e coverage-check security-check build container-check gate-docs
	@if [ -n "$(COMMIT_BASE)" ] || [ -n "$(COMMIT_HEAD)" ] || [ -n "$(COMMIT_MSG_FILE)" ]; then \
		$(MAKE) commit-check COMMIT_BASE="$(COMMIT_BASE)" COMMIT_HEAD="$(COMMIT_HEAD)" COMMIT_MSG_FILE="$(COMMIT_MSG_FILE)"; \
	fi
