package controls_test

import (
	"regexp"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The alphabet is base32-standard: A..Z plus 2..7. Nothing outside it must
// ever land in a URL segment.
var idAlphabet = regexp.MustCompile(`^[A-Z2-7]+$`)

func TestNewIDIsTwentySixBase32Characters(t *testing.T) {
	id, err := controls.NewID()
	if err != nil {
		t.Fatalf("NewID: %v", err)
	}
	if len(id) != controls.IDLength {
		t.Errorf("len(NewID) = %d, want %d", len(id), controls.IDLength)
	}
	if !idAlphabet.MatchString(id) {
		t.Errorf("NewID = %q, contains a character outside [A-Z2-7]", id)
	}
}

func TestNewIDIsUnique(t *testing.T) {
	// 128 bits of randomness: the birthday bound is at ~2^64 draws, so a
	// 10 000-draw sample colliding is astronomically unlikely — a hit here
	// would signal a broken PRNG, not a numerical accident.
	seen := make(map[string]bool, 10_000)
	for range 10_000 {
		id, err := controls.NewID()
		if err != nil {
			t.Fatalf("NewID: %v", err)
		}
		if seen[id] {
			t.Fatalf("NewID collided on %q in %d draws", id, len(seen)+1)
		}
		seen[id] = true
	}
}
