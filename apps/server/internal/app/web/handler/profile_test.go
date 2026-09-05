package handler_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/secretstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The profile screen (issue #271 S3), against a real database and a real
// secretstore — what is worth asserting here is that the token survives the
// encryption round trip and never comes back out onto the page.
//
// canvasToken is the value every case pastes. It is checked for by name in
// the rendered HTML and in the log buffer, so it must be distinctive enough
// that a match cannot be a coincidence.
const canvasToken = "1234~AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"

// stubCanvas is the API seam. The real UDP Canvas is a human's check (S8),
// for the same reason GOOGLE-CHECK.md exists.
type stubCanvas struct {
	err     error
	seen    []string
	courses []canvas.Course
}

func (s *stubCanvas) Verify(_ context.Context, token string) error {
	s.seen = append(s.seen, token)
	return s.err
}

// The profile screen does not list courses or import a roster yet — S5 and
// S6 add those. Present so the stub satisfies canvas.API.
func (s *stubCanvas) Courses(context.Context, string) ([]canvas.Course, error) {
	return s.courses, s.err
}

func (s *stubCanvas) Roster(context.Context, string, string) ([]canvas.Student, error) {
	return nil, s.err
}

type profileFixture struct {
	handler    *handler.Profile
	middleware *middleware.Auth
	store      *authstore.Store
	secrets    secret.Store
	api        *stubCanvas
	logs       *bytes.Buffer
	now        time.Time
}

// newProfileFixture wires the screen. masterKey nil is the "no
// NALANDA_SECRETS_MASTER_KEY" deployment (ADR-0068 §Decision 3).
func newProfileFixture(t *testing.T, masterKey []byte) *profileFixture {
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

	logs := &bytes.Buffer{}
	log := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))

	f := &profileFixture{
		store: authstore.New(db),
		api:   &stubCanvas{},
		logs:  logs,
		now:   time.Date(2026, time.September, 4, 12, 0, 0, 0, time.UTC),
	}
	if masterKey != nil {
		s, err := secretstore.New(db, masterKey)
		if err != nil {
			t.Fatalf("secretstore.New: %v", err)
		}
		f.secrets = s
	}

	f.handler = handler.NewProfile(handler.Profile{
		Canvas:    canvas.NewService(f.secrets, f.api),
		PublicURL: publicURL,
		Log:       log,
	})
	f.middleware = middleware.NewAuth(middleware.Auth{
		Sessions:  f.store,
		Users:     f.store,
		Now:       func() time.Time { return f.now },
		PublicURL: publicURL,
		LoginPath: handler.LoginPath,
		Log:       log,
	})
	return f
}

func profileKey() []byte {
	k := make([]byte, secret.MasterKeySize)
	for i := range k {
		k[i] = byte(i) + 3
	}
	return k
}

func (f *profileFixture) signIn(t *testing.T) (auth.User, string) {
	t.Helper()
	ctx := context.Background()

	user, err := f.store.CreateUser(ctx, "profesora@example.com", "Profesora")
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

func (f *profileFixture) get(t *testing.T, session string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, handler.ProfilePath, nil)
	request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(http.HandlerFunc(f.handler.Show))).ServeHTTP(recorder, request)
	return recorder
}

func (f *profileFixture) post(t *testing.T, session, path string, h http.HandlerFunc, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(form.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName(true), Value: session})
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(recorder, request)
	return recorder
}

func TestTheProfilePageOffersTheFormWhenNoTokenIsStored(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	rec := f.get(t, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `name="token"`) {
		t.Error("the page carries no token field")
	}
	if !strings.Contains(body, handler.ProfileCanvasTokenPath) {
		t.Errorf("the form does not post to %s", handler.ProfileCanvasTokenPath)
	}
	if strings.Contains(body, "Token configurado") {
		t.Error("the page claims a token is configured before any was saved")
	}
	if !strings.Contains(body, "csrf_token") {
		t.Error("the form carries no CSRF token; the router's guard would refuse the POST")
	}
}

// The happy path, end to end through the real encryption: the professor
// pastes, Canvas is asked, the row is sealed, and the next GET says so.
func TestSavingAValidTokenStoresItAndTheNextPageSaysSo(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)

	rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 (POST/redirect/GET)", rec.Code)
	}
	if got := rec.Header().Get("Location"); got != handler.ProfilePath {
		t.Errorf("Location = %q, want %q", got, handler.ProfilePath)
	}
	if len(f.api.seen) != 1 || f.api.seen[0] != canvasToken {
		t.Errorf("Canvas was asked about %q, want the pasted token exactly once", f.api.seen)
	}

	// It is really in the database, really decryptable, and really the
	// token — not a truncation or a re-encoding.
	stored, err := f.secrets.Get(context.Background(), user.ID, "canvas", "token")
	if err != nil {
		t.Fatalf("reading the stored secret: %v", err)
	}
	if stored != canvasToken {
		t.Errorf("stored token = %q, want the pasted value", stored)
	}

	body := f.get(t, session).Body.String()
	if !strings.Contains(body, "Token configurado") {
		t.Error("the page does not report the token as configured")
	}
}

// AC-6, and the case worth the most on this screen: the plaintext token is
// never rendered back. The professor cannot copy it out of the page, and
// neither can anyone who gets the HTML by another route.
func TestTheStoredTokenIsNeverRenderedBack(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	if rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("saving: status = %d, want 303", rec.Code)
	}

	body := f.get(t, session).Body.String()
	if strings.Contains(body, canvasToken) {
		t.Error("the profile page renders the stored token back")
	}
	// Not even a prefix: a truncated credential on a page is still a
	// credential on a page.
	if strings.Contains(body, canvasToken[:16]) {
		t.Error("the profile page renders part of the stored token")
	}
	// And the input it offers for a replacement starts empty, rather than
	// pre-filled with what is stored.
	if strings.Contains(body, `value="1234~`) {
		t.Error("the replacement input is pre-filled with the stored token")
	}
}

// A token Canvas refuses is a field error on the form, not a 500 and not a
// silent success. Nothing is stored.
func TestATokenCanvasRejectsIsAFieldErrorAndStoresNothing(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.api.err = canvas.ErrTokenRejected

	rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 — a refusal rendered as 200 hides the rejection from the HTTP layer", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Canvas rechazó este token") {
		t.Errorf("the page does not say Canvas refused the token:\n%s", rec.Body.String())
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, "canvas", "token"); !errors.Is(err, secret.ErrNotFound) {
		t.Errorf("a rejected token left something behind: %v", err)
	}
}

// The distinction that matters most for a professor's afternoon: an outage
// is not a bad token. The message must not tell them to go and generate
// another one, and nothing may be stored on an answer that says nothing.
func TestAnUnreachableCanvasIsNotReportedAsABadToken(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)
	f.api.err = canvas.ErrUnavailable

	rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "No se pudo contactar a Canvas") {
		t.Errorf("the page does not name the outage:\n%s", body)
	}
	if strings.Contains(body, "Canvas rechazó este token") {
		t.Error("an outage was rendered as a rejected token")
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, "canvas", "token"); !errors.Is(err, secret.ErrNotFound) {
		t.Errorf("a token was stored despite an unknown answer: %v", err)
	}
}

func TestForgettingTheTokenRemovesItAndRedirects(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	user, session := f.signIn(t)

	if rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}}); rec.Code != http.StatusSeeOther {
		t.Fatalf("saving: status = %d, want 303", rec.Code)
	}

	rec := f.post(t, session, handler.ProfileCanvasForgetPath, f.handler.ForgetCanvasToken, url.Values{})
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", rec.Code)
	}
	if _, err := f.secrets.Get(context.Background(), user.ID, "canvas", "token"); !errors.Is(err, secret.ErrNotFound) {
		t.Errorf("the token survived Forget: %v", err)
	}

	// Idempotent: a second click says the same thing rather than failing.
	if rec := f.post(t, session, handler.ProfileCanvasForgetPath, f.handler.ForgetCanvasToken,
		url.Values{}); rec.Code != http.StatusSeeOther {
		t.Errorf("a second Forget answered %d, want 303", rec.Code)
	}
}

// The unconfigured deployment: no master key, so no form, and the page names
// the variable — the person who can fix it is usually the one reading. This
// is the state ADR-0068 §Decision 3 chose over refusing to boot.
func TestWithoutAMasterKeyThePageExplainsInsteadOfOfferingAForm(t *testing.T) {
	f := newProfileFixture(t, nil)
	_, session := f.signIn(t)

	rec := f.get(t, session)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — an unconfigured integration is a page, not an error", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "NALANDA_SECRETS_MASTER_KEY") {
		t.Errorf("the page does not name the missing variable:\n%s", body)
	}
	if strings.Contains(body, `name="token"`) {
		t.Error("the page offers a token form it could not store anything from")
	}

	// A hand-typed POST reaches the same explanation rather than a 500,
	// and never touches Canvas.
	post := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {canvasToken}})
	if post.Code != http.StatusUnprocessableEntity {
		t.Errorf("a hand-typed POST answered %d, want 422", post.Code)
	}
	if len(f.api.seen) != 0 {
		t.Errorf("Canvas was asked %v by an unconfigured deployment, want nothing", f.api.seen)
	}
}

// The log is the one place a credential leaks with nobody attacking
// anything. Every branch of this handler writes at most a warning or an
// error; none of them may carry the token.
func TestNoLogLineEverCarriesTheToken(t *testing.T) {
	for _, c := range []struct {
		name string
		err  error
	}{
		{"the happy path", nil},
		{"canvas rejects it", canvas.ErrTokenRejected},
		{"canvas is unreachable", canvas.ErrUnavailable},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newProfileFixture(t, profileKey())
			_, session := f.signIn(t)
			f.api.err = c.err

			f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
				url.Values{"token": {canvasToken}})
			f.get(t, session)

			logged := f.logs.String()
			if strings.Contains(logged, canvasToken) {
				t.Errorf("a log line carries the token:\n%s", logged)
			}
			if strings.Contains(logged, canvasToken[:16]) {
				t.Errorf("a log line carries part of the token:\n%s", logged)
			}
		})
	}
}

// An empty submission is a blank form, not a credential: it is refused
// without asking Canvas about it.
func TestAnEmptySubmissionIsRefusedWithoutAskingCanvas(t *testing.T) {
	f := newProfileFixture(t, profileKey())
	_, session := f.signIn(t)

	rec := f.post(t, session, handler.ProfileCanvasTokenPath, f.handler.SaveCanvasToken,
		url.Values{"token": {""}})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", rec.Code)
	}
	if len(f.api.seen) != 0 {
		t.Errorf("Canvas was asked about an empty token: %v", f.api.seen)
	}
}
