package objectstore

import (
	"errors"
	"os"
	"strconv"
)

// FromEnv builds the store from R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and
// R2_SECRET_ACCESS_KEY. It returns a nil store when none is set and an error
// when only some are, so a half-configured deployment fails loudly.
func FromEnv() (Store, error) {
	endpoint, bucket := os.Getenv("R2_ENDPOINT"), os.Getenv("R2_BUCKET")
	keyID, secret := os.Getenv("R2_ACCESS_KEY_ID"), os.Getenv("R2_SECRET_ACCESS_KEY")
	set := 0
	for _, value := range []string{endpoint, bucket, keyID, secret} {
		if value != "" {
			set++
		}
	}
	switch set {
	case 0:
		return nil, nil
	case 4:
		return NewS3(S3Config{
			Endpoint: endpoint, Bucket: bucket, AccessKeyID: keyID, SecretAccessKey: secret,
			PathStyle: os.Getenv("R2_PATH_STYLE") == "true",
		})
	default:
		return nil, errors.New("R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required together")
	}
}

// QuotaFromEnv reads STORAGE_QUOTA_BYTES; zero means "use the default".
func QuotaFromEnv() (int64, error) {
	raw := os.Getenv("STORAGE_QUOTA_BYTES")
	if raw == "" {
		return 0, nil
	}
	quota, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || quota <= 0 {
		return 0, errors.New("STORAGE_QUOTA_BYTES must be a positive integer")
	}
	return quota, nil
}
