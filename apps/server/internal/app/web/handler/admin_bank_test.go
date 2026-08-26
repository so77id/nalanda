package handler_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// adminBankFixture wires a real LiveBank against an httptest server so
// each case can steer the outcome of Refresh's Reload — success, 304
// no-op, or a 5xx failure — without stubbing the concrete type.
type adminBankFixture struct {
	handler *handler.AdminBank
	live    *bank.LiveBank
	body    *atomic.Pointer[string]
	status  *atomic.Int32 // 200 or 500; 304 is delivered when the request carries If-Modified-Since
	session auth.Session
	user    auth.User
}

func newAdminBankFixture(t *testing.T) *adminBankFixture {
	t.Helper()

	body := &atomic.Pointer[string]{}
	initial := adminBankInitialJSON
	body.Store(&initial)

	status := &atomic.Int32{}
	status.Store(http.StatusOK)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if code := status.Load(); code != http.StatusOK {
			http.Error(w, "boom", int(code))
			return
		}
		if r.Header.Get("If-Modified-Since") != "" && *body.Load() == initial {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Last-Modified", "Wed, 26 Aug 2026 12:00:00 GMT")
		_, _ = w.Write([]byte(*body.Load()))
	}))
	t.Cleanup(srv.Close)

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	live, err := bank.NewLive(context.Background(), srv.URL+"/questions.json", log)
	if err != nil {
		t.Fatalf("NewLive: %v", err)
	}

	h := handler.NewAdminBank(handler.AdminBank{
		Bank:      live,
		PublicURL: publicURL,
		Log:       log,
	})

	return &adminBankFixture{
		handler: h,
		live:    live,
		body:    body,
		status:  status,
		session: auth.Session{TokenHash: "hash", UserID: 1, CSRFToken: "csrf"},
		user:    auth.User{ID: 1, Email: "profesora@example.com", Name: "Profesora"},
	}
}

func (f *adminBankFixture) postRefresh(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, handler.AdminBankRefreshPath, nil)
	req.Header.Set("Referer", "http://127.0.0.1:8081/controls")
	ctx := middleware.WithProfessorForTest(req.Context(), f.user, f.session)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	f.handler.Refresh(rec, req)
	return rec
}

func TestAdminBankRefreshFlashesTheNewCountsAndRedirects(t *testing.T) {
	f := newAdminBankFixture(t)

	// The site publishes.
	next := adminBankNextJSON
	f.body.Store(&next)

	rec := f.postRefresh(t)

	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusSeeOther)
	}
	if got := rec.Header().Get("Location"); got != "/controls" {
		t.Errorf("Location = %q, want /controls (Referer-derived same-origin)", got)
	}

	got := readFlash(t, rec)
	for _, want := range []string{"Banco recargado", "3 documentos", "5 preguntas"} {
		if !strings.Contains(got, want) {
			t.Errorf("flash = %q, want it to contain %q", got, want)
		}
	}

	// The rotation is visible through Get() — the whole point of the
	// endpoint from the professor's perspective.
	if n := len(f.live.Get().Documents); n != 3 {
		t.Errorf("Get().Documents = %d, want 3 after Reload", n)
	}
}

func TestAdminBankRefreshFlashesUnchangedOn304(t *testing.T) {
	f := newAdminBankFixture(t)

	// Do NOT change the body — the second call will carry
	// If-Modified-Since and the httptest server answers 304.

	rec := f.postRefresh(t)

	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusSeeOther)
	}
	got := readFlash(t, rec)
	if !strings.Contains(got, "ya estaba al día") {
		t.Errorf("flash = %q, want it to say the bank was unchanged", got)
	}
}

func TestAdminBankRefreshFlashesTheErrorOnServerFailure(t *testing.T) {
	f := newAdminBankFixture(t)

	// The upstream is down after boot.
	f.status.Store(http.StatusInternalServerError)

	rec := f.postRefresh(t)

	if rec.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusSeeOther)
	}
	got := readFlash(t, rec)
	if !strings.Contains(got, "No se pudo recargar") {
		t.Errorf("flash = %q, want it to say the refresh failed", got)
	}

	// The snapshot survives — the escape-hatch promise (S1).
	if n := len(f.live.Get().Documents); n != 2 {
		t.Errorf("Get().Documents = %d, want 2 (boot snapshot preserved)", n)
	}
}

func TestAdminBankRefreshFallsBackToControlsWithoutReferer(t *testing.T) {
	f := newAdminBankFixture(t)

	req := httptest.NewRequest(http.MethodPost, handler.AdminBankRefreshPath, nil)
	// No Referer header — a direct POST, or a browser that scrubbed it.
	ctx := middleware.WithProfessorForTest(req.Context(), f.user, f.session)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	f.handler.Refresh(rec, req)

	if got := rec.Header().Get("Location"); got != "/controls" {
		t.Errorf("Location = %q, want /controls as the fallback", got)
	}
}

func TestAdminBankRefreshRejectsAnOffOriginReferer(t *testing.T) {
	// A crafted request from another origin still carries the CSRF token
	// (assume the worst) and names an evil Referer. The handler must
	// refuse to bounce the professor there — an open redirect on a
	// backoffice endpoint is a phishing lever.
	f := newAdminBankFixture(t)

	req := httptest.NewRequest(http.MethodPost, handler.AdminBankRefreshPath, nil)
	req.Header.Set("Referer", "https://evil.example.com/steal")
	ctx := middleware.WithProfessorForTest(req.Context(), f.user, f.session)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	f.handler.Refresh(rec, req)

	if got := rec.Header().Get("Location"); got != "/controls" {
		t.Errorf("Location = %q, want /controls — an off-origin Referer must not steer the redirect", got)
	}
}

const adminBankInitialJSON = `{
  "version": 1,
  "documents": [
    {"id": "d1", "title": "D1", "coverage": "c", "sections": ["s"]},
    {"id": "d2", "title": "D2", "coverage": "c", "sections": ["s"]}
  ],
  "questions": [
    {"id": "q1", "document": "d1", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q2", "document": "d2", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q3", "document": "d2", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]}
  ]
}`

const adminBankNextJSON = `{
  "version": 1,
  "documents": [
    {"id": "d1", "title": "D1", "coverage": "c", "sections": ["s"]},
    {"id": "d2", "title": "D2", "coverage": "c", "sections": ["s"]},
    {"id": "d3", "title": "D3", "coverage": "c", "sections": ["s"]}
  ],
  "questions": [
    {"id": "q1", "document": "d1", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q2", "document": "d2", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q3", "document": "d2", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q4", "document": "d3", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]},
    {"id": "q5", "document": "d3", "anchor": "s", "type": "simple",
     "statement": "?", "code": null, "alternatives": ["a","b"], "correct": [0]}
  ]
}`
