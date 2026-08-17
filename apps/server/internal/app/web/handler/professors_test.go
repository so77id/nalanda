package handler_test

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
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
		Users: f.store,
		Admin: auth.NewAdmin(auth.Admin{
			Users:    f.store,
			Sessions: f.store,
			Now:      func() time.Time { return f.now },
		}),
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
//
// Also parses {id} out of the path so r.PathValue("id") resolves the way it
// would through the mux — the handlers use r.PathValue, and a direct call
// that skipped this would render a 404 for every parameterised route.
func (f *professorsFixture) get(t *testing.T, path, token string, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	setPathValues(request, path)
	if token != "" {
		request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: token})
	}
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(h)).ServeHTTP(recorder, request)
	return recorder
}

// setPathValues mimics what the mux does for parameterised routes: reads
// /professors/{id} or /professors/{id}/edit and binds the numeric component
// to r.PathValue("id"). Kept narrow — the mux is what runs in production;
// this helper only exists so a direct handler call in a test does not blank
// the id.
func setPathValues(r *http.Request, path string) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) >= 2 && parts[0] == "professors" {
		if _, err := strconvAtoi(parts[1]); err == nil {
			r.SetPathValue("id", parts[1])
		}
	}
}

func strconvAtoi(s string) (int, error) {
	return strconv.Atoi(s)
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

// The list also OFFERS to create: the "Añadir profesora" link is the way in
// to the New form. Kept as an assertion because a form no reader can reach
// is a screen that only shows up in the test suite.
func TestListLinksToTheCreateForm(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token := f.signIn(t, "yo@example.com")

	recorder := f.get(t, "/professors", token, f.handler.List)
	body := recorder.Body.String()

	if !strings.Contains(body, `href="/professors/new"`) {
		t.Errorf("list page missing the link to /professors/new\n---\n%s", body)
	}
}

// signInWithCSRF opens a session and returns the cookie and the session's
// CSRF token, both of which a POST needs to survive the middleware.
func (f *professorsFixture) signInWithCSRF(t *testing.T, email string) (auth.User, string, string) {
	t.Helper()
	user, token := f.signIn(t, email)
	session, err := f.store.SessionByTokenHash(context.Background(), auth.HashToken(token))
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	return user, token, session.CSRFToken
}

// post runs a signed-in POST through the middleware chain. The values are
// URL-encoded; the CSRF field is added when csrf != "".
func (f *professorsFixture) post(t *testing.T, path, token, csrf string, values url.Values, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	if csrf != "" {
		if values == nil {
			values = url.Values{}
		}
		values.Set(middleware.CSRFFieldName, csrf)
	}
	body := ""
	if values != nil {
		body = values.Encode()
	}
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	setPathValues(request, path)
	if token != "" {
		request.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: token})
	}
	recorder := httptest.NewRecorder()
	f.middleware.Resolve(f.middleware.RequireProfessor(f.middleware.VerifyCSRF(h))).ServeHTTP(recorder, request)
	return recorder
}

// GET /professors/new renders the create form.
func TestNewRendersTheCreateForm(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	recorder := f.get(t, "/professors/new", token, f.handler.New)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()

	for _, want := range []string{
		`method="post" action="/professors"`,
		`name="email"`,
		`name="name"`,
		fmt.Sprintf(`value="%s"`, csrf), // the CSRF hidden field must carry the session's own token
		`type="submit"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("form missing %q\n---\n%s", want, body)
		}
	}
}

// AC-5, load-bearing: creating by address + name works, then the callback
// exchange for THAT address links the identity — the Authenticate path (2)
// this WP was refined for.
func TestCreatePersistsTheProfessorAndSetsAFlashOnRedirect(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	values := url.Values{"email": []string{"Nueva@example.com"}, "name": []string{"Nueva"}}
	recorder := f.post(t, "/professors", token, csrf, values, f.handler.Create)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 (POST/redirect/GET)", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); location != "/professors" {
		t.Errorf("Location = %q, want %q", location, "/professors")
	}

	// The row exists, with the address folded per the schema's COLLATE
	// NOCASE — a look-up in lowercase must find it.
	created, err := f.store.UserByEmail(context.Background(), "nueva@example.com")
	if err != nil {
		t.Fatalf("UserByEmail: %v", err)
	}
	if created.Name != "Nueva" {
		t.Errorf("stored Name = %q, want %q", created.Name, "Nueva")
	}

	// The flash cookie is set — S8 will show it, this asserts the "message
	// crosses POST/redirect/GET" half.
	found := false
	for _, c := range recorder.Result().Cookies() {
		if c.Name == "nalanda_flash" && c.Value != "" {
			found = true
		}
	}
	if !found {
		t.Error("no flash cookie set after a successful create")
	}
}

// The form / validation / error convention this WP writes down. Errors are
// re-rendered on the SAME form with the values preserved so the professor
// does not retype them, status 422 (Unprocessable Entity) so a client can
// tell a rejection apart from a redirect, and the invalid rejection does
// not leak into the URL.
func TestCreateWithMissingFieldsRerendersTheFormWithErrors(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	values := url.Values{"email": []string{""}, "name": []string{""}}
	recorder := f.post(t, "/professors", token, csrf, values, f.handler.Create)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (form re-rendered with errors)", recorder.Code)
	}
	body := recorder.Body.String()
	// One error per empty field.
	if !strings.Contains(body, `class="error"`) {
		t.Errorf("body missing error markup\n---\n%s", body)
	}
	// Nothing was created.
	if _, err := f.store.UserByEmail(context.Background(), ""); !errors.Is(err, auth.ErrNotFound) {
		t.Error("a professor was created with an empty address")
	}
}

func TestCreateWithMalformedEmailRerendersWithError(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	values := url.Values{"email": []string{"not-an-email"}, "name": []string{"Nueva"}}
	recorder := f.post(t, "/professors", token, csrf, values, f.handler.Create)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (malformed email)", recorder.Code)
	}
	// The value the professor typed comes back so they can fix it in place.
	body := recorder.Body.String()
	if !strings.Contains(body, `value="not-an-email"`) {
		t.Errorf("body did not preserve the entered email\n---\n%s", body)
	}
	if !strings.Contains(body, `value="Nueva"`) {
		t.Errorf("body did not preserve the entered name\n---\n%s", body)
	}
}

// A duplicate must not 500. The schema's UNIQUE constraint is what would
// otherwise reach the reader as a Go error string with SQLite's own text.
// S7: edit the name only. Same form template as Create, address readonly.
func TestEditRendersTheFormPreFilledAndWithTheAddressReadonly(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token := f.signIn(t, "yo@example.com")

	target, err := f.store.CreateUser(context.Background(), "profesora@example.com", "Antes")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	path := fmt.Sprintf("/professors/%d/edit", target.ID)
	recorder := f.get(t, path, token, f.handler.Edit)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	body := recorder.Body.String()
	for _, want := range []string{
		`value="profesora@example.com"`,
		`readonly`,
		`value="Antes"`,
		fmt.Sprintf(`action="/professors/%d"`, target.ID),
	} {
		if !strings.Contains(body, want) {
			t.Errorf("edit form missing %q\n---\n%s", want, body)
		}
	}
}

func TestEditOnAnUnknownProfessorIs404(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token := f.signIn(t, "yo@example.com")

	recorder := f.get(t, "/professors/9999/edit", token, f.handler.Edit)

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 through the shell", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "<!doctype html>") {
		t.Error("body missing the shell doctype: the 404 must go through the shell")
	}
}

func TestUpdatePersistsTheNewNameAndFlashes(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	target, err := f.store.CreateUser(context.Background(), "profesora@example.com", "Antes")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	path := fmt.Sprintf("/professors/%d", target.ID)
	values := url.Values{"name": []string{"Después"}, "email": []string{"ignored@example.com"}}
	recorder := f.post(t, path, token, csrf, values, f.handler.Update)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 (POST/redirect/GET)", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); location != "/professors" {
		t.Errorf("Location = %q, want %q", location, "/professors")
	}

	got, err := f.store.UserByID(context.Background(), target.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if got.Name != "Después" {
		t.Errorf("stored Name = %q, want %q", got.Name, "Después")
	}
	// The address was NOT changed by an email posted in the body: the input
	// is readonly and the handler ignores it — otherwise a professor could
	// rewrite anyone's address by inspecting the form (issue #151 §Non-goals).
	if got.Email != "profesora@example.com" {
		t.Errorf("stored Email = %q, want %q (the address must not be editable)", got.Email, "profesora@example.com")
	}

	// Flash cookie set for the redirected GET to consume.
	var flashCookie *http.Cookie
	for _, c := range recorder.Result().Cookies() {
		if c.Name == "nalanda_flash" && c.Value != "" {
			flashCookie = c
		}
	}
	if flashCookie == nil {
		t.Error("no flash cookie set after a successful update")
	}
}

func TestUpdateWithAnEmptyNameRerendersWithError(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	target, err := f.store.CreateUser(context.Background(), "profesora@example.com", "Antes")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	path := fmt.Sprintf("/professors/%d", target.ID)
	values := url.Values{"name": []string{""}}
	recorder := f.post(t, path, token, csrf, values, f.handler.Update)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (empty name rejection)", recorder.Code)
	}
	// The row was not touched.
	got, err := f.store.UserByID(context.Background(), target.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if got.Name != "Antes" {
		t.Errorf("stored Name = %q, want %q", got.Name, "Antes")
	}
}

func TestUpdateOnAnUnknownProfessorIs404(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	values := url.Values{"name": []string{"Cualquiera"}}
	recorder := f.post(t, "/professors/9999", token, csrf, values, f.handler.Update)

	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
}

// S8: deactivate/reactivate at the handler layer. The domain enforces the
// guards; here we assert that the domain's answer reaches the professor as
// the Spanish flash the WP promises (AC-8).

func TestDeactivateRedirectsWithFlashAndCallsTheDomain(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	target, err := f.store.CreateUser(context.Background(), "otra@example.com", "Otra")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	path := fmt.Sprintf("/professors/%d/deactivate", target.ID)
	recorder := f.post(t, path, token, csrf, nil, f.handler.Deactivate)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 (POST/redirect/GET)", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); location != "/professors" {
		t.Errorf("Location = %q, want %q", location, "/professors")
	}

	// The row is inactive.
	got, err := f.store.UserByID(context.Background(), target.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if got.IsActive {
		t.Error("target is still active after Deactivate")
	}
	if got.DeactivatedAt == nil {
		t.Error("DeactivatedAt is nil after Deactivate")
	}
	// A flash cookie is set for the redirected GET to consume.
	if !hasFlash(recorder) {
		t.Error("no flash cookie set after a successful deactivation")
	}
}

func TestDeactivateRefusesSelfWithASpanishFlash(t *testing.T) {
	f := newProfessorsFixture(t)
	me, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	path := fmt.Sprintf("/professors/%d/deactivate", me.ID)
	recorder := f.post(t, path, token, csrf, nil, f.handler.Deactivate)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303 — a refused deactivation is a flash + redirect, not a 4xx (AC-8)", recorder.Code)
	}

	// The row is still active — a refused deactivation must not touch state.
	got, err := f.store.UserByID(context.Background(), me.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if !got.IsActive {
		t.Error("self went inactive after a refused self-deactivation")
	}

	// The flash carries the Spanish "cannot deactivate yourself" message,
	// verified by decoding the cookie the way the flash package does on
	// consume.
	msg := readFlash(t, recorder)
	if !strings.Contains(msg, "No puedes desactivarte") {
		t.Errorf("flash = %q, want the Spanish 'No puedes desactivarte' message", msg)
	}
}

func TestReactivateRedirectsWithFlash(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	target, err := f.store.CreateUser(context.Background(), "otra@example.com", "Otra")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if _, err := f.store.SetActive(context.Background(), target.ID, false, f.now); err != nil {
		t.Fatalf("SetActive: %v", err)
	}

	path := fmt.Sprintf("/professors/%d/reactivate", target.ID)
	recorder := f.post(t, path, token, csrf, nil, f.handler.Reactivate)

	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", recorder.Code)
	}
	got, err := f.store.UserByID(context.Background(), target.ID)
	if err != nil {
		t.Fatalf("UserByID: %v", err)
	}
	if !got.IsActive {
		t.Error("target is still inactive after Reactivate")
	}
	if !hasFlash(recorder) {
		t.Error("no flash cookie set after Reactivate")
	}
}

// hasFlash and readFlash mirror what flash.Consume does — decoded with the
// same encoding, so a change to the encoding shows up here.
func hasFlash(recorder *httptest.ResponseRecorder) bool {
	for _, c := range recorder.Result().Cookies() {
		if c.Name == "nalanda_flash" && c.Value != "" {
			return true
		}
	}
	return false
}

func readFlash(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	for _, c := range recorder.Result().Cookies() {
		if c.Name == "nalanda_flash" && c.Value != "" {
			decoded, err := base64.URLEncoding.DecodeString(c.Value)
			if err != nil {
				t.Fatalf("decoding the flash: %v", err)
			}
			return string(decoded)
		}
	}
	t.Fatal("no flash cookie present")
	return ""
}

func TestCreateWithADuplicateEmailRerendersWithError(t *testing.T) {
	f := newProfessorsFixture(t)
	_, token, csrf := f.signInWithCSRF(t, "yo@example.com")

	// Seed the row this test is going to try to duplicate.
	if _, err := f.store.CreateUser(context.Background(), "ocupado@example.com", "Ocupado"); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	values := url.Values{"email": []string{"ocupado@example.com"}, "name": []string{"Otra"}}
	recorder := f.post(t, "/professors", token, csrf, values, f.handler.Create)

	if recorder.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 for a duplicate email", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "Ya existe") {
		t.Errorf("body missing the Spanish 'Ya existe' message\n---\n%s", recorder.Body.String())
	}
}
