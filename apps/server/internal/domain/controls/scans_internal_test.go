package controls

import (
	"os"
	"path/filepath"
	"testing"
)

// The batch naming contract is stated in nextBatchNumber's docstring:
// max+1 of existing batch-N.pdf, empty dir → 1, non-matching files
// ignored. This pins it against surprise.
func TestNextBatchNumberIsMaxPlusOne(t *testing.T) {
	dir := t.TempDir()
	if n, _ := nextBatchNumber(dir); n != 1 {
		t.Errorf("empty dir → %d, want 1", n)
	}

	touch(t, dir, "batch-1.pdf", "batch-2.pdf")
	if n, _ := nextBatchNumber(dir); n != 3 {
		t.Errorf("{1,2} → %d, want 3", n)
	}

	// Deleting the highest brings the counter back — the uploads dir IS
	// the persisted state.
	if err := os.Remove(filepath.Join(dir, "batch-2.pdf")); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if n, _ := nextBatchNumber(dir); n != 2 {
		t.Errorf("{1} after 2 deleted → %d, want 2", n)
	}

	// Non-matching filenames are ignored.
	touch(t, dir, "notes.txt", "batch-abc.pdf", "batch-0.pdf")
	if n, _ := nextBatchNumber(dir); n != 2 {
		t.Errorf("with noise → %d, want 2", n)
	}
}

func touch(t *testing.T, dir string, names ...string) {
	t.Helper()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), nil, 0o644); err != nil {
			t.Fatalf("touch %s: %v", n, err)
		}
	}
}
