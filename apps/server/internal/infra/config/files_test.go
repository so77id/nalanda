package config_test

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/config"
)

// Issue #338: where the work files live. Local is the default because it is
// what the server did before the variable existed — a deploy that has not
// chosen keeps working — and S3 is opted into with its four variables.

func withS3(overrides map[string]string) map[string]string {
	m := env()
	m[config.KeyFilesStore] = "s3"
	m[config.KeyFilesS3Bucket] = "nalanda-jetson-backups"
	m[config.KeyFilesS3Region] = "us-east-1"
	m[config.KeyFilesS3AccessKeyID] = "AKIAEXAMPLESERVER"
	m[config.KeyFilesS3SecretAccessKey] = "the-s3-secret"
	for k, v := range overrides {
		m[k] = v
	}
	return m
}

func TestAnUnsetFilesStoreIsLocal(t *testing.T) {
	cfg, err := config.Load(lookupFrom(env()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FilesStore != config.FilesStoreLocal {
		t.Errorf("FilesStore = %q, want %q", cfg.FilesStore, config.FilesStoreLocal)
	}
}

func TestTheS3StoreReadsItsVariables(t *testing.T) {
	cfg, err := config.Load(lookupFrom(withS3(nil)))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FilesStore != config.FilesStoreS3 || cfg.FilesS3Bucket != "nalanda-jetson-backups" ||
		cfg.FilesS3Region != "us-east-1" || cfg.FilesS3AccessKeyID != "AKIAEXAMPLESERVER" ||
		cfg.FilesS3SecretAccessKey != "the-s3-secret" {
		t.Errorf("cfg = %+v", cfg)
	}
}

// The closed set's pair: both values accepted (above and below) AND an
// unknown one refused, naming the variable and the legal set.
func TestAnUnknownFilesStoreFailsTheBootNamingTheVariable(t *testing.T) {
	_, err := config.Load(lookupFrom(withS3(map[string]string{config.KeyFilesStore: "bucket"})))
	if err == nil {
		t.Fatal("Load accepted an unknown file store")
	}
	for _, want := range []string{config.KeyFilesStore, "local", "s3"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the error does not name %q: %v", want, err)
		}
	}
}

func TestAFilesStoreIsTrimmed(t *testing.T) {
	cfg, err := config.Load(lookupFrom(withS3(map[string]string{config.KeyFilesStore: " s3\n"})))
	if err != nil || cfg.FilesStore != config.FilesStoreS3 {
		t.Errorf("Load = %q, %v, want s3", cfg.FilesStore, err)
	}
}

// AC-10: s3 without its variables fails the boot naming EVERY missing one,
// in one run — an operator should need one restart to learn what to set.
func TestTheS3StoreRequiresItsFourVariablesAndNamesEveryMissingOne(t *testing.T) {
	m := env()
	m[config.KeyFilesStore] = "s3"
	_, err := config.Load(lookupFrom(m))
	if !errors.Is(err, config.ErrMissing) {
		t.Fatalf("Load = %v, want ErrMissing", err)
	}
	for _, key := range []string{
		config.KeyFilesS3Bucket, config.KeyFilesS3Region,
		config.KeyFilesS3AccessKeyID, config.KeyFilesS3SecretAccessKey,
	} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("the error does not name %s: %v", key, err)
		}
	}
}

func TestTheS3StoreRefusesEachMissingVariableOnItsOwn(t *testing.T) {
	for _, key := range []string{
		config.KeyFilesS3Bucket, config.KeyFilesS3Region,
		config.KeyFilesS3AccessKeyID, config.KeyFilesS3SecretAccessKey,
	} {
		t.Run(key, func(t *testing.T) {
			_, err := config.Load(lookupFrom(withS3(map[string]string{key: ""})))
			if !errors.Is(err, config.ErrMissing) || !strings.Contains(err.Error(), key) {
				t.Errorf("Load without %s = %v, want ErrMissing naming it", key, err)
			}
		})
	}
}

// The migration (S10) runs `-sync-files` with the S3 variables set while
// the store is still local, so local must load them rather than refuse.
func TestTheLocalStoreKeepsTheS3VariablesForTheMigration(t *testing.T) {
	cfg, err := config.Load(lookupFrom(withS3(map[string]string{config.KeyFilesStore: "local"})))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.FilesStore != config.FilesStoreLocal || cfg.FilesS3Bucket != "nalanda-jetson-backups" {
		t.Errorf("cfg = %+v", cfg)
	}
}

// A bucket name S3 would refuse is a typo; catch it at boot, naming the
// variable, rather than on the first upload with an SDK error.
func TestABucketNameS3WouldRefuseFailsTheBoot(t *testing.T) {
	for _, bucket := range []string{"Nalanda", "ab", "nalanda_backups", "-nalanda", "nalanda-", "s3://nalanda"} {
		t.Run(bucket, func(t *testing.T) {
			_, err := config.Load(lookupFrom(withS3(map[string]string{config.KeyFilesS3Bucket: bucket})))
			if err == nil || !strings.Contains(err.Error(), config.KeyFilesS3Bucket) {
				t.Errorf("Load with bucket %q = %v, want an error naming %s", bucket, err, config.KeyFilesS3Bucket)
			}
		})
	}
}

// The server's key can delete the primary copy (#338 §8.7): neither half
// of it reaches a log line, through slog or fmt.
func TestTheS3CredentialsNeverReachALog(t *testing.T) {
	cfg, err := config.Load(lookupFrom(withS3(nil)))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var sb strings.Builder
	slog.New(slog.NewTextHandler(&sb, nil)).Info("boot", "config", cfg)
	printed := sb.String() + fmt.Sprintf("%v %+v %s", cfg, cfg, cfg)
	for _, secret := range []string{"the-s3-secret", "AKIAEXAMPLESERVER"} {
		if strings.Contains(printed, secret) {
			t.Errorf("a log line carries %q: %s", secret, printed)
		}
	}
	// Non-vacuity: the store and the bucket ARE reported, so the redaction
	// is not a LogValue that prints nothing.
	if !strings.Contains(sb.String(), "nalanda-jetson-backups") || !strings.Contains(sb.String(), "files_s3_credentials_set=true") {
		t.Errorf("the log line omits the store's facts: %s", sb.String())
	}
}
