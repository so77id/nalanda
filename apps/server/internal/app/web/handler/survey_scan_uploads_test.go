package handler_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
)

// A run's batch in chunks (issue #339) — the controls' twin, held apart by
// ADR-0078: it lands as the run's next batch-N.pdf, written before the
// survey_analyse is queued, and only an OPEN run takes one, at start and
// again at complete.

// jsonDo drives one request from the page's script through the gate.
func (f *surveyFixture) jsonDo(method, target string, h http.HandlerFunc, body any, pathValues ...string) *httptest.ResponseRecorder {
	f.t.Helper()
	var encoded []byte
	switch b := body.(type) {
	case nil:
	case string:
		encoded = []byte(b)
	default:
		var err error
		if encoded, err = json.Marshal(b); err != nil {
			f.t.Fatalf("Marshal: %v", err)
		}
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: f.session})
	for i := 0; i+1 < len(pathValues); i += 2 {
		req.SetPathValue(pathValues[i], pathValues[i+1])
	}
	rec := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(rec, req)
	return rec
}

func (f *surveyFixture) startRunUpload(s survey.Survey, run survey.Run, start any) *httptest.ResponseRecorder {
	f.t.Helper()
	return f.jsonDo(http.MethodPost, handler.SurveyRunScanUploadsPathFor(s.ID, run.ID), f.handler.StartScanUpload,
		start, f.runValues(s, run)...)
}

func (f *surveyFixture) completeRunUpload(s survey.Survey, run survey.Run, uid string) *httptest.ResponseRecorder {
	f.t.Helper()
	return f.jsonDo(http.MethodPost, handler.SurveyRunScanUploadCompletePathFor(s.ID, run.ID, uid), f.handler.CompleteScanUpload,
		nil, append(f.runValues(s, run), "uid", uid)...)
}

func (f *surveyFixture) sendAll(uid string, source []byte) {
	f.t.Helper()
	for offset := 0; offset < len(source); offset += uploads.ChunkBytes {
		end := min(offset+uploads.ChunkBytes, len(source))
		if _, err := f.uploads.Append(f.professor.ID, uid, int64(offset), bytes.NewReader(source[offset:end])); err != nil {
			f.t.Fatalf("Append at %d: %v", offset, err)
		}
	}
}

func (f *surveyFixture) runBatches(s survey.Survey, run survey.Run) []string {
	f.t.Helper()
	list, _ := os.ReadDir(filepath.Join(f.worker.WorkDir, survey.RunProject(s.ID, run.ID), "uploads"))
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func (f *surveyFixture) incoming() []string {
	f.t.Helper()
	list, _ := os.ReadDir(filepath.Join(f.worker.WorkDir, uploads.DirName))
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func TestARunBatchUploadedInChunksIsSavedAndQueuedForReading(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	source := scanPDF(uploads.ChunkBytes + 4321)

	rec := f.startRunUpload(r.s, r.run, map[string]any{"size": len(source), "name": "hojas.pdf", "type": "application/pdf"})
	uid := uploadID(t, rec)
	if got := jsonBody(t, rec)["complete"]; got != handler.SurveyRunScanUploadCompletePathFor(r.s.ID, r.run.ID, uid) {
		t.Errorf("complete = %v, want this run's complete route", got)
	}
	f.sendAll(uid, source)

	rec = f.completeRunUpload(r.s, r.run, uid)

	if rec.Code != http.StatusOK {
		t.Fatalf("complete: status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	if got := jsonBody(t, rec)["redirect"]; got != handler.SurveyRunScansPathFor(r.s.ID, r.run.ID) {
		t.Errorf("redirect = %v, want the run's scans", got)
	}
	if got := flashOf(t, rec); !strings.Contains(got, "batch-1.pdf") {
		t.Errorf("flash = %q, want it to name batch-1.pdf", got)
	}
	saved, err := os.ReadFile(filepath.Join(f.worker.WorkDir, survey.RunProject(r.s.ID, r.run.ID), "uploads", "batch-1.pdf"))
	if err != nil {
		t.Fatalf("the batch is not on disk: %v", err)
	}
	if sha256.Sum256(saved) != sha256.Sum256(source) {
		t.Errorf("batch-1.pdf (%d bytes) is not the source (%d bytes)", len(saved), len(source))
	}
	job, err := f.jobs.LatestByKind(context.Background(), strconv.FormatInt(r.run.ID, 10), jobs.KindSurveyAnalyse)
	if err != nil || !strings.Contains(string(job.Payload), "batch-1.pdf") || job.SubjectKind != jobs.SubjectSurveyRun {
		t.Errorf("survey_analyse = %+v, %v; want one about batch-1.pdf of this run", job, err)
	}
	if left := f.incoming(); len(left) != 0 {
		t.Errorf("the partial outlived the batch: %v", left)
	}
}

// AC-6 for a run, plus the run's own gate: only an open run takes scans.
func TestStartingARunUploadRefusesBeforeAnyByte(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	cancelled := f.createRunThroughTheForm(r.s, "Cancelada")
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, cancelled.ID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	valid := map[string]any{"size": 1000, "name": "hojas.pdf"}

	for _, c := range []struct {
		name   string
		run    survey.Run
		values []string
		start  any
		status int
	}{
		{"a size above the cap", r.run, nil, map[string]any{"size": 5<<20 + 1, "name": "hojas.pdf"}, http.StatusRequestEntityTooLarge},
		{"a file that is not a PDF", r.run, nil, map[string]any{"size": 1000, "name": "hojas.docx"}, http.StatusBadRequest},
		{"a body that is not JSON", r.run, nil, "size=1000", http.StatusBadRequest},
		{"a run that is not open", cancelled, nil, valid, http.StatusConflict},
		{"a run that does not exist", r.run, []string{"id", strconv.FormatInt(r.s.ID, 10), "rid", "999"}, valid, http.StatusNotFound},
		{"a survey that does not exist", r.run, []string{"id", "999", "rid", strconv.FormatInt(r.run.ID, 10)}, valid, http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			values := c.values
			if values == nil {
				values = f.runValues(r.s, c.run)
			}
			rec := f.jsonDo(http.MethodPost, handler.SurveyRunScanUploadsPathFor(r.s.ID, c.run.ID), f.handler.StartScanUpload, c.start, values...)
			if rec.Code != c.status {
				t.Errorf("status = %d, want %d; body:\n%s", rec.Code, c.status, rec.Body.String())
			}
			if msg, _ := jsonBody(t, rec)["message"].(string); msg == "" {
				t.Error("the refusal carries no message for the page")
			}
			if left := f.incoming(); len(left) != 0 {
				t.Errorf("a refused start left %v", left)
			}
		})
	}
}

// A run cancelled while its batch was still crossing the link takes nothing
// at complete either — and the batch is not written.
func TestARunThatStoppedBeingOpenRefusesTheComplete(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	source := scanPDF(4000)
	uid := uploadID(t, f.startRunUpload(r.s, r.run, map[string]any{"size": len(source), "name": "hojas.pdf"}))
	f.sendAll(uid, source)
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, r.run.ID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}

	rec := f.completeRunUpload(r.s, r.run, uid)

	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", rec.Code)
	}
	if got := f.runBatches(r.s, r.run); len(got) != 0 {
		t.Errorf("a run that is not open received a batch: %v", got)
	}
}

func TestCompletingARunUploadEarlyElsewhereOrTwice(t *testing.T) {
	t.Run("before every byte arrived", func(t *testing.T) {
		f := newSurveyFixture(t)
		r := f.readableRun()
		source := scanPDF(4000)
		uid := uploadID(t, f.startRunUpload(r.s, r.run, map[string]any{"size": len(source), "name": "hojas.pdf"}))
		f.sendAll(uid, source[:2500])
		rec := f.completeRunUpload(r.s, r.run, uid)
		if rec.Code != http.StatusConflict || jsonBody(t, rec)["received"] != float64(2500) {
			t.Errorf("status = %d, body %s; want 409 with received 2500", rec.Code, rec.Body.String())
		}
	})
	t.Run("under another run", func(t *testing.T) {
		f := newSurveyFixture(t)
		r := f.readableRun()
		other := f.createRunThroughTheForm(r.s, "Otra")
		source := scanPDF(4000)
		uid := uploadID(t, f.startRunUpload(r.s, r.run, map[string]any{"size": len(source), "name": "hojas.pdf"}))
		f.sendAll(uid, source)
		if rec := f.completeRunUpload(r.s, other, uid); rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
		if got := f.runBatches(r.s, other); len(got) != 0 {
			t.Errorf("the other run received a batch: %v", got)
		}
	})
	t.Run("twice", func(t *testing.T) {
		f := newSurveyFixture(t)
		r := f.readableRun()
		source := scanPDF(4000)
		uid := uploadID(t, f.startRunUpload(r.s, r.run, map[string]any{"size": len(source), "name": "hojas.pdf"}))
		f.sendAll(uid, source)
		if rec := f.completeRunUpload(r.s, r.run, uid); rec.Code != http.StatusOK {
			t.Fatalf("first complete: status = %d", rec.Code)
		}
		if rec := f.completeRunUpload(r.s, r.run, uid); rec.Code != http.StatusNotFound {
			t.Errorf("second complete: status = %d, want 404", rec.Code)
		}
		if got := f.runBatches(r.s, r.run); len(got) != 1 {
			t.Errorf("uploads = %v, want one batch", got)
		}
	})
}
