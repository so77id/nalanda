package filestore_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

// Issue #338 §3: the sync around one worker call — hydrate, call, push,
// prune. The "worker" here is a func that changes the project's files the
// way a real call would.

const project = "controls/ABC"

type syncRig struct {
	sync   *filestore.Sync
	bucket *s3test.Bucket
	work   string // the work root
	dir    string // the project's directory under it
}

func newSyncRig(t *testing.T) *syncRig {
	t.Helper()
	bucket := s3test.New()
	work := t.TempDir()
	// The project exists: the server writes its inputs before any call.
	dir := filepath.Join(work, "controls", "ABC")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return &syncRig{
		sync:   filestore.NewSync(filestore.NewS3(bucket, "nalanda-test"), work, slog.New(slog.NewTextHandler(io.Discard, nil))),
		bucket: bucket,
		work:   work,
		dir:    dir,
	}
}

func (r *syncRig) local(t *testing.T, rel, content string) {
	t.Helper()
	writeFile(t, r.dir, rel, content)
}

func (r *syncRig) remote(rel, content string) {
	r.bucket.Put("work/"+project+"/"+rel, []byte(content))
}

func (r *syncRig) readLocal(t *testing.T, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(r.dir, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("reading %s: %v", rel, err)
	}
	return string(data)
}

func (r *syncRig) remoteBody(rel string) (string, bool) {
	o, ok := r.bucket.Get("work/" + project + "/" + rel)
	return string(o.Body), ok
}

func (r *syncRig) puts() []string {
	var keys []string
	for _, c := range r.bucket.Calls() {
		if c.Op == "PutObject" {
			keys = append(keys, strings.TrimPrefix(c.Key, "work/"+project+"/"))
		}
	}
	return keys
}

func (r *syncRig) links(t *testing.T) map[string]string {
	t.Helper()
	body, ok := r.remoteBody(".nalanda/links.json")
	if !ok {
		return nil
	}
	var links map[string]string
	if err := json.Unmarshal([]byte(body), &links); err != nil {
		t.Fatalf("links.json: %v", err)
	}
	return links
}

func noop() error { return nil }

// AC-4: an empty volume hydrates to files byte-identical to the bucket,
// with the objects' times, and the contract names as symlinks again.
func TestAnEmptyProjectHydratesToTheBucketsFilesAndLinks(t *testing.T) {
	r := newSyncRig(t)
	r.remote("out/sujet.pdf", "%PDF-sujet")
	r.remote("data/capture.sqlite", "SQLite format 3")
	r.remote("scans/batch-1.pdf-page-001-001.jpg", "jpeg")
	r.remote(".nalanda/links.json", `{"scans/copy-1-page-1.jpg": "batch-1.pdf-page-001-001.jpg"}`)
	stored, _ := r.bucket.Get("work/" + project + "/out/sujet.pdf")

	called := false
	err := r.sync.Around(context.Background(), project, func() error {
		called = true
		if got := r.readLocal(t, "out/sujet.pdf"); got != "%PDF-sujet" {
			t.Errorf("sujet.pdf = %q", got)
		}
		if got := r.readLocal(t, "data/capture.sqlite"); got != "SQLite format 3" {
			t.Errorf("capture.sqlite = %q", got)
		}
		info, err := os.Stat(filepath.Join(r.dir, "out", "sujet.pdf"))
		if err != nil || !info.ModTime().Equal(stored.LastModified) {
			t.Errorf("sujet.pdf's time = %v, %v, want the object's %v", info.ModTime(), err, stored.LastModified)
		}
		target, err := os.Readlink(filepath.Join(r.dir, "scans", "copy-1-page-1.jpg"))
		if err != nil || target != "batch-1.pdf-page-001-001.jpg" {
			t.Errorf("the contract link = %q, %v", target, err)
		}
		if got := r.readLocal(t, "scans/copy-1-page-1.jpg"); got != "jpeg" {
			t.Errorf("reading through the link = %q", got)
		}
		return nil
	})
	if err != nil || !called {
		t.Fatalf("Around = %v (called %v)", err, called)
	}
	if puts := r.puts(); len(puts) != 0 {
		t.Errorf("a pure hydrate uploaded %v", puts)
	}
}

// What the server wrote before the call — an upload, a source.tex — reaches
// the bucket in the hydrate, before the worker runs.
func TestALocalFileTheBucketLacksIsUploadedBeforeTheCall(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "uploads/batch-1.pdf", "%PDF-lote")

	err := r.sync.Around(context.Background(), project, func() error {
		if body, ok := r.remoteBody("uploads/batch-1.pdf"); !ok || body != "%PDF-lote" {
			t.Errorf("before the call the bucket holds %q (%v)", body, ok)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// One copy is newer than the other; the newer one wins, either way.
func TestTheNewerCopyWinsTheHydrate(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "data/scoring.sqlite", "old on disk")
	r.local(t, "data/capture.sqlite", "newer on disk")
	r.remote("data/scoring.sqlite", "newer in S3")
	r.remote("data/capture.sqlite", "old in S3")
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)
	_ = os.Chtimes(filepath.Join(r.dir, "data", "scoring.sqlite"), past, past)
	_ = os.Chtimes(filepath.Join(r.dir, "data", "capture.sqlite"), future, future)

	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	if got := r.readLocal(t, "data/scoring.sqlite"); got != "newer in S3" {
		t.Errorf("scoring.sqlite on disk = %q, want S3's newer copy", got)
	}
	if body, _ := r.remoteBody("data/capture.sqlite"); body != "newer on disk" {
		t.Errorf("capture.sqlite in S3 = %q, want the disk's newer copy", body)
	}
}

// AC-4: what the call changed is pushed, the corrected PDF first — it is
// what the review page the professor is redirected to shows next.
func TestAWorkerCallsChangesArePushedTheAnnotatedPDFFirst(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "data/capture.sqlite", "before")
	r.remote("data/capture.sqlite", "before")

	err := r.sync.Around(context.Background(), project, func() error {
		writeFile(t, r.dir, "data/capture.sqlite", "after the call")
		writeFile(t, r.dir, "cr/page-1.jpg", "crop")
		writeFile(t, r.dir, "annotated/copy-1.pdf", "%PDF-corregido")
		// Sorts before annotated/: the priority is not alphabetical luck.
		writeFile(t, r.dir, "aaa-notas.txt", "x")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	puts := r.puts()
	if len(puts) != 4 || puts[0] != "annotated/copy-1.pdf" {
		t.Fatalf("uploads = %v, want four, annotated/copy-1.pdf first", puts)
	}
	for rel, want := range map[string]string{
		"data/capture.sqlite": "after the call", "cr/page-1.jpg": "crop", "annotated/copy-1.pdf": "%PDF-corregido",
	} {
		if body, _ := r.remoteBody(rel); body != want {
			t.Errorf("%s in S3 = %q, want %q", rel, body, want)
		}
	}
}

// The hash cache (an analyse annotates each copy as a call of its own) must
// not hide a change: a file rewritten with the same size, as AMC rewrites a
// sqlite file, has a new mtime and is pushed.
func TestAFileRewrittenWithTheSameSizeIsStillPushed(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "data/scoring.sqlite", "aaaa")
	ctx := context.Background()
	if err := r.sync.Around(ctx, project, noop); err != nil {
		t.Fatal(err)
	}
	err := r.sync.Around(ctx, project, func() error {
		writeFile(t, r.dir, "data/scoring.sqlite", "bbbb")
		later := time.Now().Add(time.Second)
		return os.Chtimes(filepath.Join(r.dir, "data", "scoring.sqlite"), later, later)
	})
	if err != nil {
		t.Fatal(err)
	}
	if body, _ := r.remoteBody("data/scoring.sqlite"); body != "bbbb" {
		t.Errorf("scoring.sqlite in S3 = %q, want the rewrite", body)
	}
}

// AC-4: S3 deletes exactly what the call removed. A key that was never
// local during the call — denylisted junk, or one written meanwhile — is
// never pruned, so an incomplete picture cannot turn into a deletion.
func TestOnlyWhatTheCallRemovedIsPruned(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "cr/page-1.jpg", "crop")
	r.remote("cr/page-1.jpg", "crop")
	r.remote("scans/list-batch-1.txt", "junk S3 kept")

	err := r.sync.Around(context.Background(), project, func() error {
		if err := os.Remove(filepath.Join(r.dir, "cr", "page-1.jpg")); err != nil {
			t.Fatal(err)
		}
		r.remote("annotated/copy-9.pdf", "written by someone else meanwhile")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r.remoteBody("cr/page-1.jpg"); ok {
		t.Error("what the call removed is still in S3")
	}
	for _, kept := range []string{"scans/list-batch-1.txt", "annotated/copy-9.pdf"} {
		if _, ok := r.remoteBody(kept); !ok {
			t.Errorf("%s was pruned though it was never local", kept)
		}
	}
	if _, err := os.Stat(filepath.Join(r.dir, "scans", "list-batch-1.txt")); err == nil {
		t.Error("the hydrate brought denylisted junk to the disk")
	}
}

// AC-4: the denylist never reaches the bucket.
func TestTheDenylistIsNeverUploaded(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "scans/list.txt", "x")
	r.local(t, "scans/list-batch-2.txt", "x")
	r.local(t, "annotate-copy-3.txt", "x")
	r.local(t, "data/capture.sqlite-journal", "x")
	r.local(t, "data/capture.sqlite-wal", "x")
	r.local(t, "data/capture.sqlite-shm", "x")
	r.local(t, "data/capture.sqlite", "kept")

	err := r.sync.Around(context.Background(), project, func() error {
		writeFile(t, r.dir, "scans/list-batch-3.txt", "x")
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if puts := r.puts(); !slices.Equal(puts, []string{"data/capture.sqlite"}) {
		t.Errorf("uploads = %v, want data/capture.sqlite alone", puts)
	}
}

// The batch-survives rule of #210: whatever a FAILED call left is the
// latest version, so it is pushed too, and the call's own error is what the
// caller hears.
func TestAFailedCallIsStillPushed(t *testing.T) {
	r := newSyncRig(t)
	refused := errors.New("the worker refused")

	err := r.sync.Around(context.Background(), project, func() error {
		writeFile(t, r.dir, "data/capture.sqlite", "half-done")
		return refused
	})
	if !errors.Is(err, refused) {
		t.Fatalf("Around = %v, want the call's error", err)
	}
	if body, _ := r.remoteBody("data/capture.sqlite"); body != "half-done" {
		t.Errorf("what the failed call left was not pushed: %q", body)
	}
}

// AC-7's lower half: a push that fails is the operation's failure, wrapped
// as files.ErrSync, and the local files stay where they are.
func TestAPushFailureFailsTheOperationAndKeepsTheLocalFiles(t *testing.T) {
	r := newSyncRig(t)
	err := r.sync.Around(context.Background(), project, func() error {
		r.bucket.FailOn = func(op, _ string) error {
			if op == "PutObject" {
				return errors.New("dial tcp: i/o timeout")
			}
			return nil
		}
		writeFile(t, r.dir, "annotated/copy-1.pdf", "%PDF-corregido")
		return nil
	})
	if !errors.Is(err, files.ErrSync) {
		t.Fatalf("Around = %v, want files.ErrSync", err)
	}
	// The call succeeded: its result is on the volume, and the caller may
	// persist what it returned (issue #338 review, COR-1).
	if !errors.Is(err, files.ErrNotStored) {
		t.Errorf("Around = %v, want files.ErrNotStored after a call that succeeded", err)
	}
	if got := r.readLocal(t, "annotated/copy-1.pdf"); got != "%PDF-corregido" {
		t.Errorf("the local file = %q", got)
	}
}

// A hydrate that fails did no work: it is not ErrNotStored, so nobody
// persists a result that does not exist.
func TestAHydrateFailureIsNotAResultNotStored(t *testing.T) {
	r := newSyncRig(t)
	r.bucket.FailOn = func(op, _ string) error {
		if op == "ListObjectsV2" {
			return errors.New("dial tcp: i/o timeout")
		}
		return nil
	}
	if err := r.sync.Around(context.Background(), project, noop); errors.Is(err, files.ErrNotStored) {
		t.Errorf("Around = %v, want no ErrNotStored for a call that never ran", err)
	}
}

func TestAHydrateFailureNeverCallsTheWorker(t *testing.T) {
	r := newSyncRig(t)
	r.bucket.FailOn = func(op, _ string) error {
		if op == "ListObjectsV2" {
			return errors.New("dial tcp: i/o timeout")
		}
		return nil
	}
	called := false
	err := r.sync.Around(context.Background(), project, func() error { called = true; return nil })
	if !errors.Is(err, files.ErrSync) || called {
		t.Errorf("Around = %v, called = %v; want files.ErrSync and no call", err, called)
	}
}

// The link map follows the call: a new contract name is added, and a call
// that removes every link (Borrar escaneos) removes the map.
func TestTheLinkMapFollowsTheCall(t *testing.T) {
	r := newSyncRig(t)
	ctx := context.Background()
	err := r.sync.Around(ctx, project, func() error {
		writeFile(t, r.dir, "scans/batch-1.pdf-page-001-001.jpg", "jpeg")
		// Not a contract name: no link the review page asks for, so not
		// one the map keeps.
		if err := os.MkdirAll(filepath.Join(r.dir, "cr"), 0o755); err != nil {
			return err
		}
		if err := os.Symlink("../scans/batch-1.pdf-page-001-001.jpg", filepath.Join(r.dir, "cr", "alias.jpg")); err != nil {
			return err
		}
		return os.Symlink("batch-1.pdf-page-001-001.jpg", filepath.Join(r.dir, "scans", "copy-1-page-1.jpg"))
	})
	if err != nil {
		t.Fatal(err)
	}
	if links := r.links(t); links["scans/copy-1-page-1.jpg"] != "batch-1.pdf-page-001-001.jpg" || len(links) != 1 {
		t.Errorf("links.json = %v", links)
	}

	err = r.sync.Around(ctx, project, func() error {
		_ = os.Remove(filepath.Join(r.dir, "scans", "copy-1-page-1.jpg"))
		_ = os.Remove(filepath.Join(r.dir, "cr", "alias.jpg"))
		return os.Remove(filepath.Join(r.dir, "scans", "batch-1.pdf-page-001-001.jpg"))
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := r.remoteBody(".nalanda/links.json"); ok {
		t.Error("a call that removed every link left the map behind")
	}
	if _, ok := r.remoteBody("scans/batch-1.pdf-page-001-001.jpg"); ok {
		t.Error("the image the call removed is still in S3")
	}
}

// --- AC-5: S3 is an input, not only a destination ---------------------------

// Each key breaks the project's prefix in one way. The hydrate refuses it
// before the worker runs, and writes nothing outside the project.
func TestAKeyThatIsNotACleanPathOfTheProjectFailsTheHydrate(t *testing.T) {
	for name, key := range map[string]string{
		"parent segment":     "work/controls/ABC/../ABD/out/sujet.pdf",
		"absolute remainder": "work/controls/ABC//etc/cron.d/x",
		"empty segment":      "work/controls/ABC/out//sujet.pdf",
		"reserved directory": "work/controls/ABC/.nalanda/other.json",
	} {
		t.Run(name, func(t *testing.T) {
			r := newSyncRig(t)
			r.bucket.Put(key, []byte("hostile"))
			called := false
			err := r.sync.Around(context.Background(), project, func() error { called = true; return nil })
			if !errors.Is(err, files.ErrSync) || called {
				t.Errorf("Around = %v, called = %v; want files.ErrSync and no call", err, called)
			}
			assertNothingOutside(t, r)
		})
	}
}

// §8.2: a body whose MD5 is not the ETag is never renamed into place, and
// its temp file does not stay behind.
func TestADownloadWhoseChecksumDoesNotMatchIsRefused(t *testing.T) {
	r := newSyncRig(t)
	r.bucket.PutWithETag("work/"+project+"/out/sujet.pdf", []byte("tampered"), s3test.ETagOf([]byte("the real sheet")))

	err := r.sync.Around(context.Background(), project, noop)
	if !errors.Is(err, files.ErrSync) {
		t.Fatalf("Around = %v, want files.ErrSync", err)
	}
	entries, _ := os.ReadDir(filepath.Join(r.dir, "out"))
	if len(entries) != 0 {
		t.Errorf("out/ holds %v after a refused download", names(entries))
	}
}

// A multipart ETag ("…-N") is not an MD5 the download can be checked
// against; this server never writes one, so it is refused, not trusted.
func TestAnObjectWithAMultipartETagIsRefused(t *testing.T) {
	r := newSyncRig(t)
	r.bucket.PutWithETag("work/"+project+"/out/sujet.pdf", []byte("x"), `"9b2cf535f27731c974343645a3985328-2"`)

	if err := r.sync.Around(context.Background(), project, noop); !errors.Is(err, files.ErrSync) {
		t.Fatalf("Around = %v, want files.ErrSync", err)
	}
	if _, err := os.Stat(filepath.Join(r.dir, "out", "sujet.pdf")); err == nil {
		t.Error("the unverifiable object was written")
	}
}

// §8.3: a link is created only for a contract name pointing at a bare file
// name of the same scans/; anything else in the map is refused.
func TestOnlyAContractLinkToABareNameIsCreated(t *testing.T) {
	r := newSyncRig(t)
	r.remote("scans/batch-1.pdf-page-001-001.jpg", "jpeg")
	r.remote(".nalanda/links.json", `{
		"scans/copy-1-page-1.jpg": "batch-1.pdf-page-001-001.jpg",
		"scans/copy-2-page-1.jpg": "../out/sujet.pdf",
		"scans/copy-3-page-1.jpg": "../../../../etc/passwd",
		"scans/copy-4-page-1.jpg": "sub/x.jpg",
		"scans/notacontract.jpg": "batch-1.pdf-page-001-001.jpg",
		"out/sujet.pdf": "batch-1.pdf-page-001-001.jpg"
	}`)

	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	var links []string
	_ = filepath.WalkDir(r.dir, func(p string, d os.DirEntry, _ error) error {
		if d != nil && d.Type()&os.ModeSymlink != 0 {
			rel, _ := filepath.Rel(r.dir, p)
			links = append(links, filepath.ToSlash(rel))
		}
		return nil
	})
	if !slices.Equal(links, []string{"scans/copy-1-page-1.jpg"}) {
		t.Errorf("links on disk = %v, want only the valid one", links)
	}
}

func TestALinkMapOverOneMiBFailsTheHydrate(t *testing.T) {
	r := newSyncRig(t)
	r.remote(".nalanda/links.json", `{"scans/copy-1-page-1.jpg": "batch-1.jpg"}`+strings.Repeat(" ", 1<<20))

	if err := r.sync.Around(context.Background(), project, noop); !errors.Is(err, files.ErrSync) {
		t.Errorf("Around = %v, want files.ErrSync", err)
	}
}

// §8.2 with os.Root: a directory of the project replaced by a symlink to
// somewhere else cannot carry a download out of the project.
func TestADirectoryReplacedByASymlinkCannotCarryADownloadOut(t *testing.T) {
	r := newSyncRig(t)
	elsewhere := t.TempDir()
	if err := os.MkdirAll(r.dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(elsewhere, filepath.Join(r.dir, "out")); err != nil {
		t.Fatal(err)
	}
	r.remote("out/sujet.pdf", "%PDF-sujet")

	if err := r.sync.Around(context.Background(), project, noop); !errors.Is(err, files.ErrSync) {
		t.Errorf("Around = %v, want files.ErrSync", err)
	}
	if entries, _ := os.ReadDir(elsewhere); len(entries) != 0 {
		t.Errorf("the download landed outside the project: %v", names(entries))
	}
}

func TestTheSyncRefusesAPathThatIsNotAProject(t *testing.T) {
	r := newSyncRig(t)
	for _, p := range []string{"controls", "controls/ABC/scans", "../controls/ABC", "surveys/1"} {
		called := false
		err := r.sync.Around(context.Background(), p, func() error { called = true; return nil })
		if err == nil || called {
			t.Errorf("Around(%q) = %v, called = %v", p, err, called)
		}
	}
}

// assertNothingOutside fails when the work root holds anything but the
// project's own directory tree.
func assertNothingOutside(t *testing.T, r *syncRig) {
	t.Helper()
	_ = filepath.WalkDir(r.work, func(p string, d os.DirEntry, _ error) error {
		if d == nil || d.IsDir() {
			return nil
		}
		if rel, _ := filepath.Rel(r.dir, p); strings.HasPrefix(rel, "..") {
			t.Errorf("a file landed outside the project: %s", p)
		}
		return nil
	})
}

func names(entries []os.DirEntry) []string {
	var out []string
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out
}

// --- the review's fixes (issue #338 review) ---------------------------------

// PER-1: an annotate rewrites AMC's databases as a by-product. They stay out
// of its push and of its hydrate's uploads, and the next call of another
// kind carries them; the corrected PDF goes up at once.
func TestAnAnnotateLeavesTheDatabasesForTheNextCall(t *testing.T) {
	r := newSyncRig(t)
	ctx := context.Background()
	r.bucket.Now = func() time.Time { return time.Now().Add(-time.Hour) }
	r.remote("data/capture.sqlite", "analysed")
	r.remote("data/scoring.sqlite", "analysed")
	if err := r.sync.Around(ctx, project, noop); err != nil {
		t.Fatal(err)
	}

	annotate := func() error {
		writeFile(t, r.dir, "data/capture.sqlite", "annotated bookkeeping")
		writeFile(t, r.dir, "data/scoring.sqlite", "recomputed")
		writeFile(t, r.dir, "annotated/copy-1.pdf", "%PDF-corregido")
		return nil
	}
	if err := r.sync.AroundDeferringDatabases(ctx, project, annotate); err != nil {
		t.Fatal(err)
	}
	if body, _ := r.remoteBody("annotated/copy-1.pdf"); body != "%PDF-corregido" {
		t.Errorf("the corrected PDF did not go up: %q", body)
	}
	for _, rel := range []string{"data/capture.sqlite", "data/scoring.sqlite"} {
		if body, _ := r.remoteBody(rel); body != "analysed" {
			t.Errorf("%s = %q after an annotate, want the analyse's", rel, body)
		}
	}
	// A second annotate's hydrate finds the disk's databases newer, and
	// leaves them as well.
	if err := r.sync.AroundDeferringDatabases(ctx, project, noop); err != nil {
		t.Fatal(err)
	}
	if body, _ := r.remoteBody("data/capture.sqlite"); body != "analysed" {
		t.Errorf("an annotate's hydrate uploaded the databases: %q", body)
	}

	if err := r.sync.Around(ctx, project, noop); err != nil {
		t.Fatal(err)
	}
	if body, _ := r.remoteBody("data/capture.sqlite"); body != "annotated bookkeeping" {
		t.Errorf("the next call did not carry what the annotate left: %q", body)
	}
}

// The recheck's case: a reset after a run of annotates uploads nothing —
// not the databases they deferred, only for its own prune to delete them —
// and the bucket still loses what the reset removed.
func TestAResetAfterAnnotatesUploadsNothingAndStillPrunes(t *testing.T) {
	r := newSyncRig(t)
	ctx := context.Background()
	r.bucket.Now = func() time.Time { return time.Now().Add(-time.Hour) }
	r.remote("data/capture.sqlite", "analysed")
	r.remote("data/layout.sqlite", "layout")
	if err := r.sync.Around(ctx, project, noop); err != nil {
		t.Fatal(err)
	}
	// What the annotates deferred: the disk's capture is newer than the
	// bucket's.
	r.local(t, "data/capture.sqlite", "annotated bookkeeping")
	before := len(r.puts())

	err := r.sync.AroundDeferringDatabases(ctx, project, func() error {
		return os.Remove(filepath.Join(r.dir, "data", "capture.sqlite"))
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := r.puts()[before:]; len(got) != 0 {
		t.Errorf("the reset uploaded %v", got)
	}
	if _, ok := r.remoteBody("data/capture.sqlite"); ok {
		t.Error("the capture the reset removed is still in S3")
	}
	if body, _ := r.remoteBody("data/layout.sqlite"); body != "layout" {
		t.Errorf("layout.sqlite = %q, want it kept", body)
	}
}

// SEC-1: a call on a project that exists nowhere — one that queued behind
// its project's purge — is refused before anything is created, so what the
// worker writes for it never reaches the bucket.
func TestACallOnAProjectThatExistsNowhereIsRefused(t *testing.T) {
	r := newSyncRig(t)
	if err := os.Remove(r.dir); err != nil {
		t.Fatal(err)
	}
	called := false
	err := r.sync.Around(context.Background(), project, func() error { called = true; return nil })
	if !errors.Is(err, files.ErrSync) || called {
		t.Errorf("Around = %v, called = %v; want files.ErrSync and no call", err, called)
	}
	if _, err := os.Stat(r.dir); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the refused call re-created the project's directory (%v)", err)
	}
}

// ...while a project the bucket holds and the disk lost is exactly the one
// the hydrate exists to bring back.
func TestAProjectOnlyTheBucketHoldsIsBroughtBack(t *testing.T) {
	r := newSyncRig(t)
	if err := os.Remove(r.dir); err != nil {
		t.Fatal(err)
	}
	r.remote("inputs/source.tex", "documentclass")
	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	if got := r.readLocal(t, "inputs/source.tex"); got != "documentclass" {
		t.Errorf("source.tex = %q", got)
	}
}

// ARQ-3: at the same instant the disk's copy wins, in the hydrate as in the
// reconcile.
func TestTheHydrateGivesATieToTheDisk(t *testing.T) {
	r := newSyncRig(t)
	at := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	r.bucket.Now = func() time.Time { return at }
	r.remote("data/capture.sqlite", "bucket bytes")
	r.local(t, "data/capture.sqlite", "disk bytes")
	_ = os.Chtimes(filepath.Join(r.dir, "data", "capture.sqlite"), at, at)

	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	if got := r.readLocal(t, "data/capture.sqlite"); got != "disk bytes" {
		t.Errorf("the disk now holds %q, want its own bytes", got)
	}
	if body, _ := r.remoteBody("data/capture.sqlite"); body != "disk bytes" {
		t.Errorf("the bucket holds %q, want the disk's", body)
	}
}

// COR-5, the disk's half of the link-map rule: links newer than a bucket
// map that points elsewhere replace the map, and no local link is touched.
func TestTheDisksNewerLinksReplaceTheBucketsMap(t *testing.T) {
	r := newSyncRig(t)
	r.bucket.Now = func() time.Time { return time.Now().Add(-time.Hour) }
	r.remote(".nalanda/links.json", `{"scans/copy-1-page-1.jpg":"old-page.jpg"}`)
	r.local(t, "scans/new-page.jpg", "jpeg")
	if err := os.Symlink("new-page.jpg", filepath.Join(r.dir, "scans", "copy-1-page-1.jpg")); err != nil {
		t.Fatal(err)
	}

	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	if links := r.links(t); links["scans/copy-1-page-1.jpg"] != "new-page.jpg" || len(links) != 1 {
		t.Errorf("links.json = %v, want the disk's", links)
	}
	if target, _ := os.Readlink(filepath.Join(r.dir, "scans", "copy-1-page-1.jpg")); target != "new-page.jpg" {
		t.Errorf("the local link was rewritten to %q", target)
	}
}

// COR-5, the other half: a bucket with no map gets the disk's even when the
// call leaves the links alone. Without it every image of the review page
// answers 404 for as long as no call happens to move a link.
func TestABucketWithNoMapGetsTheDisksLinks(t *testing.T) {
	r := newSyncRig(t)
	r.local(t, "scans/page.jpg", "jpeg")
	if err := os.Symlink("page.jpg", filepath.Join(r.dir, "scans", "copy-1-page-1.jpg")); err != nil {
		t.Fatal(err)
	}
	if err := r.sync.Around(context.Background(), project, noop); err != nil {
		t.Fatal(err)
	}
	if links := r.links(t); links["scans/copy-1-page-1.jpg"] != "page.jpg" {
		t.Errorf("links.json = %v, want the disk's link", links)
	}
}

// COR-4: a file rewritten between the scan that hashed it and the send is
// refused by S3 (the fake as the real one), so the push fails rather than
// storing bytes its ETag does not describe.
func TestAFileRewrittenBetweenTheScanAndTheSendIsRefused(t *testing.T) {
	r := newSyncRig(t)
	err := r.sync.Around(context.Background(), project, func() error {
		writeFile(t, r.dir, "annotated/copy-1.pdf", "%PDF-corregido")
		writeFile(t, r.dir, "data/capture.sqlite", "as scanned")
		// The annotated PDF goes up first; while it does, the database is
		// rewritten under the push — to the same length, so only the
		// digest can tell.
		r.bucket.FailOn = func(op, key string) error {
			if op == "PutObject" && strings.HasSuffix(key, "copy-1.pdf") {
				writeFile(t, r.dir, "data/capture.sqlite", "as written")
			}
			return nil
		}
		return nil
	})
	if !errors.Is(err, files.ErrSync) {
		t.Fatalf("Around = %v, want files.ErrSync", err)
	}
	if _, ok := r.remoteBody("data/capture.sqlite"); ok {
		t.Error("a body that changed after its hash was stored")
	}
}

// PER-5's recheck: the `files: synced` line counts a deferred file once —
// both halves skip it — and says how many bytes wait for the next call.
func TestTheSyncedLineCountsADeferredFileOnceWithItsBytes(t *testing.T) {
	r := newSyncRig(t)
	var log bytes.Buffer
	sync := filestore.NewSync(filestore.NewS3(r.bucket, "nalanda-test"), r.work, slog.New(slog.NewTextHandler(&log, nil)))
	ctx := context.Background()
	r.bucket.Now = func() time.Time { return time.Now().Add(-time.Hour) }
	r.remote("data/capture.sqlite", "analysed")
	if err := sync.Around(ctx, project, noop); err != nil {
		t.Fatal(err)
	}
	// The first annotate's push skips the database; the second's hydrate
	// and push both skip it.
	for range 2 {
		if err := sync.AroundDeferringDatabases(ctx, project, func() error {
			writeFile(t, r.dir, "data/capture.sqlite", "0123456789")
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	lines := strings.Split(strings.TrimSpace(log.String()), "\n")
	last := lines[len(lines)-1]
	if !strings.Contains(last, "deferred=1 ") || !strings.Contains(last, "deferred_bytes=10") {
		t.Errorf("the last synced line = %q, want deferred=1 deferred_bytes=10", last)
	}
}
