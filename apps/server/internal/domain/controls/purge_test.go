package controls_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

// Issue #338, AC-8: with S3 the primary store, the purge deletes the
// project from S3 FIRST (amending ADR-0052's order). S3 is the step that
// fails for network reasons: failing there leaves the archived control
// whole and the professor retries; the reverse order would leave a purged
// student's scans in S3 with no row to retry from.

type purgeRig struct {
	svc     *controls.Service
	store   *fakeStore
	bucket  *s3test.Bucket
	id      string
	project string // the local project directory
}

func newPurgeRig(t *testing.T) purgeRig {
	t.Helper()
	svc, store, _, workDir := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Archive(ctx, control.ID); err != nil {
		t.Fatal(err)
	}
	bucket := s3test.New()
	prefix := "work/controls/" + control.ID + "/"
	bucket.Put(prefix+"out/sujet.pdf", []byte("%PDF"))
	bucket.Put(prefix+"scans/batch-1.pdf-page-001-001.jpg", []byte("jpeg"))
	bucket.Put(prefix+".nalanda/links.json", []byte(`{}`))
	bucket.Put("work/controls/OTHER/out/sujet.pdf", []byte("another control"))
	svc.Files = filestore.NewS3(bucket, "nalanda-test")
	return purgeRig{svc: svc, store: store, bucket: bucket, id: control.ID,
		project: filepath.Join(workDir, "controls", control.ID)}
}

func (r purgeRig) keysOfTheControl() []string {
	var keys []string
	for _, k := range r.bucket.Keys() {
		if strings.HasPrefix(k, "work/controls/"+r.id+"/") {
			keys = append(keys, k)
		}
	}
	return keys
}

func TestAPurgeLeavesNoKeyNoRowAndNoDirectory(t *testing.T) {
	r := newPurgeRig(t)
	if err := r.svc.Purge(context.Background(), r.id); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if keys := r.keysOfTheControl(); len(keys) != 0 {
		t.Errorf("S3 still holds %v", keys)
	}
	if _, ok := r.bucket.Get("work/controls/OTHER/out/sujet.pdf"); !ok {
		t.Error("the purge reached another control's files")
	}
	if len(r.store.controls) != 0 {
		t.Error("the row survived")
	}
	if _, err := os.Stat(r.project); !os.IsNotExist(err) {
		t.Errorf("the local directory survived: %v", err)
	}
}

func TestAnS3FailureRefusesThePurgeWithEverythingIntact(t *testing.T) {
	r := newPurgeRig(t)
	r.bucket.FailOn = func(op, _ string) error {
		if op == "ListObjectsV2" {
			return errors.New("dial tcp: i/o timeout")
		}
		return nil
	}

	err := r.svc.Purge(context.Background(), r.id)
	if !errors.Is(err, files.ErrSync) {
		t.Fatalf("Purge = %v, want files.ErrSync", err)
	}
	if _, err := r.svc.Get(context.Background(), r.id); err != nil {
		t.Errorf("the row is gone after a refused purge: %v", err)
	}
	if _, err := os.Stat(r.project); err != nil {
		t.Errorf("the local directory is gone after a refused purge: %v", err)
	}
	if keys := r.keysOfTheControl(); len(keys) != 3 {
		t.Errorf("S3 holds %v after a refused purge, want the three keys", keys)
	}
}

// The order, pinned: when the database fails at its step, S3 is already
// empty and the row is still there — only S3-first produces that state —
// and the retry finishes.
func TestThePurgeDeletesS3BeforeTheRows(t *testing.T) {
	r := newPurgeRig(t)
	r.store.purgeFail = errors.New("database is locked")

	if err := r.svc.Purge(context.Background(), r.id); err == nil {
		t.Fatal("Purge succeeded over a failing database")
	}
	if keys := r.keysOfTheControl(); len(keys) != 0 {
		t.Errorf("S3 still holds %v: the rows were tried first", keys)
	}
	if _, err := r.svc.Get(context.Background(), r.id); err != nil {
		t.Errorf("the row is gone though its delete failed: %v", err)
	}

	r.store.purgeFail = nil
	if err := r.svc.Purge(context.Background(), r.id); err != nil {
		t.Fatalf("the retry: %v", err)
	}
	if len(r.store.controls) != 0 {
		t.Error("the retry left the row")
	}
}

// Issue #338: the reconcile keeps an archived control's files too — they
// are what a restore brings back.
func TestProjectPathsNamesEveryControlArchivedOrNot(t *testing.T) {
	svc, store, _, _ := newService(t)
	ctx := context.Background()
	active, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatal(err)
	}
	archived, err := createControlSync(ctx, svc, req(func(r *controls.CreateRequest) { r.Name = "Archivado" }))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.Archive(ctx, archived.ID); err != nil {
		t.Fatal(err)
	}

	got, err := controls.ProjectPaths(ctx, store)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"controls/" + active.ID: true, "controls/" + archived.ID: true}
	if len(got) != 2 || !want[got[0]] || !want[got[1]] {
		t.Errorf("ProjectPaths = %v, want both controls", got)
	}
}
