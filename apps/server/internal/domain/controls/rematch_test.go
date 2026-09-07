package controls_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
	"github.com/so77id/nalanda/apps/server/internal/infra/amcworker/amctest"
)

// matchingReadingStore is a ReadingStore that actually holds readings, so
// the rematch cases can see what was written. The package's other double
// (fakeReadingStore) is deliberately inert and cannot.
type matchingReadingStore struct {
	rows map[string][]controls.Reading // key: controlID
	next int64
}

func newMatchingReadingStore() *matchingReadingStore {
	return &matchingReadingStore{rows: map[string][]controls.Reading{}}
}

// seed adds one reading per (copy number, RUT). An empty RUT is a copy
// whose boxes AMC could not read.
func (s *matchingReadingStore) seed(controlID string, ruts map[int]string) {
	numbers := make([]int, 0, len(ruts))
	for n := range ruts {
		numbers = append(numbers, n)
	}
	sort.Ints(numbers)
	for _, n := range numbers {
		s.next++
		r := controls.Reading{
			ID:         s.next,
			ControlID:  controlID,
			CopyNumber: n,
			RUTStatus:  controls.RUTStatusOK,
			CopyStatus: controls.CopyStatusOK,
		}
		if rut := ruts[n]; rut != "" {
			value := rut
			r.RUTRead = &value
		} else {
			r.RUTStatus = controls.RUTStatusUnreadable
		}
		s.rows[controlID] = append(s.rows[controlID], r)
	}
}

func (s *matchingReadingStore) at(controlID string, copyNumber int) *controls.Reading {
	for i := range s.rows[controlID] {
		if s.rows[controlID][i].CopyNumber == copyNumber {
			return &s.rows[controlID][i]
		}
	}
	return nil
}

func (s *matchingReadingStore) studentOf(controlID string, copyNumber int) *int64 {
	if r := s.at(controlID, copyNumber); r != nil {
		return r.StudentID
	}
	return nil
}

func (s *matchingReadingStore) setOverride(controlID string, copyNumber int, rut string) {
	if r := s.at(controlID, copyNumber); r != nil {
		r.RUTOverride = &controls.RUTOverride{RUT: rut}
	}
}

func (s *matchingReadingStore) setRUT(controlID string, copyNumber int, rut string) {
	r := s.at(controlID, copyNumber)
	if r == nil {
		return
	}
	if rut == "" {
		r.RUTRead = nil
		r.RUTStatus = controls.RUTStatusUnreadable
		return
	}
	value := rut
	r.RUTRead = &value
	r.RUTStatus = controls.RUTStatusOK
}

func (s *matchingReadingStore) ReadingsByControl(_ context.Context, controlID string) ([]controls.Reading, error) {
	out := make([]controls.Reading, len(s.rows[controlID]))
	copy(out, s.rows[controlID])
	return out, nil
}

func (s *matchingReadingStore) SetReadingStudent(_ context.Context, readingID int64, studentID *int64) error {
	for controlID := range s.rows {
		for i := range s.rows[controlID] {
			if s.rows[controlID][i].ID == readingID {
				s.rows[controlID][i].StudentID = studentID
				return nil
			}
		}
	}
	return controls.ErrReadingNotFound
}

func (s *matchingReadingStore) ReadingByCopy(_ context.Context, controlID string, copyNumber int) (controls.Reading, error) {
	if r := s.at(controlID, copyNumber); r != nil {
		return *r, nil
	}
	return controls.Reading{}, controls.ErrReadingNotFound
}

func (*matchingReadingStore) UpsertReadingsFromReport(context.Context, string, controls.Report, time.Time) error {
	return nil
}
func (*matchingReadingStore) MarkMissingAsNotPresent(context.Context, string, time.Time) error {
	return nil
}
func (*matchingReadingStore) SetAnswerOverride(context.Context, int64, string, controls.AnswerOverride) error {
	return nil
}
func (*matchingReadingStore) ClearAnswerOverride(context.Context, int64, string) error { return nil }
func (*matchingReadingStore) SetRUTOverride(context.Context, int64, string, time.Time) error {
	return nil
}
func (*matchingReadingStore) ClearRUTOverride(context.Context, int64) error { return nil }
func (*matchingReadingStore) SetControlState(context.Context, string, controls.State) error {
	return nil
}

// newMatchingService is a Service wired with a matcher and a reading store
// that remembers, which is the pair the rematch cases are about. The
// course id it returns is the one seedControlWithReadings files controls
// under.
func newMatchingService(t *testing.T, matcher controls.Matcher) (*controls.Service, *fakeStore, *matchingReadingStore, int64) {
	t.Helper()
	b, err := bank.Parse(strings.NewReader(bankJSON))
	if err != nil {
		t.Fatalf("bank.Parse: %v", err)
	}
	workDir := t.TempDir()
	store := newFakeStore()
	readings := newMatchingReadingStore()
	gen := &amctest.Fake{WorkDir: workDir, SujetSize: 42}
	svc := controls.NewService(controls.Service{
		Bank:      bank.NewStaticLive(b),
		Store:     store,
		Generator: gen,
		Analyzer:  gen,
		Readings:  readings,
		Annotator: gen,
		Matcher:   matcher,
		WorkDir:   workDir,
		Now:       func() time.Time { return time.Unix(1_755_446_400, 0).UTC() },
		Seed:      1,
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return svc, store, readings, 7
}

// seedControlWithReadings creates a control on courseID (0 means none) and
// gives it one reading per entry of ruts.
func seedControlWithReadings(t *testing.T, ctx context.Context, svc *controls.Service, readings *matchingReadingStore, courseID int64, ruts map[int]string) controls.Control {
	t.Helper()
	r := req(nil)
	if courseID > 0 {
		id := courseID
		r.CourseID = &id
	}
	control, err := svc.PrepareControl(ctx, r)
	if err != nil {
		t.Fatalf("PrepareControl: %v", err)
	}
	readings.seed(control.ID, ruts)
	return control
}

// --- Issue #272 S3: matching runs after every read. ---

// fakeMatcher answers out of a map keyed by the normalised RUT, and
// records every call so a case can assert what the service asked and with
// which course.
type fakeMatcher struct {
	byRUT map[string]int64
	fail  error
	calls []matcherCall
}

type matcherCall struct {
	rut      string
	courseID int64
}

func (m *fakeMatcher) MatchByRUT(_ context.Context, rut string, courseID int64) (*int64, error) {
	m.calls = append(m.calls, matcherCall{rut: rut, courseID: courseID})
	if m.fail != nil {
		return nil, m.fail
	}
	id, ok := m.byRUT[rut]
	if !ok {
		return nil, nil
	}
	return &id, nil
}

// Every reading the analyse produced is offered to the matcher, and the
// ones that match get their student written.
func TestRematchMatchesEveryReadingAgainstTheControlsCourse(t *testing.T) {
	matcher := &fakeMatcher{byRUT: map[string]int64{"11222333": 42}}
	svc, _, readings, courseID := newMatchingService(t, matcher)
	ctx := context.Background()

	control := seedControlWithReadings(t, ctx, svc, readings, courseID, map[int]string{
		1: "11222333", // on the roster
		2: "99999999", // not on the roster
	})

	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings: %v", err)
	}

	if got := readings.studentOf(control.ID, 1); got == nil || *got != 42 {
		t.Errorf("copy 1 student = %v, want 42", got)
	}
	if got := readings.studentOf(control.ID, 2); got != nil {
		t.Errorf("copy 2 student = %d, want nil (that RUT is on no roster)", *got)
	}
	for _, call := range matcher.calls {
		if call.courseID != courseID {
			t.Errorf("the matcher was asked with course %d, want the control's course %d", call.courseID, courseID)
		}
	}
}

// The professor's typed RUT wins over what AMC read.
//
// effectiveRUT is already the single answer to "what RUT does this copy
// carry" for the grade, the annotated PDF and the review page. Matching
// asking a different question would let a copy be graded under the typed
// RUT and filed under the misread one.
func TestMatchingUsesTheOverrideRatherThanWhatAMCRead(t *testing.T) {
	matcher := &fakeMatcher{byRUT: map[string]int64{"11222333": 42}}
	svc, _, readings, courseID := newMatchingService(t, matcher)
	ctx := context.Background()

	control := seedControlWithReadings(t, ctx, svc, readings, courseID, map[int]string{
		1: "77777777", // what AMC read, wrongly
	})
	readings.setOverride(control.ID, 1, "11222333") // what the professor typed

	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings: %v", err)
	}

	if got := readings.studentOf(control.ID, 1); got == nil || *got != 42 {
		t.Errorf("copy 1 student = %v, want 42 (the override's RUT)", got)
	}
	if len(matcher.calls) != 1 || matcher.calls[0].rut != "11222333" {
		t.Errorf("the matcher was asked %v, want the overridden RUT", matcher.calls)
	}
}

// A reading that stops matching has its student CLEARED, not left behind.
//
// The write is authoritative rather than additive: a re-read at a
// different sensitivity can turn a confident RUT into an illegible one,
// and a stale student_id would keep the copy filed under somebody the
// current reading no longer names. Leaving it is how a grade reaches the
// wrong person after a reanalyse nobody thought changed anything.
func TestRematchClearsAStudentThatNoLongerMatches(t *testing.T) {
	matcher := &fakeMatcher{byRUT: map[string]int64{"11222333": 42}}
	svc, _, readings, courseID := newMatchingService(t, matcher)
	ctx := context.Background()

	control := seedControlWithReadings(t, ctx, svc, readings, courseID, map[int]string{
		1: "11222333",
	})
	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings: %v", err)
	}
	if got := readings.studentOf(control.ID, 1); got == nil || *got != 42 {
		t.Fatalf("precondition: copy 1 student = %v, want 42", got)
	}

	// The re-read no longer produces a usable RUT.
	readings.setRUT(control.ID, 1, "")
	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings again: %v", err)
	}
	if got := readings.studentOf(control.ID, 1); got != nil {
		t.Errorf("copy 1 student = %d after the RUT became illegible, want nil", *got)
	}
}

// A control with no course is skipped entirely — the matcher is never
// asked.
//
// Every control that predates migration 00015 is in this state. matching
// refuses course 0 on its own too; this case is about the layer above not
// even asking, so the log stays quiet and a 30-copy control does not
// produce 30 pointless calls on every analyse.
func TestRematchSkipsAControlWithNoCourse(t *testing.T) {
	matcher := &fakeMatcher{byRUT: map[string]int64{"11222333": 42}}
	svc, _, readings, _ := newMatchingService(t, matcher)
	ctx := context.Background()

	control := seedControlWithReadings(t, ctx, svc, readings, 0, map[int]string{
		1: "11222333",
	})

	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings: %v", err)
	}
	if len(matcher.calls) != 0 {
		t.Errorf("the matcher was asked %v for a control with no course, want no calls", matcher.calls)
	}
	if got := readings.studentOf(control.ID, 1); got != nil {
		t.Errorf("copy 1 student = %d, want nil", *got)
	}
}

// A matcher failure does not fail the analyse, and does not clear what is
// already there.
//
// The readings are already committed by the time matching runs, and they
// are the artefact that cannot be reproduced without re-scanning. An
// outage in the roster lookup must leave the copies exactly as the read
// left them: unmatched ones stay unmatched (the reconciliation queue
// shows them), and matched ones keep the association a working lookup
// established. Writing nil here would silently un-file a whole control
// because a database blinked.
//
// Same policy, and the same reason, as annotateCleanCopies being
// best-effort.
func TestAMatcherFailureLeavesTheReadingsAloneAndDoesNotFailTheAnalyse(t *testing.T) {
	matcher := &fakeMatcher{byRUT: map[string]int64{"11222333": 42}}
	svc, _, readings, courseID := newMatchingService(t, matcher)
	ctx := context.Background()

	control := seedControlWithReadings(t, ctx, svc, readings, courseID, map[int]string{
		1: "11222333",
	})
	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings: %v", err)
	}

	matcher.fail = errors.New("the roster database is gone")
	if err := svc.RematchReadings(ctx, control.ID); err != nil {
		t.Fatalf("RematchReadings returned an error on a matcher outage: %v; "+
			"matching is an enrichment and must not fail the read", err)
	}
	if got := readings.studentOf(control.ID, 1); got == nil || *got != 42 {
		t.Errorf("copy 1 student = %v after a matcher outage, want the association to survive", got)
	}
}
