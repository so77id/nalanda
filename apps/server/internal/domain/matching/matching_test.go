package matching_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/matching"
)

// fakeStore answers the one question the domain asks, out of a map keyed
// by (rut, course). Anything not in the map is "nobody enrolled here
// carries that RUT" — which is what the real query returns for a
// withdrawn student and for one enrolled on a different course.
type fakeStore struct {
	byRUTAndCourse map[string]map[int64]int64
	fail           error
	// asked records every RUT the service handed down, so a case can
	// assert the store was NOT consulted for input the domain should
	// have refused on its own.
	asked []string
}

func (s *fakeStore) EnrolledStudentByRUT(_ context.Context, rut string, courseID int64) (int64, bool, error) {
	s.asked = append(s.asked, rut)
	if s.fail != nil {
		return 0, false, s.fail
	}
	id, ok := s.byRUTAndCourse[rut][courseID]
	return id, ok, nil
}

func newService(students map[string]map[int64]int64) (*matching.Service, *fakeStore) {
	store := &fakeStore{byRUTAndCourse: students}
	return matching.NewService(store), store
}

// The happy path: a RUT off the sheet resolves to the enrolled student
// who owns it.
func TestMatchByRUTFindsTheEnrolledStudent(t *testing.T) {
	svc, store := newService(map[string]map[int64]int64{
		"11222333": {7: 42},
	})

	got, err := svc.MatchByRUT(context.Background(), "11222333", 7)
	if err != nil {
		t.Fatalf("MatchByRUT: %v", err)
	}
	if got == nil {
		t.Fatal("MatchByRUT = nil, want student 42")
	}
	if *got != 42 {
		t.Errorf("MatchByRUT = %d, want 42", *got)
	}
	if len(store.asked) != 1 || store.asked[0] != "11222333" {
		t.Errorf("the store was asked for %v, want the normalised RUT once", store.asked)
	}
}

// Whatever the professor types resolves to the same eight digits before
// the store is asked. The normalisation is the domain's, not the query's
// — a store that received "11.222.333-5" would compare it against a
// column that holds "11222333" and find nothing, silently.
func TestMatchByRUTNormalisesBeforeAsking(t *testing.T) {
	for _, typed := range []string{"11222333", "11.222.333-5", "11222333-5", "112223335", " 11222333 "} {
		t.Run(typed, func(t *testing.T) {
			svc, store := newService(map[string]map[int64]int64{
				"11222333": {7: 42},
			})

			got, err := svc.MatchByRUT(context.Background(), typed, 7)
			if err != nil {
				t.Fatalf("MatchByRUT(%q): %v", typed, err)
			}
			if got == nil || *got != 42 {
				t.Fatalf("MatchByRUT(%q) = %v, want student 42", typed, got)
			}
			if len(store.asked) != 1 || store.asked[0] != "11222333" {
				t.Errorf("the store was asked for %v, want the normalised RUT", store.asked)
			}
		})
	}
}

// No match is not an error.
//
// It is the ordinary reconciliation case — an illegible RUT, a student
// who is not on this roster — and the caller's response to it is to leave
// student_id NULL and let the existing queue surface the copy. Returning
// an error would make every such copy look like a failure of the system
// rather than a copy needing a human.
func TestMatchByRUTReturnsNilWithoutAnErrorWhenNobodyMatches(t *testing.T) {
	svc, _ := newService(map[string]map[int64]int64{
		"11222333": {7: 42},
	})

	got, err := svc.MatchByRUT(context.Background(), "99999999", 7)
	if err != nil {
		t.Fatalf("MatchByRUT on an unknown RUT returned an error: %v", err)
	}
	if got != nil {
		t.Errorf("MatchByRUT = %d, want nil", *got)
	}
}

// The scope is the CONTROL'S course, and it is strict.
//
// A student enrolled on a different course does not match, even though
// student.rut is globally UNIQUE and the person is therefore
// unambiguously identified. Decided 2026-09-06: the association drives
// WP-3's emails, and a copy filed under someone who was never on this
// course is a grade delivered on the strength of a coincidence nobody
// checked.
func TestMatchByRUTDoesNotReachIntoAnotherCourse(t *testing.T) {
	svc, _ := newService(map[string]map[int64]int64{
		// The same person, enrolled on course 9 and not on course 7.
		"11222333": {9: 42},
	})

	got, err := svc.MatchByRUT(context.Background(), "11222333", 7)
	if err != nil {
		t.Fatalf("MatchByRUT: %v", err)
	}
	if got != nil {
		t.Errorf("MatchByRUT = %d for a student enrolled elsewhere, want nil", *got)
	}
}

// A RUT the domain cannot normalise never reaches the store.
//
// Both halves matter. Returning nil is what keeps an illegible reading in
// the reconciliation queue instead of erroring the whole analyse; not
// asking is what stops a half-cleaned string — "11-222-333", say — from
// being compared against the column and quietly matching nothing for a
// reason no log would explain.
func TestMatchByRUTRefusesUnusableInputWithoutTouchingTheStore(t *testing.T) {
	for _, raw := range []string{"", "   ", "abcdefgh", "1122233345", "11-222-333", "K"} {
		t.Run(raw, func(t *testing.T) {
			svc, store := newService(map[string]map[int64]int64{
				"11222333": {7: 42},
			})

			got, err := svc.MatchByRUT(context.Background(), raw, 7)
			if err != nil {
				t.Fatalf("MatchByRUT(%q) returned an error: %v", raw, err)
			}
			if got != nil {
				t.Errorf("MatchByRUT(%q) = %d, want nil", raw, *got)
			}
			if len(store.asked) != 0 {
				t.Errorf("the store was asked %v for an unusable RUT, want no query at all", store.asked)
			}
		})
	}
}

// A database failure IS an error, and is not flattened into "no match".
//
// The two outcomes look identical to a caller that only checks for nil,
// and they demand opposite responses: a no-match leaves the copy for a
// human, an outage means the answer is unknown and the caller must not
// write NULL as if it were one.
func TestMatchByRUTForwardsAStoreFailure(t *testing.T) {
	boom := errors.New("database is gone")
	store := &fakeStore{fail: boom}
	svc := matching.NewService(store)

	got, err := svc.MatchByRUT(context.Background(), "11222333", 7)
	if !errors.Is(err, boom) {
		t.Fatalf("MatchByRUT error = %v, want the store's failure", err)
	}
	if got != nil {
		t.Errorf("MatchByRUT = %d alongside an error, want nil", *got)
	}
}

// A control with no course cannot be matched against anything, and the
// domain says so before it asks.
//
// Every control that predates migration 00015 is in this state. Treating
// course 0 as a real scope would run a query that matches nobody and read
// as "this student is not enrolled", which is a different and misleading
// statement.
func TestMatchByRUTRefusesAnAbsentCourseWithoutTouchingTheStore(t *testing.T) {
	svc, store := newService(map[string]map[int64]int64{
		"11222333": {7: 42},
	})

	for _, courseID := range []int64{0, -1} {
		got, err := svc.MatchByRUT(context.Background(), "11222333", courseID)
		if err != nil {
			t.Fatalf("MatchByRUT with course %d returned an error: %v", courseID, err)
		}
		if got != nil {
			t.Errorf("MatchByRUT with course %d = %d, want nil", courseID, *got)
		}
	}
	if len(store.asked) != 0 {
		t.Errorf("the store was asked %v for a control with no course, want no query at all", store.asked)
	}
}

// The RUT never reaches the error text, and therefore never reaches the
// operator log.
//
// `docs/security-notes.md` §"Logs and personal data" (recorded
// 2026-08-26, #228) is explicit: any log line that would touch a RUT
// keeps the identifier out, because the Jetson's docker log rotation is
// where it would persist. This error is logged VERBATIM by
// controls.matchOne, and a rematch pass cancelled halfway — a closed tab
// is enough — would otherwise write one person's RUT per remaining copy.
//
// The case exists because the first version of this code did exactly
// that (#272 review, SEC-1). Nothing diagnostic is lost: the caller logs
// the control id and the copy number, which is what correlates two lines
// about one sheet.
func TestAStoreFailureNeverPutsTheRUTInTheError(t *testing.T) {
	const rut = "11222333"
	store := &fakeStore{fail: errors.New("database is locked")}
	svc := matching.NewService(store)

	_, err := svc.MatchByRUT(context.Background(), rut, 7)
	if err == nil {
		t.Fatal("MatchByRUT succeeded over a broken store")
	}
	if strings.Contains(err.Error(), rut) {
		t.Errorf("the error carries the RUT and will be logged verbatim: %q", err)
	}
	// The course id IS wanted — it is not personal data and it is what
	// tells an operator which roster the lookup was against.
	if !strings.Contains(err.Error(), "course 7") {
		t.Errorf("the error lost the course id, which is the diagnostic half: %q", err)
	}
}
