.PHONY: commit-check test-commitcheck

COMMIT_BASE ?=
COMMIT_HEAD ?=
COMMIT_MSG_FILE ?=

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
