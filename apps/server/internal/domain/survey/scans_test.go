package survey_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
)

// Issue #338: Uploads reads through the file store, so its contract is
// pinned here rather than left to the scans page that renders it — only
// batch-N.pdf names count, in batch order, each with its size.
func TestUploadsListsTheRunsBatchesInOrderWithTheirSize(t *testing.T) {
	work := t.TempDir()
	svc := survey.NewService(survey.Service{
		Store: newMemStore(), Generator: noGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewLocal(work), Now: time.Now,
	})
	dir := filepath.Join(work, survey.RunProject(1, 2), "uploads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"batch-10.pdf": "ten", "batch-2.pdf": "2", "notas.txt": "noise", "batch-abc.pdf": "noise",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	got, err := svc.Uploads(context.Background(), survey.Run{ID: 2, SurveyID: 1})
	if err != nil {
		t.Fatalf("Uploads: %v", err)
	}
	want := []survey.Upload{{Number: 2, Name: "batch-2.pdf", Bytes: 1}, {Number: 10, Name: "batch-10.pdf", Bytes: 3}}
	if len(got) != len(want) {
		t.Fatalf("Uploads = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Uploads[%d] = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestUploadsOfARunWithNoneIsEmpty(t *testing.T) {
	work := t.TempDir()
	svc := survey.NewService(survey.Service{
		Store: newMemStore(), Generator: noGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewLocal(work), Now: time.Now,
	})
	got, err := svc.Uploads(context.Background(), survey.Run{ID: 2, SurveyID: 1})
	if err != nil || len(got) != 0 {
		t.Errorf("Uploads of a run with no uploads dir = %+v, %v, want empty and nil", got, err)
	}
}
