package calls

import (
	"slices"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
)

func testConfig() Config {
	return Config{URL: "wss://media.example.test", APIURL: "https://media.example.test", APIKey: "SYNTHETICKEY", APISecret: "synthetic-secret-synthetic-secret-1234"}
}

func verify(t *testing.T, token string) (*auth.APIKeyTokenVerifier, *auth.ClaimGrants) {
	t.Helper()
	verifier, err := auth.ParseAPIToken(token)
	if err != nil {
		t.Fatal(err)
	}
	_, grants, err := verifier.Verify(testConfig().APISecret)
	if err != nil {
		t.Fatalf("token signature: %v", err)
	}
	return verifier, grants
}

func TestJoinTokenIsScopedToOneRoomAndIdentity(t *testing.T) {
	token, err := testConfig().JoinToken("call-room-1", "account-1", "ana@example.test", false, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	verifier, grants := verify(t, token)
	video := grants.Video
	if verifier.Identity() != "account-1" || video.Room != "call-room-1" || !video.RoomJoin {
		t.Fatalf("token not bound to room and identity: %+v", video)
	}
	if video.RoomCreate || video.RoomAdmin || video.RoomList || video.Hidden || video.Recorder {
		t.Fatalf("clients must never receive admin or room-creation grants: %+v", video)
	}
	if video.CanPublishData == nil || *video.CanPublishData {
		t.Fatal("data publishing must be disabled")
	}
	if !slices.Equal(video.CanPublishSources, []string{"camera", "microphone"}) && !slices.Equal(video.CanPublishSources, []string{"microphone", "camera"}) {
		t.Fatalf("default sources must exclude screen sharing: %v", video.CanPublishSources)
	}
}

func TestScreenShareSourceIsOnlyGrantedWhenRequested(t *testing.T) {
	token, err := testConfig().JoinToken("room", "account", "name", true, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	_, grants := verify(t, token)
	if !slices.Contains(grants.Video.CanPublishSources, "screen_share") {
		t.Fatalf("screen share source missing: %v", grants.Video.CanPublishSources)
	}
}

func TestJoinTokenLifetimeIsShort(t *testing.T) {
	token, err := testConfig().JoinToken("room", "account", "name", false, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	claims, _, err := mustParse(t, token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) > 5*time.Minute+5*time.Second {
		t.Fatalf("token lives too long: %v", claims.ExpiresAt)
	}
}

func TestConfigRequiresEveryField(t *testing.T) {
	if _, err := (Config{URL: "wss://x.test"}).JoinToken("r", "i", "n", false, time.Minute); err == nil {
		t.Fatal("incomplete LiveKit configuration must be rejected")
	}
}

func mustParse(t *testing.T, token string) (claims struct {
	ExpiresAt *struct{ Time time.Time }
}, grants *auth.ClaimGrants, err error) {
	t.Helper()
	verifier, err := auth.ParseAPIToken(token)
	if err != nil {
		return claims, nil, err
	}
	registered, grants, err := verifier.Verify(testConfig().APISecret)
	if err != nil {
		return claims, nil, err
	}
	if registered.ExpiresAt != nil {
		claims.ExpiresAt = &struct{ Time time.Time }{Time: registered.ExpiresAt.Time}
	}
	return claims, grants, nil
}
