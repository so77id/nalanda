package controls

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
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

// Issue #204: UploadList reads the on-disk batch contract through the same
// batchNumber helper that names the next upload — two readers, one rule.
func TestUploadListReturnsContractMatchingBatchesInOrder(t *testing.T) {
	workDir := t.TempDir()
	svc := &Service{WorkDir: workDir, Files: filestore.NewLocal(workDir)}
	dir := filepath.Join(svc.ProjectDir("CTRLUPLOAD0000000000000000"), uploadsDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	// Noise: a non-contract name, a zero batch, a negative-ish name and a
	// directory — all ignored, like nextBatchNumber ignores them.
	touch(t, dir, "batch-2.pdf", "batch-1.pdf", "batch-10.pdf",
		"notas.txt", "batch-0.pdf", "batch-abc.pdf", "batch--1.pdf")
	if err := os.MkdirAll(filepath.Join(dir, "batch-3.pdf"), 0o755); err != nil {
		t.Fatalf("MkdirAll subdir: %v", err)
	}

	names, err := svc.UploadList(context.Background(), "CTRLUPLOAD0000000000000000")
	if err != nil {
		t.Fatalf("UploadList: %v", err)
	}
	want := []string{"batch-1.pdf", "batch-2.pdf", "batch-10.pdf"}
	if len(names) != len(want) {
		t.Fatalf("UploadList = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("UploadList[%d] = %q, want %q (full list %v)", i, names[i], want[i], names)
		}
	}
}

func TestUploadListIsEmptyWhenNothingWasUploaded(t *testing.T) {
	workDir := t.TempDir()
	svc := &Service{WorkDir: workDir, Files: filestore.NewLocal(workDir)}

	names, err := svc.UploadList(context.Background(), "CTRLUPLOAD0000000000000000")
	if err != nil {
		t.Fatalf("UploadList: %v", err)
	}
	if len(names) != 0 {
		t.Errorf("UploadList = %v, want empty — the uploads dir does not exist yet", names)
	}
}

// OpenUpload names the batch under the control's own uploads/ — the same
// directory SaveUploadedBatch writes it into.
func TestOpenUploadReadsUnderTheControlUploadsDir(t *testing.T) {
	workDir := t.TempDir()
	svc := &Service{WorkDir: workDir, Files: filestore.NewLocal(workDir)}
	dir := filepath.Join(workDir, "controls", "CTRLUPLOAD0000000000000000", "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "batch-1.pdf"), []byte("%PDF-batch"), 0o644); err != nil {
		t.Fatal(err)
	}

	f, err := svc.OpenUpload(context.Background(), "CTRLUPLOAD0000000000000000", "batch-1.pdf")
	if err != nil {
		t.Fatalf("OpenUpload: %v", err)
	}
	defer func() { _ = f.Close() }()
	got, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "%PDF-batch" {
		t.Errorf("OpenUpload read %q, want %q", got, "%PDF-batch")
	}
}
