// Package uploads holds a scan batch while it crosses a slow link in pieces
// (issue #339): the bytes that have arrived, on disk, and whose they are.
//
// A batch used to travel as ONE request, and httpserver's 15 s read deadline
// bounds a request's body, so a batch the link could not carry in 15 s never
// arrived at all. Here the page sends it in chunks, each its own short
// request, and a dropped link or a restarted server resumes from what is
// already on disk.
//
// The package is neutral on purpose. The controls and the surveys both
// upload batches, and the survey subsystem may not import the controls
// (ADR-0078), so an upload knows its subject only as a kind and an id and
// carries the subsystem's own fields (a control's thresholds) as opaque
// metadata. What a finished upload BECOMES is the subsystem's business:
// Complete hands the bytes to the caller's save and removes the partial only
// once that save has returned.
//
// The truth is the files. `<uid>.part` holds the bytes, and its SIZE is how
// many arrived — no table and no counter can disagree with it, which is what
// lets a restart lose nothing. `<uid>.json` holds who and what, written once.
// Both live in one directory on the shared volume the AMC worker also mounts
// (as root), which is why everything read back from it is re-validated and
// nothing outside this package's own names is ever touched (disk.go).
package uploads

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"sync"
)

// SubjectKind names what an upload is FOR. A closed set, re-checked on every
// read of a sidecar.
type SubjectKind string

const (
	// SubjectControl is a control; its id is the control's 26-character id.
	SubjectControl SubjectKind = "control"
	// SubjectSurveyRun is one run of a survey; its id is the run's number.
	SubjectSurveyRun SubjectKind = "survey_run"
)

// Subject is what an upload will become a batch of.
type Subject struct {
	Kind SubjectKind
	ID   string
}

// valid reports whether the subject could name something. It checks shape
// only: whether the control or the run EXISTS is the subsystem's question,
// asked by the handler before Create and again by the save.
func (s Subject) valid() bool {
	switch s.Kind {
	case SubjectControl:
		return isID(s.ID)
	case SubjectSurveyRun:
		n, err := strconv.ParseInt(s.ID, 10, 64)
		return err == nil && n > 0 && strconv.FormatInt(n, 10) == s.ID
	}
	return false
}

// Upload is one upload in progress, as the server holds it.
type Upload struct {
	ID        string
	Professor int64
	Subject   Subject
	// Name is the file name the professor picked. It is shown and logged,
	// never part of a path: the batch is stored under the subsystem's own
	// batch-N.pdf.
	Name string
	// Size is what the professor's browser declared at create; Received is
	// how much of it is on disk.
	Size     int64
	Received int64
	// Meta is the subsystem's own fields, carried verbatim.
	Meta map[string]string
}

// MaxNameBytes bounds the declared file name.
const MaxNameBytes = 255

// Sentinels a handler branches on. Each refusal of an upload the caller may
// not see — unknown, another professor's, malformed, or one whose files do
// not validate — is the SAME ErrNotFound, so a uid cannot be probed.
var (
	ErrNotFound       = errors.New("uploads: no such upload")
	ErrInvalid        = errors.New("uploads: not an upload this service can hold")
	ErrTooLarge       = errors.New("uploads: more bytes than allowed")
	ErrOffsetMismatch = errors.New("uploads: a chunk at the wrong offset")
	ErrIncomplete     = errors.New("uploads: not every byte has arrived")
	ErrNotPDF         = errors.New("uploads: the bytes are not a PDF")
)

// OffsetMismatchError is ErrOffsetMismatch carrying what the server holds, so
// the client can resume from there without asking again.
type OffsetMismatchError struct {
	Received int64
}

func (e *OffsetMismatchError) Error() string {
	return fmt.Sprintf("%v: the server holds %d bytes", ErrOffsetMismatch, e.Received)
}

// Unwrap keeps errors.Is(err, ErrOffsetMismatch) true.
func (e *OffsetMismatchError) Unwrap() error { return ErrOffsetMismatch }

// Service keeps the partials. One per process: the per-upload locks live in
// it, and the server is one process (ADR-0050).
type Service struct {
	// Root is the directory the partials live in: <WorkDir>/incoming, on
	// the same filesystem as the batches they become.
	Root string
	// MaxBytes is the largest upload a professor may declare —
	// NALANDA_MAX_SCAN_MB, the cap the one-request form already has.
	MaxBytes int64
	Log      *slog.Logger

	locks *lockTable
}

// NewService refuses a set of dependencies it cannot serve with, at boot
// rather than inside a request.
func NewService(deps Service) *Service {
	switch {
	case deps.Root == "":
		panic("uploads.NewService: no root directory")
	case deps.MaxBytes <= 0:
		panic("uploads.NewService: no size cap")
	case deps.Log == nil:
		panic("uploads.NewService: no logger")
	}
	deps.locks = &lockTable{held: map[string]*uidLock{}}
	return &deps
}

// Create opens an upload: it validates everything it can before a byte of the
// batch travels, then writes the sidecar and an empty partial.
func (s *Service) Create(professor int64, subject Subject, name string, size int64, meta map[string]string) (Upload, error) {
	switch {
	case professor <= 0, !subject.valid(), name == "", len(name) > MaxNameBytes, size <= 0:
		return Upload{}, fmt.Errorf("uploads.Create: %w", ErrInvalid)
	case size > s.MaxBytes:
		return Upload{}, fmt.Errorf("uploads.Create: %d bytes over a cap of %d: %w", size, s.MaxBytes, ErrTooLarge)
	}
	id, err := newID()
	if err != nil {
		return Upload{}, err
	}
	up := Upload{ID: id, Professor: professor, Subject: subject, Name: name, Size: size, Meta: meta}

	unlock := s.locks.lock(id)
	defer unlock()
	if err := s.create(up); err != nil {
		return Upload{}, fmt.Errorf("uploads.Create: %w", err)
	}
	return up, nil
}

// Append writes a chunk at offset and answers how many bytes the server now
// holds.
//
// An offset other than what is held writes nothing and answers
// *OffsetMismatchError. A chunk that would pass the declared size writes
// nothing and answers ErrTooLarge. A chunk whose body fails part-way — the
// link dropped, or the read deadline passed — KEEPS the prefix that arrived:
// those are the right bytes at the right offset, so even a link too slow to
// carry a whole chunk inside the deadline makes progress on every request.
// The read error is returned beside the new count.
func (s *Service) Append(professor int64, id string, offset int64, r io.Reader) (int64, error) {
	if !isID(id) {
		return 0, ErrNotFound
	}
	unlock := s.locks.lock(id)
	defer unlock()

	up, err := s.load(professor, id)
	if err != nil {
		return 0, err
	}
	if offset != up.Received {
		return up.Received, &OffsetMismatchError{Received: up.Received}
	}
	return s.appendPart(up, r)
}

// Status answers what the server holds of an upload — how the client
// resynchronises after any error.
func (s *Service) Status(professor int64, id string) (Upload, error) {
	if !isID(id) {
		return Upload{}, ErrNotFound
	}
	unlock := s.locks.lock(id)
	defer unlock()
	return s.load(professor, id)
}

// Complete hands a finished upload to save and then removes the partial.
//
// Only a whole upload (ErrIncomplete), whose bytes start like a PDF
// (ErrNotPDF), under the subject the caller names (ErrNotFound otherwise),
// reaches save. The partial is removed only AFTER save returned nil — the
// batch is on disk by then, so nothing the professor sent is lost between
// the two — and a save that fails leaves it for another try.
//
// The upload's lock is held across save: a second complete arriving while
// the first is still writing the batch waits, then finds nothing, rather
// than saving a second batch from the same bytes. save may close content;
// Complete closes it too.
func (s *Service) Complete(professor int64, id string, subject Subject, save func(Upload, io.ReadCloser) error) (Upload, error) {
	if !isID(id) {
		return Upload{}, ErrNotFound
	}
	unlock := s.locks.lock(id)
	defer unlock()

	up, err := s.load(professor, id)
	if err != nil {
		return Upload{}, err
	}
	if up.Subject != subject {
		return Upload{}, ErrNotFound
	}
	if up.Received != up.Size {
		return up, fmt.Errorf("uploads.Complete %s: %d of %d bytes: %w", id, up.Received, up.Size, ErrIncomplete)
	}
	content, err := s.openPDF(id)
	if err != nil {
		return up, err
	}
	defer func() { _ = content.Close() }()
	if err := save(up, content); err != nil {
		return up, err
	}
	s.removeFiles(id)
	return up, nil
}

// Remove deletes an upload at once: the professor pressed Cancelar.
func (s *Service) Remove(professor int64, id string) error {
	if !isID(id) {
		return ErrNotFound
	}
	unlock := s.locks.lock(id)
	defer unlock()
	if _, err := s.load(professor, id); err != nil {
		return err
	}
	s.removeFiles(id)
	return nil
}

// idEncoding is the alphabet of a control id (controls.NewID): base32 with no
// padding, 26 characters for 128 bits. Repeated rather than imported, since
// this package may depend on neither subsystem.
var idEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// idLength is what every uid measures.
const idLength = 26

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("uploads: new id: %w", err)
	}
	return idEncoding.EncodeToString(b[:]), nil
}

// isID is the barrier between a URL segment and a path: a uid outside this
// shape is refused before any file name is built from it.
func isID(id string) bool {
	if len(id) != idLength {
		return false
	}
	for _, r := range id {
		if !(r >= 'A' && r <= 'Z') && !(r >= '2' && r <= '7') {
			return false
		}
	}
	return true
}

// lockTable serialises every operation on one upload — append, complete,
// cancel and, from S4, the sweep and the eviction — so none of them sees the
// files half-changed by another. An entry exists only while somebody holds or
// waits for it, so the table never outgrows the requests in flight.
type lockTable struct {
	mu   sync.Mutex
	held map[string]*uidLock
}

type uidLock struct {
	sync.Mutex
	refs int
}

func (t *lockTable) lock(id string) (unlock func()) {
	t.mu.Lock()
	l := t.held[id]
	if l == nil {
		l = &uidLock{}
		t.held[id] = l
	}
	l.refs++
	t.mu.Unlock()

	l.Lock()
	return func() {
		l.Unlock()
		t.mu.Lock()
		l.refs--
		if l.refs == 0 {
			delete(t.held, id)
		}
		t.mu.Unlock()
	}
}
