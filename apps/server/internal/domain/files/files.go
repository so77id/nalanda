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
	"path"
	"strings"
	"time"
)

// Store reads the work files. Every path it takes is relative to the work
// root and passes ValidRel first.
type Store interface {
	// Open returns the file at rel. A file that does not exist — or a
	// directory where a file was asked for — answers an error matching
	// fs.ErrNotExist.
	Open(ctx context.Context, rel string) (File, error)
	// List returns the files directly under relDir, sorted by name; nested
	// directories are not entries. A directory that does not exist is an
	// empty list, not an error.
	List(ctx context.Context, relDir string) ([]Entry, error)
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

// ErrInvalidPath is a path ValidRel refuses.
var ErrInvalidPath = errors.New("files: invalid path")

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
