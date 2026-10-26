// Package objectstore abstracts the private S3-compatible bucket (Cloudflare R2)
// that holds attachment bytes. The API never proxies file content: it only
// creates multipart uploads and hands out short-lived presigned URLs.
package objectstore

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound is returned when an object or upload does not exist.
var ErrNotFound = errors.New("object not found")

// Part identifies one uploaded multipart part.
type Part struct {
	Number int32
	ETag   string
}

// Store is the subset of bucket operations the application needs.
type Store interface {
	CreateMultipart(ctx context.Context, key string) (uploadID string, err error)
	PresignPart(ctx context.Context, key, uploadID string, part int32, ttl time.Duration) (string, error)
	Complete(ctx context.Context, key, uploadID string, parts []Part) error
	Abort(ctx context.Context, key, uploadID string) error
	Size(ctx context.Context, key string) (int64, error)
	// ReadRange returns length bytes from offset; a short object returns what exists.
	ReadRange(ctx context.Context, key string, offset, length int64) ([]byte, error)
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}

// BucketEnsurer is implemented by stores that can create their bucket, which
// only local development needs.
type BucketEnsurer interface {
	EnsureBucket(ctx context.Context) error
}

// Release frees the bucket resources of an attachment that left the active
// states: the multipart upload when aborted, the object when deleted. It is
// idempotent so cleanup can be retried safely.
func Release(ctx context.Context, store Store, state, key, uploadID string) error {
	switch state {
	case "aborted":
		if uploadID == "pending" {
			return nil
		}
		return store.Abort(ctx, key, uploadID)
	case "deleted":
		return store.Delete(ctx, key)
	}
	return nil
}
