package httpapi

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/GuilhermeVgl/crewstead-comms/internal/store/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxLogoBytes = 1024 * 1024

func brandingResponse(row sqlc.GetOrganizationBrandingRow) gen.OrganizationBranding {
	return gen.OrganizationBranding{Name: row.Name.String, HasLogo: len(row.LogoData) > 0, ShowDuo: row.ShowDuo}
}

func (h *apiServer) GetOrganizationBranding(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.reader(w, r); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	row, err := sqlc.New(h.auth.pool).GetOrganizationBranding(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, brandingResponse(row))
}

func (h *apiServer) UpdateOrganizationBranding(w http.ResponseWriter, r *http.Request) {
	session, ok := h.mutator(w, r)
	if !ok {
		return
	}
	if !session.IsAdmin {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var payload gen.UpdateOrganizationBrandingRequest
	if !decodeJSONBodyLimit(w, r, &payload, 1500*1024) {
		return
	}
	name := strings.TrimSpace(payload.Name)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 80 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	logo, mimeType, changed, valid := decodeBrandLogo(payload)
	if !valid {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	q := sqlc.New(h.auth.pool)
	membership, err := q.GetOrganizationMembershipForAccount(ctx, session.AccountID)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if err := q.UpdateOrganizationBranding(ctx, sqlc.UpdateOrganizationBrandingParams{
		Name: pgtype.Text{String: name, Valid: true}, ShowDuo: payload.ShowDuo,
		ID: membership.OrganizationID, LogoChanged: changed, LogoData: logo,
		LogoMime: pgtype.Text{String: mimeType, Valid: mimeType != ""},
	}); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	row, err := q.GetOrganizationBranding(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, brandingResponse(row))
}

func decodeBrandLogo(payload gen.UpdateOrganizationBrandingRequest) ([]byte, string, bool, bool) {
	remove := payload.RemoveLogo != nil && *payload.RemoveLogo
	if remove && (payload.LogoBase64 != nil || payload.LogoMime != nil) {
		return nil, "", false, false
	}
	if remove {
		return nil, "", true, true
	}
	if payload.LogoBase64 == nil && payload.LogoMime == nil {
		return nil, "", false, true
	}
	if payload.LogoBase64 == nil || payload.LogoMime == nil || len(*payload.LogoBase64) > base64.StdEncoding.EncodedLen(maxLogoBytes) {
		return nil, "", false, false
	}
	data, err := base64.StdEncoding.Strict().DecodeString(*payload.LogoBase64)
	if err != nil || len(data) == 0 || len(data) > maxLogoBytes {
		return nil, "", false, false
	}
	mimeType := string(*payload.LogoMime)
	if (mimeType != "image/png" && mimeType != "image/jpeg" && mimeType != "image/webp") || http.DetectContentType(data) != mimeType {
		return nil, "", false, false
	}
	return data, mimeType, true, true
}

func (h *apiServer) GetOrganizationLogo(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.reader(w, r); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	row, err := sqlc.New(h.auth.pool).GetOrganizationLogo(ctx)
	if err != nil {
		serverError(w, r, err)
		return
	}
	if len(row.LogoData) == 0 || !row.LogoMime.Valid {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", row.LogoMime.String)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(row.LogoData)
}
