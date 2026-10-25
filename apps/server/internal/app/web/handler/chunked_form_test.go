package handler_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
)

// Both scan forms are enhanced by one module, static/js/chunked_upload.mjs
// (issue #339): the form keeps posting to the one-request route, so a page
// whose script did not load still uploads, and carries in data-chunked-upload
// where the script opens a chunked upload instead. What the script DOES is
// not visible here — there is no JavaScript runner in this app — and is
// proven in a real browser (testing-strategy.md §apps/server, "inline
// browser scripts").

// assertChunkedForm checks one rendered page.
func assertChunkedForm(t *testing.T, body, legacyAction, startURL string) {
	t.Helper()
	for _, want := range []string{
		`action="` + legacyAction + `"`,
		`enctype="multipart/form-data"`,
		`data-chunked-upload="` + startURL + `"`,
		`data-chunked-status`,
		`<progress`,
		`aria-live="polite"`,
		`>Cancelar</button>`,
		`>Reintentar</button>`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the page lacks %q", want)
		}
	}
	if n := strings.Count(body, `<script type="module" src="/static/js/chunked_upload.mjs"></script>`); n != 1 {
		t.Errorf("the chunked-upload module is loaded %d times, want once", n)
	}
	// ADR-0047 §4: the behaviour is a static module, never inline.
	if strings.Contains(body, "form[data-chunked-upload]") {
		t.Error("the chunked-upload script is inline in the page, want it only in /static/js/")
	}
}

func TestTheControlScansFormCarriesTheChunkedUpload(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control 1", 3)

	body := f.detailBody(t, controlID)

	assertChunkedForm(t, body, "/controls/"+controlID+"/scans", handler.ControlScanUploadsPathFor(controlID))
}

func TestTheRunScansFormCarriesTheChunkedUpload(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	scans := handler.SurveyRunScansPathFor(r.s.ID, r.run.ID)

	body := f.do(http.MethodGet, scans, f.handler.RunScans, nil, f.runValues(r.s, r.run)...).Body.String()

	assertChunkedForm(t, body, scans, handler.SurveyRunScanUploadsPathFor(r.s.ID, r.run.ID))
}

// A run that takes no scans draws no form, and so carries no script.
func TestAClosedRunsScansPageCarriesNoUploadScript(t *testing.T) {
	f := newSurveyFixture(t)
	r := f.readableRun()
	if err := f.surveys.CancelRun(context.Background(), r.s.ID, r.run.ID); err != nil {
		t.Fatalf("CancelRun: %v", err)
	}
	scans := handler.SurveyRunScansPathFor(r.s.ID, r.run.ID)

	body := f.do(http.MethodGet, scans, f.handler.RunScans, nil, f.runValues(r.s, r.run)...).Body.String()

	if strings.Contains(body, "data-chunked-upload") {
		t.Error("a run that is not open renders the chunked upload")
	}
}
