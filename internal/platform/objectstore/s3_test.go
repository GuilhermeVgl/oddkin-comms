package objectstore

import (
	"context"
	"net/url"
	"testing"
	"time"
)

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
