// Package files is the port every work file is read through (issue #338):
// the sheets, scans, page images and corrected PDFs the controls and the
// survey runs keep under the shared volume, each named by its path relative
// to the volume's root ("controls/<id>/out/sujet.pdf").
//
// S3 becomes the place those files live and the volume a working copy AMC
// needs, so a page that shows a scan or a route that hands out a batch asks
// this port, never the disk. Which store answers is decided once at boot
// (NALANDA_FILES_STORE); nothing behind a handler branches on it.
//
// The package is neutral on purpose, like uploads: both subsystems read
// their files through it and the survey subsystem may not import the
// controls (ADR-0078), so it knows paths and never a control or a run
// (TestTheFilesDomainImportsNeitherSubsystem).
package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// Store reads the work files, and deletes a purged project's. Every path it
// takes is relative to the work root and passes ValidRel first.
type Store interface {
	// Open returns the file at rel. A file that does not exist — or a
	// directory where a file was asked for — answers an error matching
	// fs.ErrNotExist.
	Open(ctx context.Context, rel string) (File, error)
	// List returns the files directly under relDir, sorted by name; nested
	// directories are not entries. A directory that does not exist is an
	// empty list, not an error.
	List(ctx context.Context, relDir string) ([]Entry, error)
	// DeleteProject deletes every file the store holds for a project
	// (controls/<id>) — the purge, and nothing else (ADR-0052 as amended
	// by #338). The local store answers nil and deletes nothing: there the
	// disk IS the store, and the purge removes it best-effort after the
	// rows, as it always did.
	DeleteProject(ctx context.Context, project string) error
}

// File is an open work file: what http.ServeContent needs (it seeks to the
// end for the length and answers Range from there), plus the two facts a
// page or a download states about it.
type File interface {
	io.ReadSeekCloser
	Size() int64
	ModTime() time.Time
}

// Entry is one file of a List.
type Entry struct {
	Name    string
	Size    int64
	ModTime time.Time
}

// ReservedDir is the directory inside a project that holds the store's own
// metadata rather than a work file (the S3 store keeps a project's symlinks
// there). No work file may be named under it, so ValidRel refuses it.
const ReservedDir = ".nalanda"

// TempPrefix starts the name of a file still being written. The sync never
// uploads one — a crash's leftover included — so a writer that writes under
// it and puts the file in place when it is whole never hands the store half
// a file.
const TempPrefix = ".nalanda-tmp-"

// WriteNew writes r to path, which must not exist yet: into a temp file
// beside it, named under TempPrefix, then linked into place. The server
// writes a batch on the request goroutine, outside the worker lock, while a
// sync on the same project (an annotate, the reconcile) may be scanning it,
// and it uploads every file the bucket lacks — written in place, half a
// batch could reach S3 (issue #338 review, COR-8). Linking rather than
// renaming keeps what O_EXCL gave before: a path that exists by then is
// never replaced. A failure leaves nothing behind.
func WriteNew(path string, r io.Reader) error {
	f, err := os.CreateTemp(filepath.Dir(path), TempPrefix+"*")
	if err != nil {
		return fmt.Errorf("files: create a temp file for %s: %w", path, err)
	}
	tmp := f.Name()
	defer func() { _ = os.Remove(tmp) }()
	if _, err := io.Copy(f, r); err != nil {
		_ = f.Close()
		return fmt.Errorf("files: write %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("files: write %s: %w", path, err)
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		return fmt.Errorf("files: write %s: %w", path, err)
	}
	if err := os.Link(tmp, path); err != nil {
		return fmt.Errorf("files: put %s in place: %w", path, err)
	}
	return nil
}

// ErrInvalidPath is a path ValidRel refuses.
var ErrInvalidPath = errors.New("files: invalid path")

// ErrSync wraps every failure of the store to complete a write or a delete
// the server asked of it: keeping a project's working copy and the store in
// step around a worker call (the store unreachable, an object that fails
// its checksum, a key that is not a clean path), and the purge's
// DeleteProject. Declared here, not by the adapter, so the job handlers and
// pages of both subsystems can tell it apart and name it in Spanish without
// importing infra.
var ErrSync = errors.New("files: the store could not be brought in step")

// ErrNotStored is the one ErrSync after which the worker's work is DONE: the
// call succeeded and its result is on the volume, and only the copy to the
// store failed (issue #338 review, COR-1). It is always wrapped together
// with ErrSync, so a caller that knows only ErrSync still names the store. A
// caller holding a result to persist — an analyse's report — persists it
// first: the next call's hydrate, or the reconcile, finishes the copy from
// the volume, and throwing the report away would lose a reading AMC has
// already captured.
var ErrNotStored = errors.New("files: the result is on the volume but not in the store")

// FirstOpener is a store that can open the first existing one of several
// names more cheaply than one Open per name: the S3 store resolves every
// contract name against a single read of the project's link map. OpenFirst
// uses it when the store has it.
type FirstOpener interface {
	OpenFirst(ctx context.Context, rels ...string) (File, string, error)
}

// OpenFirst opens the first of rels that exists, in order, and says which it
// was — a page image that may be a PNG or a JPG, the PNG winning. Only a
// missing file falls through to the next name; any other failure is
// returned as it is, because a store that could not answer must not be
// mistaken for a file that is not there (and the next name served in its
// place). When none exists the error matches fs.ErrNotExist.
func OpenFirst(ctx context.Context, store Store, rels ...string) (File, string, error) {
	if fo, ok := store.(FirstOpener); ok {
		return fo.OpenFirst(ctx, rels...)
	}
	for _, rel := range rels {
		f, err := store.Open(ctx, rel)
		if err == nil {
			return f, rel, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return nil, "", err
		}
	}
	return nil, "", fmt.Errorf("files: none of %q: %w", rels, fs.ErrNotExist)
}

// ValidRel accepts a clean, relative, slash-separated path: no leading
// slash, no empty, "." or ".." segment, no trailing slash, no backslash, no
// NUL, and nothing under ReservedDir. It is the one check between a value a
// request carried and a file on disk or a key in a bucket.
func ValidRel(rel string) error {
	if rel == "" || strings.ContainsAny(rel, "\\\x00") || path.Clean(rel) != rel || path.IsAbs(rel) {
		return fmt.Errorf("%w: %q", ErrInvalidPath, rel)
	}
	for _, segment := range strings.Split(rel, "/") {
		if segment == "." || segment == ".." || segment == ReservedDir {
			return fmt.Errorf("%w: %q", ErrInvalidPath, rel)
		}
	}
	return nil
}
