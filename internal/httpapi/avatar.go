package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// MaxAvatarBytes is the largest stored photo: the browser resizes to a small
// square first, so anything bigger is not a profile photo.
const MaxAvatarBytes = 256 << 10

// avatarKind checks the first bytes against the declared type. The server never
// decodes or re-encodes the image; it only refuses what is not one of the three
// formats browsers draw safely in an <img> (no SVG, which can carry script).
func avatarKind(contentType string, data []byte) bool {
	switch contentType {
	case "image/jpeg":
		return bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF})
	case "image/png":
		return bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'})
	case "image/webp":
		return len(data) > 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
	}
	return false
}

// PutAvatar stores the caller's photo and tells the people who can see it.
func (h *healthHandler) PutAvatar(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	contentType := r.Header.Get("Content-Type")
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxAvatarBytes+1))
	if err != nil || len(data) > MaxAvatarBytes {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if !avatarKind(contentType, data) {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if _, err = q.UpsertAvatar(ctx, sqlc.UpsertAvatarParams{AccountID: session.AccountID, ContentType: contentType, Data: data}); err == nil {
		err = announceAvatar(ctx, q, session.AccountID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *healthHandler) DeleteAvatar(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := h.auth.pool.Begin(ctx)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := sqlc.New(tx)
	if _, err = q.DeleteAvatar(ctx, session.AccountID); err == nil {
		err = announceAvatar(ctx, q, session.AccountID)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func announceAvatar(ctx context.Context, q *sqlc.Queries, account pgtype.UUID) error {
	others, err := q.ListCoMembers(ctx, account)
	if err != nil {
		return err
	}
	return emitEvent(ctx, q, append(others, account), eventSpec{Type: "avatar.changed", ResourceID: account})
}

// visibleAvatars is what the caller may see: themselves, people who share a
// project with them, and everyone for an administrator.
func (h *healthHandler) visibleAvatars(ctx context.Context, q *sqlc.Queries, session sqlc.FindActiveSessionByTokenHashRow) (map[pgtype.UUID]int64, error) {
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		return nil, err
	}
	rows, err := q.ListVisibleAvatars(ctx, sqlc.ListVisibleAvatarsParams{Me: session.AccountID, IsAdmin: session.IsAdmin, OrganizationID: membership.OrganizationID})
	if err != nil {
		return nil, err
	}
	visible := make(map[pgtype.UUID]int64, len(rows))
	for _, row := range rows {
		visible[row.AccountID] = row.Version
	}
	return visible, nil
}

func (h *healthHandler) ListAvatars(w http.ResponseWriter, r *http.Request) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	visible, err := h.visibleAvatars(ctx, sqlc.New(h.auth.pool), session)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	list := make([]gen.AvatarVersion, 0, len(visible))
	for account, version := range visible {
		list = append(list, gen.AvatarVersion{AccountId: fromPG(account), Version: version})
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *healthHandler) GetAvatar(w http.ResponseWriter, r *http.Request, accountId openapi_types.UUID) {
	session, ok := h.reader(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	target := pgUUID(uuidFrom(accountId))
	visible, err := h.visibleAvatars(ctx, q, session)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if _, allowed := visible[target]; !allowed {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	avatar, err := q.GetAvatar(ctx, target)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	sum := sha256.Sum256(avatar.Data)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`
	header := w.Header()
	header.Set("Content-Type", avatar.ContentType)
	header.Set("ETag", etag)
	// Private: it is only for people who may see it. The page asks for it with
	// a ?v= version, so a changed photo is fetched at once.
	header.Set("Cache-Control", "private, max-age=3600")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	header.Set("Content-Length", strconv.Itoa(len(avatar.Data)))
	_, _ = w.Write(avatar.Data)
}
