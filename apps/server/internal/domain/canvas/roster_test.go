package canvas_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
)

// The two normalisations ADR-0069 fixes. Every case here is either a value
// MEASURED on the real UDP Canvas in the S4 spike, or a shape the spike
// showed the schema must refuse.

func TestSplitSISIDTakesTheVerifierOffTheBody(t *testing.T) {
	for _, c := range []struct {
		name    string
		sisID   string
		wantRUT string
		wantDV  string
	}{
		// The four shapes actually observed on course CIT2006_CA01, 2026-2.
		{"a measured student", "112223335", "11222333", "5"},
		{"another measured student", "115556667", "11555666", "3"},
		{"a measured student with a K verifier", "11222444K", "11222444", "K"},
		{"a measured student ending in 2", "116667778", "11666777", "2"},

		// Shapes the importer must handle rather than pass through.
		{"a lowercase k is folded", "11222444k", "11222444", "K"},
		{"a seven-digit RUT is padded to the eight the sheet prints", "98765432", "09876543", "2"},
		{"surrounding whitespace", "  112223335  ", "11222333", "5"},
		{"a formatted RUT, should Canvas ever send one", "11.222.333-5", "11222333", "5"},

		// Shapes that yield nothing at all. A partial result would be a
		// half-record the schema refuses anyway, and a guessed one would be
		// a wrong match on a real person's grades.
		{"empty", "", "", ""},
		{"a single character", "5", "", ""},
		{"a body longer than eight digits", "1234567890", "", ""},
		{"a letter that is not K", "11222333X", "", ""},
		{"letters in the body", "2231A062-5", "", ""},
		{"a passport-shaped identifier", "AB1234567", "", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			rut, dv := canvas.SplitSISID(c.sisID)
			if rut != c.wantRUT || dv != c.wantDV {
				t.Errorf("SplitSISID(%q) = (%q, %q), want (%q, %q)",
					c.sisID, rut, dv, c.wantRUT, c.wantDV)
			}
			// The pair travels together or not at all — the invariant the
			// schema's CHECK((rut IS NULL) = (rut_dv IS NULL)) enforces one
			// layer down. A half-answer here would be refused on INSERT,
			// which is a failed import rather than an unmatchable student.
			if (rut == "") != (dv == "") {
				t.Errorf("SplitSISID(%q) returned half a RUT: (%q, %q)", c.sisID, rut, dv)
			}
			if rut != "" && len(rut) != 8 {
				t.Errorf("SplitSISID(%q) returned a %d-digit body; the sheet prints eight", c.sisID, len(rut))
			}
		})
	}
}

func TestSplitSortableNameUsesTheCommaCanvasProvides(t *testing.T) {
	for _, c := range []struct {
		name      string
		sortable  string
		wantFirst string
		wantLast  string
	}{
		// Measured on the real roster: two surnames, two given names.
		{"two surnames and two given names", "PEREZ SOTO, ANA MARÍA", "ANA MARÍA", "PEREZ SOTO"},
		{"accented surnames", "GÓMEZ LARA, CARLA BEATRIZ", "CARLA BEATRIZ", "GÓMEZ LARA"},
		{"one given name", "MUÑOZ ÁVILA, ELENA", "ELENA", "MUÑOZ ÁVILA"},

		// A comma is what Canvas states; without one there is nothing to
		// infer. Keeping the whole string as the surname is wrong in a way
		// a professor SEES on the roster page — a split down the middle of
		// a name would be wrong in a way nobody notices.
		{"no comma at all", "ANA CAMUS", "", "ANA CAMUS"},
		{"empty", "", "", ""},

		// A trailing comma with nothing after it is not a given name.
		{"a comma with nothing after it", "PEREZ SOTO,", "", "PEREZ SOTO"},
	} {
		t.Run(c.name, func(t *testing.T) {
			first, last := canvas.SplitSortableName(c.sortable)
			if first != c.wantFirst || last != c.wantLast {
				t.Errorf("SplitSortableName(%q) = (%q, %q), want (%q, %q)",
					c.sortable, first, last, c.wantFirst, c.wantLast)
			}
		})
	}
}

func TestHasRUTReportsWhetherAStudentCanBeMatched(t *testing.T) {
	if (canvas.Student{RUT: "11222333", RUTDV: "5"}).HasRUT() != true {
		t.Error("a student with a RUT reports HasRUT() false")
	}
	if (canvas.Student{}).HasRUT() != false {
		t.Error("a student without a RUT reports HasRUT() true")
	}
}
