//go:build integration

package integration

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi"
	"github.com/GuilhermeVgl/crewstead-comms/internal/keys"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

const fixturePassword = "correct fixture password"

// e2eeFixture is a small organization with trusted devices, shared by the DM, name and recovery tests.
type e2eeFixture struct {
	t        *testing.T
	ctx      context.Context
	pool     *pgxpool.Pool
	handler  http.Handler
	orgID    string
	accounts map[string]string
	clients  map[string]*workClient
	root     ed25519.PrivateKey
	devices  map[string]testDevice
	recovery testDevice
}

func newE2EEFixture(t *testing.T, orgSeed string, prefix string, emails []string) *e2eeFixture {
	t.Helper()
	ctx, pool := openTestPool(t, 90*time.Second)
	organizationID := newTestOrganization(t, ctx, pool, orgSeed, "UTC", prefix+"-%@example.test")
	f := &e2eeFixture{
		t: t, ctx: ctx, pool: pool, accounts: map[string]string{}, clients: map[string]*workClient{}, devices: map[string]testDevice{},
		orgID: formatUUID(organizationID),
	}
	queries := sqlc.New(pool)
	for _, name := range emails {
		kind := "internal"
		if strings.HasPrefix(name, "external") {
			kind = "external"
		}
		f.accounts[name] = createTestAccount(t, ctx, queries, organizationID, prefix+"-"+name+"@example.test", fixturePassword, kind, name == "admin")
	}
	var err error
	f.handler, err = httpapi.NewAppHandler(pool)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range emails {
		f.clients[name] = f.login(prefix + "-" + name + "@example.test")
	}
	rootPublic, rootSecret, _ := ed25519.GenerateKey(rand.Reader)
	f.root = rootSecret
	if code := f.clients["admin"].do(http.MethodPut, "/api/v1/e2ee/trust-root", fmt.Sprintf(`{"signPublicKey":%q}`, b64url.EncodeToString(rootPublic)), nil); code != http.StatusOK {
		t.Fatalf("trust root: %d", code)
	}
	f.recovery = f.activate("admin", "Recovery", "recovery")
	return f
}

func (f *e2eeFixture) login(email string) *workClient {
	return loginClient(f.t, f.handler, email, fixturePassword)
}

// activate registers a device for the person and approves it with the trust root.
func (f *e2eeFixture) activate(name, deviceName, kind string) testDevice {
	f.t.Helper()
	public, secret, _ := ed25519.GenerateKey(rand.Reader)
	box := make([]byte, 32)
	_, _ = rand.Read(box)
	var created deviceDTO
	if code := f.clients[name].do(http.MethodPost, "/api/v1/devices", fmt.Sprintf(`{"name":%q,"kind":%q,"signPublicKey":%q,"boxPublicKey":%q}`, deviceName, kind, b64url.EncodeToString(public), b64url.EncodeToString(box)), &created); code != http.StatusCreated {
		f.t.Fatalf("register: %d", code)
	}
	device := testDevice{id: created.Id, account: f.accounts[name], signPublic: public, signSecret: secret, boxPublic: box}
	certificate := b64url.EncodeToString(ed25519.Sign(f.root, keys.DeviceCertificateBytes(keys.DeviceCertificate{AccountID: device.account, DeviceID: device.id, SignPublicKey: public, BoxPublicKey: box})))
	if code := f.clients["admin"].do(http.MethodPost, "/api/v1/devices/"+device.id+"/authorize", fmt.Sprintf(`{"certificate":%q}`, certificate), nil); code != http.StatusOK {
		f.t.Fatalf("authorize: %d", code)
	}
	if kind == "device" {
		f.devices[name] = device
	}
	return device
}

func (f *e2eeFixture) publish(client *workClient, domainID string, signer testDevice, generation int, recipients []testDevice) int {
	parts := make([]string, len(recipients))
	for i, recipient := range recipients {
		sealed := make([]byte, 80)
		_, _ = rand.Read(sealed)
		signature := ed25519.Sign(signer.signSecret, keys.KeyEnvelopeBytes(keys.KeyEnvelope{RecipientDeviceID: recipient.id, DomainID: domainID, Generation: uint32(generation), Sealed: sealed}))
		parts[i] = fmt.Sprintf(`{"recipientDeviceId":%q,"sealed":%q,"signature":%q}`, recipient.id, b64url.EncodeToString(sealed), b64url.EncodeToString(signature))
	}
	return client.do(http.MethodPost, "/api/v1/key-domains/"+domainID+"/generations", fmt.Sprintf(`{"generation":%d,"signerDeviceId":%q,"envelopes":[%s]}`, generation, signer.id, strings.Join(parts, ",")), nil)
}

// content builds a signed envelope with an opaque ciphertext, as packages/crypto would.
func (f *e2eeFixture) content(domainID string, signer testDevice, author string, generation uint32, resource string, revision uint64) string {
	header := make([]byte, 30)
	header[0], header[1] = 1, 1
	binary.BigEndian.PutUint32(header[2:6], generation)
	_, _ = rand.Read(header[6:])
	ciphertext := make([]byte, 40)
	_, _ = rand.Read(ciphertext)
	signature := ed25519.Sign(signer.signSecret, keys.ContentSignedBytes(keys.ContentMetadata{
		OrganizationID: f.orgID, DomainID: domainID, ResourceID: resource, AuthorID: author, Revision: revision,
	}, header, ciphertext))
	return b64url.EncodeToString(append(append(header, ciphertext...), signature...))
}

func TestDirectMessageKeyDomain(t *testing.T) {
	f := newE2EEFixture(t, "7b000000-0000-4000-8000-000000000001", "dm", []string{"admin", "ana", "bia", "carlos"})
	ana, bia := f.clients["ana"], f.clients["bia"]
	anaDevice, biaDevice := f.activate("ana", "Ana", "device"), f.activate("bia", "Bia", "device")

	var project struct{ Id string }
	f.clients["admin"].do(http.MethodPost, "/api/v1/projects", `{"name":"Equipe"}`, &project)
	for _, name := range []string{"ana", "bia", "carlos"} {
		f.clients["admin"].do(http.MethodPost, "/api/v1/projects/"+project.Id+"/members", `{"email":"dm-`+name+`@example.test"}`, nil)
	}
	var dm struct{ Id string }
	if code := ana.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+f.accounts["bia"]+`"}`, &dm); code != http.StatusCreated {
		t.Fatalf("dm: %d", code)
	}
	path := "/api/v1/conversations/" + dm.Id + "/key-domain"
	if code := f.clients["carlos"].do(http.MethodPost, path, "", nil); code != http.StatusNotFound {
		t.Fatalf("a third person creating the DM domain: %d", code)
	}
	if code := ana.do(http.MethodGet, path, "", nil); code != http.StatusNotFound {
		t.Fatalf("no domain yet: %d", code)
	}
	var domain domainDTO
	if code := ana.do(http.MethodPost, path, "", &domain); code != http.StatusCreated || domain.State != "pending_keys" {
		t.Fatalf("create DM domain: %d %+v", code, domain)
	}
	if code := bia.do(http.MethodPost, path, "", nil); code != http.StatusConflict {
		t.Fatalf("one domain per DM: %d", code)
	}
	var channel struct{ Id string }
	var channels []struct{ Id string }
	ana.do(http.MethodGet, "/api/v1/projects/"+project.Id+"/conversations", "", &channels)
	channel = channels[0]
	if code := ana.do(http.MethodPost, "/api/v1/conversations/"+channel.Id+"/key-domain", "", nil); code != http.StatusNotFound {
		t.Fatalf("a channel has no DM domain: %d", code)
	}
	// Only the two participants (and the recovery identity) are recipients.
	if code := f.clients["carlos"].do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/authorized-devices", "", nil); code != http.StatusNotFound {
		t.Fatalf("a third person reading the domain: %d", code)
	}
	everyone := []testDevice{anaDevice, biaDevice, f.recovery}
	if code := f.publish(ana, domain.Id, anaDevice, 1, []testDevice{anaDevice, f.recovery}); code != http.StatusConflict {
		t.Fatalf("a generation missing the other participant: %d", code)
	}
	if code := f.publish(ana, domain.Id, anaDevice, 1, append(everyone, f.devices["admin"])); code == http.StatusOK {
		t.Fatalf("a generation addressed to someone outside the DM must be refused")
	}
	if code := f.publish(ana, domain.Id, anaDevice, 1, everyone); code != http.StatusOK {
		t.Fatalf("publish: %d", code)
	}
	dmMessages := "/api/v1/conversations/" + dm.Id + "/messages"
	if code := ana.do(http.MethodPost, dmMessages, `{"body":"claro","clientMutationId":"00000000-0000-4000-8000-0000000005a1"}`, nil); code != http.StatusConflict {
		t.Fatalf("plaintext in a keyed DM: %d", code)
	}
	mutation := "00000000-0000-4000-8000-0000000005a2"
	body := func(c *e2eeFixture, device testDevice, who string, rev uint64) string {
		return fmt.Sprintf(`{"clientMutationId":%q,"bodyEnc":%q,"signerDeviceId":%q}`, mutation, c.content(domain.Id, device, c.accounts[who], 1, "msg:"+mutation, rev), device.id)
	}
	var sent struct{ Encrypted bool }
	if code := ana.do(http.MethodPost, dmMessages, body(f, anaDevice, "ana", 1), &sent); code != http.StatusCreated || !sent.Encrypted {
		t.Fatalf("encrypted DM message: %d", code)
	}
	var page []struct {
		Encrypted bool
		BodyEnc   string
	}
	if code := bia.do(http.MethodGet, dmMessages, "", &page); code != http.StatusOK || len(page) != 1 || page[0].BodyEnc == "" {
		t.Fatalf("the other participant reads it: %d %+v", code, page)
	}
	// Revoking a participant's device ends writes until the key is renewed.
	if code := bia.do(http.MethodPost, "/api/v1/devices/"+biaDevice.id+"/revoke", "", nil); code != http.StatusNoContent {
		t.Fatalf("revoke: %d", code)
	}
	var current domainDTO
	ana.do(http.MethodGet, path, "", &current)
	if current.State != "rotation_required" || current.Writable {
		t.Fatalf("a revoked DM device must force rotation: %+v", current)
	}
	f.activate("bia", "Bia 2", "device")
	biaNew := f.devices["bia"]
	if code := f.publish(ana, domain.Id, anaDevice, 2, []testDevice{anaDevice, biaNew, f.recovery}); code != http.StatusOK {
		t.Fatalf("rotate: %d", code)
	}
}

func TestEncryptedNamesOfProjectsChannelsAndSprints(t *testing.T) {
	f := newE2EEFixture(t, "7c000000-0000-4000-8000-000000000001", "nm", []string{"admin", "ana", "external-ext"})
	admin, ana := f.clients["admin"], f.clients["ana"]
	adminDevice, anaDevice := f.activate("admin", "Admin", "device"), f.activate("ana", "Ana", "device")

	var project struct{ Id string }
	if code := admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Nome secreto","description":"descrição secreta"}`, &project); code != http.StatusCreated {
		t.Fatalf("project: %d", code)
	}
	base := "/api/v1/projects/" + project.Id
	admin.do(http.MethodPost, base+"/members", `{"email":"nm-ana@example.test"}`, nil)
	var channels []struct {
		Id   string
		Name string
	}
	admin.do(http.MethodGet, base+"/conversations", "", &channels)

	var workDomain, chatDomain domainDTO
	admin.do(http.MethodPost, base+"/key-domains", `{"kind":"work"}`, &workDomain)
	admin.do(http.MethodPost, base+"/key-domains", `{"kind":"chat"}`, &chatDomain)
	var sprintDomain domainDTO
	if code := ana.do(http.MethodPost, "/api/v1/e2ee/sprint-domain", "", nil); code != http.StatusForbidden {
		t.Fatalf("a non-admin creating the sprint domain: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/e2ee/sprint-domain", "", &sprintDomain); code != http.StatusCreated {
		t.Fatalf("sprint domain: %d", code)
	}
	if code := admin.do(http.MethodPost, "/api/v1/e2ee/sprint-domain", "", nil); code != http.StatusConflict {
		t.Fatalf("one sprint domain: %d", code)
	}
	if code := f.clients["external-ext"].do(http.MethodGet, "/api/v1/e2ee/sprint-domain", "", nil); code != http.StatusNotFound {
		t.Fatalf("an external seeing the sprint domain: %d", code)
	}
	everyone := []testDevice{adminDevice, anaDevice, f.recovery}
	for _, domain := range []domainDTO{workDomain, chatDomain, sprintDomain} {
		if code := f.publish(admin, domain.Id, adminDevice, 1, everyone); code != http.StatusOK {
			t.Fatalf("publish %s: %d", domain.Id, code)
		}
	}

	projectEnc := func(rev uint64) string {
		return fmt.Sprintf(`{"nameEnc":%q,"descriptionEnc":%q,"signerDeviceId":%q,"contentRevision":%d}`,
			f.content(workDomain.Id, adminDevice, f.accounts["admin"], 1, "pn:"+project.Id+":name", rev),
			f.content(workDomain.Id, adminDevice, f.accounts["admin"], 1, "pn:"+project.Id+":desc", rev), adminDevice.id, rev)
	}
	if code := ana.do(http.MethodPatch, base, projectEnc(1), nil); code != http.StatusForbidden {
		t.Fatalf("a non-manager encrypting the project: %d", code)
	}
	if code := admin.do(http.MethodPatch, base, projectEnc(2), nil); code != http.StatusConflict {
		t.Fatalf("skipping a revision: %d", code)
	}
	if code := admin.do(http.MethodPatch, base, projectEnc(1), nil); code != http.StatusNoContent {
		t.Fatalf("encrypt the project: %d", code)
	}
	var left int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM project WHERE id = $1 AND (name <> '' OR description <> '')`, project.Id).Scan(&left); err != nil || left != 0 {
		t.Fatalf("the project's plaintext must be erased: %d %v", left, err)
	}
	var listed []struct {
		Id        string
		Name      string
		Encrypted bool
		NameEnc   string
	}
	if code := ana.do(http.MethodGet, "/api/v1/projects", "", &listed); code != http.StatusOK || len(listed) != 1 || !listed[0].Encrypted || listed[0].Name != "" || listed[0].NameEnc == "" {
		t.Fatalf("project list: %d %+v", code, listed)
	}

	channelBody := fmt.Sprintf(`{"nameEnc":%q,"signerDeviceId":%q,"contentRevision":1}`, f.content(chatDomain.Id, adminDevice, f.accounts["admin"], 1, "cn:"+channels[0].Id, 1), adminDevice.id)
	if code := ana.do(http.MethodPatch, "/api/v1/conversations/"+channels[0].Id, channelBody, nil); code != http.StatusForbidden {
		t.Fatalf("a non-manager renaming a channel: %d", code)
	}
	if code := admin.do(http.MethodPatch, "/api/v1/conversations/"+channels[0].Id, channelBody, nil); code != http.StatusNoContent {
		t.Fatalf("encrypt the channel name: %d", code)
	}
	var encryptedChannels []struct {
		Name      string
		Encrypted bool
	}
	admin.do(http.MethodGet, base+"/conversations", "", &encryptedChannels)
	if len(encryptedChannels) != 1 || !encryptedChannels[0].Encrypted || encryptedChannels[0].Name != "" {
		t.Fatalf("channel list: %+v", encryptedChannels)
	}

	// Sprints: plaintext is refused once the domain is keyed; encrypted creation is bound to its ID.
	if code := admin.do(http.MethodPost, "/api/v1/sprints", `{"name":"claro","startsOn":"2026-11-02","endsOn":"2026-11-13"}`, nil); code != http.StatusConflict {
		t.Fatalf("plaintext sprint after keying: %d", code)
	}
	sprintID := "00000000-0000-4000-8000-0000000006a1"
	sprintBody := fmt.Sprintf(`{"id":%q,"startsOn":"2026-11-02","endsOn":"2026-11-13","nameEnc":%q,"goalEnc":%q,"signerDeviceId":%q}`, sprintID,
		f.content(sprintDomain.Id, adminDevice, f.accounts["admin"], 1, "sp:"+sprintID+":name", 1),
		f.content(sprintDomain.Id, adminDevice, f.accounts["admin"], 1, "sp:"+sprintID+":goal", 1), adminDevice.id)
	if code := ana.do(http.MethodPost, "/api/v1/sprints", sprintBody, nil); code != http.StatusForbidden {
		t.Fatalf("a member planning a sprint: %d", code)
	}
	var sprint struct {
		Id        string
		Encrypted bool
		Name      string
	}
	if code := admin.do(http.MethodPost, "/api/v1/sprints", sprintBody, &sprint); code != http.StatusCreated || !sprint.Encrypted || sprint.Name != "" {
		t.Fatalf("encrypted sprint: %d %+v", code, sprint)
	}
	wrongID := strings.Replace(sprintBody, sprintID, "00000000-0000-4000-8000-0000000006a2", 1)
	if code := admin.do(http.MethodPost, "/api/v1/sprints", wrongID, nil); code != http.StatusBadRequest {
		t.Fatalf("an envelope bound to another sprint: %d", code)
	}
	update := fmt.Sprintf(`{"nameEnc":%q,"goalEnc":%q,"signerDeviceId":%q,"contentRevision":2}`,
		f.content(sprintDomain.Id, adminDevice, f.accounts["admin"], 1, "sp:"+sprintID+":name", 2),
		f.content(sprintDomain.Id, adminDevice, f.accounts["admin"], 1, "sp:"+sprintID+":goal", 2), adminDevice.id)
	if code := admin.do(http.MethodPatch, "/api/v1/sprints/"+sprintID, update, nil); code != http.StatusNoContent {
		t.Fatalf("edit the encrypted sprint: %d", code)
	}
	if code := admin.do(http.MethodPatch, "/api/v1/sprints/"+sprintID, update, nil); code != http.StatusConflict {
		t.Fatalf("replaying the revision: %d", code)
	}
}

func TestAdministrativeRecoveryRestoresAccessWithAuditAndNotice(t *testing.T) {
	f := newE2EEFixture(t, "7d000000-0000-4000-8000-000000000001", "rc", []string{"admin", "ana", "bia"})
	admin, ana, bia := f.clients["admin"], f.clients["ana"], f.clients["bia"]
	adminDevice, anaDevice, biaOld := f.activate("admin", "Admin", "device"), f.activate("ana", "Ana", "device"), f.activate("bia", "Bia", "device")

	var project struct{ Id string }
	admin.do(http.MethodPost, "/api/v1/projects", `{"name":"Equipe"}`, &project)
	for _, name := range []string{"ana", "bia"} {
		admin.do(http.MethodPost, "/api/v1/projects/"+project.Id+"/members", `{"email":"rc-`+name+`@example.test"}`, nil)
	}
	var dm struct{ Id string }
	ana.do(http.MethodPost, "/api/v1/direct-conversations", `{"accountId":"`+f.accounts["bia"]+`"}`, &dm)
	var domain domainDTO
	ana.do(http.MethodPost, "/api/v1/conversations/"+dm.Id+"/key-domain", "", &domain)
	if code := f.publish(ana, domain.Id, anaDevice, 1, []testDevice{anaDevice, biaOld, f.recovery}); code != http.StatusOK {
		t.Fatalf("generation 1: %d", code)
	}

	// Bia loses her only device; Ana rotates; Bia returns with a new device that holds nothing.
	bia.do(http.MethodPost, "/api/v1/devices/"+biaOld.id+"/revoke", "", nil)
	if code := f.publish(ana, domain.Id, anaDevice, 2, []testDevice{anaDevice, f.recovery}); code != http.StatusOK {
		t.Fatalf("generation 2: %d", code)
	}
	biaNew := f.activate("bia", "Bia nova", "device")
	var current domainDTO
	ana.do(http.MethodGet, "/api/v1/conversations/"+dm.Id+"/key-domain", "", &current)
	if current.State != "pending_keys" {
		t.Fatalf("the new device must leave the domain waiting for keys: %+v", current)
	}
	// Nobody else holds Bia's history: neither Ana nor the new device can restore it by themselves.
	if code := f.publish(ana, domain.Id, anaDevice, 3, []testDevice{anaDevice, biaNew, f.recovery}); code != http.StatusOK {
		t.Fatalf("a new generation lets Bia read from now on: %d", code)
	}
	var biaEnvelopes []struct{ Generation int }
	bia.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", &biaEnvelopes)
	if len(biaEnvelopes) != 1 || biaEnvelopes[0].Generation != 3 {
		t.Fatalf("before recovery Bia only reads from generation 3: %+v", biaEnvelopes)
	}

	// Recovery is the administrator's, and nobody else's.
	if code := ana.do(http.MethodGet, "/api/v1/recovery/gaps", "", nil); code != http.StatusForbidden {
		t.Fatalf("a member listing gaps: %d", code)
	}
	if code := ana.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/recovery-envelopes", "", nil); code != http.StatusForbidden {
		t.Fatalf("a member reading recovery envelopes: %d", code)
	}
	var gaps []struct {
		DomainId   string
		Kind       string
		Generation int
		Device     struct{ DeviceId, Email string }
	}
	if code := admin.do(http.MethodGet, "/api/v1/recovery/gaps", "", &gaps); code != http.StatusOK || len(gaps) != 2 {
		t.Fatalf("gaps: %d %+v", code, gaps)
	}
	for _, gap := range gaps {
		if gap.DomainId != domain.Id || gap.Kind != "dm" || gap.Device.DeviceId != biaNew.id || gap.Device.Email != "rc-bia@example.test" {
			t.Fatalf("unexpected gap %+v", gap)
		}
	}
	var held []struct {
		Generation        int
		RecipientDeviceId string
	}
	if code := admin.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/recovery-envelopes", "", &held); code != http.StatusOK || len(held) != 3 {
		t.Fatalf("the recovery identity holds every generation: %d %+v", code, held)
	}
	grant := func(client *workClient, signer testDevice, generation int, recipient testDevice) int {
		sealed := make([]byte, 80)
		_, _ = rand.Read(sealed)
		signature := ed25519.Sign(signer.signSecret, keys.KeyEnvelopeBytes(keys.KeyEnvelope{RecipientDeviceID: recipient.id, DomainID: domain.Id, Generation: uint32(generation), Sealed: sealed}))
		return client.do(http.MethodPost, "/api/v1/key-domains/"+domain.Id+"/recovery-grants", fmt.Sprintf(`{"generation":%d,"signerDeviceId":%q,"envelopes":[{"recipientDeviceId":%q,"sealed":%q,"signature":%q}]}`,
			generation, signer.id, recipient.id, b64url.EncodeToString(sealed), b64url.EncodeToString(signature)), nil)
	}
	if code := grant(ana, anaDevice, 1, biaNew); code != http.StatusForbidden {
		t.Fatalf("a member using the recovery path: %d", code)
	}
	if code := grant(admin, adminDevice, 1, biaOld); code != http.StatusBadRequest {
		t.Fatalf("granting to a revoked device: %d", code)
	}
	if code := grant(admin, adminDevice, 9, biaNew); code != http.StatusConflict {
		t.Fatalf("granting a generation that does not exist: %d", code)
	}
	for _, generation := range []int{1, 2} {
		if code := grant(admin, adminDevice, generation, biaNew); code != http.StatusOK {
			t.Fatalf("recover generation %d: %d", generation, code)
		}
	}
	if code := grant(admin, adminDevice, 1, biaNew); code != http.StatusConflict {
		t.Fatalf("granting twice: %d", code)
	}
	bia.do(http.MethodGet, "/api/v1/key-domains/"+domain.Id+"/envelopes", "", &biaEnvelopes)
	if len(biaEnvelopes) != 3 {
		t.Fatalf("Bia now holds the whole history: %+v", biaEnvelopes)
	}
	admin.do(http.MethodGet, "/api/v1/recovery/gaps", "", &gaps)
	if len(gaps) != 0 {
		t.Fatalf("no gap must remain: %+v", gaps)
	}

	// The use of the recovery identity is recorded and the person is told.
	var audit []struct {
		ApproverEmail, RecipientEmail, DomainKind string
		Generation                                int
	}
	if code := admin.do(http.MethodGet, "/api/v1/recovery/audit", "", &audit); code != http.StatusOK || len(audit) != 2 || audit[0].ApproverEmail != "rc-admin@example.test" || audit[0].RecipientEmail != "rc-bia@example.test" || audit[0].DomainKind != "dm" {
		t.Fatalf("audit: %d %+v", code, audit)
	}
	if code := ana.do(http.MethodGet, "/api/v1/recovery/audit", "", nil); code != http.StatusForbidden {
		t.Fatalf("a member reading the audit: %d", code)
	}
	var notes []struct{ Kind string }
	bia.do(http.MethodGet, "/api/v1/notifications", "", &notes)
	var told int
	for _, note := range notes {
		if note.Kind == "recovery_access" {
			told++
		}
	}
	if told != 2 {
		t.Fatalf("Bia must be notified of each restoration: %+v", notes)
	}
}
