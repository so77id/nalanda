package filestore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

// S3Client is the part of the SDK's *s3.Client the S3 store calls. Narrow on
// purpose: the suite drives an in-memory bucket behind it (s3test), and what
// that fake cannot vouch for — signing, the ETag under the bucket's real
// encryption, Range on the wire — is apps/server/S3-CHECK.md's.
type S3Client interface {
	HeadObject(context.Context, *s3.HeadObjectInput, ...func(*s3.Options)) (*s3.HeadObjectOutput, error)
	GetObject(context.Context, *s3.GetObjectInput, ...func(*s3.Options)) (*s3.GetObjectOutput, error)
	ListObjectsV2(context.Context, *s3.ListObjectsV2Input, ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
	PutObject(context.Context, *s3.PutObjectInput, ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObjects(context.Context, *s3.DeleteObjectsInput, ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error)
}

// KeyPrefix is where the work files live in the bucket. work/ mirrors
// /work exactly, so an object's key is KeyPrefix plus the path files.Store
// takes; backups/ beside it is the database's and is never touched here.
const KeyPrefix = "work/"

// linksName is the object, inside a project's files.ReservedDir, holding
// the project's symlinks: S3 has none, and the ADR-0037 contract names the
// review page asks for are symlinks the worker writes on disk.
const linksName = "links.json"

// maxLinksBytes caps a links.json. A real one is a few dozen KB (a link of
// ~60 bytes per scanned page); the cap keeps a bad object from being read
// into memory whole.
const maxLinksBytes = 1 << 20

// maxDeleteBatch is the most keys one DeleteObjects takes.
const maxDeleteBatch = 1000

// contractName is the ADR-0037 name of a scanned page under scans/.
var contractName = regexp.MustCompile(`^copy-[1-9][0-9]*-page-[1-9][0-9]*\.(jpg|png)$`)

// S3 is the store over a bucket: the place the work files live once
// NALANDA_FILES_STORE=s3, with the volume as AMC's working copy (issue #338).
type S3 struct {
	client S3Client
	bucket string
}

// NewS3 returns the store over bucket. A nil client or an empty bucket is a
// wiring mistake and panics at boot.
func NewS3(client S3Client, bucket string) *S3 {
	switch {
	case client == nil:
		panic("filestore.NewS3: no client")
	case bucket == "":
		panic("filestore.NewS3: no bucket")
	}
	return &S3{client: client, bucket: bucket}
}

// Open costs one HeadObject; the body is fetched on the first Read, from
// the position the reader has sought to, so http.ServeContent's Range and
// If-Modified-Since cost what they cost on disk. A contract name under
// scans/ is resolved through the project's links.json first.
func (s *S3) Open(ctx context.Context, rel string) (files.File, error) {
	if err := files.ValidRel(rel); err != nil {
		return nil, err
	}
	if project, ok := contractPage(rel); ok {
		target, err := s.resolveLink(ctx, project, rel)
		if err != nil {
			return nil, err
		}
		rel = target
	}
	key := KeyPrefix + rel
	head, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		if !notFound(err) && s.absent(ctx, key) {
			return nil, fmt.Errorf("filestore: open %s: %w (the HEAD answered %v)", rel, fs.ErrNotExist, err)
		}
		return nil, s.fail("open", rel, err)
	}
	// The file keeps the request's ctx for the GET it issues later: an
	// io.Reader has no ctx of its own, and the read belongs to the request
	// that opened it.
	return &s3File{
		ctx: ctx, client: s.client, bucket: s.bucket, key: key,
		etag:    aws.ToString(head.ETag),
		size:    aws.ToInt64(head.ContentLength),
		modTime: aws.ToTime(head.LastModified),
	}, nil
}

// List names the objects directly under relDir. The contract names are not
// entries — they live in links.json — and no caller lists scans/.
func (s *S3) List(ctx context.Context, relDir string) ([]files.Entry, error) {
	if err := files.ValidRel(relDir); err != nil {
		return nil, err
	}
	prefix := KeyPrefix + relDir + "/"
	var entries []files.Entry
	err := s.each(ctx, prefix, "/", func(o types.Object) {
		name := strings.TrimPrefix(aws.ToString(o.Key), prefix)
		if name == "" || strings.Contains(name, "/") {
			return
		}
		entries = append(entries, files.Entry{
			Name: name, Size: aws.ToInt64(o.Size), ModTime: aws.ToTime(o.LastModified),
		})
	})
	if err != nil {
		return nil, fmt.Errorf("filestore: list %s: %w", relDir, err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return entries, nil
}

// DeleteProject deletes every object under a project: the purge (ADR-0052,
// amended by #338) and nothing else. A destructive call on a path someone
// else derived, so only a project's own shape is accepted —
// controls/<id> or surveys/<id>/runs/<id> — and a caller's bug cannot widen
// it to a whole subsystem. S3 answers 200 to a DeleteObjects that refused
// some keys, so the per-key errors are read rather than the status.
func (s *S3) DeleteProject(ctx context.Context, project string) error {
	if err := validProject(project); err != nil {
		return err
	}
	prefix := KeyPrefix + project + "/"
	var keys []string
	if err := s.each(ctx, prefix, "", func(o types.Object) {
		keys = append(keys, aws.ToString(o.Key))
	}); err != nil {
		return fmt.Errorf("filestore: delete %s: list: %w", project, err)
	}
	if err := s.deleteKeys(ctx, keys); err != nil {
		return fmt.Errorf("filestore: delete %s: %w", project, err)
	}
	return nil
}

// deleteKeys deletes keys in batches S3 accepts, reading the per-key
// errors a 200 answer can carry.
func (s *S3) deleteKeys(ctx context.Context, keys []string) error {
	for len(keys) > 0 {
		batch := keys[:min(len(keys), maxDeleteBatch)]
		keys = keys[len(batch):]
		ids := make([]types.ObjectIdentifier, len(batch))
		for i := range batch {
			ids[i] = types.ObjectIdentifier{Key: &batch[i]}
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: &s.bucket,
			Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return err
		}
		if len(out.Errors) > 0 {
			first := out.Errors[0]
			return fmt.Errorf("%d key(s) refused, first %s: %s %s",
				len(out.Errors), aws.ToString(first.Key), aws.ToString(first.Code), aws.ToString(first.Message))
		}
	}
	return nil
}

// absent reports whether a listing of key finds no object of that very
// name. S3 answers a HEAD of a missing key with 404 only to a caller allowed
// to list the bucket, and 403 otherwise; the server's ListBucket carries a
// prefix condition whose effect on a HEAD's implicit check AWS does not
// document. A HEAD that failed for any reason but NotFound is therefore
// checked here — one listing, only on the error path — so a missing file
// reads as missing whichever way S3 answers. A listing that fails says
// nothing, and the HEAD's own error stands.
func (s *S3) absent(ctx context.Context, key string) bool {
	out, err := s.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: &s.bucket, Prefix: &key, MaxKeys: aws.Int32(1),
	})
	if err != nil {
		return false
	}
	return len(out.Contents) == 0 || aws.ToString(out.Contents[0].Key) != key
}

// each walks every object under prefix, page by page.
func (s *S3) each(ctx context.Context, prefix, delimiter string, visit func(types.Object)) error {
	in := &s3.ListObjectsV2Input{Bucket: &s.bucket, Prefix: &prefix}
	if delimiter != "" {
		in.Delimiter = &delimiter
	}
	for {
		out, err := s.client.ListObjectsV2(ctx, in)
		if err != nil {
			return err
		}
		for _, o := range out.Contents {
			visit(o)
		}
		if !aws.ToBool(out.IsTruncated) {
			return nil
		}
		in.ContinuationToken = out.NextContinuationToken
	}
}

// resolveLink answers the image a contract name links to, as a path under
// the same scans/. A target that is not a bare file name of that directory
// is never followed (issue #338 §8.3): the link map is input, not trust.
func (s *S3) resolveLink(ctx context.Context, project, rel string) (string, error) {
	links, err := s.readLinks(ctx, project)
	if err != nil {
		return "", err
	}
	name := strings.TrimPrefix(rel, project+"/")
	target, ok := links[name]
	if !ok || !bareName(target) {
		return "", fmt.Errorf("filestore: open %s: no link: %w", rel, fs.ErrNotExist)
	}
	return path.Join(project, "scans", target), nil
}

func (s *S3) readLinks(ctx context.Context, project string) (map[string]string, error) {
	key := KeyPrefix + path.Join(project, files.ReservedDir, linksName)
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if notFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("filestore: read %s: %w", key, err)
	}
	defer func() { _ = out.Body.Close() }()
	links, err := decodeLinks(out.Body)
	if err != nil {
		return nil, fmt.Errorf("filestore: read %s: %w", key, err)
	}
	return links, nil
}

// decodeLinks parses a links.json strictly: one JSON object of strings, at
// most maxLinksBytes, nothing after it.
func decodeLinks(r io.Reader) (map[string]string, error) {
	data, err := io.ReadAll(io.LimitReader(r, maxLinksBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxLinksBytes {
		return nil, fmt.Errorf("the link map is over %d bytes", maxLinksBytes)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	var links map[string]string
	if err := dec.Decode(&links); err != nil {
		return nil, fmt.Errorf("the link map is not a JSON object of strings: %w", err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return nil, errors.New("the link map has data after its object")
	}
	return links, nil
}

// contractPage reports whether rel names an ADR-0037 page under a
// project's scans/, and which project.
func contractPage(rel string) (project string, ok bool) {
	dir := path.Dir(rel)
	if path.Base(dir) != "scans" || !contractName.MatchString(path.Base(rel)) {
		return "", false
	}
	project = path.Dir(dir)
	return project, project != "."
}

// bareName is a link target the store will follow: one file name, no
// directory part, nothing reserved.
func bareName(target string) bool {
	return target != "" && !strings.Contains(target, "/") && files.ValidRel(target) == nil
}

// validProject accepts exactly the two project shapes, controls/<id> and
// surveys/<id>/runs/<id>.
func validProject(project string) error {
	if err := files.ValidRel(project); err != nil {
		return err
	}
	parts := strings.Split(project, "/")
	if (len(parts) == 2 && parts[0] == "controls") ||
		(len(parts) == 4 && parts[0] == "surveys" && parts[2] == "runs") {
		return nil
	}
	return fmt.Errorf("%w: %q is not a project", files.ErrInvalidPath, project)
}

func notFound(err error) bool {
	var missing *types.NotFound
	var noKey *types.NoSuchKey
	return errors.As(err, &missing) || errors.As(err, &noKey)
}

// fail wraps an SDK error, as fs.ErrNotExist when the object is not there
// so a handler answers 404 the way it does for a missing file on disk.
func (s *S3) fail(op, rel string, err error) error {
	if notFound(err) {
		return fmt.Errorf("filestore: %s %s: %w", op, rel, fs.ErrNotExist)
	}
	return fmt.Errorf("filestore: %s %s: %w", op, rel, err)
}

// s3File reads one object lazily: a GET only on Read, from the current
// offset, If-Match the ETag the HEAD saw, so the bytes are the ones the
// size and the time describe — an object replaced in between fails the read
// instead of serving a body of another length.
type s3File struct {
	ctx     context.Context
	client  S3Client
	bucket  string
	key     string
	etag    string
	size    int64
	modTime time.Time
	offset  int64
	body    io.ReadCloser
}

func (f *s3File) Read(p []byte) (int, error) {
	if f.offset >= f.size {
		return 0, io.EOF
	}
	if f.body == nil {
		in := &s3.GetObjectInput{Bucket: &f.bucket, Key: &f.key}
		if f.etag != "" {
			in.IfMatch = &f.etag
		}
		if f.offset > 0 {
			in.Range = aws.String(fmt.Sprintf("bytes=%d-", f.offset))
		}
		out, err := f.client.GetObject(f.ctx, in)
		if err != nil {
			return 0, fmt.Errorf("filestore: read %s: %w", f.key, err)
		}
		f.body = out.Body
	}
	n, err := f.body.Read(p)
	f.offset += int64(n)
	return n, err
}

// Seek only moves the offset; the next Read fetches from there.
func (f *s3File) Seek(offset int64, whence int) (int64, error) {
	var to int64
	switch whence {
	case io.SeekStart:
		to = offset
	case io.SeekCurrent:
		to = f.offset + offset
	case io.SeekEnd:
		to = f.size + offset
	default:
		return 0, fmt.Errorf("filestore: seek %s: invalid whence %d", f.key, whence)
	}
	if to < 0 {
		return 0, fmt.Errorf("filestore: seek %s: negative position %d", f.key, to)
	}
	if to != f.offset && f.body != nil {
		_ = f.body.Close()
		f.body = nil
	}
	f.offset = to
	return to, nil
}

func (f *s3File) Close() error {
	if f.body == nil {
		return nil
	}
	err := f.body.Close()
	f.body = nil
	return err
}

func (f *s3File) Size() int64        { return f.size }
func (f *s3File) ModTime() time.Time { return f.modTime }
