package uploads_test

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
)

// These run against a real directory, because what this package promises is a
// fact about files: the bytes that arrived, where they are, and that nothing
// outside its own names is touched.

const professor = int64(7)

var aControl = uploads.Subject{Kind: uploads.SubjectControl, ID: "MOZMMCHZLSQ3NEKN2P7CO5APNM"}

func newService(t *testing.T, root string) *uploads.Service {
	t.Helper()
	return uploads.NewService(uploads.Service{
		Root:     root,
		MaxBytes: 64 << 10,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

// aPDF is a batch the way the page sends it: something that starts like a PDF.
func aPDF(size int) []byte {
	b := bytes.Repeat([]byte("0123456789"), size/10+1)[:size]
	copy(b, "%PDF-1.4\n")
	return b
}

// keep is a save that records what it was handed.
func keep(got *[]byte) func(uploads.Upload, io.ReadCloser) error {
	return func(_ uploads.Upload, content io.ReadCloser) error {
		b, err := io.ReadAll(content)
		*got = b
		return err
	}
}

func entries(t *testing.T, dir string) []string {
	t.Helper()
	list, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func TestAnUploadArrivesInChunksAndIsHandedOverWhole(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	source := aPDF(25_000)

	up, err := s.Create(professor, aControl, "scan.pdf", int64(len(source)), map[string]string{"ticked": "0.5"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if up.Received != 0 || up.Size != int64(len(source)) {
		t.Fatalf("Create = received %d of %d, want 0 of %d", up.Received, up.Size, len(source))
	}
	for offset := 0; offset < len(source); offset += 10_000 {
		end := min(offset+10_000, len(source))
		received, err := s.Append(professor, up.ID, int64(offset), bytes.NewReader(source[offset:end]))
		if err != nil {
			t.Fatalf("Append at %d: %v", offset, err)
		}
		if received != int64(end) {
			t.Fatalf("Append at %d answered %d, want %d", offset, received, end)
		}
	}
	status, err := s.Status(professor, up.ID)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Received != int64(len(source)) {
		t.Errorf("Status = %d received, want %d", status.Received, len(source))
	}

	var saved []byte
	var meta map[string]string
	done, err := s.Complete(professor, up.ID, aControl, func(u uploads.Upload, content io.ReadCloser) error {
		meta = u.Meta
		return keep(&saved)(u, content)
	})
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if sha256.Sum256(saved) != sha256.Sum256(source) {
		t.Errorf("the save was handed %d bytes that differ from the %d sent", len(saved), len(source))
	}
	if meta["ticked"] != "0.5" || done.Meta["ticked"] != "0.5" {
		t.Errorf("the metadata did not survive the round trip: %v", meta)
	}
	if left := entries(t, root); len(left) != 0 {
		t.Errorf("the partial outlived its completion: %v", left)
	}
}

// Issue #339 Goal 2: a server restart (a Watchtower deploy) loses nothing,
// because what arrived is the size of a file rather than a number in memory.
func TestANewServiceOverTheSameDirectorySeesWhatArrived(t *testing.T) {
	root := t.TempDir()
	source := aPDF(20_000)
	first := newService(t, root)
	up, err := first.Create(professor, aControl, "scan.pdf", int64(len(source)), nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := first.Append(professor, up.ID, 0, bytes.NewReader(source[:12_345])); err != nil {
		t.Fatalf("Append: %v", err)
	}

	restarted := newService(t, root)
	status, err := restarted.Status(professor, up.ID)
	if err != nil {
		t.Fatalf("Status after the restart: %v", err)
	}
	if status.Received != 12_345 {
		t.Fatalf("after the restart the server holds %d bytes, want 12345", status.Received)
	}
	if _, err := restarted.Append(professor, up.ID, 12_345, bytes.NewReader(source[12_345:])); err != nil {
		t.Fatalf("resuming: %v", err)
	}
	var saved []byte
	if _, err := restarted.Complete(professor, up.ID, aControl, keep(&saved)); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if !bytes.Equal(saved, source) {
		t.Error("the resumed upload is not the source")
	}
}

// AC-5. A chunk at the wrong offset is refused with what the server holds,
// and writes nothing — the client resynchronises from that number.
func TestAChunkAtTheWrongOffsetWritesNothingAndSaysWhatIsHeld(t *testing.T) {
	s := newService(t, t.TempDir())
	up, err := s.Create(professor, aControl, "scan.pdf", 1000, nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(300))); err != nil {
		t.Fatalf("Append: %v", err)
	}

	received, err := s.Append(professor, up.ID, 200, bytes.NewReader(bytes.Repeat([]byte("x"), 100)))

	var mismatch *uploads.OffsetMismatchError
	if !errors.As(err, &mismatch) || !errors.Is(err, uploads.ErrOffsetMismatch) {
		t.Fatalf("Append at the wrong offset = %v, want an OffsetMismatchError", err)
	}
	if mismatch.Received != 300 || received != 300 {
		t.Errorf("the refusal says %d / %d held, want 300", mismatch.Received, received)
	}
	if status, _ := s.Status(professor, up.ID); status.Received != 300 {
		t.Errorf("the refused chunk changed the partial: %d bytes held, want 300", status.Received)
	}
}

// A chunk that would carry the upload past the size it declared is refused
// whole: none of it stays, so the partial still ends where it ended.
func TestAChunkPastTheDeclaredSizeIsRefusedAndWritesNothing(t *testing.T) {
	s := newService(t, t.TempDir())
	up, err := s.Create(professor, aControl, "scan.pdf", 500, nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(400))); err != nil {
		t.Fatalf("Append: %v", err)
	}

	_, err = s.Append(professor, up.ID, 400, bytes.NewReader(bytes.Repeat([]byte("x"), 101)))

	if !errors.Is(err, uploads.ErrTooLarge) {
		t.Fatalf("Append past the size = %v, want ErrTooLarge", err)
	}
	if status, _ := s.Status(professor, up.ID); status.Received != 400 {
		t.Errorf("the refused chunk left %d bytes, want 400", status.Received)
	}
}

// cutReader delivers a prefix of a chunk and then fails, the way a request
// body does when the link drops or the server's read deadline passes.
type cutReader struct {
	prefix io.Reader
	err    error
}

func (c *cutReader) Read(p []byte) (int, error) {
	n, err := c.prefix.Read(p)
	if errors.Is(err, io.EOF) {
		return n, c.err
	}
	return n, err
}

// The bytes of a cut chunk that DID arrive are the right bytes at the right
// offset, so they stay. That is what lets a link too slow to carry a whole
// chunk inside the read deadline still make progress on every request.
func TestACutChunkKeepsThePrefixThatArrived(t *testing.T) {
	s := newService(t, t.TempDir())
	source := aPDF(1000)
	up, err := s.Create(professor, aControl, "scan.pdf", int64(len(source)), nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	cut := errors.New("i/o timeout")

	received, err := s.Append(professor, up.ID, 0, &cutReader{prefix: bytes.NewReader(source[:640]), err: cut})

	if !errors.Is(err, cut) || !errors.Is(err, uploads.ErrCut) {
		t.Errorf("Append = %v, want ErrCut wrapping the read error", err)
	}
	if received != 640 {
		t.Errorf("Append answered %d, want the 640 that arrived", received)
	}
	if status, _ := s.Status(professor, up.ID); status.Received != 640 {
		t.Errorf("the partial holds %d bytes, want 640", status.Received)
	}
}

// AC-6 at this layer: nothing is created for an upload the service could not
// hold, so a refusal costs no byte of transfer and leaves no file.
func TestCreateRefusesWhatItCannotHold(t *testing.T) {
	cases := []struct {
		name      string
		professor int64
		subject   uploads.Subject
		file      string
		size      int64
		want      error
	}{
		{"a size above the cap", professor, aControl, "scan.pdf", 64<<10 + 1, uploads.ErrTooLarge},
		{"an empty file", professor, aControl, "scan.pdf", 0, uploads.ErrInvalid},
		{"a negative size", professor, aControl, "scan.pdf", -1, uploads.ErrInvalid},
		{"no professor", 0, aControl, "scan.pdf", 10, uploads.ErrInvalid},
		{"a subject kind nobody uploads to", professor, uploads.Subject{Kind: "course", ID: "3"}, "scan.pdf", 10, uploads.ErrInvalid},
		{"no subject id", professor, uploads.Subject{Kind: uploads.SubjectControl, ID: ""}, "scan.pdf", 10, uploads.ErrInvalid},
		{"a subject id past 64 bytes", professor, uploads.Subject{Kind: uploads.SubjectSurveyRun, ID: strings.Repeat("7", 65)}, "scan.pdf", 10, uploads.ErrInvalid},
		{"no name", professor, aControl, "", 10, uploads.ErrInvalid},
		{"a name past 255 bytes", professor, aControl, strings.Repeat("a", 252) + ".pdf", 10, uploads.ErrInvalid},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			s := newService(t, root)

			_, err := s.Create(c.professor, c.subject, c.file, c.size, nil)

			if !errors.Is(err, c.want) {
				t.Errorf("Create = %v, want %v", err, c.want)
			}
			if left := entries(t, root); len(left) != 0 {
				t.Errorf("a refused upload left files behind: %v", left)
			}
		})
	}
}

// AC-7. Another professor's upload, a uid nobody issued and a uid that is not
// even the right shape all read as the same absence — and the last is refused
// before any path is built from it.
func TestAnUploadIsOnlyEverItsCreatorsAndAnUnknownIDIsNotFound(t *testing.T) {
	root := filepath.Join(t.TempDir(), "incoming")
	s := newService(t, root)
	source := aPDF(100)
	up, err := s.Create(professor, aControl, "scan.pdf", int64(len(source)), nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if _, err := s.Append(professor, up.ID, 0, bytes.NewReader(source)); err != nil {
		t.Fatalf("Append: %v", err)
	}
	// What a traversal out of the root would reach: a pair that would pass
	// every other check, so the uid's shape is the only thing between the
	// URL segment and these files.
	victim := filepath.Join(filepath.Dir(root), "victim.part")
	if err := os.WriteFile(victim, []byte("not yours"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(root), "victim.json"), []byte(
		`{"id":"../victim","professor":7,"subject_kind":"control","subject_id":"MOZMMCHZLSQ3NEKN2P7CO5APNM","name":"a.pdf","size":9}`,
	), 0o644); err != nil {
		t.Fatal(err)
	}
	var saves int
	save := func(uploads.Upload, io.ReadCloser) error { saves++; return nil }

	for _, id := range []struct{ name, uid string }{
		{"a uid nobody issued", "AAAAAAAAAAAAAAAAAAAAAAAAAA"},
		{"a malformed uid", "../victim"},
	} {
		t.Run(id.name, func(t *testing.T) {
			if _, err := s.Status(professor, id.uid); !errors.Is(err, uploads.ErrNotFound) {
				t.Errorf("Status = %v, want ErrNotFound", err)
			}
			if _, err := s.Append(professor, id.uid, 0, strings.NewReader("x")); !errors.Is(err, uploads.ErrNotFound) {
				t.Errorf("Append = %v, want ErrNotFound", err)
			}
			if _, err := s.Complete(professor, id.uid, aControl, save); !errors.Is(err, uploads.ErrNotFound) {
				t.Errorf("Complete = %v, want ErrNotFound", err)
			}
			if err := s.Remove(professor, id.uid); !errors.Is(err, uploads.ErrNotFound) {
				t.Errorf("Remove = %v, want ErrNotFound", err)
			}
		})
	}
	t.Run("another professor's upload", func(t *testing.T) {
		other := professor + 1
		if _, err := s.Status(other, up.ID); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Status = %v, want ErrNotFound", err)
		}
		if _, err := s.Append(other, up.ID, 100, strings.NewReader("x")); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Append = %v, want ErrNotFound", err)
		}
		if _, err := s.Complete(other, up.ID, aControl, save); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Complete = %v, want ErrNotFound", err)
		}
		if err := s.Remove(other, up.ID); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Remove = %v, want ErrNotFound", err)
		}
	})

	if saves != 0 {
		t.Errorf("save ran %d times for uploads the caller does not own", saves)
	}
	if got, _ := os.ReadFile(victim); string(got) != "not yours" {
		t.Errorf("a file outside the root was touched: %q", got)
	}
	if status, err := s.Status(professor, up.ID); err != nil || status.Received != 100 {
		t.Errorf("the owner's upload changed: %+v, %v", status, err)
	}
}

// Complete hands over only a whole, PDF-shaped upload of the subject the
// caller names, and a save that fails keeps the partial for another try.
func TestCompleteHandsOverOnlyAWholePDFOfTheNamedSubject(t *testing.T) {
	t.Run("not every byte has arrived", func(t *testing.T) {
		s := newService(t, t.TempDir())
		up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
		_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(150)))
		var saved []byte
		if _, err := s.Complete(professor, up.ID, aControl, keep(&saved)); !errors.Is(err, uploads.ErrIncomplete) {
			t.Errorf("Complete = %v, want ErrIncomplete", err)
		}
		if saved != nil {
			t.Error("an incomplete upload was handed to the save")
		}
	})
	t.Run("the bytes are not a PDF", func(t *testing.T) {
		s := newService(t, t.TempDir())
		up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
		_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(bytes.Repeat([]byte("x"), 200)))
		var saved []byte
		if _, err := s.Complete(professor, up.ID, aControl, keep(&saved)); !errors.Is(err, uploads.ErrNotPDF) {
			t.Errorf("Complete = %v, want ErrNotPDF", err)
		}
		if saved != nil {
			t.Error("bytes that are not a PDF were handed to the save")
		}
	})
	t.Run("another subject", func(t *testing.T) {
		s := newService(t, t.TempDir())
		up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
		_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(200)))
		var saved []byte
		elsewhere := uploads.Subject{Kind: uploads.SubjectControl, ID: "AAAAAAAAAAAAAAAAAAAAAAAAAA"}
		if _, err := s.Complete(professor, up.ID, elsewhere, keep(&saved)); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Complete under another control = %v, want ErrNotFound", err)
		}
		run := uploads.Subject{Kind: uploads.SubjectSurveyRun, ID: "12"}
		if _, err := s.Complete(professor, up.ID, run, keep(&saved)); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Complete under a survey run = %v, want ErrNotFound", err)
		}
		if saved != nil {
			t.Error("an upload was handed over under a subject it was not created for")
		}
	})
	t.Run("a save that fails keeps the partial", func(t *testing.T) {
		s := newService(t, t.TempDir())
		source := aPDF(200)
		up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
		_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(source))
		broken := errors.New("disk full")
		if _, err := s.Complete(professor, up.ID, aControl, func(uploads.Upload, io.ReadCloser) error { return broken }); !errors.Is(err, broken) {
			t.Fatalf("Complete = %v, want the save's error", err)
		}
		var saved []byte
		if _, err := s.Complete(professor, up.ID, aControl, keep(&saved)); err != nil {
			t.Fatalf("the second Complete: %v", err)
		}
		if !bytes.Equal(saved, source) {
			t.Error("the retried Complete did not hand over the whole upload")
		}
	})
	t.Run("a second complete finds nothing", func(t *testing.T) {
		s := newService(t, t.TempDir())
		up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
		_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(200)))
		var saves int
		save := func(uploads.Upload, io.ReadCloser) error { saves++; return nil }
		if _, err := s.Complete(professor, up.ID, aControl, save); err != nil {
			t.Fatalf("Complete: %v", err)
		}
		if _, err := s.Complete(professor, up.ID, aControl, save); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("the second Complete = %v, want ErrNotFound", err)
		}
		if saves != 1 {
			t.Errorf("save ran %d times, want 1 — a double complete saves two batches", saves)
		}
	})
}

// The uid's lock is held across the save, so a second complete arriving while
// the first is still writing the batch waits, then finds nothing — rather than
// reading the same partial and saving a second batch beside the first.
func TestACompleteRacingAnotherWaitsForItAndSavesNothing(t *testing.T) {
	s := newService(t, t.TempDir())
	up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
	_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(200)))

	var saves atomic.Int32
	second := make(chan error, 1)
	_, err := s.Complete(professor, up.ID, aControl, func(uploads.Upload, io.ReadCloser) error {
		saves.Add(1)
		go func() {
			_, err := s.Complete(professor, up.ID, aControl, func(uploads.Upload, io.ReadCloser) error {
				saves.Add(1)
				return nil
			})
			second <- err
		}()
		// Without the lock the second complete runs to the end inside this
		// window; with it, it cannot start until this save returns.
		select {
		case err := <-second:
			second <- err
		case <-time.After(200 * time.Millisecond):
		}
		return nil
	})
	if err != nil {
		t.Fatalf("the first Complete: %v", err)
	}
	if saves.Load() == 0 {
		t.Fatal("the first Complete never ran its save, so nothing raced it")
	}
	if err := <-second; !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("the racing Complete = %v, want ErrNotFound", err)
	}
	if n := saves.Load(); n != 1 {
		t.Errorf("save ran %d times, want 1", n)
	}
}

func TestRemoveDeletesThePartialAtOnce(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
	_, _ = s.Append(professor, up.ID, 0, bytes.NewReader(aPDF(80)))

	if err := s.Remove(professor, up.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if left := entries(t, root); len(left) != 0 {
		t.Errorf("Remove left %v", left)
	}
	if _, err := s.Status(professor, up.ID); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("Status after Remove = %v, want ErrNotFound", err)
	}
}

// The directory sits on the volume the AMC worker also mounts, as root. A
// .part replaced by a symlink is not followed — neither to be written through
// nor to be handed over as a batch (a link to the database would otherwise be
// "saved" as a scan).
func TestASymlinkedPartIsNeverFollowed(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
	target := filepath.Join(t.TempDir(), "nalanda.db")
	secret := aPDF(200)
	if err := os.WriteFile(target, secret, 0o644); err != nil {
		t.Fatal(err)
	}
	part := filepath.Join(root, up.ID+".part")
	if err := os.Remove(part); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, part); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Append(professor, up.ID, 0, strings.NewReader("overwrite")); err == nil {
		t.Error("Append wrote through a symlinked partial")
	}
	var saved []byte
	if _, err := s.Complete(professor, up.ID, aControl, keep(&saved)); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("Complete over a symlinked partial = %v, want ErrNotFound", err)
	}
	if saved != nil {
		t.Error("the file a symlink pointed at was handed over as a batch")
	}
	if got, _ := os.ReadFile(target); !bytes.Equal(got, secret) {
		t.Error("the symlink's target was modified")
	}
}

// The sidecar is re-validated on every read: one the worker (or a crash)
// left unreadable or out of bounds is "no such upload", never a partial
// trusted on its say-so.
func TestASidecarThatDoesNotValidateIsNoUpload(t *testing.T) {
	for _, c := range []struct{ name, body string }{
		{"torn JSON", `{"id":`},
		{"a size past the cap", `{"id":"%s","professor":7,"subject_kind":"control","subject_id":"MOZMMCHZLSQ3NEKN2P7CO5APNM","name":"a.pdf","size":99999999}`},
		{"a subject kind outside the set", `{"id":"%s","professor":7,"subject_kind":"course","subject_id":"3","name":"a.pdf","size":200}`},
		{"no professor", `{"id":"%s","professor":0,"subject_kind":"control","subject_id":"MOZMMCHZLSQ3NEKN2P7CO5APNM","name":"a.pdf","size":200}`},
		{"another upload's id", `{"id":"AAAAAAAAAAAAAAAAAAAAAAAAAA","professor":7,"subject_kind":"control","subject_id":"MOZMMCHZLSQ3NEKN2P7CO5APNM","name":"a.pdf","size":200}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			s := newService(t, root)
			up, _ := s.Create(professor, aControl, "scan.pdf", 200, nil)
			body := c.body
			if strings.Contains(body, "%s") {
				body = strings.Replace(body, "%s", up.ID, 1)
			}
			if err := os.WriteFile(filepath.Join(root, up.ID+".json"), []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}

			if _, err := s.Status(professor, up.ID); !errors.Is(err, uploads.ErrNotFound) {
				t.Errorf("Status = %v, want ErrNotFound", err)
			}
		})
	}
}

// Every upload a Service creates is a uid of the same shape as a control id:
// 26 characters of [A-Z2-7], so it is safe in a URL and in a file name.
func TestCreateIssuesAnIDOfTheDocumentedShape(t *testing.T) {
	s := newService(t, t.TempDir())
	seen := map[string]bool{}
	for range 20 {
		up, err := s.Create(professor, aControl, "scan.pdf", 10, nil)
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if len(up.ID) != 26 || strings.Trim(up.ID, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567") != "" {
			t.Errorf("id %q is not 26 characters of [A-Z2-7]", up.ID)
		}
		if seen[up.ID] {
			t.Errorf("id %q issued twice", up.ID)
		}
		seen[up.ID] = true
	}
}

// gatedReader is a chunk's body that stops on its first read until the test
// opens the gate — a request the server is still reading, as when a link
// stalls mid-chunk and the page has already given up on it.
type gatedReader struct {
	body    io.Reader
	started chan struct{}
	gate    chan struct{}
	once    sync.Once
}

func newGatedReader(b []byte) *gatedReader {
	return &gatedReader{body: bytes.NewReader(b), started: make(chan struct{}), gate: make(chan struct{})}
}

func (g *gatedReader) Read(p []byte) (int, error) {
	g.once.Do(func() { close(g.started) })
	<-g.gate
	return g.body.Read(p)
}

// #339 review, COR-1. The page gives up on a stalled chunk, asks the status,
// and sends the same offset again — while the server may STILL be reading the
// first request. The upload's lock makes the second wait and then find the
// offset taken; without it both append, the partial holds the chunk twice,
// and complete saves a batch that is not the source.
func TestAChunkSentAgainWhileTheFirstIsStillArrivingIsRefused(t *testing.T) {
	s := newService(t, t.TempDir())
	source := aPDF(200)
	up, err := s.Create(professor, aControl, "scan.pdf", int64(len(source)), nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	stalled := newGatedReader(source[:100])
	first := make(chan error, 1)
	go func() {
		_, err := s.Append(professor, up.ID, 0, stalled)
		first <- err
	}()
	<-stalled.started

	second := make(chan error, 1)
	go func() {
		_, err := s.Append(professor, up.ID, 0, bytes.NewReader(source[:100]))
		second <- err
	}()
	// Without the lock the second append finishes inside this window.
	var secondErr error
	finished := false
	select {
	case secondErr = <-second:
		finished = true
	case <-time.After(200 * time.Millisecond):
	}
	close(stalled.gate)
	if err := <-first; err != nil {
		t.Fatalf("the stalled append: %v", err)
	}
	if !finished {
		secondErr = <-second
	}

	if !errors.Is(secondErr, uploads.ErrOffsetMismatch) {
		t.Errorf("the repeated chunk = %v, want ErrOffsetMismatch", secondErr)
	}
	if status, _ := s.Status(professor, up.ID); status.Received != 100 {
		t.Errorf("the partial holds %d bytes, want 100 — the same chunk landed twice", status.Received)
	}
}

// A partial whose sidecar declares fewer bytes than it holds was not written
// by this package: no upload, rather than a batch with a tail nobody sent.
func TestAPartialLongerThanItsDeclaredSizeIsNoUpload(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	up, err := s.Create(professor, aControl, "scan.pdf", 100, nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, up.ID+".part"), aPDF(150), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := s.Status(professor, up.ID); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("Status = %v, want ErrNotFound", err)
	}
	if _, err := s.Append(professor, up.ID, 150, strings.NewReader("x")); !errors.Is(err, uploads.ErrNotFound) {
		t.Errorf("Append = %v, want ErrNotFound", err)
	}
	var saved []byte
	if _, err := s.Complete(professor, up.ID, aControl, keep(&saved)); !errors.Is(err, uploads.ErrNotFound) || saved != nil {
		t.Errorf("Complete = %v (saved %d bytes), want ErrNotFound and nothing handed over", err, len(saved))
	}
}

// within fails the test if f has not returned in time — the shape of a call
// a FIFO would block for ever.
func within(t *testing.T, what string, f func()) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		f()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("%s did not return: open(2) is blocked on a FIFO", what)
	}
}

// #339 review, SEC-1. A FIFO planted under an upload's name (the worker mounts
// this volume as root) must be refused like any other non-regular file, not
// block open(2) — the eviction reads every sidecar under one mutex, so one
// FIFO would otherwise stop every professor's next upload.
func TestAFIFOOnTheSharedVolumeIsRefusedAndBlocksNothing(t *testing.T) {
	root := t.TempDir()
	s := newService(t, root)
	up, _ := s.Create(professor, aControl, "scan.pdf", 100, nil)
	sidecar := filepath.Join(root, up.ID+".json")
	if err := os.Remove(sidecar); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(sidecar, 0o666); err != nil {
		t.Fatalf("Mkfifo: %v", err)
	}

	within(t, "Status over a FIFO sidecar", func() {
		if _, err := s.Status(professor, up.ID); !errors.Is(err, uploads.ErrNotFound) {
			t.Errorf("Status = %v, want ErrNotFound", err)
		}
	})
	within(t, "a Create that walks past a FIFO sidecar", func() {
		if _, err := s.Create(professor+1, aControl, "scan.pdf", 100, nil); err != nil {
			t.Errorf("Create = %v", err)
		}
	})
	within(t, "a sweep that walks past a FIFO sidecar", func() {
		if _, err := s.Sweep(time.Now()); err != nil {
			t.Errorf("Sweep = %v", err)
		}
	})
}
