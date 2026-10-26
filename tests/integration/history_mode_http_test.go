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

// An invitation made from a project lands the person in it, and the
// administrator can see, and is told, that it was accepted.
func TestInvitationFromAProjectAddsThePersonAndTellsTheAdministrator(t *testing.T) {
	f := newE2EEFixture(t, "7e000000-0000-4000-8000-000000000001", "ip", []string{"admin"})
	deliveryKey := bytes.Repeat([]byte{0x52}, identity.InvitationDeliveryKeySize)
	handler, err := httpapi.NewAppHandlerWithConfig(f.pool, httpapi.AppConfig{InvitationDeliveryKey: deliveryKey})
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	admin := f.clients["admin"]
	admin.handler = handler
	t.Cleanup(func() {
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM river_job WHERE kind = 'invitation_email' AND args->>'invitation_id' IN (SELECT id::text FROM organization_invitation WHERE email_normalized LIKE 'ip-%')`)
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM account WHERE email_normalized LIKE 'ip-%@example.test'`)
	})
	var project struct{ Id string }
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Convites"}`, &project)

	if code, _ := postJSON(handler, admin, "/api/v1/invitations", `{"email":"ip-x@example.test","membershipKind":"internal","projectId":"00000000-0000-4000-8000-0000000000aa"}`); code != http.StatusBadRequest {
		t.Fatalf("a project of nowhere: %d", code)
	}
	if code, body := postJSON(handler, admin, "/api/v1/invitations", fmt.Sprintf(`{"email":"ip-new@example.test","membershipKind":"internal","projectId":%q}`, project.Id)); code != http.StatusCreated {
		t.Fatalf("invitation: %d %s", code, body)
	}
	var invitations []struct {
		Email, State string
		ProjectId    string
	}
	if code := admin.do(http.MethodGet, "/api/v1/invitations", "", &invitations); code != http.StatusOK || len(invitations) != 1 || invitations[0].State != "pending" || invitations[0].ProjectId != project.Id {
		t.Fatalf("pending list: %d %+v", code, invitations)
	}
	var sealed []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT d.token_ciphertext FROM invitation_delivery d JOIN organization_invitation i ON i.id = d.invitation_id WHERE i.email_normalized = 'ip-new@example.test'`).Scan(&sealed); err != nil {
		t.Fatal(err)
	}
	token, err := identity.OpenInvitationToken(deliveryKey, sealed)
	if err != nil {
		t.Fatal(err)
	}
	if code, body := postJSON(handler, nil, "/api/v1/invitations/accept", fmt.Sprintf(`{"email":"ip-new@example.test","token":%q,"password":"correct fixture password"}`, token)); code != http.StatusNoContent {
		t.Fatalf("accept: %d %s", code, body)
	}
	person := f.login("ip-new@example.test")
	person.handler = handler
	var projects []struct{ Id string }
	if code := person.do(http.MethodGet, "/api/v1/projects", "", &projects); code != http.StatusOK || len(projects) != 1 || projects[0].Id != project.Id {
		t.Fatalf("the person must see the project they were invited to: %d %+v", code, projects)
	}
	admin.do(http.MethodGet, "/api/v1/invitations", "", &invitations)
	if invitations[0].State != "accepted" {
		t.Fatalf("accepted list: %+v", invitations)
	}
	var notes []struct{ Kind string }
	admin.do(http.MethodGet, "/api/v1/notifications", "", &notes)
	if len(notes) != 1 || notes[0].Kind != "invitation_accepted" {
		t.Fatalf("the inviter is told: %+v", notes)
	}
	if code := person.do(http.MethodGet, "/api/v1/invitations", "", nil); code != http.StatusForbidden {
		t.Fatalf("only administrators list invitations: %d", code)
	}
}

// Managers (and, if the project allows, members) can bring people into their
// project; the policy and the roles are theirs to change.
func TestProjectInvitePolicyAndRoles(t *testing.T) {
	f := newE2EEFixture(t, "7f000000-0000-4000-8000-000000000001", "pp", []string{"admin", "mgr", "mem", "ana", "external-ext"})
	deliveryKey := bytes.Repeat([]byte{0x53}, identity.InvitationDeliveryKeySize)
	handler, err := httpapi.NewAppHandlerWithConfig(f.pool, httpapi.AppConfig{InvitationDeliveryKey: deliveryKey})
	if err != nil {
		t.Fatal(err)
	}
	f.handler = handler
	for _, client := range f.clients {
		client.handler = handler
	}
	admin, mgr, mem, ext := f.clients["admin"], f.clients["mgr"], f.clients["mem"], f.clients["external-ext"]
	t.Cleanup(func() {
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM river_job WHERE kind = 'invitation_email' AND args->>'invitation_id' IN (SELECT id::text FROM organization_invitation WHERE email_normalized LIKE 'pp-%')`)
		_, _ = f.pool.Exec(f.ctx, `DELETE FROM account WHERE email_normalized LIKE 'pp-%@example.test'`)
	})
	var project struct {
		Id           string
		InvitePolicy string
	}
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Politica"}`, &project)
	base := "/api/v1/projects/" + project.Id
	admin.do(http.MethodPost, base+"/members", `{"email":"pp-mgr@example.test","isManager":true}`, nil)
	admin.do(http.MethodPost, base+"/members", `{"email":"pp-mem@example.test"}`, nil)
	admin.do(http.MethodPost, base+"/members", `{"email":"pp-external-ext@example.test"}`, nil)
	invite := func(client *workClient, email, kind, extra string) int {
		code, _ := postJSON(handler, client, "/api/v1/invitations", fmt.Sprintf(`{"email":%q,"membershipKind":%q,"projectId":%q%s}`, email, kind, project.Id, extra))
		return code
	}

	// By default only administrators bring people in.
	if code := invite(mgr, "pp-a@example.test", "external", ""); code != http.StatusForbidden {
		t.Fatalf("a manager under the default policy: %d", code)
	}
	if code := invite(admin, "pp-a@example.test", "internal", ""); code != http.StatusCreated {
		t.Fatalf("administrator: %d", code)
	}
	// Managers choose the policy; no one else does.
	for who, client := range map[string]*workClient{"member": mem, "external": ext} {
		if code := client.do(http.MethodPut, base+"/invite-policy", `{"policy":"members"}`, nil); code != http.StatusForbidden {
			t.Fatalf("%s changing the policy: %d", who, code)
		}
	}
	if code := mgr.do(http.MethodPut, base+"/invite-policy", `{"policy":"everyone"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("unknown policy: %d", code)
	}
	if code := mgr.do(http.MethodPut, base+"/invite-policy", `{"policy":"managers"}`, nil); code != http.StatusNoContent {
		t.Fatalf("set managers: %d", code)
	}
	admin.do(http.MethodGet, base, "", &project)
	if project.InvitePolicy != "managers" {
		t.Fatalf("policy not shown: %+v", project)
	}
	// A manager may invite externals to this project, and only that.
	if code := invite(mgr, "pp-b@example.test", "external", ""); code != http.StatusCreated {
		t.Fatalf("manager inviting an external: %d", code)
	}
	if code := invite(mgr, "pp-c@example.test", "internal", ""); code != http.StatusForbidden {
		t.Fatalf("a manager cannot make someone internal: %d", code)
	}
	if code := invite(mgr, "pp-d@example.test", "external", `,"historyMode":"auto","linkExtra":"k=a"`); code != http.StatusBadRequest {
		t.Fatalf("only the administrator can include history: %d", code)
	}
	if code, _ := postJSON(handler, mgr, "/api/v1/invitations", `{"email":"pp-e@example.test","membershipKind":"external"}`); code != http.StatusForbidden {
		t.Fatalf("an invitation outside any project: %d", code)
	}
	if code := invite(mem, "pp-f@example.test", "external", ""); code != http.StatusForbidden {
		t.Fatalf("a plain member under managers: %d", code)
	}
	// Members are allowed once the policy says so; externals never are.
	mgr.do(http.MethodPut, base+"/invite-policy", `{"policy":"members"}`, nil)
	if code := invite(mem, "pp-f@example.test", "external", ""); code != http.StatusCreated {
		t.Fatalf("a member under members: %d", code)
	}
	if code := invite(ext, "pp-g@example.test", "external", ""); code != http.StatusForbidden {
		t.Fatalf("an external can never invite: %d", code)
	}
	// Adding someone already in the organization follows the same policy, without handing out the manager role.
	if code := mem.do(http.MethodPost, base+"/members", `{"email":"pp-ana@example.test","isManager":true}`, nil); code != http.StatusNoContent {
		t.Fatalf("a member adding a colleague: %d", code)
	}
	var members []struct {
		Email     string
		IsManager bool
		AccountId string
	}
	admin.do(http.MethodGet, base+"/members", "", &members)
	ids := map[string]string{}
	for _, entry := range members {
		ids[entry.Email] = entry.AccountId
		if entry.Email == "pp-ana@example.test" && entry.IsManager {
			t.Fatal("only a manager can hand out the manager role")
		}
	}

	// Roles: promote, demote, never the last manager, never an external.
	role := func(client *workClient, email string, manager bool) int {
		return client.do(http.MethodPut, base+"/members/"+ids[email], fmt.Sprintf(`{"isManager":%v}`, manager), nil)
	}
	if code := role(mem, "pp-mem@example.test", true); code != http.StatusForbidden {
		t.Fatalf("a member promoting themselves: %d", code)
	}
	if code := role(mgr, "pp-external-ext@example.test", true); code != http.StatusBadRequest {
		t.Fatalf("an external manager: %d", code)
	}
	if code := role(mgr, "pp-mem@example.test", true); code != http.StatusNoContent {
		t.Fatalf("promote: %d", code)
	}
	if code := role(mem, "pp-mgr@example.test", false); code != http.StatusNoContent {
		t.Fatalf("the new manager steps another down: %d", code)
	}
	if code := role(mem, "pp-ana@example.test", false); code != http.StatusNoContent {
		t.Fatalf("demoting a plain member is harmless: %d", code)
	}
	if code := role(admin, "pp-mem@example.test", false); code != http.StatusConflict && code != http.StatusNoContent {
		t.Fatalf("unexpected: %d", code)
	}

	// Each project's managers see its invitations.
	var listed []struct{ State string }
	if code := admin.do(http.MethodGet, "/api/v1/invitations?projectId="+project.Id, "", &listed); code != http.StatusOK || len(listed) < 3 {
		t.Fatalf("project invitations for the administrator: %d %+v", code, listed)
	}
	if code := mgr.do(http.MethodGet, "/api/v1/invitations?projectId="+project.Id, "", nil); code != http.StatusForbidden {
		t.Fatalf("a member who is no longer a manager: %d", code)
	}
}
