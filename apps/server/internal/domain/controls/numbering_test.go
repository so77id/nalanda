package controls_test

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

// Issue #338, AC-6: with S3 the primary store, the volume can come back
// empty while the bucket holds the control's batches. Numbering from the
// disk alone would hand out batch-1.pdf again, and the next analyse's push
// would overwrite the real batch-1 in S3 — the one destructive bug this
// design can have by construction. A new batch numbers past EVERY batch,
// on disk or in the store.

func saveBatch(t *testing.T, svc *controls.Service, controlID string) (controls.SaveUploadedBatchResult, error) {
	t.Helper()
	return svc.SaveUploadedBatch(context.Background(), controls.UploadRequest{
		ControlID: controlID,
		Filename:  "lote.pdf",
		Content:   io.NopCloser(strings.NewReader("%PDF-nuevo")),
		Ticked:    controls.DefaultTicked,
		Unsure:    controls.DefaultUnsure,
	})
}

func TestANewBatchNumbersPastTheBatchesTheStoreHoldsOnAnEmptyVolume(t *testing.T) {
	svc, _, _, workDir := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatal(err)
	}
	bucket := s3test.New()
	bucket.Put("work/controls/"+control.ID+"/uploads/batch-1.pdf", []byte("%PDF-uno"))
	bucket.Put("work/controls/"+control.ID+"/uploads/batch-2.pdf", []byte("%PDF-dos"))
	svc.Files = filestore.NewS3(bucket, "nalanda-test")

	save, err := saveBatch(t, svc, control.ID)
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	if save.BatchName != "batch-3.pdf" {
		t.Errorf("the new batch is %s, want batch-3.pdf — batch-1 and batch-2 are in the store", save.BatchName)
	}
	if _, err := os.Stat(filepath.Join(workDir, "controls", control.ID, "uploads", "batch-3.pdf")); err != nil {
		t.Errorf("the batch was not written where its number says: %v", err)
	}
	if got, _ := bucket.Get("work/controls/" + control.ID + "/uploads/batch-1.pdf"); string(got.Body) != "%PDF-uno" {
		t.Errorf("the stored batch-1 changed: %q", got.Body)
	}
}

// The union, both ways: a batch only the disk holds (written while the
// store was unreachable, or before the migration) counts too.
func TestANewBatchNumbersPastTheBatchesOnDiskThatTheStoreLacks(t *testing.T) {
	svc, _, _, workDir := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatal(err)
	}
	uploads := filepath.Join(workDir, "controls", control.ID, "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploads, "batch-4.pdf"), []byte("%PDF-cuatro"), 0o644); err != nil {
		t.Fatal(err)
	}
	bucket := s3test.New()
	bucket.Put("work/controls/"+control.ID+"/uploads/batch-1.pdf", []byte("%PDF-uno"))
	svc.Files = filestore.NewS3(bucket, "nalanda-test")

	save, err := saveBatch(t, svc, control.ID)
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	if save.BatchName != "batch-5.pdf" {
		t.Errorf("the new batch is %s, want batch-5.pdf — batch-4 is on disk", save.BatchName)
	}
}

// A store that cannot answer cannot say which numbers are taken: the upload
// is refused rather than numbered blind, and nothing is written.
func TestAnUploadIsRefusedWhenTheStoreCannotListItsBatches(t *testing.T) {
	svc, _, _, workDir := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatal(err)
	}
	bucket := s3test.New()
	bucket.FailOn = func(op, _ string) error {
		if op == "ListObjectsV2" {
			return errors.New("dial tcp: i/o timeout")
		}
		return nil
	}
	svc.Files = filestore.NewS3(bucket, "nalanda-test")

	if _, err := saveBatch(t, svc, control.ID); err == nil {
		t.Fatal("SaveUploadedBatch numbered a batch without knowing the store's")
	}
	entries, _ := os.ReadDir(filepath.Join(workDir, "controls", control.ID, "uploads"))
	if len(entries) != 0 {
		t.Errorf("a refused upload wrote %d file(s)", len(entries))
	}
}
