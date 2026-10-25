package files_test

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

func TestValidRelAcceptsACleanRelativePath(t *testing.T) {
	for _, rel := range []string{
		"controls/ABC/out/sujet.pdf",
		"controls/ABC/uploads",
		"surveys/1/runs/2/scans/copy-3-page-1.jpg",
		"pool.json",
	} {
		if err := files.ValidRel(rel); err != nil {
			t.Errorf("ValidRel(%q) = %v, want nil", rel, err)
		}
	}
}

// Each case breaks a clean path in exactly one way. A path that reaches the
// disk or a bucket key unvalidated is how a request names a file outside the
// project it was asked about.
func TestValidRelRefusesEveryPathThatIsNotCleanAndRelative(t *testing.T) {
	for _, tc := range []struct {
		name, rel string
	}{
		{"empty", ""},
		{"absolute", "/controls/ABC/out/sujet.pdf"},
		{"parent segment", "controls/../ABC/out/sujet.pdf"},
		{"leading parent", "../work/controls/ABC/pool.json"},
		{"only a parent", ".."},
		{"only a dot", "."},
		{"dot segment", "controls/./ABC/pool.json"},
		{"empty segment", "controls//ABC/pool.json"},
		{"trailing slash", "controls/ABC/uploads/"},
		{"backslash", `controls\ABC\pool.json`},
		{"reserved directory", "controls/ABC/.nalanda/links.json"},
		{"reserved directory itself", "controls/ABC/.nalanda"},
		{"NUL byte", "controls/ABC/pool.json\x00"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := files.ValidRel(tc.rel)
			if !errors.Is(err, files.ErrInvalidPath) {
				t.Errorf("ValidRel(%q) = %v, want ErrInvalidPath", tc.rel, err)
			}
		})
	}
}

// mapStore holds files by name; a name in broken fails with errBroken, the
// way a store that cannot answer does.
type mapStore struct {
	files  map[string]bool
	broken map[string]bool
	opened []string
}

var errBroken = errors.New("store unreachable")

func (m *mapStore) Open(_ context.Context, rel string) (files.File, error) {
	m.opened = append(m.opened, rel)
	switch {
	case m.broken[rel]:
		return nil, errBroken
	case m.files[rel]:
		return nopFile{}, nil
	}
	return nil, fmt.Errorf("open %s: %w", rel, fs.ErrNotExist)
}
func (m *mapStore) List(context.Context, string) ([]files.Entry, error) { return nil, nil }
func (m *mapStore) DeleteProject(context.Context, string) error         { return nil }

type nopFile struct{}

func (nopFile) Read([]byte) (int, error)       { return 0, nil }
func (nopFile) Seek(int64, int) (int64, error) { return 0, nil }
func (nopFile) Close() error                   { return nil }
func (nopFile) Size() int64                    { return 0 }
func (nopFile) ModTime() time.Time             { return time.Time{} }

// The first name that exists wins, and a missing one falls through.
func TestOpenFirstOpensTheFirstNameThatExists(t *testing.T) {
	store := &mapStore{files: map[string]bool{"p/a.jpg": true, "p/a.gif": true}}
	_, rel, err := files.OpenFirst(context.Background(), store, "p/a.png", "p/a.jpg", "p/a.gif")
	if err != nil || rel != "p/a.jpg" {
		t.Errorf("OpenFirst = %q, %v, want p/a.jpg", rel, err)
	}
}

// A store that cannot answer for the first name is not a missing file: the
// next name is never served in its place.
func TestOpenFirstStopsAtAFailureThatIsNotAMissingFile(t *testing.T) {
	store := &mapStore{files: map[string]bool{"p/a.jpg": true}, broken: map[string]bool{"p/a.png": true}}
	_, _, err := files.OpenFirst(context.Background(), store, "p/a.png", "p/a.jpg")
	if !errors.Is(err, errBroken) {
		t.Errorf("OpenFirst = %v, want the store's own failure", err)
	}
	if len(store.opened) != 1 {
		t.Errorf("opened %v after the failure, want only p/a.png", store.opened)
	}
}

func TestOpenFirstWithNoNameThatExistsIsAMissingFile(t *testing.T) {
	_, _, err := files.OpenFirst(context.Background(), &mapStore{}, "p/a.png", "p/a.jpg")
	if !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("OpenFirst = %v, want fs.ErrNotExist", err)
	}
}

// firstOpenerStore answers OpenFirst itself, in one round trip.
type firstOpenerStore struct{ mapStore }

func (f *firstOpenerStore) OpenFirst(context.Context, ...string) (files.File, string, error) {
	return nopFile{}, "itself", nil
}

func TestOpenFirstLetsAStoreThatCanAnswerItselfDoSo(t *testing.T) {
	store := &firstOpenerStore{}
	if _, rel, _ := files.OpenFirst(context.Background(), store, "p/a.png"); rel != "itself" || len(store.opened) != 0 {
		t.Errorf("OpenFirst = %q after %v opens, want the store's own answer and no Open", rel, store.opened)
	}
}

// COR-8: a batch is written whole beside its name, under TempPrefix, and
// only then put in place.
func TestWriteNewPutsTheWholeFileInPlaceAndLeavesNothingElse(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "batch-1.pdf")
	if err := files.WriteNew(path, strings.NewReader("%PDF-lote")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "%PDF-lote" {
		t.Errorf("batch-1.pdf = %q, %v", got, err)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o644 {
		t.Errorf("mode = %v, want 0644", info.Mode().Perm())
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Errorf("the directory holds %d entries, want the batch alone", len(entries))
	}
}

// A write that fails half-way leaves nothing: no batch, no temp file.
func TestWriteNewLeavesNothingWhenTheSourceFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "batch-1.pdf")
	if err := files.WriteNew(path, iotest.ErrReader(errors.New("connection reset"))); err == nil {
		t.Fatal("WriteNew of a failing source succeeded")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Errorf("a failed write left %v", entries)
	}
}

// What O_EXCL gave before: a name that exists is never replaced.
func TestWriteNewNeverReplacesAFileThatExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "batch-1.pdf")
	if err := os.WriteFile(path, []byte("the first batch"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteNew(path, strings.NewReader("a second one")); err == nil {
		t.Error("WriteNew over an existing batch succeeded")
	}
	if got, _ := os.ReadFile(path); string(got) != "the first batch" {
		t.Errorf("the existing batch now reads %q", got)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Errorf("a refused write left %d entries", len(entries))
	}
}

// statOnRead is a source that, on its first Read, records whether path
// already exists — what a sync scanning the directory meanwhile would see.
type statOnRead struct {
	path    string
	content *strings.Reader
	seen    bool
	existed bool
}

func (s *statOnRead) Read(p []byte) (int, error) {
	if !s.seen {
		s.seen = true
		_, err := os.Stat(s.path)
		s.existed = err == nil
	}
	return s.content.Read(p)
}

// COR-8 itself (issue #338 review recheck: the cases above held for an
// in-place write too): while the batch is being written its name does not
// exist, so a sync scanning the directory meanwhile cannot upload half of it.
func TestWriteNewNeverExposesAHalfWrittenFileUnderItsName(t *testing.T) {
	path := filepath.Join(t.TempDir(), "batch-1.pdf")
	src := &statOnRead{path: path, content: strings.NewReader("%PDF-lote")}
	if err := files.WriteNew(path, src); err != nil {
		t.Fatal(err)
	}
	if !src.seen || src.existed {
		t.Errorf("batch-1.pdf existed while it was being written (read %v)", src.seen)
	}
}
