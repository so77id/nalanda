package handler_test

import (
	"context"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/files"
)

// unreachableStore fails every call the way S3 does when it cannot be
// reached: an error, and NOT a missing file.
type unreachableStore struct{}

var errUnreachable = errors.New("operation error S3: HeadObject, dial tcp: i/o timeout")

func (unreachableStore) Open(context.Context, string) (files.File, error) { return nil, errUnreachable }
func (unreachableStore) List(context.Context, string) ([]files.Entry, error) {
	return nil, errUnreachable
}
func (unreachableStore) DeleteProject(context.Context, string) error { return errUnreachable }

// Issue #338 §8.5: once the files live in S3, a download can fail for a
// reason that is not the file's absence. Saying "no está disponible" would
// send the professor looking for a file that is there; the page says the
// store failed and to retry.
const storeFailed = "No se pudo leer el archivo del almacenamiento"

func TestAControlDownloadSaysTheStoreFailedRatherThanTheFileIsMissing(t *testing.T) {
	f := newControlsFixture(t)
	id := f.createControl(t, "Control sin S3", 1)
	f.service.Files = unreachableStore{}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+id+"/sujet.pdf", nil)
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	f.handler.SujetPDF(rec, req)

	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), storeFailed) {
		t.Errorf("status %d body %q, want 503 saying the store failed", rec.Code, rec.Body.String())
	}
}

func TestAScanPageSaysTheStoreFailedRatherThanTheImageIsMissing(t *testing.T) {
	f := newControlsFixture(t)
	id := f.createControl(t, "Control sin S3", 1)
	f.service.Files = unreachableStore{}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+id+"/copies/1/pages/1.png", nil)
	req.SetPathValue("id", id)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), storeFailed) {
		t.Errorf("status %d body %q, want 503 saying the store failed", rec.Code, rec.Body.String())
	}
}

// pngUnreachableStore fails to read any PNG and has no JPG: the case where
// falling through to the JPG on ANY error would turn a store failure into
// "the page has no image".
type pngUnreachableStore struct{}

func (pngUnreachableStore) Open(_ context.Context, rel string) (files.File, error) {
	if strings.HasSuffix(rel, ".png") {
		return nil, errUnreachable
	}
	return nil, fs.ErrNotExist
}
func (pngUnreachableStore) List(context.Context, string) ([]files.Entry, error) { return nil, nil }
func (pngUnreachableStore) DeleteProject(context.Context, string) error         { return nil }

func TestAScanPageWhosePNGCouldNotBeReadIsNotReportedAsMissing(t *testing.T) {
	f := newControlsFixture(t)
	id := f.createControl(t, "Control con PNG ilegible", 1)
	f.service.Files = pngUnreachableStore{}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+id+"/copies/1/pages/1.png", nil)
	req.SetPathValue("id", id)
	req.SetPathValue("copy", "1")
	req.SetPathValue("n", "1")
	rec := httptest.NewRecorder()
	f.handler.PageImage(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status %d, want 503: the PNG could not be READ, which is not its absence", rec.Code)
	}
}

// The other half of the pair: a file that is genuinely not there is still
// the page's own 404, through the same helper.
func TestAMissingControlFileIsStillA404(t *testing.T) {
	f := newControlsFixture(t)
	id := f.createControl(t, "Control sin escaneos", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+id+"/uploads/batch-1.pdf", nil)
	req.SetPathValue("id", id)
	req.SetPathValue("batch", "batch-1.pdf")
	rec := httptest.NewRecorder()
	f.handler.UploadsPDF(rec, req)

	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), storeFailed) {
		t.Errorf("status %d body %q, want the 404", rec.Code, rec.Body.String())
	}
}

func TestARunSheetSaysTheStoreFailedRatherThanThePDFIsMissing(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Encuesta sin S3")
	f.bankOfThree(s)
	run := f.createRunThroughTheForm(s, "")
	f.finishGeneration(s, run)
	f.surveys.Files = unreachableStore{}

	rec := f.do(http.MethodGet, "/sujet.pdf", f.handler.RunSheet, nil, f.runValues(s, run)...)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), storeFailed) {
		t.Errorf("status %d body %q, want 503 saying the store failed", rec.Code, rec.Body.String())
	}
}

func TestARunScanPageSaysTheStoreFailedRatherThanTheImageIsMissing(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.reviewable()
	f.surveys.Files = unreachableStore{}

	rec := f.do(http.MethodGet, handler.SurveyRunPagePathFor(r.s.ID, r.run.ID, 2, 1), f.handler.RunPage, nil,
		append(f.reviewValues(r, 2), "n", strconv.Itoa(1))...)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), storeFailed) {
		t.Errorf("status %d, want 503 saying the store failed", rec.Code)
	}
}

// Issue #338, AC-8 at the page: S3 out of reach refuses the purge with a
// sentence that says the control is still archived — never "no se pudo
// eliminar", which reads as if something were half-deleted.
func TestAPurgeTheStoreRefusesKeepsTheControlAndSaysSo(t *testing.T) {
	f := newControlsFixture(t)
	name := "Control sin S3"
	id := f.createControl(t, name, 1)
	if err := f.service.Archive(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	f.service.Files = unreachableStore{}

	req := f.authedRequest(t, http.MethodPost, "/controls/"+id+"/purge", url.Values{"confirm_name": {name}})
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	f.handler.Purge(rec, req)

	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "sigue archivado") {
		t.Errorf("status %d, want 502 saying the control is still archived", rec.Code)
	}
	if _, err := f.service.Get(context.Background(), id); err != nil {
		t.Errorf("the row is gone after a refused purge: %v", err)
	}
}
