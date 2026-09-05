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
		{"the shape measured on 25 of 25 students", "112223335", "11222333", "5"},
		{"another synthetic student", "115556667", "11555666", "7"},
		{"the K verifier, 4 of 25 measured", "11222444K", "11222444", "K"},
		{"a synthetic student ending in 8", "116667778", "11666777", "8"},

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

// COR-3. The known gap, pinned so it is VISIBLE rather than merely absent:
// a short numeric sisId becomes a well-formed RUT that no person owns, and
// two of them can collide on `student.rut`'s UNIQUE and abort a whole
// import — the one outcome ADR-0069 §Consequences promises cannot happen.
//
// The behaviour is asserted as it IS, not as it should be, because no
// length rule fixes it: a minimum body of seven keeps the ADR's pinned
// zero-padding case and still admits "20231234"; a minimum of eight catches
// that one and breaks the ADR. The guard that would discriminate is a
// modulus-11 check of the verifier, which is a design decision this WP did
// not take. The WP that takes it inherits this test and inverts it.
func TestSplitSISIDCurrentlyFabricatesARutFromAShortNumericID(t *testing.T) {
	for _, c := range []struct {
		sisID   string
		wantRUT string
		wantDV  string
	}{
		{"00", "00000000", "0"},
		{"15", "00000001", "5"},
		{"12345", "00001234", "5"},
		{"20231234", "02023123", "4"},
	} {
		rut, dv := canvas.SplitSISID(c.sisID)
		if rut != c.wantRUT || dv != c.wantDV {
			t.Errorf("SplitSISID(%q) = (%q, %q), want (%q, %q) — this pins the KNOWN GAP, "+
				"so a change here means somebody closed it and should invert this case",
				c.sisID, rut, dv, c.wantRUT, c.wantDV)
		}
	}

	// The collision the gap produces: two different ids, one body.
	first, _ := canvas.SplitSISID("10")
	second, _ := canvas.SplitSISID("11")
	if first != second {
		t.Errorf("SplitSISID(\"10\") = %q and SplitSISID(\"11\") = %q no longer collide; "+
			"if that is deliberate, this case and the doc comment both need updating", first, second)
	}
}
