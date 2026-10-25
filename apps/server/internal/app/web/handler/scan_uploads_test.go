package handler_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
)

// A control's batch uploaded in chunks (issue #339) must land exactly where
// the one-request form's lands — batch-N.pdf, written before the analyse job
// is queued — and refuse at create everything the form would refuse, before
// a byte of the batch has travelled.

// jsonRequest is a request from the page's script, as the signed-in
// professor, with a JSON body (nil sends none).
func (f *controlsFixture) jsonRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var reader *bytes.Reader
	switch b := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case string:
		reader = bytes.NewReader([]byte(b))
	default:
		encoded, err := json.Marshal(b)
		if err != nil {
			t.Fatalf("Marshal: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	return req.WithContext(middleware.WithProfessorForTest(req.Context(), f.user, f.session))
}

func (f *controlsFixture) startScanUpload(t *testing.T, controlID string, start any) *httptest.ResponseRecorder {
	t.Helper()
	req := f.jsonRequest(t, http.MethodPost, handler.ControlScanUploadsPathFor(controlID), start)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.StartScanUpload(rec, req)
	return rec
}

func (f *controlsFixture) completeScanUpload(t *testing.T, controlID, uid string) *httptest.ResponseRecorder {
	t.Helper()
	req := f.jsonRequest(t, http.MethodPost, handler.ControlScanUploadCompletePathFor(controlID, uid), nil)
	req.SetPathValue("id", controlID)
	req.SetPathValue("uid", uid)
	rec := httptest.NewRecorder()
	f.handler.CompleteScanUpload(rec, req)
	return rec
}

// sendAll delivers source through the uploads service in chunks, the way the
// PUT route does.
func (f *controlsFixture) sendAll(t *testing.T, uid string, source []byte) {
	t.Helper()
	for offset := 0; offset < len(source); offset += uploads.ChunkBytes {
		end := min(offset+uploads.ChunkBytes, len(source))
		if _, err := f.uploads.Append(f.user.ID, uid, int64(offset), bytes.NewReader(source[offset:end])); err != nil {
			t.Fatalf("Append at %d: %v", offset, err)
		}
	}
}

func (f *controlsFixture) incoming(t *testing.T) []string {
	t.Helper()
	list, err := os.ReadDir(filepath.Join(f.workDir, uploads.DirName))
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("ReadDir: %v", err)
	}
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

func (f *controlsFixture) batches(t *testing.T, controlID string) []string {
	t.Helper()
	list, _ := os.ReadDir(filepath.Join(f.workDir, "controls", controlID, "uploads"))
	var names []string
	for _, e := range list {
		names = append(names, e.Name())
	}
	return names
}

// scanPDF is a batch large enough to cross several chunks.
func scanPDF(size int) []byte {
	b := bytes.Repeat([]byte("0123456789abcdef"), size/16+1)[:size]
	copy(b, "%PDF-1.4\n")
	return b
}

func uploadID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	if rec.Code != http.StatusCreated {
		t.Fatalf("start: status = %d, want 201; body:\n%s", rec.Code, rec.Body.String())
	}
	id, _ := jsonBody(t, rec)["upload"].(string)
	if id == "" {
		t.Fatalf("start answered no upload id: %s", rec.Body.String())
	}
	return id
}

func TestAControlBatchUploadedInChunksIsSavedAndAnalysed(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	f.fake.AnalyzeReports = []controls.Report{{Copies: map[string]controls.ReportCopy{
		"1": {RUT: "20123456", RUTStatus: controls.RUTStatusOK, Status: controls.CopyStatusNeedsReview,
			ExpectedQuestions: 2, SeenQuestions: 2},
	}}}
	source := scanPDF(2*uploads.ChunkBytes + 12_345)

	rec := f.startScanUpload(t, controlID, map[string]any{
		"size": len(source), "name": "lote.pdf", "type": "application/pdf",
		"ticked": "0.6", "unsure": "0.3",
	})
	uid := uploadID(t, rec)
	opened := jsonBody(t, rec)
	if opened["received"] != float64(0) || opened["chunk"] != float64(uploads.ChunkBytes) {
		t.Errorf("start = %v, want received 0 and chunk %d", opened, uploads.ChunkBytes)
	}
	if opened["complete"] != handler.ControlScanUploadCompletePathFor(controlID, uid) {
		t.Errorf("complete = %v, want this control's complete route", opened["complete"])
	}
	if opened["chunks"] != handler.UploadPathFor(uid) {
		t.Errorf("chunks = %v, want %s — the page's script takes the chunk route from here", opened["chunks"], handler.UploadPathFor(uid))
	}
	f.sendAll(t, uid, source)

	rec = f.completeScanUpload(t, controlID, uid)

	if rec.Code != http.StatusOK {
		t.Fatalf("complete: status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	if got := jsonBody(t, rec)["redirect"]; got != "/controls/"+controlID {
		t.Errorf("redirect = %v, want the control's page", got)
	}
	if got := flashFromResponse(t, rec); !strings.HasPrefix(got, "Escaneo 1 subido.") {
		t.Errorf("flash = %q, want the one-request form's", got)
	}
	saved, err := os.ReadFile(filepath.Join(f.workDir, "controls", controlID, "uploads", "batch-1.pdf"))
	if err != nil {
		t.Fatalf("the batch is not on disk: %v", err)
	}
	if sha256.Sum256(saved) != sha256.Sum256(source) {
		t.Errorf("batch-1.pdf (%d bytes) is not the source (%d bytes)", len(saved), len(source))
	}
	if left := f.incoming(t); len(left) != 0 {
		t.Errorf("the partial outlived the batch: %v", left)
	}
	f.waitLatestJobTerminal(t, controlID)
	call, ok := f.fake.LastAnalyzeCall()
	if !ok {
		t.Fatal("no analyse job reached the worker")
	}
	if !strings.HasSuffix(call.ScanPDF, "batch-1.pdf") || call.Ticked != 0.6 || call.Unsure != 0.3 {
		t.Errorf("analyse = %+v, want batch-1.pdf at the thresholds chosen at start", call)
	}
}

// AC-6. Everything the one-request form would refuse is refused at start,
// before a byte of the batch travels — and nothing is left on disk.
func TestStartingAControlUploadRefusesBeforeAnyByte(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	valid := func() map[string]any {
		return map[string]any{"size": 1000, "name": "lote.pdf", "type": "application/pdf"}
	}
	with := func(k string, v any) map[string]any {
		m := valid()
		m[k] = v
		return m
	}

	for _, c := range []struct {
		name    string
		control string
		start   any
		status  int
	}{
		{"a size above the cap", controlID, with("size", 5<<20+1), http.StatusRequestEntityTooLarge},
		{"an empty file", controlID, with("size", 0), http.StatusBadRequest},
		{"a file that is not a PDF", controlID, map[string]any{"size": 1000, "name": "lote.docx", "type": "application/msword"}, http.StatusBadRequest},
		{"thresholds outside the band", controlID, map[string]any{"size": 1000, "name": "lote.pdf", "ticked": "0.2", "unsure": "0.5"}, http.StatusBadRequest},
		{"a body that is not JSON", controlID, "size=1000", http.StatusBadRequest},
		{"a control that does not exist", "AAAAAAAAAAAAAAAAAAAAAAAAAA", valid(), http.StatusNotFound},
		{"a control id of the wrong shape", "nope", valid(), http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := f.startScanUpload(t, c.control, c.start)
			if rec.Code != c.status {
				t.Errorf("status = %d, want %d; body:\n%s", rec.Code, c.status, rec.Body.String())
			}
			if msg, _ := jsonBody(t, rec)["message"].(string); msg == "" {
				t.Error("the refusal carries no message for the page")
			}
			if left := f.incoming(t); len(left) != 0 {
				t.Errorf("a refused start left %v", left)
			}
		})
	}
}

func TestCompletingAControlUploadBeforeEveryByteArrivedIs409(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	source := scanPDF(5000)
	uid := uploadID(t, f.startScanUpload(t, controlID, map[string]any{"size": len(source), "name": "lote.pdf"}))
	f.sendAll(t, uid, source[:3000])

	rec := f.completeScanUpload(t, controlID, uid)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if got := jsonBody(t, rec)["received"]; got != float64(3000) {
		t.Errorf("received = %v, want 3000", got)
	}
	if got := f.batches(t, controlID); len(got) != 0 {
		t.Errorf("an incomplete upload became a batch: %v", got)
	}
}

// An upload is finished only under the control it was started for: under
// another, it does not exist.
func TestCompletingAControlUploadUnderAnotherControlIs404(t *testing.T) {
	f := newControlsFixture(t)
	mine := f.createControl(t, "Control 1", 3)
	other := f.createControl(t, "Control 2", 3)
	source := scanPDF(5000)
	uid := uploadID(t, f.startScanUpload(t, mine, map[string]any{"size": len(source), "name": "lote.pdf"}))
	f.sendAll(t, uid, source)

	rec := f.completeScanUpload(t, other, uid)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if got := f.batches(t, other); len(got) != 0 {
		t.Errorf("the other control received a batch: %v", got)
	}
	if rec := f.completeScanUpload(t, mine, uid); rec.Code != http.StatusOK {
		t.Errorf("the upload did not survive the wrong complete: status %d", rec.Code)
	}
}

// A second complete — a double click, a retry after a lost answer — finds the
// upload already finished and saves nothing.
func TestADoubleCompleteSavesOneBatch(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	source := scanPDF(5000)
	uid := uploadID(t, f.startScanUpload(t, controlID, map[string]any{"size": len(source), "name": "lote.pdf"}))
	f.sendAll(t, uid, source)

	if rec := f.completeScanUpload(t, controlID, uid); rec.Code != http.StatusOK {
		t.Fatalf("first complete: status = %d", rec.Code)
	}
	rec := f.completeScanUpload(t, controlID, uid)

	if rec.Code != http.StatusNotFound {
		t.Errorf("second complete: status = %d, want 404", rec.Code)
	}
	if got := f.batches(t, controlID); len(got) != 1 || got[0] != "batch-1.pdf" {
		t.Errorf("uploads = %v, want only batch-1.pdf", got)
	}
}

func TestAControlUploadThatIsNotAPDFIsRefusedAtComplete(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	source := bytes.Repeat([]byte("not a pdf "), 100)
	uid := uploadID(t, f.startScanUpload(t, controlID, map[string]any{"size": len(source), "name": "lote.pdf"}))
	f.sendAll(t, uid, source)

	rec := f.completeScanUpload(t, controlID, uid)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if msg, _ := jsonBody(t, rec)["message"].(string); msg == "" {
		t.Error("the refusal carries no message for the page")
	}
	if got := f.batches(t, controlID); len(got) != 0 {
		t.Errorf("bytes that are not a PDF became a batch: %v", got)
	}
}

// #339 review, COR-3. Once SaveUploadedBatch returned, the batch is on disk
// and the partial is gone, so the upload is FINISHED even if the analyse job
// cannot be queued. A 500 there sent the page into a retry that found nothing
// and reloaded with no word; the answer is the redirect, and the flash says
// what did not happen.
func TestAControlUploadSavedButNotQueuedStillFinishesAndSaysSo(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)
	source := scanPDF(5000)
	uid := uploadID(t, f.startScanUpload(t, controlID, map[string]any{"size": len(source), "name": "lote.pdf"}))
	f.sendAll(t, uid, source)
	// The queue's insert fails from here on: what a broken jobs store does.
	if _, err := f.db.Exec(`ALTER TABLE job RENAME TO job_unreachable`); err != nil {
		t.Fatalf("breaking the queue: %v", err)
	}

	rec := f.completeScanUpload(t, controlID, uid)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — the batch is saved; body:\n%s", rec.Code, rec.Body.String())
	}
	if got := jsonBody(t, rec)["redirect"]; got != "/controls/"+controlID {
		t.Errorf("redirect = %v, want the control's page", got)
	}
	if got := flashFromResponse(t, rec); !strings.Contains(got, "no pudo encolar") {
		t.Errorf("flash = %q, want it to say the analysis was not queued", got)
	}
	if got := f.batches(t, controlID); len(got) != 1 || got[0] != "batch-1.pdf" {
		t.Errorf("uploads = %v, want batch-1.pdf kept (the #210 rule)", got)
	}
	if left := f.incoming(t); len(left) != 0 {
		t.Errorf("the partial outlived the batch: %v", left)
	}
}
