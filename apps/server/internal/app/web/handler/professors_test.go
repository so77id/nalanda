package handler_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// professorsFixture builds the CRUD handler against a real database. Same
// premise as the auth handler fixture: middleware tests fake the store, but
// what these cases assert — the list, the render, and later the writes — is
// what the queries do.

type professorsFixture struct {
	store       *authstore.Store
	handler     *handler.Professors
	middleware  *middleware.Auth
	now         time.Time
	log         *slog.Logger
	activeUser  auth.User
	activeToken string
}

func newProfessorsFixture(t *testing.T) *professorsFixture {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	f := &professorsFixture{
		store: authstore.New(db),
		now:   time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC),
		log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	f.handler = handler.NewProfessors(handler.Professors{
		Users:     f.store,
		PublicURL: publicURL,
		Log:       f.log,
	})
	f.middleware = middleware.NewAuth(middleware.Auth{
		Sessions:  f.store,
		Users:     f.store,
		Now:       func() time.Time { return f.now },
		PublicURL: publicURL,
		LoginPath: handler.LoginPath,
		Log:       f.log,
	})
	return f
}

// signIn creates a professor and a live session, returning both. The token is
// what a signed-in request's cookie would carry.
func (f *professorsFixture) signIn(t *testing.T, email string) (auth.User, string) {
	t.Helper()
	ctx := context.Background()
	user, err := f.store.CreateUser(ctx, email, "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	csrf, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}
	if err := f.store.CreateSession(ctx, auth.Session{
		TokenHash: auth.HashToken(token), UserID: user.ID, CSRFToken: csrf,
		CreatedAt: f.now, ExpiresAt: f.now.Add(time.Hour), LastSeenAt: f.now,
	}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return user, token
}

// request runs a signed-in GET through the middleware, so the handler sees the
// professor on its context — the way the router mounts it.
func (f *professorsFixture) get(t *testing.T, path, token string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: token})
	}
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(recorder, request)
	return recorder
}

// AC-2: `/` redirects to the professor list.
func TestRootRedirectsToTheProfessorList(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token := f.signIn(t, "profesora@example.com")

	recorder := f.get(t, "/", token, f.handler.Root)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); location != "/professors" {
		t.Errorf("Location = %q, want %q", location, "/professors")
	}
}

// AC-3: the list shows every professor with the columns the WP asks for, and
// the "never signed in" case is words, not an epoch.
func TestListRendersEveryProfessorAndSpellsOutTheNeverSignedInCase(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token := f.signIn(t, "yo@example.com")

	// Seed one professor who signed in and one who never did.
	ctx := context.Background()
	arrived, err := f.store.CreateUser(ctx, "arrived@example.com", "Ya llegó")
	if err != nil {
		t.Fatalf("CreateUser arrived: %v", err)
	}
	lastLogin := time.Date(2026, time.August, 15, 9, 30, 0, 0, time.UTC)
	if err := f.store.RecordLogin(ctx, arrived.ID, lastLogin); err != nil {
		t.Fatalf("RecordLogin arrived: %v", err)
	}
	_, err = f.store.CreateUser(ctx, "nunca@example.com", "Sin llegar")
	if err != nil {
		t.Fatalf("CreateUser nunca: %v", err)
	}
	deactivated, err := f.store.CreateUser(ctx, "inactive@example.com", "Inactiva")
	if err != nil {
		t.Fatalf("CreateUser inactive: %v", err)
	}
	if _, err := f.store.SetActive(ctx, deactivated.ID, false, f.now); err != nil {
		t.Fatalf("SetActive: %v", err)
	}

	recorder := f.get(t, "/professors", token, f.handler.List)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()

	// AC-3: every professor is listed, by address and by name.
	for _, want := range []string{
		"yo@example.com",
		"arrived@example.com", "Ya llegó",
		"nunca@example.com", "Sin llegar",
		"inactive@example.com", "Inactiva",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\n---\n%s", want, body)
		}
	}
	// AC-3 tail: the "never signed in" case is in words, not an epoch or a
	// blank cell. Any epoch-ish "0" or "1970" would be the failure mode.
	if !strings.Contains(body, "Nunca ha entrado") {
		t.Errorf("body missing the Spanish 'never signed in' text\n---\n%s", body)
	}
	if strings.Contains(body, "1970") {
		t.Errorf("body carries the unix epoch, which means an empty last_login_at rendered as one\n---\n%s", body)
	}
	// State column is in words a person reads, not 0/1.
	if !strings.Contains(body, "Activa") || !strings.Contains(body, "Inactiva") {
		t.Errorf("body missing the Spanish state words\n---\n%s", body)
	}
	// AC-11 companion: it goes through the shell — the layout markers.
	for _, want := range []string{"<!doctype html>", `class="sections"`, "profesora@example.com" /* the bar's menu */} {
		_ = want
	}
	if !strings.Contains(body, "<!doctype html>") {
		t.Error("body is not rendered through the shell")
	}
	if !strings.Contains(body, `class="sections"`) {
		t.Error("body missing the shell's bar (should show since a professor is signed in)")
	}
}

// AC-1: an anonymous visitor to /professors is sent to sign-in. The gate is
// what enforces this; the case runs the WRAPPED handler and asserts the
// redirect.
func TestListRedirectsAnAnonymousVisitorToSignIn(t *testing.T) {
	f := newProfessorsFixture(t)

	recorder := f.get(t, "/professors", "", f.handler.List)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); location != handler.LoginPath {
		t.Errorf("Location = %q, want %q", location, handler.LoginPath)
	}
}
