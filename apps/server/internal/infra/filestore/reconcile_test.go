package filestore_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

// Issue #338 §5: the reconcile is the hydrate's UPLOAD half, for every
// project the database knows — at boot, daily, and as the migration's
// -sync-files. It never downloads and never deletes.

func newReconciler(t *testing.T, bucket *s3test.Bucket, work string, projects ...string) (*filestore.Reconciler, *int) {
	t.Helper()
	locked := 0
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return &filestore.Reconciler{
		Sync:     filestore.NewSync(filestore.NewS3(bucket, "nalanda-test"), work, log),
		Projects: func(context.Context) ([]string, error) { return projects, nil },
		Exclusive: func(fn func() error) error {
			locked++
			return fn()
		},
		Log: log,
	}, &locked
}

func writeUnder(t *testing.T, work, rel, content string) {
	t.Helper()
	writeFile(t, work, rel, content)
}

// AC-9's pin: an EMPTY local tree over a FULL bucket — the drill's fresh
// volume, or a reconcile that ran before anything was restored — must
// change neither side: no download, and above all no deletion.
func TestTheReconcileNeverDownloadsAndNeverDeletes(t *testing.T) {
	bucket := s3test.New()
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("%PDF"))
	bucket.Put("work/controls/ABC/scans/batch-1.pdf-page-001-001.jpg", []byte("jpeg"))
	bucket.Put("work/controls/ABC/.nalanda/links.json", []byte(`{"scans/copy-1-page-1.jpg":"batch-1.pdf-page-001-001.jpg"}`))
	work := t.TempDir()
	if err := os.MkdirAll(filepath.Join(work, "controls", "ABC"), 0o755); err != nil {
		t.Fatal(err)
	}
	r, _ := newReconciler(t, bucket, work, "controls/ABC", "controls/GONE")

	summary, err := r.Run(context.Background())
	if err != nil || summary.Failed != 0 {
		t.Fatalf("Run = %+v, %v", summary, err)
	}
	if len(bucket.Keys()) != 3 {
		t.Errorf("the bucket holds %v, want the three keys untouched", bucket.Keys())
	}
	for _, c := range bucket.Calls() {
		if c.Op == "GetObject" && !strings.HasSuffix(c.Key, "links.json") || c.Op == "DeleteObjects" || c.Op == "PutObject" {
			t.Errorf("the reconcile called %s %s", c.Op, c.Key)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(work, "controls", "ABC"))
	if len(entries) != 0 {
		t.Errorf("the reconcile wrote %d entr(ies) to the disk", len(entries))
	}
	if _, err := os.Stat(filepath.Join(work, "controls", "GONE")); !os.IsNotExist(err) {
		t.Errorf("the reconcile created a directory for a project with none: %v", err)
	}
}

func TestTheReconcileUploadsWhatTheBucketLacksOrHoldsOlder(t *testing.T) {
	bucket := s3test.New()
	bucket.Put("work/controls/ABC/data/capture.sqlite", []byte("old in S3"))
	bucket.Put("work/controls/ABC/data/scoring.sqlite", []byte("newer in S3"))
	bucket.Put("work/surveys/1/runs/2/out/sujet.pdf", []byte("%PDF"))
	work := t.TempDir()
	writeUnder(t, work, "controls/ABC/uploads/batch-1.pdf", "%PDF-lote")
	writeUnder(t, work, "controls/ABC/data/capture.sqlite", "newer on disk")
	writeUnder(t, work, "controls/ABC/data/scoring.sqlite", "old on disk")
	writeUnder(t, work, "controls/ABC/scans/list-batch-1.txt", "junk")
	writeUnder(t, work, "surveys/1/runs/2/out/sujet.pdf", "%PDF")
	past, future := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)
	_ = os.Chtimes(filepath.Join(work, "controls/ABC/data/capture.sqlite"), future, future)
	_ = os.Chtimes(filepath.Join(work, "controls/ABC/data/scoring.sqlite"), past, past)
	r, locked := newReconciler(t, bucket, work, "controls/ABC", "surveys/1/runs/2")

	summary, err := r.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Projects != 2 || summary.Files != 2 || summary.Failed != 0 {
		t.Errorf("summary = %+v, want 2 projects, 2 files, no failure", summary)
	}
	for key, want := range map[string]string{
		"work/controls/ABC/uploads/batch-1.pdf": "%PDF-lote",
		"work/controls/ABC/data/capture.sqlite": "newer on disk",
		"work/controls/ABC/data/scoring.sqlite": "newer in S3",
	} {
		if o, _ := bucket.Get(key); string(o.Body) != want {
			t.Errorf("%s = %q, want %q", key, o.Body, want)
		}
	}
	if _, ok := bucket.Get("work/controls/ABC/scans/list-batch-1.txt"); ok {
		t.Error("the reconcile uploaded the denylist")
	}
	if got, _ := os.ReadFile(filepath.Join(work, "controls/ABC/data/scoring.sqlite")); string(got) != "old on disk" {
		t.Errorf("the reconcile changed the disk: %q", got)
	}
	if *locked != 2 {
		t.Errorf("the worker lock was taken %d time(s), want once per project", *locked)
	}
}

// The link map rides along: the disk's links reach a bucket that has none.
func TestTheReconcileUploadsTheLinkMapTheBucketLacks(t *testing.T) {
	bucket := s3test.New()
	work := t.TempDir()
	writeUnder(t, work, "controls/ABC/scans/batch-1.pdf-page-001-001.jpg", "jpeg")
	if err := os.Symlink("batch-1.pdf-page-001-001.jpg", filepath.Join(work, "controls/ABC/scans/copy-1-page-1.jpg")); err != nil {
		t.Fatal(err)
	}
	r, _ := newReconciler(t, bucket, work, "controls/ABC")

	if _, err := r.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if o, ok := bucket.Get("work/controls/ABC/.nalanda/links.json"); !ok || !strings.Contains(string(o.Body), "copy-1-page-1.jpg") {
		t.Errorf("links.json = %q (%v)", o.Body, ok)
	}
}

// One project's failure is counted and logged; the others still go up,
// and -sync-files can exit non-zero on the count.
func TestOneFailingProjectDoesNotStopTheReconcile(t *testing.T) {
	bucket := s3test.New()
	bucket.FailOn = func(op, key string) error {
		if op == "ListObjectsV2" && strings.HasPrefix(key, "work/controls/BAD/") {
			return errors.New("AccessDenied")
		}
		return nil
	}
	work := t.TempDir()
	writeUnder(t, work, "controls/BAD/out/sujet.pdf", "x")
	writeUnder(t, work, "controls/GOOD/out/sujet.pdf", "x")
	r, _ := newReconciler(t, bucket, work, "controls/BAD", "controls/GOOD")

	summary, err := r.Run(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if summary.Failed != 1 || summary.Projects != 2 {
		t.Errorf("summary = %+v, want one failure out of two", summary)
	}
	if !slices.Contains(bucket.Keys(), "work/controls/GOOD/out/sujet.pdf") {
		t.Error("the good project was not reconciled after the bad one")
	}
}

// 03:00 UTC, the database backup's hour, so the day's two snapshots line up.
func TestTheDailyReconcileIsTheNextThreeOClockUTC(t *testing.T) {
	for now, want := range map[string]string{
		"2026-10-25T01:00:00Z":      "2026-10-25T03:00:00Z",
		"2026-10-25T03:00:00Z":      "2026-10-26T03:00:00Z",
		"2026-10-25T22:30:00Z":      "2026-10-26T03:00:00Z",
		"2026-10-25T02:30:00-03:00": "2026-10-26T03:00:00Z",
		// A zone whose date is still yesterday while UTC is past 03:00.
		"2026-10-25T23:00:00-05:00": "2026-10-27T03:00:00Z",
	} {
		at, _ := time.Parse(time.RFC3339, now)
		if got := filestore.NextReconcile(at); got.Format(time.RFC3339) != want {
			t.Errorf("NextReconcile(%s) = %s, want %s", now, got.Format(time.RFC3339), want)
		}
	}
}
