package controls_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

// bankJSON is the fixture from S1, trimmed to what these cases exercise.
// Copied inline rather than shared through a helper package: a fixture
// travelling across packages is one that drifts (backend-code-style.md
// §Testing).
const bankJSON = `{
  "version": 1,
  "documents": [
    {"id": "welcome", "title": "Bienvenida", "coverage": "clase 0",
     "sections": ["hola", "reglas"]},
    {"id": "flujo",   "title": "Flujo",      "coverage": "clase 2",
     "sections": ["if-else", "bucles"]}
  ],
  "questions": [
    {"id": "q1", "document": "welcome", "anchor": "hola",   "type": "simple",
     "statement": "A?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q2", "document": "welcome", "anchor": "reglas", "type": "simple",
     "statement": "B?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q3", "document": "flujo",   "anchor": "if-else","type": "simple",
     "statement": "C?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q4", "document": "flujo",   "anchor": "bucles", "type": "multiple",
     "statement": "D?", "code": null, "alternatives": ["a","b","c"], "correct": [0,1]}
  ]
}`

// fakeStore is a minimal in-memory Store, enough to exercise the Service's
// error-handling paths without a real database. The controlstore's own L6
// tests cover the real one.
type fakeStore struct {
	controls  []controls.Control
	pools     map[string][]controls.PoolEntry
	annotated map[string]controls.AnnotatedCopy // key: <controlID>#<copyNumber>
	fail      error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		pools:     map[string][]controls.PoolEntry{},
		annotated: map[string]controls.AnnotatedCopy{},
	}
}

func (s *fakeStore) CreateControl(_ context.Context, c controls.Control, pool []controls.PoolEntry) error {
	if s.fail != nil {
		return s.fail
	}
	s.controls = append(s.controls, c)
	s.pools[c.ID] = pool
	return nil
}

func (s *fakeStore) ControlByID(_ context.Context, id string) (controls.Control, error) {
	for _, c := range s.controls {
		if c.ID == id {
			return c, nil
		}
	}
	return controls.Control{}, controls.ErrControlNotFound
}

func (s *fakeStore) ListControls(_ context.Context) ([]controls.Control, error) {
	return append([]controls.Control(nil), s.controls...), nil
}

func (s *fakeStore) ControlPool(_ context.Context, id string) ([]controls.PoolEntry, error) {
	return s.pools[id], nil
}

func (s *fakeStore) RecordAnnotated(_ context.Context, a controls.AnnotatedCopy) error {
	if s.fail != nil {
		return s.fail
	}
	s.annotated[fmt.Sprintf("%s#%d", a.ControlID, a.CopyNumber)] = a
	return nil
}

func (s *fakeStore) AnnotatedByCopy(_ context.Context, controlID string, copyNumber int) (controls.AnnotatedCopy, bool, error) {
	a, ok := s.annotated[fmt.Sprintf("%s#%d", controlID, copyNumber)]
	return a, ok, nil
}

func (s *fakeStore) ClearAnnotated(_ context.Context, controlID string) error {
	prefix := controlID + "#"
	for key := range s.annotated {
		if strings.HasPrefix(key, prefix) {
			delete(s.annotated, key)
		}
	}
	return nil
}

func (s *fakeStore) SetControlThresholds(_ context.Context, controlID string, ticked, unsure float64) error {
	for i := range s.controls {
		if s.controls[i].ID == controlID {
			s.controls[i].Ticked = ticked
			s.controls[i].Unsure = unsure
		}
	}
	return nil
}

// fakeReadingStore is the do-nothing double the pre-WP-F cases use. The
// WP-F flows are exercised through Service.UploadScan in scans_internal_test.go
// with a real controlstore. readingsByCopy holds stored readings for the
// annotate tests (issue #190); empty maps behave exactly like the old
// do-nothing shape.
type fakeReadingStore struct {
	readingsByCopy map[string]controls.Reading // key: <controlID>#<copyNumber>
}

func newFakeReadingStore() *fakeReadingStore {
	return &fakeReadingStore{readingsByCopy: map[string]controls.Reading{}}
}

func (s *fakeReadingStore) UpsertReadingsFromReport(context.Context, string, controls.Report, time.Time) error {
	return nil
}
func (s *fakeReadingStore) MarkMissingAsNotPresent(context.Context, string, time.Time) error {
	return nil
}
func (s *fakeReadingStore) ReadingsByControl(context.Context, string) ([]controls.Reading, error) {
	return nil, nil
}
func (s *fakeReadingStore) ReadingByCopy(_ context.Context, controlID string, copyNumber int) (controls.Reading, error) {
	r, ok := s.readingsByCopy[fmt.Sprintf("%s#%d", controlID, copyNumber)]
	if !ok {
		return controls.Reading{}, controls.ErrReadingNotFound
	}
	return r, nil
}
func (fakeReadingStore) SetAnswerOverride(context.Context, int64, string, controls.AnswerOverride) error {
	return nil
}
func (fakeReadingStore) ClearAnswerOverride(context.Context, int64, string) error { return nil }
func (fakeReadingStore) SetRUTOverride(context.Context, int64, string, time.Time) error {
	return nil
}
func (fakeReadingStore) ClearRUTOverride(context.Context, int64) error { return nil }
func (fakeReadingStore) SetControlState(context.Context, string, controls.State) error {
	return nil
}

// newService returns a Service against a fixture bank, a fake store, a
// fake generator that succeeds (SujetSize > 0), and a work dir under t's
// tempdir.
func newService(t *testing.T) (*controls.Service, *fakeStore, *amctest.Fake, string) {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(bankJSON))
	if err != nil {
		t.Fatalf("bank.Parse: %v", err)
	}
	workDir := t.TempDir()
	store := newFakeStore()
	gen := &amctest.Fake{WorkDir: workDir, SujetSize: 42}
	svc := controls.NewService(controls.Service{
		Bank:      b,
		Store:     store,
		Generator: gen,
		Analyzer:  gen,
		Readings:  newFakeReadingStore(),
		Annotator: gen,
		// The production default (config default true, issue #190). Tests
		// that exercise the off switch build their own Service.
		AnnotateEnabled: true,
		WorkDir:         workDir,
		Now:             func() time.Time { return time.Unix(1_755_446_400, 0).UTC() },
		Seed:            1242,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return svc, store, gen, workDir
}

func req(mutate func(*controls.CreateRequest)) controls.CreateRequest {
	r := controls.CreateRequest{
		Name:             "Control 1",
		RangeFrom:        bank.SectionRef{Document: "welcome", Section: "hola"},
		RangeTo:          bank.SectionRef{Document: "flujo", Section: "bucles"},
		QuestionsPerCopy: 3,
		Copies:           5,
		CreatedBy:        1,
	}
	if mutate != nil {
		mutate(&r)
	}
	return r
}

func TestCreateWritesFilesAndPersistsTheControl(t *testing.T) {
	svc, store, gen, workDir := newService(t)

	got, err := svc.Create(context.Background(), req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if got.ID == "" || got.State != controls.Generated {
		t.Errorf("Control returned = %+v", got)
	}

	// The row landed in the fake store.
	if len(store.controls) != 1 || store.controls[0].ID != got.ID {
		t.Errorf("store.controls = %+v", store.controls)
	}

	// The worker was called once with the project rooted at controls/<id>.
	if gen.CallCount() != 1 {
		t.Fatalf("generator was called %d times, want 1", gen.CallCount())
	}
	call, _ := gen.LastCall()
	if call.Project != filepath.Join("controls", got.ID) {
		t.Errorf("generator.Project = %q, want controls/<id>", call.Project)
	}
	if call.Copies != 5 {
		t.Errorf("generator.Copies = %d, want 5", call.Copies)
	}

	// The source .tex is on disk. It was written before the worker was
	// asked to compile, and never cleaned up on success.
	sourcePath := filepath.Join(workDir, "controls", got.ID, "inputs", "source.tex")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("read source.tex: %v", err)
	}
	if !strings.Contains(string(source), "\\AMCrandomseed{1242}") {
		t.Errorf("source.tex is missing the configured seed")
	}
}

func TestCreateSurfacesBankErrorsAsIs(t *testing.T) {
	svc, _, _, _ := newService(t)

	// Inverted range → ErrRangeInverted, no rollback needed because no
	// files were staged.
	_, err := svc.Create(context.Background(), req(func(r *controls.CreateRequest) {
		r.RangeFrom = bank.SectionRef{Document: "flujo", Section: "bucles"}
		r.RangeTo = bank.SectionRef{Document: "welcome", Section: "hola"}
	}))
	if !errors.Is(err, bank.ErrRangeInverted) {
		t.Errorf("Create(inverted range): %v, want bank.ErrRangeInverted", err)
	}

	// Unknown section → ErrUnknownSection.
	_, err = svc.Create(context.Background(), req(func(r *controls.CreateRequest) {
		r.RangeFrom = bank.SectionRef{Document: "welcome", Section: "no-existe"}
	}))
	if !errors.Is(err, bank.ErrUnknownSection) {
		t.Errorf("Create(unknown section): %v, want bank.ErrUnknownSection", err)
	}
}

func TestCreateRefusesAPoolSmallerThanTheCopyAsksFor(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := svc.Create(context.Background(), req(func(r *controls.CreateRequest) {
		r.QuestionsPerCopy = 8 // pool has 4
	}))
	if !errors.Is(err, controls.ErrPoolTooSmall) {
		t.Errorf("Create(oversized copy): %v, want ErrPoolTooSmall", err)
	}
	var pool controls.PoolTooSmallErr
	if !errors.As(err, &pool) {
		t.Fatalf("Create(oversized copy): does not unwrap to PoolTooSmallErr: %v", err)
	}
	if pool.Pool != 4 || pool.QuestionsPerCopy != 8 {
		t.Errorf("PoolTooSmallErr = %+v, want {Pool:4, QuestionsPerCopy:8}", pool)
	}
}

func TestCreateRollsBackWhenTheWorkerRefuses(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	gen.Err = controls.ErrGeneratorRefused

	_, err := svc.Create(context.Background(), req(nil))
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Fatalf("Create(worker refused): %v, want ErrGeneratorRefused", err)
	}

	if len(store.controls) != 0 {
		t.Errorf("store.controls = %+v, want empty (worker refusal must roll back the row)", store.controls)
	}

	// The project directory is gone.
	projects, err := os.ReadDir(filepath.Join(workDir, "controls"))
	if err == nil && len(projects) > 0 {
		t.Errorf("workDir/controls holds %d directories after a rolled-back Create, want 0", len(projects))
	}
}

func TestCreateRollsBackWhenSujetIsZeroBytes(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	gen.SujetSize = 0 // fake writes an empty sujet.pdf

	_, err := svc.Create(context.Background(), req(nil))
	if !errors.Is(err, controls.ErrSujetMissing) {
		t.Fatalf("Create(0-byte sujet): %v, want ErrSujetMissing", err)
	}

	if len(store.controls) != 0 {
		t.Error("store.controls is not empty after a 0-byte sujet failure — creation must be all-or-nothing")
	}
	if entries, _ := os.ReadDir(filepath.Join(workDir, "controls")); len(entries) > 0 {
		t.Errorf("workDir/controls holds %d entries after a 0-byte sujet failure, want 0", len(entries))
	}
}

func TestCreateRollsBackWhenTheStoreFails(t *testing.T) {
	svc, store, _, workDir := newService(t)
	store.fail = errors.New("boom")

	_, err := svc.Create(context.Background(), req(nil))
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("Create(store fails): %v, want error carrying 'boom'", err)
	}
	if entries, _ := os.ReadDir(filepath.Join(workDir, "controls")); len(entries) > 0 {
		t.Errorf("workDir/controls holds %d entries after a persist failure, want 0", len(entries))
	}
}

func TestCreatePassesTheCorrectAbsoluteListingPathForCodeQuestions(t *testing.T) {
	// Build a bank whose only question in a section has code, and ask a
	// control that draws it — that is what tests the /work absolute-path
	// staging (ADR-0033).
	const codeBank = `{
  "version": 1,
  "documents": [
    {"id": "arr", "title": "Arreglos", "coverage": "clase 3",
     "sections": ["b"]}
  ],
  "questions": [
    {"id": "prints", "document": "arr", "anchor": "b", "type": "simple",
     "statement": "?", "code": {"language":"java","source":"System.out.println(1);"},
     "alternatives": ["1","2"], "correct": [0]}
  ]
}`
	b, err := bank.Parse(strings.NewReader(codeBank))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	workDir := t.TempDir()
	gen := &amctest.Fake{WorkDir: workDir, SujetSize: 4}
	store := newFakeStore()
	svc := controls.NewService(controls.Service{
		Bank: b, Store: store, Generator: gen, Analyzer: gen, Readings: newFakeReadingStore(),
		Annotator: gen, AnnotateEnabled: true,
		WorkDir: workDir,
		Now:     func() time.Time { return time.Now() }, Seed: 1,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	control, err := svc.Create(context.Background(), controls.CreateRequest{
		Name:             "c",
		RangeFrom:        bank.SectionRef{Document: "arr", Section: "b"},
		RangeTo:          bank.SectionRef{Document: "arr", Section: "b"},
		QuestionsPerCopy: 1, Copies: 1, CreatedBy: 1,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// The staged listing is on disk under the server's work dir.
	stagedPath := filepath.Join(workDir, "controls", control.ID, "inputs", "question-prints.txt")
	if _, err := os.Stat(stagedPath); err != nil {
		t.Errorf("staged listing missing: %v", err)
	}
	// The source.tex references the WORKER's absolute path (/work), not
	// the server's.
	source, _ := os.ReadFile(filepath.Join(workDir, "controls", control.ID, "inputs", "source.tex"))
	want := "\\lstinputlisting{/work/controls/" + control.ID + "/inputs/question-prints.txt}"
	if !strings.Contains(string(source), want) {
		t.Errorf("source.tex is missing %q — a listing under the server's mount would not resolve inside the worker", want)
	}
}

// Issue #197: the defense-in-depth pair validation refuses before the
// analyzer is called and before the batch file touches the disk.
func TestUploadScanRefusesAnInvalidPair(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	control, err := svc.Create(context.Background(), req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	_, err = svc.UploadScan(context.Background(), controls.UploadRequest{
		ControlID: control.ID,
		Filename:  "batch.pdf",
		Content:   io.NopCloser(strings.NewReader("%PDF-fake")),
		Ticked:    0.05,
		Unsure:    0.20, // inverted band
	})
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Fatalf("UploadScan = %v, want ErrAnalyzerRefused", err)
	}
	if n := gen.AnalyzeCallCount(); n != 0 {
		t.Errorf("Analyze called %d times for an invalid pair, want 0", n)
	}
	if _, statErr := os.Stat(filepath.Join(workDir, "controls", control.ID, "uploads")); !os.IsNotExist(statErr) {
		t.Errorf("uploads dir exists after the refusal: %v — the batch file must not touch the disk", statErr)
	}
	_ = store
}
