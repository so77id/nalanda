package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/jobs"
)

// Issue #261: POST /controls/{id}/archive soft-deletes the control and
// lands on /controls with a flash. The control disappears from Service.List
// (the main list), and Service.ArchivedList surfaces it.
func TestArchiveHidesControlFromListAndSurfacesItInArchived(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control archive", 1)

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/archive", url.Values{})
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Archive(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Location"); got != handler.ControlsPath {
		t.Errorf("Location = %q, want %q", got, handler.ControlsPath)
	}

	ctx := context.Background()
	rows, err := f.service.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	for _, c := range rows {
		if c.ID == controlID {
			t.Errorf("archived control %s still in Service.List", controlID)
		}
	}
	arch, err := f.service.ArchivedList(ctx)
	if err != nil {
		t.Fatalf("ArchivedList: %v", err)
	}
	if len(arch) != 1 || arch[0].ID != controlID {
		t.Fatalf("ArchivedList = %+v, want the archived control only", arch)
	}
	if arch[0].DeletedAt == nil {
		t.Errorf("DeletedAt is nil on the archived row")
	}
}

// Issue #261: /controls/{id}/archive on a non-existent id answers 404,
// not 500. Same shape as every other detail-page handler.
func TestArchiveAnswers404ForUnknownID(t *testing.T) {
	f := newControlsFixture(t)
	req := f.authedRequest(t, http.MethodPost, "/controls/ZZZZZZZZZZZZZZZZZZZZZZZZZZ/archive", url.Values{})
	req.SetPathValue("id", "ZZZZZZZZZZZZZZZZZZZZZZZZZZ")
	rec := httptest.NewRecorder()
	f.handler.Archive(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 (unknown id)", rec.Code)
	}
}

// Issue #261: POST /controls/{id}/restore clears deleted_at and lands on
// /controls/{id}. The control reappears in Service.List.
func TestRestoreClearsArchiveAndLandsOnDetail(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control restore", 1)

	if err := f.service.Archive(context.Background(), controlID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/restore", url.Values{})
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Restore(rec, req)

	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303; body:\n%s", rec.Code, rec.Body.String())
	}
	want := "/controls/" + controlID
	if got := rec.Header().Get("Location"); got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}

	rows, err := f.service.List(context.Background())
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	found := false
	for _, c := range rows {
		if c.ID == controlID {
			found = true
			if c.DeletedAt != nil {
				t.Errorf("DeletedAt = %v after restore, want nil", c.DeletedAt)
			}
		}
	}
	if !found {
		t.Errorf("restored control %s not in Service.List", controlID)
	}
}

// Issue #261: Detail on an archived control renders the "está archivado"
// banner with a Restore form and DOES NOT render the "Zona peligrosa"
// Archive form — the professor cannot re-archive what is already archived.
func TestDetailShowsArchivedBannerAndHidesDangerZoneOnArchivedControl(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control banner", 1)

	if err := f.service.Archive(context.Background(), controlID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID, nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()

	if !strings.Contains(body, "Este control está archivado") {
		t.Errorf("archived banner missing:\n%s", body)
	}
	if !strings.Contains(body, `action="/controls/`+controlID+`/restore"`) {
		t.Errorf("Restore form action missing")
	}
	if strings.Contains(body, "Zona peligrosa") {
		t.Errorf("Zona peligrosa is rendered on an archived control (should be hidden)")
	}
	if strings.Contains(body, `action="/controls/`+controlID+`/archive"`) {
		t.Errorf("Archive form action rendered on an archived control")
	}
}

// Issue #261: Detail on an ACTIVE control renders the "Zona peligrosa"
// section with the Archive form, and does NOT render the archived banner.
func TestDetailShowsDangerZoneOnActiveControl(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control zona", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls/"+controlID, nil)
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Detail(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "Zona peligrosa") {
		t.Errorf("Zona peligrosa missing on active control")
	}
	if !strings.Contains(body, `action="/controls/`+controlID+`/archive"`) {
		t.Errorf("Archive form action missing on active control")
	}
	if strings.Contains(body, "Este control está archivado") {
		t.Errorf("archived banner rendered on active control")
	}
}

// Issue #261 AC: archiving a control with an in-flight async job MUST NOT
// disturb the job — the row stays, the runner keeps going, MarkDone
// / MarkFailed still find the job. We seed a running job on the store,
// archive the control, wait a moment, and confirm the job row is still
// present and its status is not corrupted.
func TestArchiveDoesNotDisturbAnInFlightJob(t *testing.T) {
	f := newControlsFixture(t)
	controlID := f.createControl(t, "Control inflight", 1)
	ctx := context.Background()

	id, err := f.jstore.Insert(ctx, jobs.NewJob{
		ControlID: controlID, Kind: jobs.KindReanalyse, Payload: []byte(`{}`),
	}, time.Now())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if err := f.jstore.MarkRunning(ctx, id, time.Now()); err != nil {
		t.Fatalf("MarkRunning: %v", err)
	}

	req := f.authedRequest(t, http.MethodPost, "/controls/"+controlID+"/archive", url.Values{})
	req.SetPathValue("id", controlID)
	rec := httptest.NewRecorder()
	f.handler.Archive(rec, req)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("archive status = %d, want 303", rec.Code)
	}

	after, err := f.jstore.ByID(ctx, id)
	if err != nil {
		t.Fatalf("ByID after archive: %v (job was cascaded — the row must survive)", err)
	}
	if after.Status != jobs.StatusRunning {
		t.Errorf("job.Status = %q after archive, want running (soft-delete must not transition state)", after.Status)
	}

	// The runner can still transition it — the domain contract from
	// issue #257 (MarkDone finds the row) survives the soft-delete.
	if err := f.jstore.MarkDone(ctx, id, time.Now()); err != nil {
		t.Errorf("MarkDone after archive: %v, want nil", err)
	}
}

// Issue #261: GET /controls/archived renders every archived control, each
// row carrying the Restore POST target and the Purge-confirm GET link.
func TestArchivedPageListsArchivedControlsWithActionURLs(t *testing.T) {
	f := newControlsFixture(t)
	activeID := f.createControl(t, "Control activo", 1)
	archivedID := f.createControl(t, "Control para archivar", 1)
	if err := f.service.Archive(context.Background(), archivedID); err != nil {
		t.Fatalf("Archive: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/archived", nil)
	rec := httptest.NewRecorder()
	f.handler.Archived(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()

	if !strings.Contains(body, "Control para archivar") {
		t.Errorf("archived control name missing:\n%s", body)
	}
	if strings.Contains(body, "Control activo") {
		t.Errorf("active control leaked into the archived page")
	}
	if !strings.Contains(body, `action="/controls/`+archivedID+`/restore"`) {
		t.Errorf("Restore form action missing")
	}
	if !strings.Contains(body, `href="/controls/`+archivedID+`/purge/confirm"`) {
		t.Errorf("Purge confirm link missing")
	}
	_ = activeID
}

// Issue #261: /controls has a "Ver archivados" link in the header so a
// professor can find the archived listing without a bookmark.
func TestListRendersLinkToArchivedPage(t *testing.T) {
	f := newControlsFixture(t)
	_ = f.createControl(t, "Control 1", 1)

	req := f.authedRequest(t, http.MethodGet, "/controls", nil)
	rec := httptest.NewRecorder()
	f.handler.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `href="/controls/archived"`) {
		t.Errorf("/controls list is missing the 'Ver archivados' link:\n%s", body)
	}
}

// Issue #261: /controls/archived lists archived rows newest first —
// Service.ArchivedList delegates to Store.ListArchivedControls which
// orders by deleted_at DESC.
func TestArchivedPageOrdersRowsByDeletedAtDesc(t *testing.T) {
	f := newControlsFixture(t)
	ctx := context.Background()
	older := f.createControl(t, "Archivado más viejo", 1)
	newer := f.createControl(t, "Archivado más nuevo", 1)
	if err := f.service.Archive(ctx, older); err != nil {
		t.Fatalf("Archive older: %v", err)
	}
	// Force strictly-greater deleted_at on the newer one — same second
	// resolution as the DB, so a small sleep avoids a flaky tie-break.
	time.Sleep(1100 * time.Millisecond)
	if err := f.service.Archive(ctx, newer); err != nil {
		t.Fatalf("Archive newer: %v", err)
	}

	req := f.authedRequest(t, http.MethodGet, "/controls/archived", nil)
	rec := httptest.NewRecorder()
	f.handler.Archived(rec, req)
	body := rec.Body.String()
	newerIdx := strings.Index(body, "Archivado más nuevo")
	olderIdx := strings.Index(body, "Archivado más viejo")
	if newerIdx < 0 || olderIdx < 0 {
		t.Fatalf("both archived rows not present in body")
	}
	if newerIdx > olderIdx {
		t.Errorf("older row rendered before newer — want deleted_at DESC")
	}
}
