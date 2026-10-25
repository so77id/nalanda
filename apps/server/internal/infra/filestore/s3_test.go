package filestore_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
)

var _ filestore.S3Client = s3test.New()

func newS3(t *testing.T) (*filestore.S3, *s3test.Bucket) {
	t.Helper()
	bucket := s3test.New()
	return filestore.NewS3(bucket, "nalanda-test"), bucket
}

func calls(bucket *s3test.Bucket, op string) []s3test.Call {
	var out []s3test.Call
	for _, c := range bucket.Calls() {
		if c.Op == op {
			out = append(out, c)
		}
	}
	return out
}

func TestS3OpenServesTheObjectWithItsSizeAndTime(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("%PDF-sheet"))
	stored, _ := bucket.Get("work/controls/ABC/out/sujet.pdf")

	f, err := store.Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "%PDF-sheet" || f.Size() != 10 || !f.ModTime().Equal(stored.LastModified) {
		t.Errorf("read %q size %d time %v, want %q 10 %v", got, f.Size(), f.ModTime(), "%PDF-sheet", stored.LastModified)
	}
}

// AC-3: the handlers hand the File to http.ServeContent, so a ranged
// request must come back 206 with exactly the asked bytes — and fetch only
// from the range's start, not the whole object.
func TestS3OpenServesARangedRequestWithTheExactBytes(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/uploads/batch-1.pdf", []byte("0123456789"))

	f, err := store.Open(context.Background(), "controls/ABC/uploads/batch-1.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=2-5")
	rec := httptest.NewRecorder()
	// As every handler does: without it ServeContent reads the first 512
	// bytes to sniff a type, which is a second GET this test is not about.
	rec.Header().Set("Content-Type", "application/pdf")
	http.ServeContent(rec, req, "batch-1.pdf", f.ModTime(), f)

	if rec.Code != http.StatusPartialContent || rec.Body.String() != "2345" {
		t.Fatalf("status %d body %q, want 206 %q", rec.Code, rec.Body.String(), "2345")
	}
	gets := calls(bucket, "GetObject")
	if len(gets) != 1 || gets[0].Range != "bytes=2-" {
		t.Errorf("GetObject calls = %+v, want one ranged from byte 2", gets)
	}
}

func TestS3OpenAnswers304ToIfModifiedSince(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("%PDF"))

	f, err := store.Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-Modified-Since", f.ModTime().Add(time.Hour).UTC().Format(http.TimeFormat))
	rec := httptest.NewRecorder()
	http.ServeContent(rec, req, "sujet.pdf", f.ModTime(), f)

	if rec.Code != http.StatusNotModified {
		t.Errorf("status = %d, want 304", rec.Code)
	}
	if gets := calls(bucket, "GetObject"); len(gets) != 0 {
		t.Errorf("a 304 fetched the body: %+v", gets)
	}
}

// Opening costs one HEAD; the body is fetched only when something reads.
func TestS3OpenFetchesNothingUntilRead(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("%PDF"))

	f, err := store.Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	_ = f.Close()
	if gets := calls(bucket, "GetObject"); len(gets) != 0 {
		t.Errorf("Open fetched the body: %+v", gets)
	}
}

// A seek after a read drops the open body: the next read starts over from
// the new position, as a file's would (ServeContent seeks back after it
// sniffs a type, and between the parts of a multi-range answer).
func TestS3ReadAfterASeekReadsFromTheNewPosition(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/uploads/batch-1.pdf", []byte("0123456789"))

	f, err := store.Open(context.Background(), "controls/ABC/uploads/batch-1.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	head := make([]byte, 3)
	if _, err := io.ReadFull(f, head); err != nil || string(head) != "012" {
		t.Fatalf("first read %q, %v", head, err)
	}
	if _, err := f.Seek(7, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	rest, err := io.ReadAll(f)
	if err != nil || string(rest) != "789" {
		t.Errorf("after Seek(7) read %q, %v, want %q", rest, err, "789")
	}
	if pos, _ := f.Seek(-4, io.SeekEnd); pos != 6 {
		t.Errorf("Seek(-4, End) = %d, want 6", pos)
	}
	if _, err := f.Seek(-1, io.SeekStart); err == nil {
		t.Error("a seek before the start succeeded")
	}
}

// The bytes read are the bytes the HEAD described: an object replaced in
// between fails the read rather than serving a body of another length.
func TestS3ReadFailsWhenTheObjectChangedSinceOpen(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("first"))

	f, err := store.Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("second, longer"))
	if _, err := io.ReadAll(f); err == nil {
		t.Error("a read of a replaced object succeeded")
	}
}

func TestS3OpenOfAMissingKeyIsNotExist(t *testing.T) {
	store, _ := newS3(t)
	if _, err := store.Open(context.Background(), "controls/ABC/out/sujet.pdf"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Open of a missing key = %v, want fs.ErrNotExist", err)
	}
}

func TestS3RefusesAnInvalidPathBeforeAskingTheBucket(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/.nalanda/links.json", []byte(`{}`))
	ctx := context.Background()

	for _, rel := range []string{"../backups/nalanda.db", "controls/ABC/.nalanda/links.json", "/work/x"} {
		if _, err := store.Open(ctx, rel); !errors.Is(err, files.ErrInvalidPath) {
			t.Errorf("Open(%q) = %v, want ErrInvalidPath", rel, err)
		}
	}
	if _, err := store.List(ctx, ".."); !errors.Is(err, files.ErrInvalidPath) {
		t.Errorf("List(..) = %v, want ErrInvalidPath", err)
	}
	if got := bucket.Calls(); len(got) != 0 {
		t.Errorf("the bucket was asked %+v for invalid paths", got)
	}
}

// The ADR-0037 contract names are symlinks on disk; in S3 they live in the
// project's links.json and resolve to the image they name.
func TestS3OpenResolvesAContractNameThroughTheLinkMap(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/.nalanda/links.json",
		[]byte(`{"scans/copy-3-page-1.jpg": "batch-1.pdf-page-005-001.jpg"}`))
	bucket.Put("work/controls/ABC/scans/batch-1.pdf-page-005-001.jpg", []byte("jpeg"))
	ctx := context.Background()

	f, err := store.Open(ctx, "controls/ABC/scans/copy-3-page-1.jpg")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	got, _ := io.ReadAll(f)
	_ = f.Close()
	if string(got) != "jpeg" {
		t.Errorf("read %q, want the linked image", got)
	}
	if _, err := store.Open(ctx, "controls/ABC/scans/copy-4-page-1.jpg"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a contract name with no link = %v, want fs.ErrNotExist", err)
	}
}

// Only the ADR-0037 names go through the map; every other file under scans/
// is an object of its own.
func TestS3OpenReadsAnyOtherScansFileDirectly(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/scans/batch-1.pdf-page-005-001.jpg", []byte("jpeg"))
	bucket.Put("work/controls/ABC/scans/copy-0-page-1.jpg", []byte("not a contract name"))

	for rel, want := range map[string]string{
		"controls/ABC/scans/batch-1.pdf-page-005-001.jpg": "jpeg",
		"controls/ABC/scans/copy-0-page-1.jpg":            "not a contract name",
	} {
		f, err := store.Open(context.Background(), rel)
		if err != nil {
			t.Errorf("Open(%s): %v", rel, err)
			continue
		}
		got, _ := io.ReadAll(f)
		_ = f.Close()
		if string(got) != want {
			t.Errorf("Open(%s) read %q, want %q", rel, got, want)
		}
	}
}

func TestS3OpenOfAContractNameInAProjectWithNoLinksIsNotExist(t *testing.T) {
	store, _ := newS3(t)
	if _, err := store.Open(context.Background(), "controls/ABC/scans/copy-3-page-1.jpg"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Open = %v, want fs.ErrNotExist", err)
	}
}

// §8.3: the link map is input, not trust. A target that is not a bare file
// name of the same scans/ is never followed, whatever exists where it points.
func TestS3NeverFollowsALinkOutOfItsScansDirectory(t *testing.T) {
	for _, target := range []string{"../out/sujet.pdf", "../../OTHER/scans/x.jpg", "sub/x.jpg", "..", ".", "", ".nalanda"} {
		t.Run(target, func(t *testing.T) {
			store, bucket := newS3(t)
			bucket.Put("work/controls/ABC/.nalanda/links.json",
				[]byte(fmt.Sprintf(`{"scans/copy-1-page-1.jpg": %q}`, target)))
			bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("secret"))
			bucket.Put("work/controls/OTHER/scans/x.jpg", []byte("secret"))

			_, err := store.Open(context.Background(), "controls/ABC/scans/copy-1-page-1.jpg")
			if !errors.Is(err, fs.ErrNotExist) {
				t.Errorf("a link to %q = %v, want fs.ErrNotExist", target, err)
			}
		})
	}
}

func TestS3RefusesALinkMapThatIsTooLargeOrNotJSON(t *testing.T) {
	for name, body := range map[string]string{
		// Valid JSON whatever its length — trailing whitespace is allowed —
		// so only the size cap refuses it, not a decode of a cut object.
		"over 1 MiB":     `{"scans/copy-1-page-1.jpg": "batch-1.jpg"}` + strings.Repeat(" ", 1<<20),
		"not JSON":       `scans/copy-1-page-1.jpg -> batch-1.jpg`,
		"trailing data":  `{"scans/copy-1-page-1.jpg": "batch-1.jpg"} {}`,
		"not an object":  `["batch-1.jpg"]`,
		"non-string map": `{"scans/copy-1-page-1.jpg": 7}`,
	} {
		t.Run(name, func(t *testing.T) {
			store, bucket := newS3(t)
			bucket.Put("work/controls/ABC/.nalanda/links.json", []byte(body))
			bucket.Put("work/controls/ABC/scans/batch-1.jpg", []byte("jpeg"))

			f, err := store.Open(context.Background(), "controls/ABC/scans/copy-1-page-1.jpg")
			if err == nil {
				_ = f.Close()
				t.Fatal("a malformed link map resolved a link")
			}
			if errors.Is(err, fs.ErrNotExist) {
				t.Errorf("a malformed link map = %v; it is a failure, not a missing file", err)
			}
		})
	}
}

func TestS3ListPagesAndNamesOnlyTheDirectEntries(t *testing.T) {
	store, bucket := newS3(t)
	bucket.PageSize = 2
	bucket.Put("work/controls/ABC/uploads/batch-3.pdf", []byte("333"))
	bucket.Put("work/controls/ABC/uploads/batch-1.pdf", []byte("1"))
	bucket.Put("work/controls/ABC/uploads/batch-2.pdf", []byte("22"))
	bucket.Put("work/controls/ABC/uploads/nested/batch-9.pdf", []byte("9"))
	// A "folder" the S3 console creates: a key equal to the prefix itself.
	bucket.Put("work/controls/ABC/uploads/", nil)
	bucket.Put("work/controls/ABC/uploadsX/batch-8.pdf", []byte("8"))

	entries, err := store.List(context.Background(), "controls/ABC/uploads")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, fmt.Sprintf("%s:%d", e.Name, e.Size))
	}
	if got := strings.Join(names, " "); got != "batch-1.pdf:1 batch-2.pdf:2 batch-3.pdf:3" {
		t.Errorf("List = %s", got)
	}
	if lists := calls(bucket, "ListObjectsV2"); len(lists) < 2 {
		t.Errorf("the listing took %d page(s); the test wants it to span several", len(lists))
	}
}

func TestS3ListOfAnEmptyPrefixIsEmpty(t *testing.T) {
	store, _ := newS3(t)
	entries, err := store.List(context.Background(), "controls/ABC/uploads")
	if err != nil || len(entries) != 0 {
		t.Errorf("List = %v, %v, want empty and nil", entries, err)
	}
}

// Purge (S9) calls this: every key under the project goes, in batches S3
// accepts, and nothing that merely shares the prefix's text.
func TestS3DeleteProjectDeletesEveryKeyUnderTheProjectAndNothingElse(t *testing.T) {
	store, bucket := newS3(t)
	for i := range 1001 {
		bucket.Put(fmt.Sprintf("work/controls/ABC/scans/page-%04d.jpg", i), []byte("x"))
	}
	bucket.Put("work/controls/ABC/.nalanda/links.json", []byte(`{}`))
	bucket.Put("work/controls/ABCD/out/sujet.pdf", []byte("keep"))
	bucket.Put("work/controls/OTHER/out/sujet.pdf", []byte("keep"))
	bucket.Put("backups/nalanda-2026-10-25.db", []byte("keep"))

	if err := store.DeleteProject(context.Background(), "controls/ABC"); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	want := "backups/nalanda-2026-10-25.db work/controls/ABCD/out/sujet.pdf work/controls/OTHER/out/sujet.pdf"
	if got := strings.Join(bucket.Keys(), " "); got != want {
		t.Errorf("left %s, want %s", got, want)
	}
}

// A destructive call on a derived path: only a project's own shape is
// accepted, so a caller's bug cannot widen it to every control.
func TestS3DeleteProjectRefusesAPathThatIsNotAProject(t *testing.T) {
	for _, project := range []string{"controls", "surveys", "surveys/1", "surveys/1/runs", "surveys/1/scans/2", "controls/ABC/scans", "backups/x", ""} {
		t.Run(project, func(t *testing.T) {
			store, bucket := newS3(t)
			bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("keep"))
			bucket.Put("work/surveys/1/runs/2/out/sujet.pdf", []byte("keep"))

			if err := store.DeleteProject(context.Background(), project); err == nil {
				t.Errorf("DeleteProject(%q) succeeded", project)
			}
			if len(bucket.Keys()) != 2 {
				t.Errorf("DeleteProject(%q) deleted %v", project, bucket.Keys())
			}
		})
	}
}

func TestS3DeleteProjectAcceptsASurveyRun(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/surveys/1/runs/2/out/sujet.pdf", []byte("x"))
	bucket.Put("work/surveys/1/runs/20/out/sujet.pdf", []byte("keep"))

	if err := store.DeleteProject(context.Background(), "surveys/1/runs/2"); err != nil {
		t.Fatalf("DeleteProject: %v", err)
	}
	if got := strings.Join(bucket.Keys(), " "); got != "work/surveys/1/runs/20/out/sujet.pdf" {
		t.Errorf("left %s", got)
	}
}

// S3 answers 200 to a DeleteObjects that refused some keys; the store reads
// the per-key errors rather than trusting the status.
func TestS3DeleteProjectFailsWhenAKeyIsRefused(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("x"))
	bucket.Put("work/controls/ABC/out/corrige.pdf", []byte("x"))
	bucket.FailOn = func(op, key string) error {
		if op == "DeleteObjects" && strings.HasSuffix(key, "corrige.pdf") {
			return errors.New("AccessDenied")
		}
		return nil
	}

	err := store.DeleteProject(context.Background(), "controls/ABC")
	if err == nil || !strings.Contains(err.Error(), "corrige.pdf") {
		t.Errorf("DeleteProject = %v, want an error naming the refused key", err)
	}
}

// S3 answers a HEAD of a missing key with 404 only to a caller that may
// list the bucket; otherwise 403. The server's policy grants ListBucket
// under a prefix condition, and whether a HEAD's implicit check passes it
// is not documented — so a HEAD that fails for any other reason is checked
// with a listing of that very key: absent there, it is a missing file (a
// page's 404, and the PNG-then-JPG fall-through keeps working); present,
// or the listing failing too, it is the store failing.
func TestAForbiddenHeadOfAMissingKeyIsStillNotExist(t *testing.T) {
	store, bucket := newS3(t)
	bucket.Put("work/controls/ABC/out/sujet.pdf", []byte("%PDF"))
	bucket.FailOn = func(op, _ string) error {
		if op == "HeadObject" {
			return errors.New("api error Forbidden: Forbidden")
		}
		return nil
	}
	ctx := context.Background()

	if _, err := store.Open(ctx, "controls/ABC/out/missing.pdf"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a forbidden HEAD of a missing key = %v, want fs.ErrNotExist", err)
	}
	// A missing key that is a PREFIX of one that exists is still missing.
	if _, err := store.Open(ctx, "controls/ABC/out/sujet"); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a forbidden HEAD of a key that only prefixes another = %v, want fs.ErrNotExist", err)
	}
	_, err := store.Open(ctx, "controls/ABC/out/sujet.pdf")
	if err == nil || errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a forbidden HEAD of a key that IS there = %v, want the store's failure", err)
	}

	bucket.FailOn = func(op, _ string) error { return errors.New("dial tcp: i/o timeout") }
	if _, err := store.Open(ctx, "controls/ABC/out/missing.pdf"); err == nil || errors.Is(err, fs.ErrNotExist) {
		t.Errorf("an unreachable store = %v, want its failure, not a missing file", err)
	}
}
