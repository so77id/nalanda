package canvas

import (
	"strings"
)

// Course is one course as Canvas describes it. The picker (S5) renders
// these and creates a `course` row from the one the professor chooses; no
// field is ever typed by a human.
type Course struct {
	// CanvasID is Canvas's own `_id`, kept as text (see migration 00014 on
	// why the column is TEXT).
	CanvasID string
	Name     string
	// Code is Canvas's `courseCode`, e.g. "CIT2006_CA01".
	Code string
	// Term is the academic period's name, e.g. "2026-2". Empty when the
	// course sits in Canvas's default term, which is what the professor's
	// non-teaching courses do.
	Term string
	// TermStart orders the picker: most recent term first, terms without a
	// start last. RFC 3339 as Canvas sends it, compared as a string —
	// which is correct for that format and avoids parsing a value whose
	// only job is to sort (ADR-0069 §Decision 5).
	TermStart string
}

// Student is one person on a roster, normalised into the shape migration
// 00014 stores. Everything here is derived by RosterFrom* below rather than
// by the caller, so the rules ADR-0069 fixes have exactly one home.
type Student struct {
	FirstName string
	LastName  string
	Email     string

	// RUT is the eight-digit body and RUTDV its verifier — the split
	// ADR-0069 §Decision 1 records. Both are empty together when Canvas's
	// sisId did not fit the shape: an unmatchable student is a visible
	// gap, and a guessed RUT would be a wrong match on a real person's
	// grades.
	RUT   string
	RUTDV string

	CanvasUserID       string
	CanvasEnrollmentID string
}

// HasRUT reports whether this student can be matched to a reading at all.
func (s Student) HasRUT() bool { return s.RUT != "" }

// SplitSISID turns Canvas's `user.sisId` into the (body, verifier) pair the
// schema stores, per ADR-0069 §Decision 2.
//
// Canvas holds the RUT with its verifier attached and no separators —
// `112223335`, `11222444K` — while the printed sheet reads
// `\AMCcode{rut}{8}`, eight digits and no verifier. So the last character
// is the verifier, uppercased, and the rest is the body, left-padded to
// eight digits because AMC's code field is fixed width and a seven-digit
// RUT reaches the sheet as `09876543`.
//
// WHAT IT REFUSES, and what it does not. A body that is not digits, longer
// than eight digits, or a verifier that is neither a digit nor K, returns
// two empty strings — never a partial result, since a body without its
// verifier is a half-record the schema refuses anyway.
//
// It does NOT refuse a SHORT numeric id, and that is a known gap rather
// than an oversight (#271 review, COR-3). `"15"` becomes `00000001-5` and
// `"20231234"` becomes `02023123-4`: well-formed RUTs that no person owns.
// Worse, `"10"` and `"11"` both yield the body `00000001`, so two such ids
// in one course collide on `student.rut`'s UNIQUE and abort the whole
// import — the one outcome ADR-0069 §Consequences promises cannot happen.
//
// No length floor closes it. A minimum body of seven keeps ADR-0069's
// zero-padding case (`sisId "98765432"` → `09876543`) but still admits
// `"20231234"`, whose body is also seven digits; a minimum of eight catches
// that one and breaks both the ADR and the test pinning it. The only guard
// that actually discriminates is a modulus-11 check of the verifier against
// the body, which is a design decision this WP did not take — ADR-0069
// rejected COMPUTING the verifier instead of storing it, which is a
// different question from validating it.
//
// Left as a documented gap because no short `sisId` has ever been observed:
// all 25 measured are nine characters, a passport identifier carries
// letters and is already refused, and Canvas's own Test Student arrives as
// a `StudentViewEnrollment` and never reaches here. The WP that adds the
// mod-11 check inherits this paragraph.
func SplitSISID(sisID string) (rut, dv string) {
	// Separators are tolerated on the way in — a Canvas that starts
	// sending "11.222.333-5" would otherwise silently produce a roster
	// where nobody matches. Nothing observed in the S4 spike had them;
	// stripping is one line and turns a whole-course failure into none.
	trimmed := strings.Map(func(r rune) rune {
		if r == '.' || r == '-' || r == ' ' {
			return -1
		}
		return r
	}, strings.TrimSpace(sisID))
	if len(trimmed) < 2 {
		return "", ""
	}

	body, verifier := trimmed[:len(trimmed)-1], strings.ToUpper(trimmed[len(trimmed)-1:])
	if verifier != "K" && !isDigits(verifier) {
		return "", ""
	}
	if !isDigits(body) || len(body) > 8 {
		return "", ""
	}
	// Left-pad rather than reject: the sheet prints eight boxes whatever
	// the RUT's length, so the eight-digit form is the one a reading can
	// hold.
	return strings.Repeat("0", 8-len(body)) + body, verifier
}

// SplitSortableName turns Canvas's `user.sortableName` into surnames and
// given names, per ADR-0069 §Decision 3.
//
// Canvas states the boundary as "APELLIDOS, NOMBRES", measured on 25 of 25
// students. `user.name` only implies it, and no positional rule can find it
// there: a Chilean name carries two surnames and "PABLO ANDRÉS GONZÁLEZ
// OJEDA" has no marker saying where the given names stop.
//
// A sortableName with no comma keeps the whole string as the surname and
// leaves the given names empty. Wrong-but-visible beats a guessed split
// down the middle of somebody's name.
func SplitSortableName(sortable string) (firstName, lastName string) {
	surnames, given, found := strings.Cut(sortable, ",")
	if !found {
		return "", strings.TrimSpace(sortable)
	}
	return strings.TrimSpace(given), strings.TrimSpace(surnames)
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
