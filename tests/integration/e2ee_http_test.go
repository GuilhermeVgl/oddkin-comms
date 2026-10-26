//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/identity"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var b64url = base64.RawURLEncoding

type testDevice struct {
	id         string
	account    string
	signPublic ed25519.PublicKey
	signSecret ed25519.PrivateKey
	boxPublic  []byte
}

type deviceDTO struct {
	Id    string `json:"id"`
	State string `json:"state"`
}

type domainDTO struct {
	Id                string `json:"id"`
	CurrentGeneration int    `json:"currentGeneration"`
	State             string `json:"state"`
	Writable          bool   `json:"writable"`
}

func TestKeyDirectoryDomainsAndRotation(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var organizationID pgtype.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('79000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID); err != nil {
			t.Error(err)
		}
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'key-%@example.test'`)
	}()
	hash, err := identity.HashPassword("correct key password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	accountIDs := map[string]string{}
	for _, email := range []string{"key-admin@example.test", "key-member@example.test", "key-external@example.test", "key-outsider@example.test"} {
		account, createErr := queries.CreateAccount(ctx, sqlc.CreateAccountParams{EmailNormalized: email, PasswordHash: hash})
		if createErr != nil {
			t.Fatal(createErr)
		}
		kind := "internal"
		if strings.Contains(email, "external") {
			kind = "external"
		}
		if _, createErr = queries.CreateOrganizationMembership(ctx, sqlc.CreateOrganizationMembershipParams{
			OrganizationID: organizationID, AccountID: account.ID, MembershipKind: kind, IsAdmin: strings.Contains(email, "admin"),
		}); createErr != nil {
			t.Fatal(createErr)
		}
		accountIDs[email] = fmt.Sprintf("%x-%x-%x-%x-%x", account.ID.Bytes[0:4], account.ID.Bytes[4:6], account.ID.Bytes[6:8], account.ID.Bytes[8:10], account.ID.Bytes[10:16])
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct key password"}`))
		req.Host = "crewstead.test"
		req.Header.Set("Origin", "http://crewstead.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		c := &workClient{t: t, handler: handler}
		for _, cookie := range result.Result().Cookies() {
			if cookie.Name == "crewstead_session" {
				c.session = cookie
			}
			if cookie.Name == "crewstead_csrf" {
				c.csrf = cookie
			}
		}
		return c
	}
	admin, member := login("key-admin@example.test"), login("key-member@example.test")
	external, outsider := login("key-external@example.test"), login("key-outsider@example.test")

	rootPublic, rootSecret, _ := ed25519.GenerateKey(rand.Reader)

	// register creates keys locally and registers only the public halves.
	register := func(client *workClient, email, name, kind string) testDevice {
		public, secret, _ := ed25519.GenerateKey(rand.Reader)
		box := make([]byte, 32)
		_, _ = rand.Read(box)
		body := fmt.Sprintf(`{"name":%q,"kind":%q,"signPublicKey":%q,"boxPublicKey":%q}`, name, kind, b64url.EncodeToString(public), b64url.EncodeToString(box))
		var created deviceDTO
		if code := client.do(http.MethodPost, "/api/v1/devices", body, &created); code != http.StatusCreated || created.State != "pending" {
			t.Fatalf("register %s: %d %+v", name, code, created)
		}
		return testDevice{id: created.Id, account: accountIDs[email], signPublic: public, signSecret: secret, boxPublic: box}
	}
	certificate := func(signer ed25519.PrivateKey, device testDevice) string {
		return b64url.EncodeToString(ed25519.Sign(signer, keys.DeviceCertificateBytes(keys.DeviceCertificate{
			AccountID: device.account, DeviceID: device.id, SignPublicKey: device.signPublic, BoxPublicKey: device.boxPublic,
		})))
	}

	// Trust root: pinned once by an administrator.
	if code := admin.do(http.MethodGet, "/api/v1/e2ee/trust-root", "", nil); code != http.StatusNotFound {
		t.Fatalf("trust root before setup: %d", code)
	}
	rootBody := fmt.Sprintf(`{"signPublicKey":%q}`, b64url.EncodeToString(rootPublic))
	if code := member.do(http.MethodPut, "/api/v1/e2ee/trust-root", rootBody, nil); code != http.StatusForbidden {
		t.Fatalf("non-admin pinned the root: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/e2ee/trust-root", `{"signPublicKey":"AAAA"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("short root key: %d", code)
	}
	if code := admin.do(http.MethodPut, "/api/v1/e2ee/trust-root", rootBody, nil); code != http.StatusOK {
		t.Fatalf("pin root: %d", code)
	}
	otherPublic, _, _ := ed25519.GenerateKey(rand.Reader)
	if code := admin.do(http.MethodPut, "/api/v1/e2ee/trust-root", fmt.Sprintf(`{"signPublicKey":%q}`, b64url.EncodeToString(otherPublic)), nil); code != http.StatusConflict {
		t.Fatalf("replacing the root must be refused: %d", code)
	}

	// Devices wait for approval; only the root (an administrator) or an existing device of the same person can vouch.
	adminDevice := register(admin, "key-admin@example.test", "Admin laptop", "device")
	recovery := register(admin, "key-admin@example.test", "Recovery identity", "recovery")
	memberDevice := register(member, "key-member@example.test", "Member laptop", "device")
	externalDevice := register(external, "key-external@example.test", "External laptop", "device")
	if code := member.do(http.MethodPost, "/api/v1/devices", `{"name":"x","kind":"recovery","signPublicKey":"AAAA","boxPublicKey":"AAAA"}`, nil); code != http.StatusBadRequest {
		t.Fatalf("recovery registration by a non-admin: %d", code)
	}
	if code := member.do(http.MethodGet, "/api/v1/devices/pending", "", nil); code != http.StatusForbidden {
		t.Fatalf("pending list for a non-admin: %d", code)
	}
	var pending []struct{ Device deviceDTO }
	if code := admin.do(http.MethodGet, "/api/v1/devices/pending", "", &pending); code != http.StatusOK || len(pending) != 4 {
		t.Fatalf("pending devices: %d %d", code, len(pending))
	}
	authorizeWithRoot := func(client *workClient, device testDevice) int {
		return client.do(http.MethodPost, "/api/v1/devices/"+device.id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate(rootSecret, device)), nil)
	}
	if code := authorizeWithRoot(member, memberDevice); code != http.StatusForbidden {
		t.Fatalf("a user cannot approve their own device with the root: %d", code)
	}
	forger, forgerSecret, _ := ed25519.GenerateKey(rand.Reader)
	_ = forger
	if code := admin.do(http.MethodPost, "/api/v1/devices/"+memberDevice.id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate(forgerSecret, memberDevice)), nil); code != http.StatusBadRequest {
		t.Fatalf("certificate signed by an unknown key: %d", code)
	}
	swapped := memberDevice
	swapped.boxPublic = append([]byte(nil), memberDevice.boxPublic...)
	swapped.boxPublic[0] ^= 1
	if code := admin.do(http.MethodPost, "/api/v1/devices/"+memberDevice.id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate(rootSecret, swapped)), nil); code != http.StatusBadRequest {
		t.Fatalf("certificate for different keys: %d", code)
	}
	for _, device := range []testDevice{adminDevice, recovery, memberDevice, externalDevice} {
		if code := authorizeWithRoot(admin, device); code != http.StatusOK {
			t.Fatalf("authorize %s: %d", device.id, code)
		}
	}
	if code := authorizeWithRoot(admin, memberDevice); code != http.StatusConflict {
		t.Fatalf("authorizing twice: %d", code)
	}
	// A second device of the same person is vouched for by the first.
	memberPhone := register(member, "key-member@example.test", "Member phone", "device")
	viaDevice := fmt.Sprintf(`{"authorizerDeviceId":%q,"certificate":%q}`, memberDevice.id, certificate(memberDevice.signSecret, memberPhone))
	if code := external.do(http.MethodPost, "/api/v1/devices/"+memberPhone.id+"/authorize", viaDevice, nil); code != http.StatusForbidden {
		t.Fatalf("someone else vouching with a device that is not theirs: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/devices/"+memberPhone.id+"/authorize", viaDevice, nil); code != http.StatusOK {
		t.Fatalf("device-to-device authorization: %d", code)
	}

	// Project, members and the directory.
	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Cofre"}`, &project); code != http.StatusCreated {
		t.Fatalf("project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	for _, email := range []string{"key-member@example.test", "key-external@example.test"} {
		if code := admin.do(http.MethodPost, base+"/members", `{"email":"`+email+`"}`, nil); code != http.StatusNoContent {
			t.Fatalf("add member: %d", code)
		}
	}
	var directory []struct {
		DeviceId, Kind, Certificate string
	}
	if code := member.do(http.MethodGet, base+"/directory", "", &directory); code != http.StatusOK || len(directory) != 5 {
		t.Fatalf("directory: %d %d", code, len(directory))
	}
	if code := outsider.do(http.MethodGet, base+"/directory", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider directory: %d", code)
	}

	// Key domain and first generation.
	if code := external.do(http.MethodPost, base+"/key-domains", `{"kind":"work"}`, nil); code != http.StatusForbidden {
		t.Fatalf("external created a domain: %d", code)
	}
	var domain domainDTO
	if code := member.do(http.MethodPost, base+"/key-domains", `{"kind":"work"}`, &domain); code != http.StatusCreated || domain.State != "pending_keys" || domain.Writable {
		t.Fatalf("create domain: %d %+v", code, domain)
	}
	if code := member.do(http.MethodPost, base+"/key-domains", `{"kind":"work"}`, nil); code != http.StatusConflict {
		t.Fatalf("duplicate domain: %d", code)
	}
	generationPath := "/api/v1/key-domains/" + domain.Id + "/generations"
	envelope := func(signer testDevice, recipient testDevice, generation int, tamper bool) string {
		sealed := make([]byte, 80)
		_, _ = rand.Read(sealed)
		signature := ed25519.Sign(signer.signSecret, keys.KeyEnvelopeBytes(keys.KeyEnvelope{
			RecipientDeviceID: recipient.id, DomainID: domain.Id, Generation: uint32(generation), Sealed: sealed,
		}))
		if tamper {
			signature[0] ^= 1
		}
		return fmt.Sprintf(`{"recipientDeviceId":%q,"sealed":%q,"signature":%q}`, recipient.id, b64url.EncodeToString(sealed), b64url.EncodeToString(signature))
	}
	publish := func(client *workClient, signer testDevice, generation int, recipients []testDevice, tamperFirst bool) int {
		parts := make([]string, len(recipients))
		for i, recipient := range recipients {
			parts[i] = envelope(signer, recipient, generation, tamperFirst && i == 0)
		}
		return client.do(http.MethodPost, generationPath, fmt.Sprintf(`{"generation":%d,"signerDeviceId":%q,"envelopes":[%s]}`, generation, signer.id, strings.Join(parts, ",")), nil)
	}
	all := []testDevice{adminDevice, recovery, memberDevice, memberPhone, externalDevice}
	if code := publish(member, memberDevice, 1, []testDevice{adminDevice, memberDevice, memberPhone, externalDevice}, false); code != http.StatusConflict {
		t.Fatalf("a generation without the recovery envelope: %d", code)
	}
	if code := publish(member, memberDevice, 1, all, true); code != http.StatusBadRequest {
		t.Fatalf("a forged envelope signature: %d", code)
	}
	if code := publish(member, memberDevice, 2, all, false); code != http.StatusConflict {
		t.Fatalf("skipping a generation: %d", code)
	}
	if code := publish(outsider, memberDevice, 1, all, false); code != http.StatusNotFound {
		t.Fatalf("outsider publishing: %d", code)
	}
	if code := publish(external, externalDevice, 1, all, false); code != http.StatusForbidden && code != http.StatusOK {
		t.Fatalf("unexpected external publish status: %d", code)
	}
	// The external may read the work domain (work.read), so publishing as the external is legitimate; use the member for the real one.
	var published domainDTO
	if err := pool.QueryRow(ctx, `SELECT current_generation FROM key_domain WHERE id = $1`, domain.Id).Scan(&published.CurrentGeneration); err != nil {
		t.Fatal(err)
	}
	if published.CurrentGeneration == 0 {
		if code := publish(member, memberDevice, 1, all, false); code != http.StatusOK {
			t.Fatalf("publish generation 1: %d", code)
		}
	}
	var domains []domainDTO
	if code := member.do(http.MethodGet, base+"/key-domains", "", &domains); code != http.StatusOK || len(domains) != 1 || domains[0].State != "ok" || !domains[0].Writable || domains[0].CurrentGeneration != 1 {
		t.Fatalf("domain after generation 1: %d %+v", code, domains)
	}
	var mine []struct {
		Generation        int
		RecipientDeviceId string
	}
	if code := member.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", &mine); code != http.StatusOK || len(mine) != 2 {
		t.Fatalf("a member's envelopes: %d %+v", code, mine)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", nil); code != http.StatusNotFound {
		t.Fatalf("outsider envelopes: %d", code)
	}

	// Removing the external's read permission forces a rotation: writes stop until a new generation exists.
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["chat.read"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	member.do(http.MethodGet, base+"/key-domains", "", &domains)
	if domains[0].State != "rotation_required" || domains[0].Writable {
		t.Fatalf("revoked reader must require rotation: %+v", domains[0])
	}
	if code := external.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", nil); code != http.StatusForbidden {
		t.Fatalf("revoked reader keeps receiving envelopes: %d", code)
	}
	if code := publish(member, memberDevice, 2, all, false); code != http.StatusBadRequest {
		t.Fatalf("an envelope for a device that lost access: %d", code)
	}
	remaining := []testDevice{adminDevice, recovery, memberDevice, memberPhone}
	if code := publish(member, memberDevice, 2, remaining, false); code != http.StatusOK {
		t.Fatalf("rotation: %d", code)
	}
	member.do(http.MethodGet, base+"/key-domains", "", &domains)
	if domains[0].State != "ok" || !domains[0].Writable || domains[0].CurrentGeneration != 2 {
		t.Fatalf("after rotation: %+v", domains[0])
	}

	// A revoked device cannot sign or receive; its removal rotates the key again.
	if code := member.do(http.MethodPost, "/api/v1/devices/"+memberPhone.id+"/revoke", "", nil); code != http.StatusNoContent {
		t.Fatalf("revoke: %d", code)
	}
	member.do(http.MethodGet, base+"/key-domains", "", &domains)
	if domains[0].State != "rotation_required" {
		t.Fatalf("revoked device must require rotation: %+v", domains[0])
	}
	if code := external.do(http.MethodPost, "/api/v1/devices/"+memberDevice.id+"/revoke", "", nil); code != http.StatusNotFound {
		t.Fatalf("revoking someone else's device: %d", code)
	}
	if code := publish(member, memberPhone, 3, []testDevice{adminDevice, recovery, memberDevice}, false); code != http.StatusForbidden {
		t.Fatalf("a revoked device signing: %d", code)
	}
	if code := publish(member, memberDevice, 3, []testDevice{adminDevice, recovery, memberDevice}, false); code != http.StatusOK {
		t.Fatalf("rotation after device revocation: %d", code)
	}

	// A new member with an active device waits for keys, without disturbing writers.
	outsiderDevice := register(outsider, "key-outsider@example.test", "Outsider laptop", "device")
	if code := authorizeWithRoot(admin, outsiderDevice); code != http.StatusOK {
		t.Fatalf("authorize outsider device: %d", code)
	}
	if code := admin.do(http.MethodPost, base+"/members", `{"email":"key-outsider@example.test"}`, nil); code != http.StatusNoContent {
		t.Fatalf("add member: %d", code)
	}
	member.do(http.MethodGet, base+"/key-domains", "", &domains)
	if domains[0].State != "pending_keys" || !domains[0].Writable {
		t.Fatalf("a new reader must leave the domain pending keys but writable: %+v", domains[0])
	}
	if code := publish(member, memberDevice, 4, []testDevice{adminDevice, recovery, memberDevice, outsiderDevice}, false); code != http.StatusOK {
		t.Fatalf("grant history to the new member: %d", code)
	}
	if code := outsider.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", &mine); code != http.StatusOK || len(mine) != 1 || mine[0].Generation != 4 {
		t.Fatalf("new member envelopes: %d %+v", code, mine)
	}
	var stored int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM key_envelope WHERE domain_id = $1`, domain.Id).Scan(&stored); err != nil || stored == 0 {
		t.Fatalf("envelopes stored: %d %v", stored, err)
	}
	raw, _ := json.Marshal(mine)
	if bytes.Contains(raw, []byte("secret")) {
		t.Fatal("responses must never carry secret key material")
	}
}
