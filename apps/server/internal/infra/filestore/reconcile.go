package filestore

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"time"
)

// Reconciler uploads, for every project the database knows, each local file
// the bucket lacks or holds older, and the link map when the disk's is
// newer — the hydrate's upload half, under the same tie rule (bucketNewer),
// and nothing else (issue #338 §5). It
// NEVER downloads and NEVER deletes: it runs at boot, when the volume may be
// the drill's empty one or a rollback's stale one, and a reconcile that
// trusted the disk over the bucket would be the very deletion-by-absence the
// design forbids.
//
// It is what carries the files across the migration (-sync-files, before
// the store is flipped), what finishes a push a failed call or a deadline
// left behind, and what uploads what a rollback to the local store wrote
// meanwhile. It also carries what an annotate left for the next call (the
// databases Sync.AroundAnnotate defers).
type Reconciler struct {
	sync *Sync
	// projects lists every project the database knows — controls archived
	// or not, and every survey run — as files.Store paths.
	projects func(ctx context.Context) ([]string, error)
	// exclusive runs fn under the worker lock, so a project is never read
	// while a worker call is changing it, nor while the purge deletes it.
	// -sync-files runs in a process of its own and cannot share the
	// server's lock; its operating procedure says to run it with no job in
	// flight (DEPLOY-JETSON.md).
	exclusive func(fn func() error) error
	log       *slog.Logger
}

// NewReconciler returns the reconciler over sync. projects and exclusive are
// described on the type; a missing dependency is a wiring mistake and
// panics at boot, like NewSync.
func NewReconciler(sync *Sync, projects func(context.Context) ([]string, error), exclusive func(func() error) error, log *slog.Logger) *Reconciler {
	switch {
	case sync == nil:
		panic("filestore.NewReconciler: no sync")
	case projects == nil:
		panic("filestore.NewReconciler: no project list")
	case exclusive == nil:
		panic("filestore.NewReconciler: no worker lock")
	case log == nil:
		panic("filestore.NewReconciler: no logger")
	}
	return &Reconciler{sync: sync, projects: projects, exclusive: exclusive, log: log}
}

// Summary is one reconcile's line in the log.
type Summary struct {
	Projects int
	Files    int
	Bytes    int64
	Failed   int
	Took     time.Duration
}

// Run reconciles every project, one at a time, each under the lock. A
// project that fails is logged and counted, and the others still run; the
// error is only for a project list that could not be read.
//
// The list is read again under each project's lock, and a project no longer
// on it is skipped: the purge takes the same lock, so one that landed after
// the walk began has deleted the project's objects and rows by then, and
// what a failed RemoveAll left on the disk must not go back up with no row
// to find it (issue #338 review, COR-10).
func (r *Reconciler) Run(ctx context.Context) (Summary, error) {
	start := time.Now()
	projects, err := r.projects(ctx)
	if err != nil {
		return Summary{}, fmt.Errorf("filestore: list the projects to reconcile: %w", err)
	}
	summary := Summary{Projects: len(projects)}
	for _, project := range projects {
		var files int
		var bytes int64
		err := r.exclusive(func() error {
			current, err := r.projects(ctx)
			if err != nil {
				return fmt.Errorf("list the projects again: %w", err)
			}
			if !slices.Contains(current, project) {
				return nil
			}
			files, bytes, err = r.sync.uploadLocal(ctx, project)
			return err
		})
		if err != nil {
			summary.Failed++
			r.log.Error("files: reconcile", "project", project, "error", err)
			continue
		}
		summary.Files += files
		summary.Bytes += bytes
	}
	summary.Took = time.Since(start).Round(time.Millisecond)
	r.log.Info("files: reconciled", "projects", summary.Projects, "files", summary.Files,
		"bytes", summary.Bytes, "failed", summary.Failed, "took", summary.Took)
	return summary, nil
}

// NextReconcile is the next 03:00 UTC strictly after now: the database
// backup's hour, so the day's two snapshots line up.
func NextReconcile(now time.Time) time.Time {
	now = now.UTC()
	next := time.Date(now.Year(), now.Month(), now.Day(), 3, 0, 0, 0, time.UTC)
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// uploadLocal is the upload half of hydrate for one project: a local file
// goes up when the bucket lacks it, or holds a different one that is not
// NEWER; the link map, when the disk has links the bucket's map lacks and
// the bucket's is not newer. A project with no local directory has nothing
// to upload — the directory is not created.
func (s *Sync) uploadLocal(ctx context.Context, project string) (files int, bytes int64, err error) {
	if err := validProject(project); err != nil {
		return 0, 0, err
	}
	dir := filepath.Join(s.root, filepath.FromSlash(project))
	if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
		return 0, 0, nil
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return 0, 0, fmt.Errorf("open %s: %w", dir, err)
	}
	defer func() { _ = root.Close() }()

	remote, links, err := s.remoteState(ctx, project)
	if err != nil {
		return 0, 0, err
	}
	local, err := s.scan(root)
	if err != nil {
		return 0, 0, err
	}
	for _, rel := range slices.Sorted(maps.Keys(local.files)) {
		file := local.files[rel]
		obj, there := remote.objects[rel]
		if there && (file.md5 == etagMD5(obj.etag) || bucketNewer(obj.modTime, file.modTime)) {
			continue
		}
		if err := s.upload(ctx, root, project, rel, file); err != nil {
			return files, bytes, err
		}
		files++
		bytes += file.size
	}
	if len(local.links) > 0 && !maps.Equal(local.links, links) &&
		(!remote.hasLinks || !bucketNewer(remote.linksModTime, local.newestLink)) {
		if err := s.writeLinks(ctx, project, local.links); err != nil {
			return files, bytes, err
		}
	}
	return files, bytes, nil
}
