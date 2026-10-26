//go:build integration

package integration

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
)

// Who is asked to set up a key is decided by the invitation, and a device that
// registers through one carries a proof the inviting browser can check.
func TestInvitationDecidesWhoIsAskedForAKey(t *testing.T) {
	f := newE2EEFixture(t, "7d000000-0000-4000-8000-000000000001", "hm", []string{"admin"})
	deliveryKey := bytes.Repeat([]byte{0x51}, identity.InvitationDeliveryKeySize)
	handler, err := httpapi.NewAppHandlerWithConfig(f.pool, httpapi.AppConfig{InvitationDeliveryKey: deliveryKey})
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	admin := f.clients["admin"]
	admin.handler = handler
	t.Cleanup(func() {
		// The e-mail jobs this test queued must not leak into another test's worker.
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM river_job WHERE kind = 'invitation_email' AND args->>'invitation_id' IN (SELECT id::text FROM organization_invitation WHERE email_normalized LIKE 'hm-%')`)
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM account WHERE email_normalized LIKE 'hm-%@example.test'`)
	})

	invite := func(email, extra string) (int, string) {
		code, body := postJSON(handler, admin, "/api/v1/invitations", fmt.Sprintf(`{"email":%q,"membershipKind":"internal"%s}`, email, extra))
		return code, body
	}
	tokenOf := func(email string) string {
		var sealed []byte
		if err := f.pool.QueryRow(f.ctx, `SELECT d.token_ciphertext FROM invitation_delivery d JOIN organization_invitation i ON i.id = d.invitation_id WHERE i.email_normalized = $1 AND i.revoked_at IS NULL`, email).Scan(&sealed); err != nil {
			t.Fatal(err)
		}
		token, err := identity.OpenInvitationToken(deliveryKey, sealed)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	accept := func(email string) *workClient {
		code, body := postJSON(handler, nil, "/api/v1/invitations/accept", fmt.Sprintf(`{"email":%q,"token":%q,"password":"correct fixture password"}`, email, tokenOf(email)))
		if code != http.StatusNoContent {
			t.Fatalf("accept %s: %d %s", email, code, body)
		}
		return f.login(email)
	}

	// The secret may only travel with an invitation that includes history, and only as plain parameters.
	if code, _ := invite("hm-a@example.test", `,"linkExtra":"k=abc"`); code != http.StatusBadRequest {
		t.Fatalf("a link secret without history: %d", code)
	}
	if code, _ := invite("hm-a@example.test", `,"historyMode":"auto","linkExtra":"k=<script>"`); code != http.StatusBadRequest {
		t.Fatalf("unsafe characters in the link secret: %d", code)
	}
	if code, _ := invite("hm-a@example.test", `,"historyMode":"sometimes"`); code != http.StatusBadRequest {
		t.Fatalf("unknown mode: %d", code)
	}

	// Yes: the person is never asked; the secret is stored sealed.
	if code, body := invite("hm-auto@example.test", `,"historyMode":"auto","linkExtra":"k=secretvalue123&rf=aa11"`); code != http.StatusCreated {
		t.Fatalf("auto invitation: %d %s", code, body)
	}
	var sealedExtra []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT d.extra_ciphertext FROM invitation_delivery d JOIN organization_invitation i ON i.id = d.invitation_id WHERE i.email_normalized = 'hm-auto@example.test'`).Scan(&sealedExtra); err != nil || len(sealedExtra) == 0 || bytes.Contains(sealedExtra, []byte("secretvalue123")) {
		t.Fatalf("the link secret must be stored sealed: %v", err)
	}
	auto := accept("hm-auto@example.test")
	var me struct{ HistoryMode string }
	if code := auto.do(http.MethodGet, "/api/v1/auth/me", "", &me); code != http.StatusOK || me.HistoryMode != "auto" {
		t.Fatalf("auto account: %d %+v", code, me)
	}
	var left []byte
	_ = f.pool.QueryRow(f.ctx, `SELECT d.extra_ciphertext FROM invitation_delivery d JOIN organization_invitation i ON i.id = d.invitation_id WHERE i.email_normalized = 'hm-auto@example.test'`).Scan(&left)
	if left != nil {
		t.Fatal("the secret must be erased once the invitation is used")
	}

	// A device registered through the invitation carries its proof for the administrator to check.
	if code := auto.do(http.MethodPost, "/api/v1/devices", `{"name":"Navegador","signPublicKey":"`+key43("s")+`","boxPublicKey":"`+key43("b")+`","proof":"proof-value"}`, nil); code != http.StatusCreated {
		t.Fatalf("register with proof: %d", code)
	}
	var pending []struct {
		Device struct{ Proof string }
	}
	if code := admin.do(http.MethodGet, "/api/v1/devices/pending", "", &pending); code != http.StatusOK || len(pending) != 1 || pending[0].Device.Proof != "proof-value" {
		t.Fatalf("pending devices: %d %+v", code, pending)
	}

	// No: the default for everyone else stays "ask"; "none" is never asked and can opt in later.
	if code, _ := invite("hm-none@example.test", `,"historyMode":"none"`); code != http.StatusCreated {
		t.Fatalf("none invitation: %d", code)
	}
	none := accept("hm-none@example.test")
	none.do(http.MethodGet, "/api/v1/auth/me", "", &me)
	if me.HistoryMode != "none" {
		t.Fatalf("none account: %+v", me)
	}
	if code := none.do(http.MethodPut, "/api/v1/account/history-mode", `{"mode":"auto"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("nobody may grant themselves auto: %d", code)
	}
	if code := none.do(http.MethodPut, "/api/v1/account/history-mode", `{"mode":"ask"}`, nil); code != http.StatusNoContent {
		t.Fatalf("asking for access later: %d", code)
	}
	none.do(http.MethodGet, "/api/v1/auth/me", "", &me)
	if me.HistoryMode != "ask" {
		t.Fatalf("after opting in: %+v", me)
	}
	admin.do(http.MethodGet, "/api/v1/auth/me", "", &me)
	if me.HistoryMode != "ask" {
		t.Fatalf("existing members keep ask: %+v", me)
	}
}

func key43(seed string) string {
	raw := bytes.Repeat([]byte(seed), 32)
	return b64url.EncodeToString(raw)
}

func postJSON(handler http.Handler, client *workClient, path, body string) (int, string) {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Host = "oddkin.test"
	req.Header.Set("Origin", "http://oddkin.test")
	req.Header.Set("Content-Type", "application/json")
	if client != nil {
		req.AddCookie(client.session)
		req.Header.Set("X-CSRF-Token", client.csrf.Value)
	}
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, req)
	return result.Code, result.Body.String()
}
