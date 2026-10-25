package filestore

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// NewS3Client builds the SDK client the server reaches its bucket with: the
// region and the static key config read, and nothing the SDK would find on
// its own — no shared credentials file, no instance metadata, no AWS_*
// variable, because the client is built from s3.Options rather than the
// SDK's default config loader. Nor is there an endpoint override: HTTPS to
// AWS is the only way out (issue #338 §8.4), and the server user's IAM
// policy denies any request without aws:SecureTransport besides.
func NewS3Client(region, accessKeyID, secretAccessKey string) *s3.Client {
	key := aws.Credentials{
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		Source:          "NALANDA_FILES_S3_ACCESS_KEY_ID",
	}
	return s3.New(s3.Options{
		Region: region,
		Credentials: aws.NewCredentialsCache(aws.CredentialsProviderFunc(
			func(context.Context) (aws.Credentials, error) { return key, nil })),
	})
}
