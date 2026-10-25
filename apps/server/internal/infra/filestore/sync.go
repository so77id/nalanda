package filestore

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"maps"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

// Sync keeps one project's working copy on the volume and its objects in
// the bucket in step around a worker call (issue #338 §3). AMC works on
// local files, so the bucket being the primary store means: bring the
// project to the disk before the call, and the call's result to the bucket
// after it. The caller holds the worker lock, so nothing else changes the
// project meanwhile.
//
// Two rules carry the design. Nothing is ever deleted from S3 because it is
// MISSING locally: the prune deletes exactly what this call removed (the
// local file set before the call minus the one after), so a partial
// picture can never become a deletion. And S3 is an input as well as a
// destination — its keys become paths the worker (root) reads and its link
// map becomes symlinks the review page serves — so every key is validated
// and every write goes through an os.Root on the project (§8).
type Sync struct {
	store *S3
	root  string
	log   *slog.Logger

	// hashes caches each local file's MD5 by its path, size and
	// nanosecond mtime. Every call scans its project twice, and an analyse
	// annotates each clean copy as a call of its own: forty copies would
	// otherwise hash the project's ~100 MB eighty times. A file rewritten
	// with the same size changes its mtime; one rewritten within the same
	// nanosecond with the same size would be missed, which no writer here
	// can do.
	mu     sync.Mutex
	hashes map[string]cachedHash
}

type cachedHash struct {
	size    int64
	modTime time.Time
	md5     string
}

// NewSync returns the sync over store for the work root workRoot
// (NALANDA_WORK_DIR). A missing dependency is a wiring mistake and panics.
func NewSync(store *S3, workRoot string, log *slog.Logger) *Sync {
	switch {
	case store == nil:
		panic("filestore.NewSync: no store")
	case workRoot == "":
		panic("filestore.NewSync: no work root")
	case log == nil:
		panic("filestore.NewSync: no logger")
	}
	return &Sync{store: store, root: workRoot, log: log, hashes: map[string]cachedHash{}}
}

// Around hydrates project, runs call, and pushes and prunes what the call
// did — after a FAILED call too, since whatever it left is the latest
// version (the batch-survives rule of #210). A hydrate failure returns
// before call runs. A push failure is the operation's failure, wrapped as
// files.ErrSync — and, after a call that SUCCEEDED, as files.ErrNotStored
// too, because the worker's work is done and on the volume (issue #338
// review, COR-1); when the call had failed as well, the call's error is the
// one returned and the push's is logged. The local files are never touched
// by a failure: the next call on the project, or the reconcile, finishes
// the copy.
//
// A project with no file on the volume and none in the bucket is refused
// before anything is created: no real call starts from nothing — the
// server writes a project's inputs before its first call — so it can only
// be a call that queued behind the purge of its project, and running it
// would re-create the directory and upload what the failed call leaves
// there, with no row left to find it (issue #338 review, SEC-1).
func (s *Sync) Around(ctx context.Context, project string, call func() error) error {
	return s.around(ctx, project, keptWhole, call)
}

// AroundDeferringDatabases is Around for a call the bucket does not need
// AMC's databases (data/*.sqlite) from: they are left out of the hydrate's
// uploads and of the push, and the next call of another kind uploads them in
// its hydrate — the disk's copy is the newer one — as does the reconcile.
// Two kinds of call (issue #338 review):
//
//   - /annotate/copy (PER-1) rewrites them as a by-product: it re-applies the
//     overrides the server holds and recomputes the scores — measured on the
//     real worker, two identical annotates of one copy changed capture.sqlite
//     and scoring.sqlite and left the corrected PDF byte-identical. Pushed per
//     call, an analyse's forty annotates uploaded a 5.7 MB capture.sqlite
//     forty times (228 MB) to keep the last one. Until the next other call
//     the bucket's databases are the ones it left, which is what a restore
//     needs: what an annotate adds is derived from them and from the
//     database, and the next annotate re-derives it.
//   - /scans/reset DELETES the capture's: uploading what the annotates
//     deferred, only for the reset's own prune to delete it, cost the
//     synchronous reset seconds of its 25 — on a slow uplink all of them, a
//     hydrate that could never finish (the recheck measured 5.8 MB). The
//     prune still deletes the bucket's copies of whatever the reset removed.
//
// Everything else, the corrected PDF first, goes up as in Around, and
// whatever the call needs from the bucket still comes down.
func (s *Sync) AroundDeferringDatabases(ctx context.Context, project string, call func() error) error {
	return s.around(ctx, project, amcDatabase, call)
}

// keptWhole defers nothing: every file a call changes goes up.
func keptWhole(string) bool { return false }

// amcDatabase names AMC's project databases, which
// AroundDeferringDatabases leaves for the next other call.
func amcDatabase(rel string) bool {
	return path.Dir(rel) == "data" && strings.HasSuffix(rel, ".sqlite")
}

func (s *Sync) around(ctx context.Context, project string, deferred func(rel string) bool, call func() error) error {
	if err := validProject(project); err != nil {
		return fmt.Errorf("%w: %w", files.ErrSync, err)
	}
	var stats syncStats
	start := time.Now()
	before, err := s.hydrate(ctx, project, deferred, &stats)
	stats.hydrate = time.Since(start)
	if err != nil {
		return fmt.Errorf("%w: bring %s from the bucket: %w", files.ErrSync, project, err)
	}
	start = time.Now()
	callErr := call()
	stats.call = time.Since(start)
	start = time.Now()
	pushErr := s.push(ctx, project, before, deferred, &stats)
	stats.push = time.Since(start)
	s.log.Info("files: synced", stats.attrs(project)...)
	if callErr != nil {
		if pushErr != nil {
			s.log.Error("files: push after a failed worker call", "project", project, "error", pushErr)
		}
		return callErr
	}
	if pushErr != nil {
		return fmt.Errorf("%w: %w: keep %s in the bucket: %w", files.ErrSync, files.ErrNotStored, project, pushErr)
	}
	return nil
}

// syncStats is one Around's line in the log: what each half moved and how
// long each part took, the call included — the numbers ADR-0089
// §Measurements asks for, which a push's duration alone hid (issue #338
// review, PER-5).
type syncStats struct {
	hydrate, call, push time.Duration
	downloaded          int
	// uploadedFirst is what the hydrate uploaded before the call: a new
	// batch, a source.tex, what a cut push left behind.
	uploadedFirst int
	uploaded      int
	bytes         int64
	pruned        int
	// deferred is what AroundDeferringDatabases left for the next other
	// call, by name: a file both halves skip is one file, and its size is
	// the upload that waits.
	deferred map[string]int64
}

func (st *syncStats) deferFile(rel string, size int64) {
	if st.deferred == nil {
		st.deferred = map[string]int64{}
	}
	st.deferred[rel] = size
}

func (st syncStats) attrs(project string) []any {
	ms := func(d time.Duration) time.Duration { return d.Round(time.Millisecond) }
	var deferredBytes int64
	for _, size := range st.deferred {
		deferredBytes += size
	}
	return []any{"project", project,
		"hydrate", ms(st.hydrate), "downloaded", st.downloaded, "uploaded_first", st.uploadedFirst,
		"call", ms(st.call),
		"push", ms(st.push), "uploaded", st.uploaded, "pruned", st.pruned,
		"bytes", st.bytes, "deferred", len(st.deferred), "deferred_bytes", deferredBytes}
}

// errNoProject is a call on a project that exists nowhere (see Around).
var errNoProject = errors.New("the project has no file on the volume nor in the bucket — purged, or never prepared")

// bucketNewer is the one tie rule of the hydrate and the reconcile (issue
// #338 review, ARQ-3): the bucket's copy wins only when it is strictly
// newer. At the same instant the disk's does — it is where AMC wrote it.
func bucketNewer(bucket, disk time.Time) bool { return bucket.After(disk) }

// snapshot is a project's local files at one moment: what the push compares
// against and what the prune subtracts.
type snapshot struct {
	files map[string]diskFile
	// links maps a contract name ("scans/copy-1-page-1.jpg") to its target.
	links      map[string]string
	newestLink time.Time
}

type diskFile struct {
	size    int64
	modTime time.Time
	md5     string // lower-case hex
}

type remoteObject struct {
	etag    string
	size    int64
	modTime time.Time
}

// hydrate makes the disk and the bucket agree on project, the newer side
// winning each file, and returns the snapshot the call starts from. A file
// deferred is never uploaded here; it still comes down when the bucket's is
// the newer one.
func (s *Sync) hydrate(ctx context.Context, project string, deferred func(string) bool, stats *syncStats) (snapshot, error) {
	remote, links, err := s.remoteState(ctx, project)
	if err != nil {
		return snapshot{}, err
	}
	if len(remote.objects) == 0 && !remote.hasLinks {
		if _, err := os.Stat(filepath.Join(s.root, filepath.FromSlash(project))); errors.Is(err, fs.ErrNotExist) {
			return snapshot{}, errNoProject
		}
	}
	root, err := s.openProject(project)
	if err != nil {
		return snapshot{}, err
	}
	defer func() { _ = root.Close() }()
	local, err := s.scan(root)
	if err != nil {
		return snapshot{}, err
	}

	up := func(rel string, file diskFile) error {
		if deferred(rel) {
			stats.deferFile(rel, file.size)
			return nil
		}
		if err := s.upload(ctx, root, project, rel, file); err != nil {
			return err
		}
		stats.uploadedFirst++
		stats.bytes += file.size
		return nil
	}
	for _, rel := range slices.Sorted(maps.Keys(remote.objects)) {
		obj := remote.objects[rel]
		file, here := local.files[rel]
		switch {
		case here && file.md5 == etagMD5(obj.etag):
			continue
		case !here || bucketNewer(obj.modTime, file.modTime):
			if err := s.download(ctx, root, project, rel, obj); err != nil {
				return snapshot{}, err
			}
			stats.downloaded++
		default:
			if err := up(rel, file); err != nil {
				return snapshot{}, err
			}
		}
	}
	for _, rel := range slices.Sorted(maps.Keys(local.files)) {
		if _, there := remote.objects[rel]; !there {
			if err := up(rel, local.files[rel]); err != nil {
				return snapshot{}, err
			}
		}
	}

	// The link map, newer side winning as for a file: the bucket's when the
	// disk has none (an empty volume) or older ones; the disk's otherwise.
	if remote.hasLinks && (len(local.links) == 0 || bucketNewer(remote.linksModTime, local.newestLink)) {
		s.materialize(root, links)
	} else if len(local.links) > 0 && !maps.Equal(local.links, links) {
		if err := s.writeLinks(ctx, project, local.links); err != nil {
			return snapshot{}, err
		}
	}

	return s.scan(root)
}

// push uploads what the call changed — the corrected PDFs first, since the
// review page the professor is redirected to shows one next — but what is
// deferred, rewrites the link map when it moved, and prunes exactly what the
// call removed.
func (s *Sync) push(ctx context.Context, project string, before snapshot, deferred func(string) bool, stats *syncStats) error {
	root, err := s.openProject(project)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	after, err := s.scan(root)
	if err != nil {
		return err
	}

	var changed []string
	for rel, file := range after.files {
		if was, ok := before.files[rel]; ok && was.md5 == file.md5 {
			continue
		}
		if deferred(rel) {
			stats.deferFile(rel, file.size)
			continue
		}
		changed = append(changed, rel)
	}
	slices.SortFunc(changed, func(a, b string) int {
		if pa, pb := strings.HasPrefix(a, "annotated/"), strings.HasPrefix(b, "annotated/"); pa != pb {
			if pa {
				return -1
			}
			return 1
		}
		return strings.Compare(a, b)
	})
	for _, rel := range changed {
		if err := s.upload(ctx, root, project, rel, after.files[rel]); err != nil {
			return err
		}
		stats.uploaded++
		stats.bytes += after.files[rel].size
	}

	if !maps.Equal(before.links, after.links) {
		var err error
		if len(after.links) == 0 {
			err = s.store.deleteKeys(ctx, []string{linksKey(project)})
		} else {
			err = s.writeLinks(ctx, project, after.links)
		}
		if err != nil {
			return fmt.Errorf("the link map: %w", err)
		}
	}

	var removed []string
	for rel := range before.files {
		if _, still := after.files[rel]; !still {
			removed = append(removed, KeyPrefix+project+"/"+rel)
		}
	}
	slices.Sort(removed)
	if err := s.store.deleteKeys(ctx, removed); err != nil {
		return fmt.Errorf("prune: %w", err)
	}
	stats.pruned = len(removed)
	return nil
}

// remote is the bucket's side of a project.
type remote struct {
	objects      map[string]remoteObject
	hasLinks     bool
	linksModTime time.Time
}

// remoteState lists the project's objects and reads its link map. A key
// whose remainder is not a clean path of the project — `..`, an absolute
// remainder, an empty segment, a reserved name other than the link map —
// fails the hydrate (§8.1): it can only have been written by someone
// holding the server's key, and quietly skipping it would hide that.
func (s *Sync) remoteState(ctx context.Context, project string) (remote, map[string]string, error) {
	prefix := KeyPrefix + project + "/"
	state := remote{objects: map[string]remoteObject{}}
	var refused []string
	err := s.store.each(ctx, prefix, "", func(o types.Object) {
		key := aws.ToString(o.Key)
		rel := strings.TrimPrefix(key, prefix)
		switch {
		case key == linksKey(project):
			state.hasLinks = true
			state.linksModTime = aws.ToTime(o.LastModified)
		case strings.HasSuffix(key, "/") && aws.ToInt64(o.Size) == 0:
			// A "folder" the S3 console makes; no file to bring.
		case files.ValidRel(rel) != nil:
			refused = append(refused, key)
		case skipped(rel):
		default:
			state.objects[rel] = remoteObject{
				etag: aws.ToString(o.ETag), size: aws.ToInt64(o.Size), modTime: aws.ToTime(o.LastModified),
			}
		}
	})
	if err != nil {
		return remote{}, nil, fmt.Errorf("list: %w", err)
	}
	if len(refused) > 0 {
		return remote{}, nil, fmt.Errorf("%w: %d key(s) under %s are not clean paths of the project, first %q",
			files.ErrInvalidPath, len(refused), prefix, refused[0])
	}
	var links map[string]string
	if state.hasLinks {
		if links, err = s.store.readLinks(ctx, project); err != nil {
			return remote{}, nil, err
		}
	}
	return state, links, nil
}

// scan reads the project's local files and links through root. Only
// regular files are files; a symlink is a link only when it is an ADR-0037
// contract name pointing at a bare file name of the same scans/ (anything
// else is left out, and logged); the denylist and the reserved directory
// never enter.
func (s *Sync) scan(root *os.Root) (snapshot, error) {
	snap := snapshot{files: map[string]diskFile{}, links: map[string]string{}}
	err := fs.WalkDir(root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		switch {
		case p == ".":
			return nil
		case d.IsDir():
			if d.Name() == files.ReservedDir {
				s.log.Warn("files: leaving a reserved directory out of the sync", "dir", root.Name()+"/"+p)
				return fs.SkipDir
			}
			return nil
		case d.Type()&fs.ModeSymlink != 0:
			target, err := root.Readlink(filepath.FromSlash(p))
			if err != nil {
				return err
			}
			if !contractLink(p, target) {
				s.log.Warn("files: leaving a symlink out of the sync", "link", root.Name()+"/"+p, "target", target)
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			snap.links[p] = target
			if info.ModTime().After(snap.newestLink) {
				snap.newestLink = info.ModTime()
			}
			return nil
		case !d.Type().IsRegular():
			s.log.Warn("files: leaving a non-regular file out of the sync", "path", root.Name()+"/"+p)
			return nil
		case skipped(p):
			return nil
		case files.ValidRel(p) != nil:
			s.log.Warn("files: leaving a file whose name is not a clean path out of the sync", "path", root.Name()+"/"+p)
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		sum, err := s.hashOf(root, p, info)
		if err != nil {
			return err
		}
		snap.files[p] = diskFile{size: info.Size(), modTime: info.ModTime(), md5: sum}
		return nil
	})
	if err != nil {
		return snapshot{}, fmt.Errorf("read %s: %w", root.Name(), err)
	}
	return snap, nil
}

// download brings one object to rel through root (§8.2): into a temp file
// beside the target, MD5-checked against the ETag, given the object's time,
// and renamed into place — rename replaces whatever is at rel, a symlink
// included, instead of writing through it. A multipart ETag is not an MD5
// and this server never writes one, so such an object is refused.
func (s *Sync) download(ctx context.Context, root *os.Root, project, rel string, obj remoteObject) error {
	want := etagMD5(obj.etag)
	if want == "" {
		return fmt.Errorf("%s/%s has ETag %s, which is not a single-part MD5 the download can be checked against",
			project, rel, obj.etag)
	}
	if dir := path.Dir(rel); dir != "." {
		if err := root.MkdirAll(filepath.FromSlash(dir), 0o755); err != nil {
			return fmt.Errorf("prepare %s: %w", dir, err)
		}
	}
	key := KeyPrefix + project + "/" + rel
	body, err := s.store.get(ctx, key, obj.etag)
	if err != nil {
		return fmt.Errorf("get %s: %w", key, err)
	}
	defer func() { _ = body.Close() }()

	tmp := path.Join(path.Dir(rel), tempPrefix+randomSuffix())
	f, err := root.OpenFile(filepath.FromSlash(tmp), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("create %s: %w", tmp, err)
	}
	sum := md5.New()
	_, copyErr := io.Copy(io.MultiWriter(f, sum), body)
	closeErr := f.Close()
	got := hex.EncodeToString(sum.Sum(nil))
	switch {
	case copyErr != nil:
		err = fmt.Errorf("read %s: %w", key, copyErr)
	case closeErr != nil:
		err = fmt.Errorf("write %s: %w", tmp, closeErr)
	case got != want:
		err = fmt.Errorf("%s arrived with MD5 %s, its ETag says %s", key, got, want)
	default:
		err = root.Chtimes(filepath.FromSlash(tmp), obj.modTime, obj.modTime)
	}
	if err == nil {
		err = root.Rename(filepath.FromSlash(tmp), filepath.FromSlash(rel))
	}
	if err != nil {
		_ = root.Remove(filepath.FromSlash(tmp))
		return err
	}
	return nil
}

// upload sends one local file whole, through S3.put: one PutObject with the
// MD5 the scan computed, so S3 refuses a body that changed between the scan
// and the send.
func (s *Sync) upload(ctx context.Context, root *os.Root, project, rel string, file diskFile) error {
	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		return fmt.Errorf("open %s: %w", rel, err)
	}
	defer func() { _ = f.Close() }()
	raw, err := hex.DecodeString(file.md5)
	if err != nil {
		return err
	}
	key := KeyPrefix + project + "/" + rel
	if err := s.store.put(ctx, key, f, file.size, raw, ""); err != nil {
		return fmt.Errorf("put %s: %w", key, err)
	}
	return nil
}

// materialize creates the bucket's links on disk, each one only if it is a
// contract name pointing at a bare file name of the same scans/ (§8.3), and
// through a temp link renamed into place. A link it cannot create is
// logged and left; the page answers 404 for that one image.
func (s *Sync) materialize(root *os.Root, links map[string]string) {
	for _, name := range slices.Sorted(maps.Keys(links)) {
		target := links[name]
		if !contractLink(name, target) {
			s.log.Warn("files: refusing a link from the bucket's map", "dir", root.Name(), "link", name, "target", target)
			continue
		}
		if current, err := root.Readlink(filepath.FromSlash(name)); err == nil && current == target {
			continue
		}
		if err := root.MkdirAll("scans", 0o755); err != nil {
			s.log.Warn("files: preparing scans/ for a link", "dir", root.Name(), "error", err)
			return
		}
		tmp := path.Join("scans", tempPrefix+randomSuffix())
		err := root.Symlink(target, filepath.FromSlash(tmp))
		if err == nil {
			err = root.Rename(filepath.FromSlash(tmp), filepath.FromSlash(name))
		}
		if err != nil {
			_ = root.Remove(filepath.FromSlash(tmp))
			s.log.Warn("files: creating a link from the bucket's map", "dir", root.Name(), "link", name, "error", err)
		}
	}
}

func (s *Sync) writeLinks(ctx context.Context, project string, links map[string]string) error {
	body, err := json.Marshal(links)
	if err != nil {
		return err
	}
	if len(body) > maxLinksBytes {
		return fmt.Errorf("the link map of %s is %d bytes, over the %d the reader accepts", project, len(body), maxLinksBytes)
	}
	sum := md5.Sum(body)
	key := linksKey(project)
	if err := s.store.put(ctx, key, bytes.NewReader(body), int64(len(body)), sum[:], "application/json"); err != nil {
		return fmt.Errorf("put %s: %w", key, err)
	}
	return nil
}

// openProject opens the project's directory as an os.Root, creating it
// first: every write the sync makes stays inside it, whatever symlink a
// directory of the project has been replaced by.
func (s *Sync) openProject(project string) (*os.Root, error) {
	dir := filepath.Join(s.root, filepath.FromSlash(project))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("prepare %s: %w", dir, err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", dir, err)
	}
	return root, nil
}

func linksKey(project string) string {
	return KeyPrefix + project + "/" + files.ReservedDir + "/" + linksName
}

// tempPrefix names the sync's own temp files and links, and the server's
// batches while they are written (files.WriteNew). The denylist skips it, so
// one a crash left behind is never uploaded.
const tempPrefix = files.TempPrefix

// annotateScratch is the file a failed annotate leaves at the project's
// root (the worker's annotate-copy-N.txt).
var annotateScratch = regexp.MustCompile(`^annotate-copy-[0-9]+\.txt$`)

// skipped is the denylist (issue #338's catalog): what a project holds that
// is not worth keeping — the getimages input lists, the annotate scratch,
// SQLite's transients — and the sync's own temp files. Default-include is
// deliberate: a file AMC starts writing tomorrow is kept until somebody
// decides otherwise, rather than lost until somebody notices.
func skipped(rel string) bool {
	base, dir := path.Base(rel), path.Dir(rel)
	switch {
	case dir == "scans" && strings.HasPrefix(base, "list") && strings.HasSuffix(base, ".txt"):
		return true
	case dir == "." && annotateScratch.MatchString(base):
		return true
	case strings.HasSuffix(base, "-journal"), strings.HasSuffix(base, "-wal"), strings.HasSuffix(base, "-shm"):
		return true
	case strings.HasPrefix(base, tempPrefix):
		return true
	}
	return false
}

// contractLink is a link the sync keeps: an ADR-0037 name directly under
// scans/, pointing at a bare file name of the same directory.
func contractLink(name, target string) bool {
	return path.Dir(name) == "scans" && contractName.MatchString(path.Base(name)) && bareName(target)
}

// etagMD5 is the MD5 a single-part ETag carries, lower-case hex, or "" for
// anything else (a multipart ETag is "<md5 of md5s>-<parts>").
func etagMD5(etag string) string {
	sum := strings.ToLower(strings.Trim(etag, `"`))
	if len(sum) != 32 {
		return ""
	}
	if _, err := hex.DecodeString(sum); err != nil {
		return ""
	}
	return sum
}

// hashOf is md5Of through the cache.
func (s *Sync) hashOf(root *os.Root, rel string, info fs.FileInfo) (string, error) {
	key := root.Name() + "/" + rel
	s.mu.Lock()
	cached, ok := s.hashes[key]
	s.mu.Unlock()
	if ok && cached.size == info.Size() && cached.modTime.Equal(info.ModTime()) {
		return cached.md5, nil
	}
	sum, err := md5Of(root, rel)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.hashes[key] = cachedHash{size: info.Size(), modTime: info.ModTime(), md5: sum}
	s.mu.Unlock()
	return sum, nil
}

func md5Of(root *os.Root, rel string) (string, error) {
	f, err := root.Open(filepath.FromSlash(rel))
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	sum := md5.New()
	if _, err := io.Copy(sum, f); err != nil {
		return "", fmt.Errorf("hash %s: %w", rel, err)
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

func randomSuffix() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
