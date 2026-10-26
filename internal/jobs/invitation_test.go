package jobs

import (
	"net/url"
	"strings"
	"testing"
)

func TestInvitationLinkKeepsTokenOutOfHTTPQuery(t *testing.T) {
	t.Parallel()
	link, err := invitationLink("https://crewstead.example/app", "person@example.test", "secret-token")
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.RawQuery != "" || !strings.Contains(parsed.Fragment, "token=secret-token") || parsed.Path != "/app/" {
		t.Fatalf("unsafe or invalid invitation link: %s", link)
	}
}

func TestInvitationLinkRejectsInvalidPublicURL(t *testing.T) {
	t.Parallel()
	for _, publicURL := range []string{"", "crewstead.example", "ftp://crewstead.example", "https://user@crewstead.example", "https://crewstead.example?x=1"} {
		if link, err := invitationLink(publicURL, "person@example.test", "token"); err == nil || link != "" {
			t.Errorf("invalid public URL accepted: %q", publicURL)
		}
	}
}

func TestInvitationEmailArgsUseBoundedEmailQueue(t *testing.T) {
	t.Parallel()
	opts := (InvitationEmailArgs{}).InsertOpts()
	if opts.Queue != "email" || opts.MaxAttempts != 10 {
		t.Fatalf("unexpected invitation job options: %+v", opts)
	}
}
