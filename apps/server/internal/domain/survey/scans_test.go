package survey_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/files"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore"
	"github.com/so77id/nalanda/apps/server/internal/infra/filestore/s3test"
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

// openRunStore answers one open run, so SaveUploadedBatch reaches its
// numbering.
type openRunStore struct{ *memStore }

func (openRunStore) Run(_ context.Context, surveyID, runID int64) (survey.Run, error) {
	return survey.Run{ID: runID, SurveyID: surveyID, State: survey.RunOpen}, nil
}

func uploadTo(t *testing.T, svc *survey.Service) (string, error) {
	t.Helper()
	return svc.SaveUploadedBatch(context.Background(), 1, 2, io.NopCloser(strings.NewReader("%PDF-hojas")))
}

// Issue #338, AC-6 for a run: the same destructive bug as the controls'. A
// volume that came back empty must not hand out batch-1.pdf again while the
// store holds it.
func TestARunsNewBatchNumbersPastTheBatchesTheStoreHolds(t *testing.T) {
	work := t.TempDir()
	bucket := s3test.New()
	bucket.Put("work/surveys/1/runs/2/uploads/batch-1.pdf", []byte("uno"))
	bucket.Put("work/surveys/1/runs/2/uploads/batch-2.pdf", []byte("dos"))
	svc := survey.NewService(survey.Service{
		Store: openRunStore{newMemStore()}, Generator: noGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewS3(bucket, "nalanda-test"), Now: time.Now,
	})

	name, err := uploadTo(t, svc)
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	if name != "batch-3.pdf" {
		t.Errorf("the new batch is %s, want batch-3.pdf", name)
	}
	if _, err := os.Stat(filepath.Join(work, survey.RunProject(1, 2), "uploads", "batch-3.pdf")); err != nil {
		t.Errorf("the batch was not written where its number says: %v", err)
	}
}

func TestARunsNewBatchNumbersPastTheBatchesOnDiskThatTheStoreLacks(t *testing.T) {
	work := t.TempDir()
	uploads := filepath.Join(work, survey.RunProject(1, 2), "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploads, "batch-4.pdf"), []byte("cuatro"), 0o644); err != nil {
		t.Fatal(err)
	}
	bucket := s3test.New()
	bucket.Put("work/surveys/1/runs/2/uploads/batch-1.pdf", []byte("uno"))
	svc := survey.NewService(survey.Service{
		Store: openRunStore{newMemStore()}, Generator: noGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewS3(bucket, "nalanda-test"), Now: time.Now,
	})

	name, err := uploadTo(t, svc)
	if err != nil {
		t.Fatalf("SaveUploadedBatch: %v", err)
	}
	if name != "batch-5.pdf" {
		t.Errorf("the new batch is %s, want batch-5.pdf — batch-4 is on disk", name)
	}
}

func TestARunsUploadIsRefusedWhenTheStoreCannotListItsBatches(t *testing.T) {
	work := t.TempDir()
	bucket := s3test.New()
	bucket.FailOn = func(op, _ string) error {
		if op == "ListObjectsV2" {
			return errors.New("dial tcp: i/o timeout")
		}
		return nil
	}
	svc := survey.NewService(survey.Service{
		Store: openRunStore{newMemStore()}, Generator: noGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewS3(bucket, "nalanda-test"), Now: time.Now,
	})

	if _, err := uploadTo(t, svc); err == nil {
		t.Fatal("SaveUploadedBatch numbered a batch without knowing the store's")
	}
	entries, _ := os.ReadDir(filepath.Join(work, survey.RunProject(1, 2), "uploads"))
	if len(entries) != 0 {
		t.Errorf("a refused upload wrote %d file(s)", len(entries))
	}
}

// syncFailingGenerator is a worker client whose file store could not be
// brought in step (issue #338).
type syncFailingGenerator struct{ noGenerator }

func (syncFailingGenerator) GenerateSheet(context.Context, survey.GenerateRequest) (survey.Assets, error) {
	return survey.Assets{}, fmt.Errorf("%w: put work/surveys/1/runs/2/out/sujet.pdf: dial tcp: i/o timeout", files.ErrSync)
}

// AC-7 for a run: the job says, in Spanish, that S3 was not reached and the
// files are on the Jetson — not "the generator refused".
func TestARunsSyncFailureFailsItsJobInSpanish(t *testing.T) {
	work := t.TempDir()
	svc := survey.NewService(survey.Service{
		Store: openRunStore{newMemStore()}, Generator: syncFailingGenerator{}, Analyzer: noGenerator{},
		WorkDir: work, Files: filestore.NewLocal(work), Now: time.Now,
	})
	err := survey.NewGenerateHandler(svc)(context.Background(), "2", []byte(`{"survey_id":1}`))
	var failure *jobs.Failure
	if !errors.As(err, &failure) {
		t.Fatalf("the handler returned %v, want a *jobs.Failure", err)
	}
	if !strings.Contains(failure.Message, "S3") || !strings.Contains(failure.Message, "Jetson") || strings.Contains(failure.Message, "dial tcp") {
		t.Errorf("banner = %q", failure.Message)
	}
}

// allRunsStore answers two runs of two surveys.
type allRunsStore struct{ *memStore }

func (allRunsStore) AllRuns(context.Context) ([]survey.Run, error) {
	return []survey.Run{{ID: 2, SurveyID: 1}, {ID: 7, SurveyID: 3}}, nil
}

func TestRunProjectPathsNamesEveryRunAsAStorePath(t *testing.T) {
	got, err := survey.RunProjectPaths(context.Background(), allRunsStore{newMemStore()})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "surveys/1/runs/2" || got[1] != "surveys/3/runs/7" {
		t.Errorf("RunProjectPaths = %v", got)
	}
}
