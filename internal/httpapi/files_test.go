package httpapi

import (
	"net/http"
	"testing"

	"github.com/GuilhermeVgl/crewstead-comms/internal/httpapi/gen"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func TestCheckUploadRequest(t *testing.T) {
	id := openapi_types.UUID(uuid.New())
	name := "report.pdf"
	nameEnc := gen.EncryptedBlob("c3ludGhldGljIHRlc3QgZW52ZWxvcGU")
	yes := true
	// 1 byte of plaintext: header + one record of 1 byte + overhead.
	encryptedOne := int64(fileHeaderLength + 1 + fileRecordOverhead)

	cases := []struct {
		name    string
		payload gen.CreateUploadRequest
		want    int
	}{
		{"plain file with a name", gen.CreateUploadRequest{Size: 10, Name: &name}, 0},
		{"empty file", gen.CreateUploadRequest{Size: 0, Name: &name}, http.StatusBadRequest},
		{"plain file over 500 MB", gen.CreateUploadRequest{Size: MaxFileBytes + 1, Name: &name}, http.StatusRequestEntityTooLarge},
		{"plain file at exactly 500 MB", gen.CreateUploadRequest{Size: MaxFileBytes, Name: &name}, 0},
		{"no name and no encrypted name", gen.CreateUploadRequest{Size: 10}, http.StatusBadRequest},
		{"both name and encrypted name", gen.CreateUploadRequest{Size: 10, Name: &name, NameEnc: &nameEnc, Id: &id, SignerDeviceId: &id}, http.StatusBadRequest},
		{"encrypted name needs the id and signer", gen.CreateUploadRequest{Size: 10, NameEnc: &nameEnc}, http.StatusBadRequest},
		{"encrypted name with id and signer", gen.CreateUploadRequest{Size: 10, NameEnc: &nameEnc, Id: &id, SignerDeviceId: &id}, 0},
		{"encrypted body with an impossible size", gen.CreateUploadRequest{Size: 5, Name: &name, BodyEncrypted: &yes, Id: &id, SignerDeviceId: &id}, http.StatusBadRequest},
		{"encrypted body needs the id and signer", gen.CreateUploadRequest{Size: encryptedOne, Name: &name, BodyEncrypted: &yes}, http.StatusBadRequest},
		{"encrypted body of one byte", gen.CreateUploadRequest{Size: encryptedOne, Name: &name, BodyEncrypted: &yes, Id: &id, SignerDeviceId: &id}, 0},
		{"encrypted body over the physical bound", gen.CreateUploadRequest{Size: MaxFileBytes + maxFileOverhead + 1, Name: &name, BodyEncrypted: &yes, Id: &id, SignerDeviceId: &id}, http.StatusRequestEntityTooLarge},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := checkUploadRequest(c.payload); got != c.want {
				t.Fatalf("checkUploadRequest = %d, want %d", got, c.want)
			}
		})
	}
}

func TestUploadPartCount(t *testing.T) {
	for size, want := range map[int64]int32{1: 1, uploadPartSize: 1, uploadPartSize + 1: 2, 3 * uploadPartSize: 3} {
		if got := uploadPartCount(size); got != want {
			t.Fatalf("uploadPartCount(%d) = %d, want %d", size, got, want)
		}
	}
}
