package controls_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

// annotateFixture wires a Service for the annotate loop's tests: a fake
// annotator that records every call, a reading store the test seeds, and a
// control row so Store.ControlByID resolves.
type annotateFixture struct {
	svc      *controls.Service
	store    *fakeStore
	readings *fakeReadingStore
	fake     *amctest.Fake
	control  controls.Control
}

func newAnnotateFixture(t *testing.T, annotateEnabled bool) *annotateFixture {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(bankJSON))
	if err != nil {
		t.Fatalf("bank.Parse: %v", err)
	}
	store := newFakeStore()
	readings := newFakeReadingStore()
	fake := &amctest.Fake{}
	svc := controls.NewService(controls.Service{
		Bank:            b,
		Store:           store,
		Generator:       fake,
		Analyzer:        fake,
		Readings:        readings,
		Annotator:       fake,
		AnnotateEnabled: annotateEnabled,
		WorkDir:         t.TempDir(),
		Now:             func() time.Time { return time.Unix(1_755_446_400, 0).UTC() },
		Seed:            1242,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	control := controls.Control{
		ID:     "CTRL0001ABC0000000000000AA",
		Copies: 5,
		Ticked: controls.DefaultTicked,
		Unsure: controls.DefaultUnsure,
	}
	store.controls = append(store.controls, control)
	return &annotateFixture{svc: svc, store: store, readings: readings, fake: fake, control: control}
}

func (f *annotateFixture) seedReading(t *testing.T, copyNumber int, mutate func(*controls.Reading)) controls.Reading {
	t.Helper()
	r := controls.Reading{
		ID:         int64(copyNumber),
		ControlID:  f.control.ID,
		CopyNumber: copyNumber,
		Answers: []controls.Answer{
			{QuestionRef: "q1", Marked: []int{1}},
			{QuestionRef: "q2", Marked: []int{2}},
		},
	}
	if mutate != nil {
		mutate(&r)
	}
	f.readings.readingsByCopy[fmtKey(f.control.ID, copyNumber)] = r
	return r
}

func fmtKey(controlID string, copyNumber int) string {
	return fmt.Sprintf("%s#%d", controlID, copyNumber)
}

func TestAnnotateSendsTheOverridesAndPersistsTheRecord(t *testing.T) {
	f := newAnnotateFixture(t, true)
	rut := "20123456"
	f.seedReading(t, 3, func(r *controls.Reading) {
		r.RUTOverride = &controls.RUTOverride{RUT: rut, EditedAt: time.Now()}
		r.Answers[1].Override = &controls.AnswerOverride{
			Marked: []int{1, 3}, Status: controls.AnswerStatusOK, EditedAt: time.Now(),
		}
	})

	got, err := f.svc.Annotate(context.Background(), f.control.ID, 3)
	if err != nil {
		t.Fatalf("Annotate: %v", err)
	}

	call, ok := f.fake.LastAnnotateCall()
	if !ok {
		t.Fatal("AnnotateCopy was never called")
	}
	if call.Copy != 3 {
		t.Errorf("Copy = %d, want 3", call.Copy)
	}
	// Issue #197: the control's stored threshold travels with the annotate
	// call — the PDF must agree with the reader's verdict.
	if call.Ticked != controls.DefaultTicked {
		t.Errorf("Ticked = %v, want the control's stored %v", call.Ticked, controls.DefaultTicked)
	}
	if want := "controls/" + f.control.ID; call.Project != want {
		t.Errorf("Project = %q, want %q", call.Project, want)
	}
	if call.Overrides.RUT == nil || *call.Overrides.RUT != rut {
		t.Errorf("Overrides.RUT = %v, want %q", call.Overrides.RUT, rut)
	}
	if len(call.Overrides.Answers) != 1 {
		t.Fatalf("Overrides.Answers = %v, want exactly the q2 override", call.Overrides.Answers)
	}
	if call.Overrides.Answers[0].Question != "q2" || len(call.Overrides.Answers[0].Marked) != 2 ||
		call.Overrides.Answers[0].Marked[0] != 1 || call.Overrides.Answers[0].Marked[1] != 3 {
		t.Errorf("Overrides.Answers[0] = %+v, want q2 marked [1 3]", call.Overrides.Answers[0])
	}

	record, exists, err := f.store.AnnotatedByCopy(context.Background(), f.control.ID, 3)
	if err != nil || !exists {
		t.Fatalf("AnnotatedByCopy = %+v, %v, %v; want a record", record, exists, err)
	}
	if record.Path == "" {
		t.Error("record.Path is empty")
	}
	if !record.GeneratedAt.Equal(f.svc.Now()) {
		t.Errorf("record.GeneratedAt = %v, want the service clock %v", record.GeneratedAt, f.svc.Now())
	}
	if record.Path != got.Path {
		t.Errorf("record.Path = %q, Annotate returned %q", record.Path, got.Path)
	}
}

func TestAnnotateWithoutOverridesSendsNone(t *testing.T) {
	f := newAnnotateFixture(t, true)
	f.seedReading(t, 1, nil)

	if _, err := f.svc.Annotate(context.Background(), f.control.ID, 1); err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	call, ok := f.fake.LastAnnotateCall()
	if !ok {
		t.Fatal("AnnotateCopy was never called")
	}
	if call.Overrides.RUT != nil || len(call.Overrides.Answers) != 0 {
		t.Errorf("Overrides = %+v, want empty — the professor changed nothing", call.Overrides)
	}
}

func TestAnnotateDisabledIsANoOp(t *testing.T) {
	f := newAnnotateFixture(t, false)
	f.seedReading(t, 2, nil)

	if _, err := f.svc.Annotate(context.Background(), f.control.ID, 2); err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	if n := f.fake.AnnotateCallCount(); n != 0 {
		t.Errorf("AnnotateCopy called %d times with the flow disabled, want 0", n)
	}
	if _, exists, _ := f.store.AnnotatedByCopy(context.Background(), f.control.ID, 2); exists {
		t.Error("annotated_copy has a row with the flow disabled")
	}
}

func TestAnnotateWithoutReadingReturnsErrReadingNotFound(t *testing.T) {
	f := newAnnotateFixture(t, true)

	_, err := f.svc.Annotate(context.Background(), f.control.ID, 9)
	if !errors.Is(err, controls.ErrReadingNotFound) {
		t.Errorf("Annotate = %v, want ErrReadingNotFound", err)
	}
	if n := f.fake.AnnotateCallCount(); n != 0 {
		t.Errorf("AnnotateCopy called %d times for a missing reading, want 0", n)
	}
}

func TestAnnotateWorkerErrorPropagatesWithoutARecord(t *testing.T) {
	f := newAnnotateFixture(t, true)
	f.seedReading(t, 4, nil)
	f.fake.AnnotateErr = controls.ErrAnnotatorRefused

	_, err := f.svc.Annotate(context.Background(), f.control.ID, 4)
	if !errors.Is(err, controls.ErrAnnotatorRefused) {
		t.Errorf("Annotate = %v, want ErrAnnotatorRefused", err)
	}
	if _, exists, _ := f.store.AnnotatedByCopy(context.Background(), f.control.ID, 4); exists {
		t.Error("annotated_copy has a row after a refused annotate")
	}
}

// A blank override must travel as an EMPTY list, not nil — nil marshals to
// JSON null, which the worker used to read as a malformed field while the
// save itself had succeeded (issue #190 review, blocker 1). Pinned here on
// the domain shape the wire derives from.
func TestAnnotateBlankOverrideCarriesAnEmptyMarkedList(t *testing.T) {
	f := newAnnotateFixture(t, true)
	f.seedReading(t, 5, func(r *controls.Reading) {
		r.Answers[0].Override = &controls.AnswerOverride{
			Marked: nil, Status: controls.AnswerStatusBlank, EditedAt: time.Now(),
		}
	})

	if _, err := f.svc.Annotate(context.Background(), f.control.ID, 5); err != nil {
		t.Fatalf("Annotate: %v", err)
	}
	call, ok := f.fake.LastAnnotateCall()
	if !ok {
		t.Fatal("AnnotateCopy was never called")
	}
	if len(call.Overrides.Answers) != 1 {
		t.Fatalf("Overrides.Answers = %+v, want the blank override", call.Overrides.Answers)
	}
	if call.Overrides.Answers[0].Marked == nil {
		t.Error("Marked is nil for a blank override — the wire would carry null, not []")
	}
	if len(call.Overrides.Answers[0].Marked) != 0 {
		t.Errorf("Marked = %v, want an empty list", call.Overrides.Answers[0].Marked)
	}
}

// Reanalyze invalidates the stored annotated PDFs: they were drawn at the
// previous thresholds and can no longer agree with the report just
// persisted (issue #190 review, F6).
func TestReanalyzeClearsAnnotatedRows(t *testing.T) {
	f := newAnnotateFixture(t, true)
	if err := f.store.RecordAnnotated(context.Background(), controls.AnnotatedCopy{
		ControlID: f.control.ID, CopyNumber: 1, GeneratedAt: f.svc.Now(),
		Path: "controls/" + f.control.ID + "/annotated/copy-1.pdf",
	}); err != nil {
		t.Fatalf("RecordAnnotated: %v", err)
	}
	f.fake.ReanalyzeReports = []controls.Report{{}}

	if _, err := f.svc.Reanalyze(context.Background(), f.control.ID, 0.30, 0.10); err != nil {
		t.Fatalf("Reanalyze: %v", err)
	}
	if _, exists, _ := f.store.AnnotatedByCopy(context.Background(), f.control.ID, 1); exists {
		t.Error("annotated_copy row survived the reanalyze — the PDF would disagree with the new reading")
	}
}
