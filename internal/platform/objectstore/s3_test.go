package objectstore

import (
	"context"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/aws/smithy-go"
)

type fakeAPIError struct{ code string }

func (e fakeAPIError) Error() string                 { return e.code }
func (e fakeAPIError) ErrorCode() string             { return e.code }
func (e fakeAPIError) ErrorMessage() string          { return e.code }
func (e fakeAPIError) ErrorFault() smithy.ErrorFault { return smithy.FaultServer }

func TestS3PresignedURLsAreShortLivedAndScopedToTheObject(t *testing.T) {
	store, err := NewS3(S3Config{
		Endpoint: "https://synthetic-account.r2.example.test", Bucket: "synthetic-bucket",
		AccessKeyID: "SYNTHETIC_KEY_ID", SecretAccessKey: "synthetic-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	put, err := store.PresignPart(context.Background(), "objects/abc", "upload-1", 3, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(put)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("partNumber") != "3" || query.Get("uploadId") != "upload-1" || query.Get("X-Amz-Expires") != "900" {
		t.Fatalf("unexpected part URL query: %v", query)
	}
	get, err := store.PresignGet(context.Background(), "objects/abc", 60*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	parsedGet, _ := url.Parse(get)
	if parsedGet.Query().Get("X-Amz-Expires") != "60" || parsedGet.Query().Get("X-Amz-Signature") == "" {
		t.Fatalf("unexpected download URL: %s", get)
	}
}

func TestS3RequiresCompleteConfiguration(t *testing.T) {
	if _, err := NewS3(S3Config{Endpoint: "https://x.example.test"}); err == nil {
		t.Fatal("incomplete configuration must be rejected")
	}
}

func TestBrowserCORSExposesMultipartETag(t *testing.T) {
	rules := browserCORS("https://app.example.test")
	if len(rules) != 1 || len(rules[0].AllowedOrigins) != 1 || rules[0].AllowedOrigins[0] != "https://app.example.test" {
		t.Fatalf("unexpected allowed origins: %#v", rules)
	}
	if len(rules[0].ExposeHeaders) != 1 || rules[0].ExposeHeaders[0] != "ETag" {
		t.Fatalf("the browser must be able to read multipart ETags: %#v", rules)
	}
}

func TestMinIOManagedCORSIsAccepted(t *testing.T) {
	if !corsManagedByServer(fakeAPIError{code: "NotImplemented"}) {
		t.Fatal("MinIO's environment-managed CORS must not stop startup")
	}
	if corsManagedByServer(errors.New("network")) {
		t.Fatal("real bucket failures must still stop startup")
	}
}

func TestS3SignsForThePublicEndpointBrowsersReach(t *testing.T) {
	store, err := NewS3(S3Config{
		Endpoint: "http://storage:9000", PublicEndpoint: "http://127.0.0.1:9000", PathStyle: true,
		Bucket: "synthetic-bucket", AccessKeyID: "SYNTHETIC_KEY_ID", SecretAccessKey: "synthetic-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := store.PresignGet(context.Background(), "objects/abc", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(signed)
	if parsed.Host != "127.0.0.1:9000" || parsed.Path != "/synthetic-bucket/objects/abc" {
		t.Fatalf("a browser must be given the public address, got %s", signed)
	}
}

func TestS3PublicEndpointMayCarryAPathPrefix(t *testing.T) {
	store, err := NewS3(S3Config{
		Endpoint: "http://storage:9090", PublicEndpoint: "http://127.0.0.1:3000/storage", PathStyle: true,
		Bucket: "synthetic-bucket", AccessKeyID: "SYNTHETIC_KEY_ID", SecretAccessKey: "synthetic-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	signed, err := store.PresignPart(context.Background(), "objects/abc", "upload-1", 1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(signed)
	if parsed.Host != "127.0.0.1:3000" || parsed.Path != "/storage/synthetic-bucket/objects/abc" {
		t.Fatalf("the web server proxies /storage, got %s", signed)
	}
}
