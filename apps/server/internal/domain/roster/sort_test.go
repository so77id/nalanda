package roster_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/roster"
)

// SortEnrollments is the roster's ordering policy, and it lives here rather
// than in the store's SQL for a measured reason: SQLite's BINARY collation
// sorts every accented surname after every unaccented one, so `ÁVILA MUÑOZ`
// came after `ZUNIGA PEREZ` on a real roster (#271 review, COR-7).
//
// These cases live in the roster package, not in coursestore's, because the
// rule is the domain's. Applied from the store it was an obligation every
// future implementer of roster.Store had to remember, guarded only by one
// adapter's tests — deleting the call left this whole package green
// (#271 review, ARQ-9).

func enrolled(id int64, last, first string) roster.Enrollment {
	return roster.Enrollment{
		State:   roster.StateEnrolled,
		Student: roster.Student{ID: id, LastName: last, FirstName: first},
	}
}

func withdrawn(id int64, last, first string) roster.Enrollment {
	e := enrolled(id, last, first)
	e.State = roster.StateWithdrawn
	return e
}

func surnames(enrollments []roster.Enrollment) []string {
	out := make([]string, 0, len(enrollments))
	for _, e := range enrollments {
		out = append(out, e.Student.LastName)
	}
	return out
}

func TestSortEnrollmentsFoldsAccentsRatherThanSortingThemAfterZ(t *testing.T) {
	got := []roster.Enrollment{
		enrolled(1, "ZUNIGA PEREZ", "ANA"),
		enrolled(2, "ÁVILA MUÑOZ", "BEATRIZ"),
		enrolled(3, "BRAVO SOTO", "CARLA"),
		enrolled(4, "MUÑOZ ÁVILA", "DIEGO"),
		enrolled(5, "ÑUÑEZ ROJAS", "ELENA"),
		enrolled(6, "ORDÓÑEZ LARA", "FELIPE"),
	}
	roster.SortEnrollments(got)

	want := []string{
		"ÁVILA MUÑOZ", "BRAVO SOTO", "ÑUÑEZ ROJAS",
		"ORDÓÑEZ LARA", "MUÑOZ ÁVILA", "ZUNIGA PEREZ",
	}
	for i := range want {
		if surnames(got)[i] != want[i] {
			t.Fatalf("order = %v, want %v", surnames(got), want)
		}
	}
}

// Enrolled before withdrawn, whatever the surname says. A student who
// dropped is not the first name a professor should read.
func TestSortEnrollmentsPutsEveryEnrolledStudentFirst(t *testing.T) {
	got := []roster.Enrollment{
		withdrawn(1, "ÁVILA MUÑOZ", "ANA"),
		enrolled(2, "ZUNIGA PEREZ", "BEATRIZ"),
		withdrawn(3, "BRAVO SOTO", "CARLA"),
		enrolled(4, "MUÑOZ ÁVILA", "DIEGO"),
	}
	roster.SortEnrollments(got)

	if got[0].State != roster.StateEnrolled || got[1].State != roster.StateEnrolled {
		t.Fatalf("states = %q, %q, %q, %q; want both enrolled first",
			got[0].State, got[1].State, got[2].State, got[3].State)
	}
	// And within each group, the folded surname still decides.
	if got[0].Student.LastName != "MUÑOZ ÁVILA" || got[2].Student.LastName != "ÁVILA MUÑOZ" {
		t.Errorf("order = %v, want SÁNCHEZ then ZUNIGA, then ÁVILA then BRAVO", surnames(got))
	}
}

// Given names break a surname tie, and both are folded.
func TestSortEnrollmentsBreaksASurnameTieOnTheGivenName(t *testing.T) {
	got := []roster.Enrollment{
		enrolled(1, "MUÑOZ", "ÓSCAR"),
		enrolled(2, "MUÑOZ", "ANA"),
		enrolled(3, "MUÑOZ", "ELENA"),
	}
	roster.SortEnrollments(got)

	var given []string
	for _, e := range got {
		given = append(given, e.Student.FirstName)
	}
	want := []string{"ANA", "ELENA", "ÓSCAR"}
	for i := range want {
		if given[i] != want[i] {
			t.Fatalf("given names = %v, want %v", given, want)
		}
	}
}

// The order is TOTAL: two people whose folded names are identical — MUÑOZ
// and MUNOZ fold to the same key — still land in a fixed order, because the
// student id is the final comparison. Without it the pair kept whatever
// order the store's scan produced, and the withdraw UPDATE rewrites rows,
// so it could swap between page loads (#271 review, COR-NEW-3).
func TestSortEnrollmentsIsTotalWhenTwoFoldedNamesAreEqual(t *testing.T) {
	first := []roster.Enrollment{
		enrolled(7, "MUNOZ", "ANA"),
		enrolled(3, "MUÑOZ", "ANA"),
	}
	second := []roster.Enrollment{
		enrolled(3, "MUÑOZ", "ANA"),
		enrolled(7, "MUNOZ", "ANA"),
	}
	roster.SortEnrollments(first)
	roster.SortEnrollments(second)

	if first[0].Student.ID != 3 || second[0].Student.ID != 3 {
		t.Errorf("the two input orders produced %d and %d first; the order is not total",
			first[0].Student.ID, second[0].Student.ID)
	}
}

// Empty names sort rather than panic: SplitSortableName leaves the given
// name empty when Canvas's sortableName carries no comma (ADR-0069
// §Decision 3), so this is a shape the roster really holds.
func TestSortEnrollmentsHandlesEmptyNamesAndAnEmptySlice(t *testing.T) {
	roster.SortEnrollments(nil)
	roster.SortEnrollments([]roster.Enrollment{})

	got := []roster.Enrollment{
		enrolled(1, "BRAVO SOTO", ""),
		enrolled(2, "", ""),
		enrolled(3, "ÁVILA MUÑOZ", "ANA"),
	}
	roster.SortEnrollments(got)

	if got[0].Student.LastName != "" {
		t.Errorf("order = %v, want the empty surname first", surnames(got))
	}
}
