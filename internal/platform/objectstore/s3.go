package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// S3Config configures an S3-compatible endpoint; for R2 the endpoint is
// https://<account>.r2.cloudflarestorage.com and the region is "auto".
type S3Config struct {
	Endpoint string
	// PublicEndpoint is the address browsers use for presigned URLs when it
	// differs from Endpoint (local MinIO behind Docker). Empty means Endpoint.
	PublicEndpoint  string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	Region          string
	PathStyle       bool
}

type s3Store struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

// NewS3 builds a Store without contacting the network.
func NewS3(config S3Config) (Store, error) {
	if config.Endpoint == "" || config.Bucket == "" || config.AccessKeyID == "" || config.SecretAccessKey == "" {
		return nil, errors.New("endpoint, bucket and credentials are required")
	}
	region := config.Region
	if region == "" {
		region = "auto"
	}
	client := s3.New(s3.Options{
		Region:       region,
		BaseEndpoint: aws.String(config.Endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(config.AccessKeyID, config.SecretAccessKey, ""),
		UsePathStyle: config.PathStyle,
	})
	presigner := client
	if config.PublicEndpoint != "" && config.PublicEndpoint != config.Endpoint {
		presigner = s3.New(s3.Options{
			Region:       region,
			BaseEndpoint: aws.String(config.PublicEndpoint),
			Credentials:  credentials.NewStaticCredentialsProvider(config.AccessKeyID, config.SecretAccessKey, ""),
			UsePathStyle: config.PathStyle,
		})
	}
	return &s3Store{client: client, presign: s3.NewPresignClient(presigner), bucket: config.Bucket}, nil
}

// EnsureBucket creates the bucket when it does not exist. Meant for the local
// MinIO that stands in for R2.
func (s *s3Store) EnsureBucket(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: &s.bucket}); err == nil {
		return nil
	}
	if _, err := s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: &s.bucket}); err != nil {
		var exists *types.BucketAlreadyOwnedByYou
		if errors.As(err, &exists) {
			return nil
		}
		return fmt.Errorf("create bucket: %w", err)
	}
	return nil
}

func (s *s3Store) CreateMultipart(ctx context.Context, key string) (string, error) {
	out, err := s.client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket: &s.bucket, Key: &key, ContentType: aws.String("application/octet-stream"),
	})
	if err != nil {
		return "", fmt.Errorf("create multipart upload: %w", err)
	}
	return aws.ToString(out.UploadId), nil
}

func (s *s3Store) PresignPart(ctx context.Context, key, uploadID string, part int32, ttl time.Duration) (string, error) {
	request, err := s.presign.PresignUploadPart(ctx, &s3.UploadPartInput{
		Bucket: &s.bucket, Key: &key, UploadId: &uploadID, PartNumber: &part,
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign part: %w", err)
	}
	return request.URL, nil
}

func (s *s3Store) Complete(ctx context.Context, key, uploadID string, parts []Part) error {
	completed := make([]types.CompletedPart, 0, len(parts))
	for _, part := range parts {
		completed = append(completed, types.CompletedPart{PartNumber: aws.Int32(part.Number), ETag: aws.String(part.ETag)})
	}
	_, err := s.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket: &s.bucket, Key: &key, UploadId: &uploadID,
		MultipartUpload: &types.CompletedMultipartUpload{Parts: completed},
	})
	if err != nil {
		return fmt.Errorf("complete multipart upload: %w", mapError(err))
	}
	return nil
}

func (s *s3Store) Abort(ctx context.Context, key, uploadID string) error {
	_, err := s.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{Bucket: &s.bucket, Key: &key, UploadId: &uploadID})
	if err != nil && !errors.Is(mapError(err), ErrNotFound) {
		return fmt.Errorf("abort multipart upload: %w", err)
	}
	return nil
}

func (s *s3Store) Size(ctx context.Context, key string) (int64, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return 0, fmt.Errorf("head object: %w", mapError(err))
	}
	return aws.ToInt64(out.ContentLength), nil
}

func (s *s3Store) ReadRange(ctx context.Context, key string, offset, length int64) ([]byte, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: &s.bucket, Key: &key, Range: aws.String(fmt.Sprintf("bytes=%d-%d", offset, offset+length-1)),
	})
	if err != nil {
		return nil, fmt.Errorf("get object range: %w", mapError(err))
	}
	defer func() { _ = out.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(out.Body, length))
	if err != nil {
		return nil, fmt.Errorf("read object range: %w", err)
	}
	return data, nil
}

func (s *s3Store) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	request, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("presign get: %w", err)
	}
	return request.URL, nil
}

func (s *s3Store) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		return fmt.Errorf("delete object: %w", err)
	}
	return nil
}

// mapError turns provider "missing" codes into ErrNotFound.
func mapError(err error) error {
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NoSuchUpload", "NotFound":
			return ErrNotFound
		}
	}
	return err
}
