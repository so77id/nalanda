package controls_test

import (
	"context"
	"encoding/json"
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
	var out []controls.Control
	for _, c := range s.controls {
		if c.DeletedAt == nil {
			out = append(out, c)
		}
	}
	return out, nil
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

// Archive/restore/purge stubs (issue #261). ListArchivedControls is the read
// side; the three mutating methods share the same guard shape the real
// controlstore encodes — SoftDelete only fires on active rows, Restore only
// on archived, Purge only on archived.
func (s *fakeStore) ListArchivedControls(_ context.Context) ([]controls.Control, error) {
	var out []controls.Control
	for _, c := range s.controls {
		if c.DeletedAt != nil {
			out = append(out, c)
		}
	}
	return out, nil
}

func (s *fakeStore) SoftDeleteControl(_ context.Context, id string, at time.Time) error {
	for i := range s.controls {
		if s.controls[i].ID == id && s.controls[i].DeletedAt == nil {
			t := at
			s.controls[i].DeletedAt = &t
			return nil
		}
	}
	return controls.ErrControlNotFound
}

func (s *fakeStore) RestoreControl(_ context.Context, id string) error {
	for i := range s.controls {
		if s.controls[i].ID == id && s.controls[i].DeletedAt != nil {
			s.controls[i].DeletedAt = nil
			return nil
		}
	}
	return controls.ErrControlNotFound
}

func (s *fakeStore) PurgeControl(_ context.Context, id string) error {
	for i := range s.controls {
		if s.controls[i].ID == id && s.controls[i].DeletedAt != nil {
			s.controls = append(s.controls[:i], s.controls[i+1:]...)
			delete(s.pools, id)
			prefix := id + "#"
			for key := range s.annotated {
				if strings.HasPrefix(key, prefix) {
					delete(s.annotated, key)
				}
			}
			return nil
		}
	}
	return controls.ErrControlNotFound
}

// fakeReadingStore is the do-nothing double the pre-WP-F cases use. The
// WP-F flows are exercised through SaveUploadedBatch + AnalyzeBatch in
// scans_internal_test.go with a real controlstore. readingsByCopy holds
// stored readings for the annotate tests (issue #190); empty maps behave
// exactly like the old do-nothing shape.
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
		Bank:      bank.NewStaticLive(b),
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

// createControlSync composes PrepareControl + GenerateAssets — the two
// halves the runner picks up in production — so the tests exercise the
// same shape production does. Since ARQ-1 (issue #249 review) the
// Service.Create wrapper is gone; tests that need both halves in a row
// call this helper directly.
func createControlSync(ctx context.Context, svc *controls.Service, req controls.CreateRequest) (controls.Control, error) {
	control, err := svc.PrepareControl(ctx, req)
	if err != nil {
		return controls.Control{}, err
	}
	if err := svc.GenerateAssets(ctx, control.ID); err != nil {
		return controls.Control{}, err
	}
	return control, nil
}

// uploadScanSync composes SaveUploadedBatch + AnalyzeBatch — same
// shape the runner picks up in production. Same reasoning as
// createControlSync; ARQ-1 removed the Service.UploadScan wrapper.
func uploadScanSync(ctx context.Context, svc *controls.Service, req controls.UploadRequest) (controls.SaveUploadedBatchResult, controls.Report, error) {
	save, err := svc.SaveUploadedBatch(ctx, req)
	if err != nil {
		return controls.SaveUploadedBatchResult{}, controls.Report{}, err
	}
	report, err := svc.AnalyzeBatch(ctx, req.ControlID, save.BatchName, save.Ticked, save.Unsure)
	if err != nil {
		return save, controls.Report{}, err
	}
	return save, report, nil
}

func TestCreateWritesFilesAndPersistsTheControl(t *testing.T) {
	svc, store, gen, workDir := newService(t)

	got, err := createControlSync(context.Background(), svc, req(nil))
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

	// The pool snapshot (issue #198) sits beside the source: the control's
	// metadata plus every pool question in full, self-contained.
	snapPath := filepath.Join(workDir, "controls", got.ID, "pool.json")
	raw, err := os.ReadFile(snapPath)
	if err != nil {
		t.Fatalf("read pool.json: %v", err)
	}
	var snap controls.PoolSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("pool.json does not parse: %v\n---\n%s", err, raw)
	}
	if snap.Version != 1 {
		t.Errorf("pool.json version = %d, want 1", snap.Version)
	}
	if snap.Control.ID != got.ID || snap.Control.Name != "Control 1" {
		t.Errorf("pool.json control = %+v", snap.Control)
	}
	if snap.Control.Seed != 1242 {
		t.Errorf("pool.json seed = %d, want 1242", snap.Control.Seed)
	}
	if snap.Control.QuestionsPerCopy != 3 || snap.Control.Copies != 5 {
		t.Errorf("pool.json counts = %d/%d, want 3/5",
			snap.Control.QuestionsPerCopy, snap.Control.Copies)
	}
	// Issue #208: Paper is a generation-time preference the snapshot
	// records like DuplexPadding, so a regenerate off pool.json (WP-G)
	// can reproduce source.tex byte-for-byte. Empty request → default
	// (Letter), same guard as paperOrDefault in Create.
	if snap.Control.Paper != "letter" {
		t.Errorf("pool.json paper = %q, want \"letter\" (default when the request omits it, ADR-0043)", snap.Control.Paper)
	}
	if len(snap.Pool) != 4 {
		t.Fatalf("pool.json pool = %d questions, want 4 (the fixture range)", len(snap.Pool))
	}
	for i, q := range snap.Pool {
		if q.ID == "" || q.Statement == "" || len(q.Alternatives) == 0 || len(q.Correct) == 0 {
			t.Errorf("pool.json pool[%d] is not self-contained: %+v", i, q)
		}
	}
}

func TestCreateSurfacesBankErrorsAsIs(t *testing.T) {
	svc, _, _, _ := newService(t)

	// Inverted range → ErrRangeInverted, no rollback needed because no
	// files were staged.
	_, err := createControlSync(context.Background(), svc, req(func(r *controls.CreateRequest) {
		r.RangeFrom = bank.SectionRef{Document: "flujo", Section: "bucles"}
		r.RangeTo = bank.SectionRef{Document: "welcome", Section: "hola"}
	}))
	if !errors.Is(err, bank.ErrRangeInverted) {
		t.Errorf("Create(inverted range): %v, want bank.ErrRangeInverted", err)
	}

	// Unknown section → ErrUnknownSection.
	_, err = createControlSync(context.Background(), svc, req(func(r *controls.CreateRequest) {
		r.RangeFrom = bank.SectionRef{Document: "welcome", Section: "no-existe"}
	}))
	if !errors.Is(err, bank.ErrUnknownSection) {
		t.Errorf("Create(unknown section): %v, want bank.ErrUnknownSection", err)
	}
}

func TestCreateRefusesAPoolSmallerThanTheCopyAsksFor(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := createControlSync(context.Background(), svc, req(func(r *controls.CreateRequest) {
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

// Since issue #249 the worker call is on the async job (Create is now
// PrepareControl + GenerateAssets composed). A refusal on the worker
// leg leaves the row committed and the input files staged — the
// professor can re-run generation from the same row without losing
// the pool. The all-or-nothing promise (row+files-together) is
// preserved for the SYNC leg only (PrepareControl).
func TestGenerateAssetsRefusalLeavesTheRowAndFilesIntact(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	gen.Err = controls.ErrGeneratorRefused

	_, err := createControlSync(context.Background(), svc, req(nil))
	if !errors.Is(err, controls.ErrGeneratorRefused) {
		t.Fatalf("Create(worker refused): %v, want ErrGeneratorRefused", err)
	}
	if len(store.controls) != 1 {
		t.Errorf("store.controls = %+v, want the row committed by PrepareControl", store.controls)
	}
	projects, err := os.ReadDir(filepath.Join(workDir, "controls"))
	if err != nil || len(projects) != 1 {
		t.Errorf("workDir/controls holds %d directories after a worker refusal, want 1 (files stay for retry)", len(projects))
	}
}

func TestGenerateAssetsSujetMissingLeavesTheRowAndFilesIntact(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	gen.SujetSize = 0

	_, err := createControlSync(context.Background(), svc, req(nil))
	if !errors.Is(err, controls.ErrSujetMissing) {
		t.Fatalf("Create(0-byte sujet): %v, want ErrSujetMissing", err)
	}
	if len(store.controls) != 1 {
		t.Errorf("store.controls should still have the PrepareControl row: %+v", store.controls)
	}
	if entries, _ := os.ReadDir(filepath.Join(workDir, "controls")); len(entries) != 1 {
		t.Errorf("workDir/controls holds %d entries after 0-byte sujet, want 1 (files stay for retry)", len(entries))
	}
}

func TestCreateRollsBackWhenTheStoreFails(t *testing.T) {
	svc, store, _, workDir := newService(t)
	store.fail = errors.New("boom")

	_, err := createControlSync(context.Background(), svc, req(nil))
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
		Bank: bank.NewStaticLive(b), Store: store, Generator: gen, Analyzer: gen, Readings: newFakeReadingStore(),
		Annotator: gen, AnnotateEnabled: true,
		WorkDir: workDir,
		Now:     func() time.Time { return time.Now() }, Seed: 1,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	control, err := createControlSync(context.Background(), svc, controls.CreateRequest{
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

// Issue #210: a worker refusal used to rollback the uploaded PDF, which
// erased the artefact an operator would inspect and forced the professor
// to re-scan. The promise now is "wipe DB rows on failure" only — the
// batch survives on disk so the professor can download it and an operator
// can look at what got sent. The next upload advances to batch-(N+1).pdf,
// as expected of a preserved counter derived from directory listing.
func TestUploadScanPreservesTheBatchOnWorkerRefusal(t *testing.T) {
	svc, _, gen, workDir := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	gen.AnalyzeErr = &controls.AnalyzerRefusedError{
		Status: 400, Message: "scan not recognized",
		Detail: "ERR: /work/controls/x/scans/0001.pdf scan not recognized",
	}
	_, _, err = uploadScanSync(context.Background(), svc, controls.UploadRequest{
		ControlID: control.ID,
		Filename:  "batch.pdf",
		Content:   io.NopCloser(strings.NewReader("%PDF-fake")),
		Ticked:    controls.DefaultTicked,
		Unsure:    controls.DefaultUnsure,
	})
	if !errors.Is(err, controls.ErrAnalyzerRefused) {
		t.Fatalf("UploadScan = %v, want ErrAnalyzerRefused", err)
	}
	batch1 := filepath.Join(workDir, "controls", control.ID, "uploads", "batch-1.pdf")
	if _, statErr := os.Stat(batch1); statErr != nil {
		t.Fatalf("batch-1.pdf missing after refusal: %v — the failed upload's artefact must survive so the operator can download and inspect it", statErr)
	}

	// The second upload succeeds. The counter is derived from what is on
	// disk (nextBatchNumber walks the directory), so the second file must
	// land at batch-2.pdf, not overwrite batch-1.pdf.
	gen.AnalyzeErr = nil
	gen.AnalyzeReports = []controls.Report{{
		Copies: map[string]controls.ReportCopy{
			"1": {RUT: "20100001", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusOK,
				ExpectedQuestions: 3, SeenQuestions: 3},
		},
	}}
	save, _, err := uploadScanSync(context.Background(), svc, controls.UploadRequest{
		ControlID: control.ID,
		Filename:  "batch.pdf",
		Content:   io.NopCloser(strings.NewReader("%PDF-fake-2")),
		Ticked:    controls.DefaultTicked,
		Unsure:    controls.DefaultUnsure,
	})
	if err != nil {
		t.Fatalf("second UploadScan: %v", err)
	}
	if save.BatchNumber != 2 {
		t.Errorf("second BatchNumber = %d, want 2 (batch-1.pdf survived the refusal)", save.BatchNumber)
	}
	batch2 := filepath.Join(workDir, "controls", control.ID, "uploads", "batch-2.pdf")
	if _, statErr := os.Stat(batch2); statErr != nil {
		t.Errorf("batch-2.pdf missing after second upload: %v", statErr)
	}
	// batch-1.pdf still there — the second upload does not shift the first.
	if _, statErr := os.Stat(batch1); statErr != nil {
		t.Errorf("batch-1.pdf gone after second upload: %v", statErr)
	}
}

// Issue #197: the defense-in-depth pair validation refuses before the
// analyzer is called and before the batch file touches the disk.
func TestUploadScanRefusesAnInvalidPair(t *testing.T) {
	svc, store, gen, workDir := newService(t)
	control, err := createControlSync(context.Background(), svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	_, _, err = uploadScanSync(context.Background(), svc, controls.UploadRequest{
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

// Issue #261: Archive stamps the Service's clock — the runner's ordering
// on /controls/archived is a wall-clock question ("what did I archive
// last?") and the domain owns the answer through Service.Now.
func TestArchiveStampsTheServiceClockAndListMovesTheRow(t *testing.T) {
	svc, store, _, _ := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := svc.Archive(ctx, control.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, c := range list {
		if c.ID == control.ID {
			t.Errorf("List still contains archived control %s", control.ID)
		}
	}

	arch, err := svc.ArchivedList(ctx)
	if err != nil {
		t.Fatalf("ArchivedList: %v", err)
	}
	if len(arch) != 1 || arch[0].ID != control.ID {
		t.Fatalf("ArchivedList = %v, want the archived control only", arch)
	}
	if arch[0].DeletedAt == nil || !arch[0].DeletedAt.Equal(time.Unix(1_755_446_400, 0).UTC()) {
		t.Errorf("DeletedAt = %v, want the Service clock", arch[0].DeletedAt)
	}
	_ = store
}

// Issue #261: Restore returns a soft-deleted control to the main listing.
func TestRestoreMakesTheControlActiveAgain(t *testing.T) {
	svc, _, _, _ := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.Archive(ctx, control.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	if err := svc.Restore(ctx, control.ID); err != nil {
		t.Fatalf("Restore: %v", err)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	found := false
	for _, c := range list {
		if c.ID == control.ID {
			found = true
			if c.DeletedAt != nil {
				t.Errorf("DeletedAt = %v after Restore, want nil", c.DeletedAt)
			}
		}
	}
	if !found {
		t.Errorf("Restored control %s not in List", control.ID)
	}
}

// Issue #261: Purge on an active control returns ErrCannotPurgeActive
// AND leaves the row and the on-disk project directory intact. This is
// the defense-in-depth gate — a hand-typed /controls/{id}/purge URL
// cannot destroy grades.
func TestPurgeRefusesActiveControlsAndFilesSurvive(t *testing.T) {
	svc, store, _, workDir := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	projectDir := filepath.Join(workDir, "controls", control.ID)

	err = svc.Purge(ctx, control.ID)
	if !errors.Is(err, controls.ErrCannotPurgeActive) {
		t.Errorf("Purge(active): %v, want ErrCannotPurgeActive", err)
	}
	if len(store.controls) != 1 || store.controls[0].ID != control.ID {
		t.Errorf("row was removed by a refused purge: %+v", store.controls)
	}
	if _, statErr := os.Stat(projectDir); statErr != nil {
		t.Errorf("project dir gone after a refused purge: %v", statErr)
	}
}

// Issue #261: Purge on an archived control deletes the DB row AND the
// on-disk project directory. RemoveAll is best-effort by design — the
// happy path proves it runs; the FS-failure path (WARN, not returned) is
// exercised by TestPurgeReturnsSuccessWhenTheFileCleanupFails.
func TestPurgeArchivedControlDeletesRowAndFiles(t *testing.T) {
	svc, store, _, workDir := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	projectDir := filepath.Join(workDir, "controls", control.ID)
	if _, statErr := os.Stat(projectDir); statErr != nil {
		t.Fatalf("project dir setup: %v", statErr)
	}
	if err := svc.Archive(ctx, control.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	if err := svc.Purge(ctx, control.ID); err != nil {
		t.Fatalf("Purge: %v", err)
	}
	if _, err := svc.Get(ctx, control.ID); !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("Get after Purge: %v, want ErrControlNotFound", err)
	}
	if len(store.controls) != 0 {
		t.Errorf("store still holds %d row(s) after Purge", len(store.controls))
	}
	if _, statErr := os.Stat(projectDir); !os.IsNotExist(statErr) {
		t.Errorf("project dir survived Purge: %v", statErr)
	}
}

// Issue #261: a filesystem failure on the RemoveAll step must NOT reverse
// the DB delete — the row is already gone via cascade, and returning an
// error would leave the caller believing the purge failed while every
// referenced grade is unrecoverable. The failure is logged and swallowed.
// We provoke the FS failure by pre-purge replacing the project directory
// with a regular file whose parent we chmod 0500 — RemoveAll cannot
// unlink under an unwritable directory.
func TestPurgeReturnsSuccessWhenTheFileCleanupFails(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root, chmod 0500 does not block RemoveAll")
	}
	svc, _, _, workDir := newService(t)
	ctx := context.Background()
	control, err := createControlSync(ctx, svc, req(nil))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.Archive(ctx, control.ID); err != nil {
		t.Fatalf("Archive: %v", err)
	}
	// Lock the parent directory read-only so RemoveAll's rmdir call fails.
	// Restored in the cleanup so the tempdir can be removed.
	parent := filepath.Join(workDir, "controls")
	if err := os.Chmod(parent, 0o500); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	t.Cleanup(func() { _ = os.Chmod(parent, 0o755) })

	if err := svc.Purge(ctx, control.ID); err != nil {
		t.Fatalf("Purge should have swallowed the FS failure: %v", err)
	}
	if _, err := svc.Get(ctx, control.ID); !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("row still present after Purge: %v", err)
	}
}

// Issue #261: Purge on an unknown id returns ErrControlNotFound (from
// ControlByID); the FS is untouched.
func TestPurgeOnMissingControlReturnsNotFound(t *testing.T) {
	svc, _, _, _ := newService(t)
	err := svc.Purge(context.Background(), "does-not-exist")
	if !errors.Is(err, controls.ErrControlNotFound) {
		t.Errorf("Purge(missing): %v, want ErrControlNotFound", err)
	}
}
