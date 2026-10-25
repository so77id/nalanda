package uploads

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"
)

// The three names an upload may have under Root, and nothing else is ever
// opened, written or removed there. `.tmp` is the sidecar while it is being
// written: it is renamed into place, so no reader sees half of one.
const (
	extPart    = ".part"
	extSidecar = ".json"
	extTemp    = ".tmp"
)

// ownExts is every name an upload may have, for the walks that need them all.
var ownExts = []string{extPart, extSidecar, extTemp}

// maxSidecarBytes bounds what is read back from a sidecar. Create refuses an
// upload whose own sidecar would not fit, so the two can never disagree.
const maxSidecarBytes = 16 << 10

// pdfMagic is how every PDF starts; the worker refuses anything else anyway,
// but a professor who picked the wrong file hears it before a job is queued.
const pdfMagic = "%PDF-"

// path names one of an upload's files. Callers have already checked isID: the
// uid is what keeps this inside Root.
func (s *Service) path(id, ext string) string {
	return filepath.Join(s.Root, id+ext)
}

// sidecar is `<uid>.json`: everything about an upload except how much of it
// arrived. Written once, at create.
type sidecar struct {
	ID          string            `json:"id"`
	Professor   int64             `json:"professor"`
	SubjectKind SubjectKind       `json:"subject_kind"`
	SubjectID   string            `json:"subject_id"`
	Name        string            `json:"name"`
	Size        int64             `json:"size"`
	Meta        map[string]string `json:"meta,omitempty"`
}

// create writes an upload's two files: the sidecar (through a temp file and a
// rename) and an empty partial. A failure removes whatever was written.
func (s *Service) create(up Upload) error {
	body, err := json.Marshal(sidecar{
		ID: up.ID, Professor: up.Professor,
		SubjectKind: up.Subject.Kind, SubjectID: up.Subject.ID,
		Name: up.Name, Size: up.Size, Meta: up.Meta,
	})
	if err != nil {
		return fmt.Errorf("encode the sidecar: %w", err)
	}
	if len(body) > maxSidecarBytes {
		return fmt.Errorf("a sidecar of %d bytes: %w", len(body), ErrInvalid)
	}
	if err := os.MkdirAll(s.Root, 0o755); err != nil {
		return fmt.Errorf("prepare %s: %w", s.Root, err)
	}
	if err := s.writeSidecar(up.ID, body); err != nil {
		s.removeFiles(up.ID)
		return err
	}
	part, err := os.OpenFile(s.path(up.ID, extPart), os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0o644)
	if err != nil {
		s.removeFiles(up.ID)
		return fmt.Errorf("create the partial of %s: %w", up.ID, err)
	}
	if err := part.Close(); err != nil {
		s.removeFiles(up.ID)
		return fmt.Errorf("create the partial of %s: %w", up.ID, err)
	}
	return nil
}

func (s *Service) writeSidecar(id string, body []byte) error {
	tmp := s.path(id, extTemp)
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0o644)
	if err != nil {
		return fmt.Errorf("write the sidecar of %s: %w", id, err)
	}
	if _, err := f.Write(body); err != nil {
		_ = f.Close()
		return fmt.Errorf("write the sidecar of %s: %w", id, err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("write the sidecar of %s: %w", id, err)
	}
	if err := os.Rename(tmp, s.path(id, extSidecar)); err != nil {
		return fmt.Errorf("write the sidecar of %s: %w", id, err)
	}
	return nil
}

// load reads an upload back from disk, re-validating all of it: the sidecar
// must parse, be this upload's, name a subject that could exist and a size
// within the cap, and belong to this professor; the partial must be a regular
// file no longer than that size. Anything else is ErrNotFound — logged when
// the files exist but do not validate, since that is somebody's to look at.
func (s *Service) load(professor int64, id string) (Upload, error) {
	sc, err := s.readSidecar(id)
	if err != nil {
		return Upload{}, err
	}
	if sc.Professor != professor {
		return Upload{}, ErrNotFound
	}
	info, err := os.Lstat(s.path(id, extPart))
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return Upload{}, ErrNotFound
	case err != nil:
		return Upload{}, fmt.Errorf("uploads: stat the partial of %s: %w", id, err)
	case !info.Mode().IsRegular() || info.Size() > sc.Size:
		s.Log.Warn("uploads: ignoring a partial that does not validate",
			"upload", id, "mode", info.Mode().String(), "bytes", info.Size(), "declared", sc.Size)
		return Upload{}, ErrNotFound
	}
	return Upload{
		ID:        id,
		Professor: sc.Professor,
		Subject:   Subject{Kind: sc.SubjectKind, ID: sc.SubjectID},
		Name:      sc.Name,
		Size:      sc.Size,
		Received:  info.Size(),
		Meta:      sc.Meta,
	}, nil
}

func (s *Service) readSidecar(id string) (sidecar, error) {
	f, err := s.open(id, extSidecar, os.O_RDONLY)
	if err != nil {
		return sidecar{}, err
	}
	defer func() { _ = f.Close() }()
	body, err := io.ReadAll(io.LimitReader(f, maxSidecarBytes+1))
	if err != nil {
		return sidecar{}, fmt.Errorf("uploads: read the sidecar of %s: %w", id, err)
	}
	var sc sidecar
	if err := json.Unmarshal(body, &sc); err != nil || len(body) > maxSidecarBytes || !s.validSidecar(sc, id) {
		s.Log.Warn("uploads: ignoring a sidecar that does not validate", "upload", id, "bytes", len(body), "error", err)
		return sidecar{}, ErrNotFound
	}
	return sc, nil
}

func (s *Service) validSidecar(sc sidecar, id string) bool {
	return sc.ID == id &&
		sc.Professor > 0 &&
		Subject{Kind: sc.SubjectKind, ID: sc.SubjectID}.valid() &&
		sc.Name != "" && len(sc.Name) <= MaxNameBytes &&
		sc.Size > 0 && sc.Size <= s.MaxBytes
}

// open opens one of an upload's files WITHOUT following a symlink, and only
// if it is a regular file: the worker shares this volume as root, and a
// partial replaced by a link to the database must not be written through or
// handed over as a batch.
//
// O_NONBLOCK is what lets the regular-file check run at all: a FIFO planted
// under a sidecar's name would otherwise block open(2) for ever — and with it
// every Create, since the eviction reads every sidecar under one mutex
// (#339 review, SEC-1). On a regular file it changes nothing.
func (s *Service) open(id, ext string, flag int) (*os.File, error) {
	f, err := os.OpenFile(s.path(id, ext), flag|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return nil, ErrNotFound
	case errors.Is(err, syscall.ELOOP):
		s.Log.Warn("uploads: refusing a file that is a symlink", "upload", id, "file", id+ext)
		return nil, ErrNotFound
	case errors.Is(err, syscall.ENXIO):
		// A FIFO opened for writing with nobody reading it.
		s.Log.Warn("uploads: refusing a file that is not a regular file", "upload", id, "file", id+ext)
		return nil, ErrNotFound
	case err != nil:
		return nil, fmt.Errorf("uploads: open %s: %w", id+ext, err)
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = f.Close()
		s.Log.Warn("uploads: refusing a file that is not a regular file", "upload", id, "file", id+ext)
		return nil, ErrNotFound
	}
	return f, nil
}

// appendPart writes r at the end of the partial, at most up to the declared
// size. See Append for what each outcome leaves on disk.
func (s *Service) appendPart(up Upload, r io.Reader) (int64, error) {
	f, err := s.open(up.ID, extPart, os.O_WRONLY|os.O_APPEND)
	if err != nil {
		return up.Received, err
	}
	body := &readRecorder{r: r}
	n, copyErr := io.Copy(f, io.LimitReader(body, up.Size-up.Received))
	received := up.Received + n
	if copyErr != nil {
		// The prefix that arrived stays: it is the right bytes at the right
		// offset, and the client resynchronises through Status.
		_ = f.Close()
		if body.err != nil {
			return received, fmt.Errorf("uploads.Append %s: at byte %d: %w: %w", up.ID, received, ErrCut, body.err)
		}
		return received, fmt.Errorf("uploads.Append %s: at byte %d: %w", up.ID, received, copyErr)
	}
	var probe [1]byte
	if _, err := io.ReadFull(r, probe[:]); err == nil {
		// More than the upload declared: the whole chunk goes, so the
		// partial still ends where it ended before this request.
		if err := f.Truncate(up.Received); err != nil {
			_ = f.Close()
			return up.Received, fmt.Errorf("uploads.Append %s: undo an oversized chunk: %w", up.ID, err)
		}
		_ = f.Close()
		return up.Received, fmt.Errorf("uploads.Append %s: past %d bytes: %w", up.ID, up.Size, ErrTooLarge)
	}
	if err := f.Close(); err != nil {
		return received, fmt.Errorf("uploads.Append %s: %w", up.ID, err)
	}
	return received, nil
}

// readRecorder remembers the error a chunk's body failed with, which io.Copy
// returns without saying whether it came from the read or the write.
type readRecorder struct {
	r   io.Reader
	err error
}

func (rr *readRecorder) Read(p []byte) (int, error) {
	n, err := rr.r.Read(p)
	if err != nil && !errors.Is(err, io.EOF) {
		rr.err = err
	}
	return n, err
}

// openPDF opens a finished partial for reading, refusing one that does not
// start like a PDF, rewound to its first byte.
func (s *Service) openPDF(id string) (*os.File, error) {
	f, err := s.open(id, extPart, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	head := make([]byte, len(pdfMagic))
	if _, err := io.ReadFull(f, head); err != nil || string(head) != pdfMagic {
		_ = f.Close()
		return nil, fmt.Errorf("uploads.Complete %s: %w", id, ErrNotPDF)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("uploads.Complete %s: rewind: %w", id, err)
	}
	return f, nil
}

// removeFiles deletes every file an upload may have. Best-effort: a file that
// will not go is logged, and the sweep tries again.
func (s *Service) removeFiles(id string) {
	for _, ext := range ownExts {
		if err := os.Remove(s.path(id, ext)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			s.Log.Warn("uploads: removing a partial's file", "upload", id, "file", id+ext, "error", err)
		}
	}
}
