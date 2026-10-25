// Package s3test is an in-memory S3 bucket behind filestore.S3Client, for
// the suite (issue #338) — the shape DocumentBuddy's ADR-008 uses for its own
// store. It keeps exactly what the S3 store relies on: single-part ETags (the
// quoted hex MD5 of the bytes, as S3 answers for a single PutObject under
// SSE-S3), LastModified to the second, ranged and If-Match GETs, prefix and
// delimiter listing in pages, and DeleteObjects. Nothing here vouches for
// real S3 — signing, the ETag under the bucket's real encryption, Range on
// the wire — which is apps/server/S3-CHECK.md's.
package s3test

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// Object is one stored object.
type Object struct {
	Body         []byte
	ETag         string
	LastModified time.Time
}

// Call is one request the bucket answered (or refused), in order. Range is
// a GetObject's, so a test can tell a ranged read from a whole one.
type Call struct {
	Op    string
	Key   string
	Range string
}

// Bucket is the fake. The zero value is not usable; call New.
type Bucket struct {
	// PageSize caps the keys of one ListObjectsV2 page, so a test can make
	// a listing span several; 0 means S3's own 1000.
	PageSize int
	// Now stamps LastModified on a put.
	Now func() time.Time
	// FailOn, when set, is asked before every request and its error is
	// returned instead of acting — the way a test makes S3 fail at a chosen
	// step. op is the SDK method's name.
	FailOn func(op, key string) error

	mu      sync.Mutex
	objects map[string]Object
	calls   []Call
}

// New returns an empty bucket whose clock is time.Now.
func New() *Bucket {
	return &Bucket{Now: time.Now, objects: map[string]Object{}}
}

// Put stores body under key the way a PutObject would, for a test's setup.
func (b *Bucket) Put(key string, body []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.store(key, body)
}

// Get returns what is stored under key.
func (b *Bucket) Get(key string) (Object, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	o, ok := b.objects[key]
	return o, ok
}

// Keys lists every stored key, sorted.
func (b *Bucket) Keys() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	keys := make([]string, 0, len(b.objects))
	for k := range b.objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Calls returns the requests answered so far, in order.
func (b *Bucket) Calls() []Call {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]Call(nil), b.calls...)
}

// ETagOf is the ETag S3 gives a single-part object holding body.
func ETagOf(body []byte) string {
	sum := md5.Sum(body)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}

func (b *Bucket) store(key string, body []byte) {
	b.objects[key] = Object{
		Body:         append([]byte(nil), body...),
		ETag:         ETagOf(body),
		LastModified: b.Now().UTC().Truncate(time.Second),
	}
}

// begin records the call and asks FailOn; callers hold b.mu.
func (b *Bucket) begin(op, key string) error {
	b.calls = append(b.calls, Call{Op: op, Key: key})
	if b.FailOn != nil {
		return b.FailOn(op, key)
	}
	return nil
}

// HeadObject answers *types.NotFound for a missing key, as S3 does to a
// caller allowed to list the bucket.
func (b *Bucket) HeadObject(_ context.Context, in *s3.HeadObjectInput, _ ...func(*s3.Options)) (*s3.HeadObjectOutput, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := aws.ToString(in.Key)
	if err := b.begin("HeadObject", key); err != nil {
		return nil, err
	}
	o, ok := b.objects[key]
	if !ok {
		return nil, &types.NotFound{}
	}
	return &s3.HeadObjectOutput{
		ContentLength: aws.Int64(int64(len(o.Body))),
		ETag:          aws.String(o.ETag),
		LastModified:  aws.Time(o.LastModified),
	}, nil
}

// GetObject honours Range ("bytes=a-" and "bytes=a-b") and If-Match, and
// answers *types.NoSuchKey for a missing key.
func (b *Bucket) GetObject(_ context.Context, in *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	key := aws.ToString(in.Key)
	if err := b.begin("GetObject", key); err != nil {
		return nil, err
	}
	b.calls[len(b.calls)-1].Range = aws.ToString(in.Range)
	o, ok := b.objects[key]
	if !ok {
		return nil, &types.NoSuchKey{}
	}
	if match := aws.ToString(in.IfMatch); match != "" && match != o.ETag {
		return nil, fmt.Errorf("s3test: PreconditionFailed: %s is %s, not %s", key, o.ETag, match)
	}
	body := o.Body
	if r := aws.ToString(in.Range); r != "" {
		from, to, err := parseRange(r, int64(len(body)))
		if err != nil {
			return nil, err
		}
		body = body[from : to+1]
	}
	return &s3.GetObjectOutput{
		Body:          io.NopCloser(bytes.NewReader(append([]byte(nil), body...))),
		ContentLength: aws.Int64(int64(len(body))),
		ETag:          aws.String(o.ETag),
		LastModified:  aws.Time(o.LastModified),
	}, nil
}

func parseRange(r string, size int64) (from, to int64, err error) {
	spec, ok := strings.CutPrefix(r, "bytes=")
	first, last, dash := strings.Cut(spec, "-")
	if !ok || !dash {
		return 0, 0, fmt.Errorf("s3test: unsupported range %q", r)
	}
	if from, err = strconv.ParseInt(first, 10, 64); err != nil || from < 0 || from >= size {
		return 0, 0, fmt.Errorf("s3test: InvalidRange %q for %d bytes", r, size)
	}
	to = size - 1
	if last != "" {
		if to, err = strconv.ParseInt(last, 10, 64); err != nil || to < from {
			return 0, 0, fmt.Errorf("s3test: InvalidRange %q", r)
		}
		to = min(to, size-1)
	}
	return from, to, nil
}

// PutObject stores the body whole, the way one single-part PUT does.
func (b *Bucket) PutObject(_ context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	key := aws.ToString(in.Key)
	var body []byte
	if in.Body != nil {
		var err error
		if body, err = io.ReadAll(in.Body); err != nil {
			return nil, err
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.begin("PutObject", key); err != nil {
		return nil, err
	}
	b.store(key, body)
	return &s3.PutObjectOutput{ETag: aws.String(b.objects[key].ETag)}, nil
}

// ListObjectsV2 lists in key order, rolling keys up to CommonPrefixes on
// the delimiter, PageSize keys at a time.
func (b *Bucket) ListObjectsV2(_ context.Context, in *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	prefix := aws.ToString(in.Prefix)
	if err := b.begin("ListObjectsV2", prefix); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(b.objects))
	for k := range b.objects {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)

	start := 0
	if token := aws.ToString(in.ContinuationToken); token != "" {
		start = sort.SearchStrings(keys, token)
	}
	page := b.PageSize
	if page <= 0 {
		page = 1000
	}
	out := &s3.ListObjectsV2Output{Prefix: in.Prefix}
	seen := map[string]bool{}
	delimiter := aws.ToString(in.Delimiter)
	count := 0
	for i := start; i < len(keys); i++ {
		if count == page {
			out.IsTruncated = aws.Bool(true)
			out.NextContinuationToken = aws.String(keys[i])
			break
		}
		k := keys[i]
		if delimiter != "" {
			if cut := strings.Index(k[len(prefix):], delimiter); cut >= 0 {
				common := k[:len(prefix)+cut+len(delimiter)]
				if !seen[common] {
					seen[common] = true
					out.CommonPrefixes = append(out.CommonPrefixes, types.CommonPrefix{Prefix: aws.String(common)})
					count++
				}
				continue
			}
		}
		o := b.objects[k]
		out.Contents = append(out.Contents, types.Object{
			Key:          aws.String(k),
			Size:         aws.Int64(int64(len(o.Body))),
			ETag:         aws.String(o.ETag),
			LastModified: aws.Time(o.LastModified),
		})
		count++
	}
	out.KeyCount = aws.Int32(int32(len(out.Contents) + len(out.CommonPrefixes)))
	return out, nil
}

// DeleteObjects deletes every key it is handed (a missing one is not an
// error, as in S3) and refuses more than 1000, as S3 does.
func (b *Bucket) DeleteObjects(_ context.Context, in *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if in.Delete == nil {
		return nil, fmt.Errorf("s3test: DeleteObjects with no Delete")
	}
	if len(in.Delete.Objects) > 1000 {
		return nil, fmt.Errorf("s3test: MalformedXML: %d keys, the limit is 1000", len(in.Delete.Objects))
	}
	out := &s3.DeleteObjectsOutput{}
	for _, id := range in.Delete.Objects {
		key := aws.ToString(id.Key)
		if err := b.begin("DeleteObjects", key); err != nil {
			out.Errors = append(out.Errors, types.Error{Key: aws.String(key), Code: aws.String("InternalError"), Message: aws.String(err.Error())})
			continue
		}
		delete(b.objects, key)
		if !aws.ToBool(in.Delete.Quiet) {
			out.Deleted = append(out.Deleted, types.DeletedObject{Key: aws.String(key)})
		}
	}
	return out, nil
}
