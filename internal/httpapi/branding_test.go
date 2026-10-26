package httpapi

import (
	"encoding/base64"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
)

func TestDecodeBrandLogoRejectsInvalidAndConflictingImages(t *testing.T) {
	png := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/yQAAAABJRU5ErkJggg=="
	mime := gen.UpdateOrganizationBrandingRequestLogoMime("image/png")
	image, kind, changed, valid := decodeBrandLogo(gen.UpdateOrganizationBrandingRequest{LogoBase64: &png, LogoMime: &mime})
	if !valid || !changed || kind != "image/png" || len(image) == 0 {
		t.Fatalf("valid PNG rejected: valid=%t changed=%t kind=%q", valid, changed, kind)
	}
	jpeg := gen.UpdateOrganizationBrandingRequestLogoMime("image/jpeg")
	if _, _, _, valid := decodeBrandLogo(gen.UpdateOrganizationBrandingRequest{LogoBase64: &png, LogoMime: &jpeg}); valid {
		t.Fatal("mismatched MIME accepted")
	}
	bad := base64.StdEncoding.EncodeToString([]byte("<svg onload=alert(1)>"))
	if _, _, _, valid := decodeBrandLogo(gen.UpdateOrganizationBrandingRequest{LogoBase64: &bad, LogoMime: &mime}); valid {
		t.Fatal("non-image data accepted")
	}
	remove := true
	if _, _, _, valid := decodeBrandLogo(gen.UpdateOrganizationBrandingRequest{LogoBase64: &png, LogoMime: &mime, RemoveLogo: &remove}); valid {
		t.Fatal("simultaneous upload and removal accepted")
	}
	if data, kind, changed, valid := decodeBrandLogo(gen.UpdateOrganizationBrandingRequest{RemoveLogo: &remove}); !valid || !changed || data != nil || kind != "" {
		t.Fatal("logo removal rejected")
	}
}
