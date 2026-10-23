package commitcheck

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCheckMessage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		message string
		wantErr bool
	}{
		{"ordinary commit", "feat: add work items\n", false},
		{"prose is allowed", "docs: describe the Co-authored-by: rule\n", false},
		{"standard trailer", "feat: add work items\n\nCo-authored-by: Bot <bot@example.invalid>\n", true},
		{"case and indentation", "feat: add work items\n\n  cO-AuThOrEd-By  : Bot\n", true},
		{"empty message", " \n", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckMessage(tt.message)
			if (err != nil) != tt.wantErr {
				t.Fatalf("CheckMessage(%q) error = %v; want error %t", tt.message, err, tt.wantErr)
			}
		})
	}
}

func TestCheckRangeChecksEveryNewCommit(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-q")
	root := commit(t, dir, "chore: start")
	commit(t, dir, "feat: add feature\n\nCo-authored-by: Bot <bot@example.invalid>")
	commit(t, dir, "docs: update readme")
	if err := CheckRange(context.Background(), dir, root, "HEAD"); err == nil {
		t.Fatal("expected middle commit's coauthor trailer to be rejected")
	}
}

func TestCheckRangeAcceptsCleanCommits(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-q")
	root := commit(t, dir, "chore: start")
	commit(t, dir, "feat: add feature")
	commit(t, dir, "docs: update readme")
	if err := CheckRange(context.Background(), dir, root, "HEAD"); err != nil {
		t.Fatalf("expected clean range to pass: %v", err)
	}
}

func TestCheckRangeRejectsInvalidAndEmptyRanges(t *testing.T) {
	dir := t.TempDir()
	runGit(t, dir, "init", "-q")
	root := commit(t, dir, "chore: start")
	for _, tt := range []struct{ base, head string }{
		{"unknown", "HEAD"},
		{root, "unknown"},
		{root, root},
		{"", "HEAD"},
	} {
		if err := CheckRange(context.Background(), dir, tt.base, tt.head); err == nil {
			t.Errorf("expected error for range %q..%q", tt.base, tt.head)
		}
	}
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func commit(t *testing.T, dir, message string) string {
	t.Helper()
	file := filepath.Join(dir, "change")
	previous, err := os.ReadFile(file)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, append(previous, 'x'), 0o600); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "add", "change")
	runGit(t, dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", message)
	return runGit(t, dir, "rev-parse", "HEAD")
}
