package matching_test

import (
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/matching"
)

// The whole table of what NormalizeRUT accepts and what it refuses.
//
// The column it produces is `student.rut`: exactly eight digits, no
// verifier, zero-padded (migration 00014). Anything that cannot become
// that is refused rather than approximated — a wrong eight digits matches
// somebody, and matching the wrong person is the one failure this whole
// subsystem exists to avoid.
func TestNormalizeRUT(t *testing.T) {
	for _, c := range []struct {
		name string
		in   string
		want string
		ok   bool
	}{
		// The AMC shape: what \AMCcode{rut}{8} prints and what
		// reading.rut_read holds. Eight digits, already the body.
		{"eight digits are the body", "11222333", "11222333", true},
		{"eight digits with a leading zero", "09876543", "09876543", true},

		// What a professor might type in the review page's RUT field.
		{"dotted with a separated verifier", "11.222.333-5", "11222333", true},
		{"undotted with a separated verifier", "11222333-5", "11222333", true},
		{"nine digits carry a verifier", "112223335", "11222333", true},
		{"a K verifier is a verifier", "11222444K", "11222444", true},
		{"a lowercase k is folded", "11222444k", "11222444", true},
		{"a separated K", "11222444-K", "11222444", true},

		// Seven-digit RUTs reach the sheet zero-padded, because AMC's
		// code field is fixed width (00014's own comment).
		{"seven digits pad to eight", "9876543", "09876543", true},
		{"seven digits with a verifier pad to eight", "9.876.543-5", "09876543", true},
		{"seven digits and a K pad to eight", "1122444K", "01122444", true},

		{"surrounding whitespace is trimmed", "  11222333  ", "11222333", true},

		// Refusals. Each returns false rather than a best guess.
		{"empty", "", "", false},
		{"letters", "abcdefgh", "", false},
		{"a letter that is not K", "11222444X", "", false},
		{"ten characters is too long", "1122233345", "", false},
		{"a separator in the wrong place", "11-222-333", "", false},
		// The verifier-SHAPE guard, which the docstring names by example
		// and which no case reached: deleting the three lines that
		// enforce it left the whole suite green (#272 review, COR-5).
		{"a two-character verifier is not a verifier", "11222333-99", "", false},
		{"a two-character verifier with a K", "11222333-KK", "", false},
		{"a verifier that is a letter other than K", "11222333-X", "", false},
		{"a verifier with no body", "-5", "", false},
		{"only a verifier", "K", "", false},

		// THE ACCEPTED GAP, pinned as a decision rather than left in a
		// paragraph (#272 review, COR-5). A seven-digit RUT typed with
		// its verifier and NO separator is indistinguishable from an
		// eight-digit body, and this function reads it as the body. The
		// trade is deliberate — see NormalizeRUT's docstring — and the
		// consequence is a copy that matches the owner of those eight
		// digits or nobody, never a guess. A future change that starts
		// stripping here has to come through this row.
		{"seven digits plus an unseparated verifier read as the body", "11222335", "11222335", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, ok := matching.NormalizeRUT(c.in)
			if ok != c.ok {
				t.Fatalf("NormalizeRUT(%q) ok = %v, want %v (got %q)", c.in, ok, c.ok, got)
			}
			if got != c.want {
				t.Errorf("NormalizeRUT(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// Eight bare digits are the BODY, never a seven-digit body plus its
// verifier — and this is the decision the whole function turns on.
//
// canvas.SplitSISID makes the opposite call for the opposite reason: its
// input is Canvas's `user.sisId`, which ADR-0069 measured as always
// carrying the verifier, so its last character always IS one. Feeding an
// AMC reading through it would take `11222333` — eight digits off the
// printed sheet — and return the body `01122233`, which is a DIFFERENT
// person's RUT, or nobody's.
//
// That is not a hypothetical: the two functions have the same shape, live
// two packages apart, and the wrong one is one import away. This case
// exists so the day somebody "removes the duplication" the suite says
// what it costs.
func TestEightDigitsAreTheBodyUnlikeCanvasSISIDs(t *testing.T) {
	const fromTheSheet = "11222333"

	got, ok := matching.NormalizeRUT(fromTheSheet)
	if !ok {
		t.Fatalf("NormalizeRUT(%q) refused an ordinary AMC reading", fromTheSheet)
	}
	if got != fromTheSheet {
		t.Fatalf("NormalizeRUT(%q) = %q, want the digits unchanged", fromTheSheet, got)
	}

	// The same input through the Canvas splitter, which is correct there
	// and catastrophic here.
	canvasBody, canvasDV := canvas.SplitSISID(fromTheSheet)
	if canvasBody == got {
		t.Fatal("canvas.SplitSISID now agrees with NormalizeRUT on eight bare digits; " +
			"if that is deliberate, this case and the comment above it need rewriting")
	}
	if canvasBody != "01122233" || canvasDV != "3" {
		t.Errorf("canvas.SplitSISID(%q) = (%q, %q), want (01122233, 3) — "+
			"the contract this case contrasts against has changed",
			fromTheSheet, canvasBody, canvasDV)
	}
}
