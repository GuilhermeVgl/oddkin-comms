package commitcheck

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

var coauthorTrailer = regexp.MustCompile(`(?im)^\s*co-authored-by\s*:`)

func CheckMessage(message string) error {
	if strings.TrimSpace(message) == "" {
		return errors.New("commit message is empty")
	}
	if coauthorTrailer.MatchString(message) {
		return errors.New("commit message contains a Co-authored-by trailer")
	}
	return nil
}

func CheckRange(ctx context.Context, dir, base, head string) error {
	if base == "" || head == "" || strings.HasPrefix(base, "-") || strings.HasPrefix(head, "-") {
		return errors.New("commit base and head must be explicit Git revisions")
	}
	baseCommit, err := resolveCommit(ctx, dir, base)
	if err != nil {
		return fmt.Errorf("invalid commit base: %w", err)
	}
	headCommit, err := resolveCommit(ctx, dir, head)
	if err != nil {
		return fmt.Errorf("invalid commit head: %w", err)
	}
	if _, err := git(ctx, dir, "merge-base", "--is-ancestor", baseCommit, headCommit); err != nil {
		return fmt.Errorf("commit base is not an ancestor of head: %w", err)
	}
	output, err := git(ctx, dir, "rev-list", "--reverse", baseCommit+".."+headCommit)
	if err != nil {
		return fmt.Errorf("list new commits: %w", err)
	}
	commits := strings.Fields(output)
	if len(commits) == 0 {
		return errors.New("commit range contains no new commits")
	}
	for _, hash := range commits {
		message, err := git(ctx, dir, "show", "-s", "--format=%B", hash)
		if err != nil {
			return fmt.Errorf("read commit %s: %w", hash, err)
		}
		if err := CheckMessage(message); err != nil {
			return fmt.Errorf("commit %s: %w", hash, err)
		}
	}
	return nil
}

func resolveCommit(ctx context.Context, dir, revision string) (string, error) {
	output, err := git(ctx, dir, "rev-parse", "--verify", "--end-of-options", revision+"^{commit}")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(output), nil
}

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %w: %s", args[0], err, strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
