package filestore_test

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
)

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestLocalOpenReadsTheFileUnderTheRoot(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "controls/ABC/out/sujet.pdf", "%PDF-sheet")
	stamp := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(root, "controls/ABC/out/sujet.pdf"), stamp, stamp); err != nil {
		t.Fatal(err)
	}

	f, err := filestore.NewLocal(root).Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()
	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "%PDF-sheet" {
		t.Errorf("content = %q, want %q", got, "%PDF-sheet")
	}
	if f.Size() != int64(len("%PDF-sheet")) {
		t.Errorf("Size = %d, want %d", f.Size(), len("%PDF-sheet"))
	}
	if !f.ModTime().Equal(stamp) {
		t.Errorf("ModTime = %v, want %v", f.ModTime(), stamp)
	}
}

// The handlers hand the file straight to http.ServeContent, so the port's
// File must keep what that gives a browser: a ranged read answers 206 with
// exactly the asked bytes (the PDF viewer reads a batch in ranges).
func TestLocalOpenServesARangedRequest(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "controls/ABC/uploads/batch-1.pdf", "0123456789")

	f, err := filestore.NewLocal(root).Open(context.Background(), "controls/ABC/uploads/batch-1.pdf")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = f.Close() }()

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Range", "bytes=2-5")
	rec := httptest.NewRecorder()
	http.ServeContent(rec, req, "batch-1.pdf", f.ModTime(), f)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", rec.Code)
	}
	if got := rec.Body.String(); got != "2345" {
		t.Errorf("body = %q, want %q", got, "2345")
	}
}

func TestLocalOpenOfAMissingFileIsNotExist(t *testing.T) {
	_, err := filestore.NewLocal(t.TempDir()).Open(context.Background(), "controls/ABC/out/sujet.pdf")
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Open of a missing file = %v, want fs.ErrNotExist", err)
	}
}

// A directory where a file was asked for is not a file: ServeContent over
// an *os.File of a directory would answer with whatever reading it yields.
func TestLocalOpenOfADirectoryIsNotExist(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "controls/ABC/out/sujet.pdf", "x")

	_, err := filestore.NewLocal(root).Open(context.Background(), "controls/ABC/out")
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("Open of a directory = %v, want fs.ErrNotExist", err)
	}
}

func TestLocalRefusesAnInvalidPathBeforeTouchingTheDisk(t *testing.T) {
	root := t.TempDir()
	// A real file one level ABOVE the root: an unvalidated "../" would reach it.
	outside := filepath.Join(filepath.Dir(root), "outside-"+filepath.Base(root)+".txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(outside) })
	store := filestore.NewLocal(root)

	if _, err := store.Open(context.Background(), "../"+filepath.Base(outside)); !errors.Is(err, files.ErrInvalidPath) {
		t.Errorf("Open(../…) = %v, want ErrInvalidPath", err)
	}
	if _, err := store.List(context.Background(), ".."); !errors.Is(err, files.ErrInvalidPath) {
		t.Errorf("List(..) = %v, want ErrInvalidPath", err)
	}
}

func TestLocalListNamesTheFilesDirectlyUnderTheDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "controls/ABC/uploads/batch-2.pdf", "two")
	writeFile(t, root, "controls/ABC/uploads/batch-1.pdf", "1")
	writeFile(t, root, "controls/ABC/uploads/nested/batch-9.pdf", "nested")

	entries, err := filestore.NewLocal(root).List(context.Background(), "controls/ABC/uploads")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %+v, want batch-1.pdf and batch-2.pdf only", entries)
	}
	if entries[0].Name != "batch-1.pdf" || entries[1].Name != "batch-2.pdf" {
		t.Errorf("names = %q, %q, want batch-1.pdf, batch-2.pdf (sorted)", entries[0].Name, entries[1].Name)
	}
	if entries[1].Size != 3 {
		t.Errorf("batch-2.pdf size = %d, want 3", entries[1].Size)
	}
}

func TestLocalListOfAMissingDirectoryIsEmpty(t *testing.T) {
	entries, err := filestore.NewLocal(t.TempDir()).List(context.Background(), "controls/ABC/uploads")
	if err != nil || len(entries) != 0 {
		t.Errorf("List of a missing directory = %v, %v, want empty and nil", entries, err)
	}
}
