//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/GuilhermeVgl/oddkin-comms/internal/httpapi"
	"github.com/GuilhermeVgl/oddkin-comms/internal/identity"
	"github.com/GuilhermeVgl/oddkin-comms/internal/keys"
	"github.com/GuilhermeVgl/oddkin-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEncryptedContentRulesAndMigration(t *testing.T) {
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
	if err := pool.QueryRow(ctx, `INSERT INTO organization (id, timezone) VALUES ('7a000000-0000-4000-8000-000000000001', 'UTC') RETURNING id`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM organization WHERE id = $1`, organizationID); err != nil {
			t.Error(err)
		}
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM account WHERE email_normalized LIKE 'enc-%@example.test'`)
	}()
	orgString := fmt.Sprintf("%x-%x-%x-%x-%x", organizationID.Bytes[0:4], organizationID.Bytes[4:6], organizationID.Bytes[6:8], organizationID.Bytes[8:10], organizationID.Bytes[10:16])
	hash, err := identity.HashPassword("correct encryption password")
	if err != nil {
		t.Fatal(err)
	}
	queries := sqlc.New(pool)
	accounts := map[string]string{}
	for _, email := range []string{"enc-admin@example.test", "enc-member@example.test", "enc-external@example.test"} {
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
		accounts[email] = fmt.Sprintf("%x-%x-%x-%x-%x", account.ID.Bytes[0:4], account.ID.Bytes[4:6], account.ID.Bytes[6:8], account.ID.Bytes[8:10], account.ID.Bytes[10:16])
	}
	handler, err := httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	login := func(email string) *workClient {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"email":"`+email+`","password":"correct encryption password"}`))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		if result.Code != http.StatusNoContent {
			t.Fatalf("login %s: %d", email, result.Code)
		}
		c := &workClient{t: t, handler: handler}
		for _, cookie := range result.Result().Cookies() {
			if cookie.Name == "oddkin_session" {
				c.session = cookie
			}
			if cookie.Name == "oddkin_csrf" {
				c.csrf = cookie
			}
		}
		return c
	}
	admin, member, external := login("enc-admin@example.test"), login("enc-member@example.test"), login("enc-external@example.test")

	rootPublic, rootSecret, _ := ed25519.GenerateKey(rand.Reader)
	if code := admin.do(http.MethodPut, "/api/v1/e2ee/trust-root", fmt.Sprintf(`{"signPublicKey":%q}`, b64url.EncodeToString(rootPublic)), nil); code != http.StatusOK {
		t.Fatalf("root: %d", code)
	}
	activate := func(client *workClient, email, name, kind string) testDevice {
		public, secret, _ := ed25519.GenerateKey(rand.Reader)
		box := make([]byte, 32)
		_, _ = rand.Read(box)
		var created deviceDTO
		if code := client.do(http.MethodPost, "/api/v1/devices", fmt.Sprintf(`{"name":%q,"kind":%q,"signPublicKey":%q,"boxPublicKey":%q}`, name, kind, b64url.EncodeToString(public), b64url.EncodeToString(box)), &created); code != http.StatusCreated {
			t.Fatalf("register: %d", code)
		}
		device := testDevice{id: created.Id, account: accounts[email], signPublic: public, signSecret: secret, boxPublic: box}
		certificate := b64url.EncodeToString(ed25519.Sign(rootSecret, keys.DeviceCertificateBytes(keys.DeviceCertificate{
			AccountID: device.account, DeviceID: device.id, SignPublicKey: public, BoxPublicKey: box,
		})))
		if code := admin.do(http.MethodPost, "/api/v1/devices/"+device.id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate), nil); code != http.StatusOK {
			t.Fatalf("authorize: %d", code)
		}
		return device
	}
	adminDevice := activate(admin, "enc-admin@example.test", "Admin", "device")
	recovery := activate(admin, "enc-admin@example.test", "Recovery", "recovery")
	memberDevice := activate(member, "enc-member@example.test", "Member", "device")
	externalDevice := activate(external, "enc-external@example.test", "External", "device")

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Criptografado"}`, &project); code != http.StatusCreated {
		t.Fatalf("project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	for _, email := range []string{"enc-member@example.test", "enc-external@example.test"} {
		if code := admin.do(http.MethodPost, base+"/members", `{"email":"`+email+`"}`, nil); code != http.StatusNoContent {
			t.Fatalf("member: %d", code)
		}
	}
	var channels []struct{ Id string }
	admin.do(http.MethodGet, base+"/conversations", "", &channels)
	messagesPath := "/api/v1/conversations/" + channels[0].Id + "/messages"
	var columns []struct{ Id string }
	admin.do(http.MethodGet, base+"/columns", "", &columns)

	// Before any generation exists the legacy plaintext path still works.
	var legacyItem struct{ Id string }
	if code := member.do(http.MethodPost, base+"/work-items", `{"kind":"task","title":"Legado","description":"texto em claro"}`, &legacyItem); code != http.StatusCreated {
		t.Fatalf("legacy item: %d", code)
	}
	var legacyComment struct{ Id string }
	if code := member.do(http.MethodPost, "/api/v1/work-items/"+legacyItem.Id+"/comments", `{"body":"comentário antigo"}`, &legacyComment); code != http.StatusCreated {
		t.Fatalf("legacy comment: %d", code)
	}
	var legacyMessage struct{ Id string }
	if code := member.do(http.MethodPost, messagesPath, `{"body":"mensagem antiga","clientMutationId":"00000000-0000-4000-8000-0000000004a1"}`, &legacyMessage); code != http.StatusCreated {
		t.Fatalf("legacy message: %d", code)
	}

	// Key domains with generation 1.
	var workDomain, chatDomain domainDTO
	member.do(http.MethodPost, base+"/key-domains", `{"kind":"work"}`, &workDomain)
	member.do(http.MethodPost, base+"/key-domains", `{"kind":"chat"}`, &chatDomain)
	publish := func(client *workClient, domain domainDTO, signer testDevice, generation int, recipients []testDevice) int {
		parts := make([]string, len(recipients))
		for i, recipient := range recipients {
			sealed := make([]byte, 80)
			_, _ = rand.Read(sealed)
			signature := ed25519.Sign(signer.signSecret, keys.KeyEnvelopeBytes(keys.KeyEnvelope{RecipientDeviceID: recipient.id, DomainID: domain.Id, Generation: uint32(generation), Sealed: sealed}))
			parts[i] = fmt.Sprintf(`{"recipientDeviceId":%q,"sealed":%q,"signature":%q}`, recipient.id, b64url.EncodeToString(sealed), b64url.EncodeToString(signature))
		}
		return client.do(http.MethodPost, "/api/v1/key-domains/"+domain.Id+"/generations", fmt.Sprintf(`{"generation":%d,"signerDeviceId":%q,"envelopes":[%s]}`, generation, signer.id, strings.Join(parts, ",")), nil)
	}
	everyone := []testDevice{adminDevice, recovery, memberDevice, externalDevice}
	if code := publish(member, workDomain, memberDevice, 1, everyone); code != http.StatusOK {
		t.Fatalf("work generation: %d", code)
	}
	if code := publish(member, chatDomain, memberDevice, 1, everyone); code != http.StatusOK {
		t.Fatalf("chat generation: %d", code)
	}

	// content builds an envelope the way packages/crypto does: header, opaque ciphertext, author signature.
	content := func(domain domainDTO, signer testDevice, author string, generation uint32, resource string, revision uint64) string {
		header := make([]byte, 30)
		header[0], header[1] = 1, 1
		binary.BigEndian.PutUint32(header[2:6], generation)
		_, _ = rand.Read(header[6:])
		ciphertext := make([]byte, 40)
		_, _ = rand.Read(ciphertext)
		signature := ed25519.Sign(signer.signSecret, keys.ContentSignedBytes(keys.ContentMetadata{
			OrganizationID: orgString, DomainID: domain.Id, ResourceID: resource, AuthorID: author, Revision: revision,
		}, header, ciphertext))
		return b64url.EncodeToString(append(append(header, ciphertext...), signature...))
	}
	own := func(email string, device testDevice, domain domainDTO, resource string, revision uint64) string {
		return content(domain, device, accounts[email], 1, resource, revision)
	}
	memberEmail := "enc-member@example.test"
	apiError := func(client *workClient, method, path, body string) (int, string) {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Host = "oddkin.test"
		req.Header.Set("Origin", "http://oddkin.test")
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(client.session)
		req.Header.Set("X-CSRF-Token", client.csrf.Value)
		result := httptest.NewRecorder()
		handler.ServeHTTP(result, req)
		return result.Code, result.Body.String()
	}

	// No downgrade: plaintext is refused everywhere once a generation exists.
	for name, request := range map[string][3]string{
		"item":    {http.MethodPost, base + "/work-items", `{"kind":"task","title":"claro"}`},
		"epic":    {http.MethodPost, base + "/epics", `{"title":"claro"}`},
		"comment": {http.MethodPost, "/api/v1/work-items/" + legacyItem.Id + "/comments", `{"body":"claro"}`},
		"message": {http.MethodPost, messagesPath, `{"body":"claro","clientMutationId":"00000000-0000-4000-8000-0000000004a2"}`},
		"edit":    {http.MethodPatch, "/api/v1/work-items/" + legacyItem.Id, `{"version":1,"title":"claro"}`},
	} {
		code, body := apiError(member, request[0], request[1], request[2])
		if code != http.StatusConflict || !strings.Contains(body, "encryption_required") {
			t.Fatalf("plaintext %s must be refused: %d %s", name, code, body)
		}
	}

	// Encrypted item: create, then the failure modes.
	itemID := "00000000-0000-4000-8000-0000000004b1"
	createBody := func(titleEnc, descEnc, signer string) string {
		return fmt.Sprintf(`{"kind":"task","id":%q,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q}`, itemID, titleEnc, descEnc, signer)
	}
	title := func(rev uint64) string { return own(memberEmail, memberDevice, workDomain, "wi:"+itemID+":title", rev) }
	desc := func(rev uint64) string { return own(memberEmail, memberDevice, workDomain, "wi:"+itemID+":desc", rev) }
	if code, body := apiError(member, http.MethodPost, base+"/work-items", createBody(title(1), content(workDomain, memberDevice, accounts[memberEmail], 2, "wi:"+itemID+":desc", 1), memberDevice.id)); code != http.StatusConflict || !strings.Contains(body, "stale_generation") {
		t.Fatalf("stale generation: %d %s", code, body)
	}
	if code, body := apiError(member, http.MethodPost, base+"/work-items", createBody(title(1), content(workDomain, adminDevice, accounts[memberEmail], 1, "wi:"+itemID+":desc", 1), memberDevice.id)); code != http.StatusBadRequest || !strings.Contains(body, "bad_envelope") {
		t.Fatalf("signature by another device: %d %s", code, body)
	}
	otherResource := own(memberEmail, memberDevice, workDomain, "wi:00000000-0000-4000-8000-0000000004ff:desc", 1)
	if code, body := apiError(member, http.MethodPost, base+"/work-items", createBody(title(1), otherResource, memberDevice.id)); code != http.StatusBadRequest || !strings.Contains(body, "bad_envelope") {
		t.Fatalf("envelope bound to another record: %d %s", code, body)
	}
	if code, _ := apiError(member, http.MethodPost, base+"/work-items", createBody(title(1), desc(1), adminDevice.id)); code != http.StatusForbidden {
		t.Fatalf("signer device of someone else: %d", code)
	}
	if code, _ := apiError(member, http.MethodPost, base+"/work-items", createBody(title(2), desc(2), memberDevice.id)); code != http.StatusBadRequest {
		t.Fatalf("a first write must be revision 1: %d", code)
	}
	if code, _ := apiError(member, http.MethodPost, base+"/work-items", fmt.Sprintf(`{"kind":"task","titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q}`, title(1), desc(1), memberDevice.id)); code != http.StatusBadRequest {
		t.Fatalf("encrypted content needs a client-chosen id: %d", code)
	}
	var created struct {
		Id              string
		Encrypted       bool
		Title           string
		TitleEnc        string
		ContentRevision int
		Version         int
	}
	if code := member.do(http.MethodPost, base+"/work-items", createBody(title(1), desc(1), memberDevice.id), &created); code != http.StatusCreated || !created.Encrypted || created.Title != "" || created.TitleEnc == "" || created.Id != itemID {
		t.Fatalf("encrypted create: %d %+v", code, created)
	}
	var plaintextColumns int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM work_item WHERE id = $1 AND title = '' AND description = '' AND title_enc IS NOT NULL`, itemID).Scan(&plaintextColumns); err != nil || plaintextColumns != 1 {
		t.Fatalf("the database must hold no plaintext for an encrypted item: %d %v", plaintextColumns, err)
	}
	if code := member.do(http.MethodPost, base+"/work-items", createBody(title(1), desc(1), memberDevice.id), nil); code != http.StatusConflict {
		t.Fatalf("reusing an id: %d", code)
	}

	// Revisions only move forward by one; a replay is refused.
	updateBody := func(rev int, titleEnc, descEnc string) string {
		return fmt.Sprintf(`{"version":%d,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q,"contentRevision":%d}`, created.Version, titleEnc, descEnc, memberDevice.id, rev)
	}
	if code, body := apiError(member, http.MethodPatch, "/api/v1/work-items/"+itemID, updateBody(3, title(3), desc(3))); code != http.StatusConflict || !strings.Contains(body, "bad_revision") {
		t.Fatalf("skipped revision: %d %s", code, body)
	}
	var edited struct{ Version, ContentRevision int }
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+itemID, updateBody(2, title(2), desc(2)), &edited); code != http.StatusOK || edited.ContentRevision != 2 {
		t.Fatalf("encrypted edit: %d %+v", code, edited)
	}
	created.Version = edited.Version
	if code, body := apiError(member, http.MethodPatch, "/api/v1/work-items/"+itemID, updateBody(2, title(2), desc(2))); code != http.StatusConflict {
		t.Fatalf("replayed revision: %d %s", code, body)
	}

	// Migrating a legacy item: its plaintext disappears from the database.
	legacyTitle := own(memberEmail, memberDevice, workDomain, "wi:"+legacyItem.Id+":title", 1)
	legacyDesc := own(memberEmail, memberDevice, workDomain, "wi:"+legacyItem.Id+":desc", 1)
	if code := member.do(http.MethodPatch, "/api/v1/work-items/"+legacyItem.Id, fmt.Sprintf(`{"version":1,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q,"contentRevision":1}`, legacyTitle, legacyDesc, memberDevice.id), nil); code != http.StatusOK {
		t.Fatalf("migrate legacy item: %d", code)
	}
	var leftover int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM work_item WHERE id = $1 AND (title <> '' OR description <> '') `, legacyItem.Id).Scan(&leftover); err != nil || leftover != 0 {
		t.Fatalf("migration must erase the plaintext: %d %v", leftover, err)
	}

	// A legacy comment can only be encrypted by its author, and its plaintext disappears.
	migrated := fmt.Sprintf(`{"bodyEnc":%q,"signerDeviceId":%q}`, own(memberEmail, memberDevice, workDomain, "wc:"+legacyComment.Id, 1), memberDevice.id)
	if code := admin.do(http.MethodPatch, "/api/v1/comments/"+legacyComment.Id, migrated, nil); code != http.StatusForbidden {
		t.Fatalf("someone else encrypting a comment: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/comments/"+legacyComment.Id, migrated, nil); code != http.StatusNoContent {
		t.Fatalf("migrate legacy comment: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/comments/"+legacyComment.Id, migrated, nil); code != http.StatusConflict {
		t.Fatalf("migrating twice: %d", code)
	}
	var commentPlaintext int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM work_item_comment WHERE id = $1 AND body <> ''`, legacyComment.Id).Scan(&commentPlaintext); err != nil || commentPlaintext != 0 {
		t.Fatalf("legacy comment plaintext must be gone: %d %v", commentPlaintext, err)
	}

	// Comments, epics and messages.
	commentID := "00000000-0000-4000-8000-0000000004c1"
	commentBody := fmt.Sprintf(`{"id":%q,"bodyEnc":%q,"signerDeviceId":%q}`, commentID, own(memberEmail, memberDevice, workDomain, "wc:"+commentID, 1), memberDevice.id)
	if code := member.do(http.MethodPost, "/api/v1/work-items/"+itemID+"/comments", commentBody, nil); code != http.StatusCreated {
		t.Fatalf("encrypted comment: %d", code)
	}
	var comments []struct {
		Encrypted bool
		Body      string
		BodyEnc   string
	}
	if code := external.do(http.MethodGet, "/api/v1/work-items/"+itemID+"/comments", "", &comments); code != http.StatusOK || len(comments) != 1 || !comments[0].Encrypted || comments[0].Body != "" || comments[0].BodyEnc == "" {
		t.Fatalf("comments as served: %d %+v", code, comments)
	}
	epicID := "00000000-0000-4000-8000-0000000004d1"
	if code := member.do(http.MethodPost, base+"/epics", fmt.Sprintf(`{"id":%q,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q}`, epicID,
		own(memberEmail, memberDevice, workDomain, "ep:"+epicID+":title", 1), own(memberEmail, memberDevice, workDomain, "ep:"+epicID+":desc", 1), memberDevice.id), nil); code != http.StatusCreated {
		t.Fatalf("encrypted epic: %d", code)
	}
	mutation := "00000000-0000-4000-8000-0000000004e1"
	messageBody := func(rev uint64) string {
		return fmt.Sprintf(`{"clientMutationId":%q,"bodyEnc":%q,"signerDeviceId":%q}`, mutation, own(memberEmail, memberDevice, chatDomain, "msg:"+mutation, rev), memberDevice.id)
	}
	var sent struct {
		Id        string
		Encrypted bool
		Body      string
	}
	if code := member.do(http.MethodPost, messagesPath, messageBody(1), &sent); code != http.StatusCreated || !sent.Encrypted || sent.Body != "" {
		t.Fatalf("encrypted message: %d %+v", code, sent)
	}
	if code := member.do(http.MethodPost, messagesPath, messageBody(1), nil); code != http.StatusOK {
		t.Fatalf("retrying an encrypted message must be idempotent: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/messages/"+sent.Id, fmt.Sprintf(`{"bodyEnc":%q,"signerDeviceId":%q,"contentRevision":2}`, own(memberEmail, memberDevice, chatDomain, "msg:"+mutation, 2), memberDevice.id), nil); code != http.StatusOK {
		t.Fatalf("encrypted edit: %d", code)
	}
	if code := member.do(http.MethodPatch, "/api/v1/messages/"+sent.Id, `{"body":"claro"}`, nil); code != http.StatusConflict {
		t.Fatalf("plaintext edit of an encrypted channel: %d", code)
	}
	// Migrate the legacy channel message too.
	legacyMutation := "00000000-0000-4000-8000-0000000004a1"
	if code := member.do(http.MethodPatch, "/api/v1/messages/"+legacyMessage.Id, fmt.Sprintf(`{"bodyEnc":%q,"signerDeviceId":%q,"contentRevision":1}`, own(memberEmail, memberDevice, chatDomain, "msg:"+legacyMutation, 1), memberDevice.id), nil); code != http.StatusOK {
		t.Fatalf("migrate legacy message: %d", code)
	}
	var plainLeft int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM message WHERE id = $1 AND body <> ''`, legacyMessage.Id).Scan(&plainLeft); err != nil || plainLeft != 0 {
		t.Fatalf("legacy message plaintext must be gone: %d %v", plainLeft, err)
	}
	var page []struct {
		Encrypted bool
		BodyEnc   string
		Body      string
	}
	if code := external.do(http.MethodGet, messagesPath, "", &page); code != http.StatusOK || len(page) != 2 || !page[0].Encrypted || page[0].Body != "" {
		t.Fatalf("channel as served: %d %+v", code, page)
	}

	// DMs have no key domain yet: they stay plaintext, and encrypted DM writes are refused.
	var dm struct{ Id string }
	if code := member.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+accounts["enc-admin@example.test"]+`"}`, &dm); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("dm: %d", code)
	}
	if code := member.do(http.MethodPost, "/api/v1/conversations/"+dm.Id+"/messages", `{"body":"ainda em claro","clientMutationId":"00000000-0000-4000-8000-0000000004f1"}`, nil); code != http.StatusCreated {
		t.Fatalf("plaintext DM: %d", code)
	}
	if code, body := apiError(member, http.MethodPost, "/api/v1/conversations/"+dm.Id+"/messages", fmt.Sprintf(`{"clientMutationId":"00000000-0000-4000-8000-0000000004f2","bodyEnc":%q,"signerDeviceId":%q}`, own(memberEmail, memberDevice, chatDomain, "msg:00000000-0000-4000-8000-0000000004f2", 1), memberDevice.id)); code != http.StatusConflict || !strings.Contains(body, "domain_unavailable") {
		t.Fatalf("encrypted DM: %d %s", code, body)
	}

	// Rotation blocks writes until a new generation exists; envelopes for history are granted separately.
	if code := admin.do(http.MethodPut, base+"/external-policy", `{"version":1,"permissions":["chat.read"]}`, nil); code != http.StatusOK {
		t.Fatalf("policy: %d", code)
	}
	secondItem := "00000000-0000-4000-8000-0000000004b2"
	blocked := fmt.Sprintf(`{"kind":"task","id":%q,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q}`, secondItem,
		own(memberEmail, memberDevice, workDomain, "wi:"+secondItem+":title", 1), own(memberEmail, memberDevice, workDomain, "wi:"+secondItem+":desc", 1), memberDevice.id)
	if code, body := apiError(member, http.MethodPost, base+"/work-items", blocked); code != http.StatusConflict || !strings.Contains(body, "rotation_required") {
		t.Fatalf("writes during rotation: %d %s", code, body)
	}
	if code := publish(member, workDomain, memberDevice, 2, []testDevice{adminDevice, recovery, memberDevice}); code != http.StatusOK {
		t.Fatalf("rotation: %d", code)
	}
	if code, body := apiError(member, http.MethodPost, base+"/work-items", blocked); code != http.StatusConflict || !strings.Contains(body, "stale_generation") {
		t.Fatalf("a generation-1 envelope after rotation: %d %s", code, body)
	}
	newGeneration := fmt.Sprintf(`{"kind":"task","id":%q,"titleEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q}`, secondItem,
		content(workDomain, memberDevice, accounts[memberEmail], 2, "wi:"+secondItem+":title", 1), content(workDomain, memberDevice, accounts[memberEmail], 2, "wi:"+secondItem+":desc", 1), memberDevice.id)
	if code := member.do(http.MethodPost, base+"/work-items", newGeneration, nil); code != http.StatusCreated {
		t.Fatalf("write with the new generation: %d", code)
	}

	// History for a new reader: a device that lacks generation 1 receives it via the grant endpoint.
	newDevice := activate(member, memberEmail, "Member tablet", "device")
	var recipients []struct {
		Generation int
		DeviceId   string
	}
	member.do(http.MethodGet, "/api/v1/key-domains/"+workDomain.Id+"/recipients", "", &recipients)
	var holds int
	for _, recipient := range recipients {
		if recipient.DeviceId == newDevice.id {
			holds++
		}
	}
	if holds != 0 {
		t.Fatal("a new device must not hold any envelope yet")
	}
	var authorized []struct{ DeviceId string }
	if code := member.do(http.MethodGet, "/api/v1/key-domains/"+workDomain.Id+"/authorized-devices", "", &authorized); code != http.StatusOK || len(authorized) != 4 {
		t.Fatalf("authorized devices: %d %d", code, len(authorized))
	}
	if code := external.do(http.MethodGet, "/api/v1/key-domains/"+workDomain.Id+"/authorized-devices", "", nil); code != http.StatusForbidden {
		t.Fatalf("a non-reader listing authorized devices: %d", code)
	}
	grant := func(generation int, recipient testDevice, tamper bool) int {
		sealed := make([]byte, 80)
		_, _ = rand.Read(sealed)
		signature := ed25519.Sign(memberDevice.signSecret, keys.KeyEnvelopeBytes(keys.KeyEnvelope{RecipientDeviceID: recipient.id, DomainID: workDomain.Id, Generation: uint32(generation), Sealed: sealed}))
		if tamper {
			signature[3] ^= 1
		}
		return member.do(http.MethodPost, "/api/v1/key-domains/"+workDomain.Id+"/envelopes", fmt.Sprintf(`{"generation":%d,"signerDeviceId":%q,"envelopes":[{"recipientDeviceId":%q,"sealed":%q,"signature":%q}]}`,
			generation, memberDevice.id, recipient.id, b64url.EncodeToString(sealed), b64url.EncodeToString(signature)), nil)
	}
	if code := grant(1, externalDevice, false); code != http.StatusBadRequest {
		t.Fatalf("granting history to a device that lost access: %d", code)
	}
	if code := grant(1, newDevice, true); code != http.StatusBadRequest {
		t.Fatalf("forged grant: %d", code)
	}
	if code := grant(1, newDevice, false); code != http.StatusOK {
		t.Fatalf("grant generation 1: %d", code)
	}
	if code := grant(1, newDevice, false); code != http.StatusConflict {
		t.Fatalf("granting twice: %d", code)
	}
	if code := grant(5, newDevice, false); code != http.StatusConflict {
		t.Fatalf("granting a generation that does not exist: %d", code)
	}
	var directoryEntry struct {
		DeviceId, State string
		Certificate     string
	}
	if code := member.do(http.MethodGet, "/api/v1/devices/"+memberDevice.id, "", &directoryEntry); code != http.StatusOK || directoryEntry.State != "active" || directoryEntry.Certificate == "" {
		t.Fatalf("public device record: %d %+v", code, directoryEntry)
	}
}
