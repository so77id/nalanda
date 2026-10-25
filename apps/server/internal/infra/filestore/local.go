// Package filestore holds the two adapters behind files.Store and what keeps
// the second one current (issue #338, ADR-0089). Local reads the shared
// volume directly, which is what every read did before S3 became the primary
// store and what NALANDA_FILES_STORE=local keeps doing; S3 reads the bucket.
// Sync keeps a project's working copy and its objects in step around each
// worker call, and Reconciler uploads what the disk holds and the bucket
// lacks, at boot, daily and on -sync-files.
package filestore

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

// Local is the store over a directory on this host: the work root the
// server sees (NALANDA_WORK_DIR).
type Local struct {
	root string
}

// NewLocal returns the store over root. An empty root is a wiring mistake
// and panics at boot (backend-code-style.md §Errors).
func NewLocal(root string) *Local {
	if root == "" {
		panic("filestore.NewLocal: no root")
	}
	return &Local{root: root}
}

// Open opens rel under the root. A path through a symlink is followed, as
// os.Open always did here: the review page's contract names
// (scans/copy-N-page-M.jpg) are symlinks the worker writes (ADR-0037).
func (l *Local) Open(_ context.Context, rel string) (files.File, error) {
	if err := files.ValidRel(rel); err != nil {
		return nil, err
	}
	f, err := os.Open(l.path(rel))
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("filestore: stat %s: %w", rel, err)
	}
	if !info.Mode().IsRegular() {
		_ = f.Close()
		return nil, fmt.Errorf("filestore: %s is not a regular file: %w", rel, fs.ErrNotExist)
	}
	return localFile{File: f, info: info}, nil
}

// List names the regular files directly under relDir. A symlink is not an
// entry — the S3 store keeps symlinks in a link map, not as objects, and the
// two stores answer alike.
func (l *Local) List(_ context.Context, relDir string) ([]files.Entry, error) {
	if err := files.ValidRel(relDir); err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(l.path(relDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("filestore: list %s: %w", relDir, err)
	}
	entries := make([]files.Entry, 0, len(dirents))
	for _, d := range dirents {
		if !d.Type().IsRegular() {
			continue
		}
		info, err := d.Info()
		if err != nil {
			return nil, fmt.Errorf("filestore: list %s: %s: %w", relDir, d.Name(), err)
		}
		entries = append(entries, files.Entry{Name: d.Name(), Size: info.Size(), ModTime: info.ModTime()})
	}
	return entries, nil
}

// DeleteProject deletes nothing: the local copy is the volume itself, which
// the purge removes after the rows, best-effort, as before #338 — deleting
// it here, before them, would turn a disk hiccup into a refused purge with
// half its files gone.
func (l *Local) DeleteProject(_ context.Context, project string) error {
	return validProject(project)
}

func (l *Local) path(rel string) string {
	return filepath.Join(l.root, filepath.FromSlash(rel))
}

type localFile struct {
	*os.File
	info fs.FileInfo
}

func (f localFile) Size() int64        { return f.info.Size() }
func (f localFile) ModTime() time.Time { return f.info.ModTime() }
