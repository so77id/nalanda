package middleware_test

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// These run against a real SQLite database rather than a fake store. The
// middleware's job is to turn a cookie into a professor, and most of what can go
// wrong in that sentence — an expired row, a deactivated professor, a hash that
// matches nothing — is a fact about the database. A fake would agree with
// whatever the middleware believed.

// harness holds everything a case needs: the store, the middleware under test,
// and a recorder of what the wrapped handler saw.
type harness struct {
	db    *sql.DB
	store *authstore.Store
	auth  *middleware.Auth
	now   time.Time

	// seen is what the wrapped handler found in the request context.
	seenProfessor auth.User
	seenOK        bool
	handlerRan    bool
}

func newHarness(t *testing.T) *harness {
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

	h := &harness{
		db:    db,
		store: authstore.New(db),
		now:   time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC),
	}
	h.auth = &middleware.Auth{
		Sessions:     h.store,
		Users:        h.store,
		Now:          func() time.Time { return h.now },
		SecureCookie: true,
		Log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	return h
}

// next is the handler the middleware wraps: it records what it saw.
func (h *harness) next() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.handlerRan = true
		h.seenProfessor, h.seenOK = middleware.ProfessorFrom(r.Context())
		w.WriteHeader(http.StatusOK)
	})
}

// login creates a professor and a live session, returning the raw cookie token.
func (h *harness) login(t *testing.T, email string) (auth.User, string) {
	t.Helper()

	ctx := context.Background()
	user, err := h.store.CreateUser(ctx, email, "Profesora")
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
	if err := h.store.CreateSession(ctx, auth.Session{
		TokenHash:  auth.HashToken(token),
		UserID:     user.ID,
		CSRFToken:  csrf,
		CreatedAt:  h.now,
		ExpiresAt:  h.now.Add(time.Hour),
		LastSeenAt: h.now,
	}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return user, token
}

// request runs one GET through the resolver, carrying token as the cookie when
// it is not empty.
func (h *harness) request(handler http.Handler, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: token})
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

// clearedCookie reports whether the response tells the browser to drop the
// session cookie.
func clearedCookie(t *testing.T, recorder *httptest.ResponseRecorder) bool {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == middleware.SessionCookieName && cookie.MaxAge < 0 {
			return true
		}
	}
	return false
}

// deactivate flips is_active with SQL rather than through the store, on purpose:
// this WP only READS that column. The screen and the store method that write it
// are WP-C3, and adding one here would be a domain method with no caller.
func (h *harness) deactivate(t *testing.T, userID int64) {
	t.Helper()

	if _, err := h.db.ExecContext(context.Background(),
		"UPDATE users SET is_active = 0, deactivated_at = ? WHERE user_id = ?", h.now.Unix(), userID); err != nil {
		t.Fatalf("deactivating the professor: %v", err)
	}
}

func TestResolveAttachesTheProfessorOfALiveSession(t *testing.T) {
	h := newHarness(t)
	user, token := h.login(t, "profesora@example.com")

	h.request(h.auth.Resolve(h.next()), token)

	if !h.seenOK {
		t.Fatal("the handler saw no professor on a live session")
	}
	if h.seenProfessor.ID != user.ID {
		t.Errorf("the handler saw professor %d, want %d", h.seenProfessor.ID, user.ID)
	}
}

// A request with no cookie is the normal case — every anonymous visit — and must
// pass through rather than fail. The gate is a separate middleware precisely so
// that resolving and requiring are different decisions.
func TestResolveLetsAnAnonymousRequestThrough(t *testing.T) {
	h := newHarness(t)

	recorder := h.request(h.auth.Resolve(h.next()), "")

	if !h.handlerRan {
		t.Error("the handler did not run for an anonymous request")
	}
	if h.seenOK {
		t.Error("the handler saw a professor on a request with no cookie")
	}
	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", recorder.Code)
	}
}

func TestResolveRefusesASessionThatHasExpired(t *testing.T) {
	h := newHarness(t)
	_, token := h.login(t, "profesora@example.com")

	// Past the session's expiry, which login set an hour out.
	h.now = h.now.Add(2 * time.Hour)

	recorder := h.request(h.auth.Resolve(h.next()), token)

	if h.seenOK {
		t.Error("the handler saw a professor on an expired session")
	}
	if !clearedCookie(t, recorder) {
		t.Error("the expired session's cookie was not cleared, so the browser keeps sending it")
	}
	// And the row is gone: a session that can never be used again is not worth
	// keeping, and sweeping it here is what stops the table growing forever
	// without a separate job to do it.
	if _, err := h.store.SessionByTokenHash(context.Background(), auth.HashToken(token)); err == nil {
		t.Error("the expired session row survived the request that rejected it")
	}
}

func TestResolveRefusesACookieThatMatchesNoSession(t *testing.T) {
	h := newHarness(t)

	recorder := h.request(h.auth.Resolve(h.next()), "a-token-nobody-issued")

	if h.seenOK {
		t.Error("the handler saw a professor for a cookie that matches no session")
	}
	if !clearedCookie(t, recorder) {
		t.Error("the unusable cookie was not cleared")
	}
}

// A professor deactivated while holding a live cookie is out on their next
// request. This is the whole reason users.is_active exists in this WP, before
// the screen that flips it (WP-C3).
func TestResolveRefusesADeactivatedProfessor(t *testing.T) {
	h := newHarness(t)
	user, token := h.login(t, "profesora@example.com")

	h.deactivate(t, user.ID)

	recorder := h.request(h.auth.Resolve(h.next()), token)

	if h.seenOK {
		t.Error("the handler saw a deactivated professor")
	}
	if !clearedCookie(t, recorder) {
		t.Error("the deactivated professor's cookie was not cleared")
	}
	if _, err := h.store.SessionByTokenHash(context.Background(), auth.HashToken(token)); err == nil {
		t.Error("the deactivated professor's session survived")
	}
}

// The session is touched so an operator can see when it was last used. Asserted
// because it is the kind of side effect that is silently dropped in a refactor
// and that nothing else would notice.
func TestResolveRecordsThatTheSessionWasUsed(t *testing.T) {
	h := newHarness(t)
	_, token := h.login(t, "profesora@example.com")

	h.now = h.now.Add(10 * time.Minute)
	h.request(h.auth.Resolve(h.next()), token)

	session, err := h.store.SessionByTokenHash(context.Background(), auth.HashToken(token))
	if err != nil {
		t.Fatalf("SessionByTokenHash: %v", err)
	}
	if !session.LastSeenAt.Equal(h.now) {
		t.Errorf("LastSeenAt = %v, want %v", session.LastSeenAt, h.now)
	}
}

func TestRequireProfessorSendsAnAnonymousRequestToTheLoginPage(t *testing.T) {
	h := newHarness(t)

	recorder := h.request(h.auth.Resolve(h.auth.RequireProfessor(h.next())), "")

	if h.handlerRan {
		t.Error("the gated handler ran for an anonymous request")
	}
	if recorder.Code != http.StatusSeeOther {
		t.Errorf("status = %d, want 303", recorder.Code)
	}
	if location := recorder.Header().Get("Location"); !strings.HasPrefix(location, "/login") {
		t.Errorf("Location = %q, want the login page", location)
	}
}

func TestRequireProfessorLetsASignedInProfessorThrough(t *testing.T) {
	h := newHarness(t)
	_, token := h.login(t, "profesora@example.com")

	recorder := h.request(h.auth.Resolve(h.auth.RequireProfessor(h.next())), token)

	if !h.handlerRan {
		t.Error("the gated handler did not run for a signed-in professor")
	}
	if recorder.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", recorder.Code)
	}
}

// AC-4, proved by performing the violation rather than by reading the code.
func TestCSRF(t *testing.T) {
	post := func(t *testing.T, h *harness, token, csrf string) *httptest.ResponseRecorder {
		t.Helper()

		form := url.Values{}
		if csrf != "" {
			form.Set(middleware.CSRFFieldName, csrf)
		}
		req := httptest.NewRequest(http.MethodPost, "/logout", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if token != "" {
			req.AddCookie(&http.Cookie{Name: middleware.SessionCookieName, Value: token})
		}
		recorder := httptest.NewRecorder()
		h.auth.Resolve(h.auth.RequireProfessor(h.auth.VerifyCSRF(h.next()))).ServeHTTP(recorder, req)
		return recorder
	}

	t.Run("a state-changing request with no token is refused", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.login(t, "profesora@example.com")

		recorder := post(t, h, token, "")

		if h.handlerRan {
			t.Error("the handler ran for a POST with no CSRF token")
		}
		if recorder.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", recorder.Code)
		}
	})

	t.Run("a state-changing request with another session's token is refused", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.login(t, "profesora@example.com")

		recorder := post(t, h, token, "a-csrf-token-from-somewhere-else")

		if h.handlerRan {
			t.Error("the handler ran for a POST with the wrong CSRF token")
		}
		if recorder.Code != http.StatusForbidden {
			t.Errorf("status = %d, want 403", recorder.Code)
		}
	})

	t.Run("the session's own token is accepted", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.login(t, "profesora@example.com")

		session, err := h.store.SessionByTokenHash(context.Background(), auth.HashToken(token))
		if err != nil {
			t.Fatalf("SessionByTokenHash: %v", err)
		}

		recorder := post(t, h, token, session.CSRFToken)

		if !h.handlerRan {
			t.Error("the handler did not run for a POST carrying the session's own CSRF token")
		}
		if recorder.Code != http.StatusOK {
			t.Errorf("status = %d, want 200", recorder.Code)
		}
	})

	t.Run("a safe method needs no token", func(t *testing.T) {
		h := newHarness(t)
		_, token := h.login(t, "profesora@example.com")

		h.request(h.auth.Resolve(h.auth.RequireProfessor(h.auth.VerifyCSRF(h.next()))), token)

		if !h.handlerRan {
			t.Error("a GET was refused for carrying no CSRF token")
		}
	})
}

// The cookie's attributes are each load-bearing and none of them is visible in
// any other test: HttpOnly keeps a script from reading the session, SameSite
// keeps a cross-site form from riding it, Path scopes it to the whole site, and
// Secure is what the configuration derives from the public URL.
func TestTheSessionCookieCarriesItsProtections(t *testing.T) {
	for _, secure := range []bool{true, false} {
		name := "over https"
		if !secure {
			name = "over http"
		}
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			expires := time.Date(2026, time.September, 16, 12, 0, 0, 0, time.UTC)

			middleware.SetSessionCookie(recorder, "the-token", expires, secure)

			cookies := recorder.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("the response carries %d cookies, want 1", len(cookies))
			}
			cookie := cookies[0]

			if cookie.Name != middleware.SessionCookieName || cookie.Value != "the-token" {
				t.Errorf("cookie = %s=%s", cookie.Name, cookie.Value)
			}
			if !cookie.HttpOnly {
				t.Error("the session cookie is readable by scripts")
			}
			if cookie.SameSite != http.SameSiteLaxMode {
				t.Errorf("SameSite = %v, want Lax", cookie.SameSite)
			}
			if cookie.Path != "/" {
				t.Errorf("Path = %q, want /", cookie.Path)
			}
			if cookie.Secure != secure {
				t.Errorf("Secure = %v, want %v", cookie.Secure, secure)
			}
			if !cookie.Expires.Equal(expires) {
				t.Errorf("Expires = %v, want %v", cookie.Expires, expires)
			}
		})
	}
}

// failingSessions answers every lookup with a transport-shaped failure — the
// database being unreachable, not the row being absent.
type failingSessions struct {
	auth.SessionStore
	err error
}

func (f failingSessions) SessionByTokenHash(context.Context, string) (auth.Session, error) {
	return auth.Session{}, f.err
}

// A database that cannot answer is not a logged-out professor, and the
// difference matters at exactly the wrong moment: under load, or during a
// backup, clearing the cookie would log every professor out at once and none of
// them could log back in while the trouble lasted. The request proceeds
// anonymous — the gate will redirect it — but the cookie survives.
func TestResolveDoesNotLogAnyoneOutOverADatabaseError(t *testing.T) {
	h := newHarness(t)
	_, token := h.login(t, "profesora@example.com")
	h.auth.Sessions = failingSessions{SessionStore: h.store, err: errors.New("database is locked")}

	recorder := h.request(h.auth.Resolve(h.next()), token)

	if h.seenOK {
		t.Error("the handler saw a professor although the session could not be read")
	}
	if !h.handlerRan {
		t.Error("the request was refused outright, want it to continue as anonymous")
	}
	if clearedCookie(t, recorder) {
		t.Error("the cookie was cleared over a database error, which logs everyone out for the duration")
	}
}
