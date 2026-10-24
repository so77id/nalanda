package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/app/web/middleware"
	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
	"github.com/so77id/nalanda/apps/server/internal/domain/uploads"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/authstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// The chunk, status and cancel routes are driven through the SAME middleware
// chain the router mounts — Resolve, RequireProfessor, VerifyCSRF — over a
// real session, because what they promise (the token rides in a header, the
// gate redirects an expired session) is a fact about that chain, not about
// the handler alone.

type uploadsFixture struct {
	service *uploads.Service
	root    string
	server  http.Handler
	prof    auth.User
	other   auth.User
	cookie  *http.Cookie
	csrf    string
}

func newUploadsFixture(t *testing.T) *uploadsFixture {
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
	store := authstore.New(db)
	prof, err := store.CreateUser(ctx, "profesora@example.com", "Profesora")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	other, err := store.CreateUser(ctx, "otro@example.com", "Otro")
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	token, _ := auth.NewToken()
	csrf, _ := auth.NewToken()
	now := time.Now()
	if err := store.CreateSession(ctx, auth.Session{
		TokenHash: auth.HashToken(token), UserID: prof.ID, CSRFToken: csrf,
		CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now,
	}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	root := filepath.Join(t.TempDir(), uploads.DirName)
	service := uploads.NewService(uploads.Service{Root: root, MaxBytes: 8 << 20, Log: log})
	h := handler.NewUploads(handler.Uploads{Service: service, Log: log})
	mux := http.NewServeMux()
	mux.HandleFunc(http.MethodPut+" "+handler.UploadPath, h.Append)
	mux.HandleFunc(http.MethodGet+" "+handler.UploadPath, h.Status)
	mux.HandleFunc(http.MethodDelete+" "+handler.UploadPath, h.Cancel)
	gate := middleware.NewAuth(middleware.Auth{
		Sessions: store, Users: store, Now: time.Now,
		PublicURL: publicURL, LoginPath: handler.LoginPath, Log: log,
	})
	return &uploadsFixture{
		service: service, root: root,
		server: gate.Resolve(gate.RequireProfessor(gate.VerifyCSRF(mux))),
		prof:   prof, other: other,
		cookie: &http.Cookie{Name: middleware.SessionCookieName(true), Value: token},
		csrf:   csrf,
	}
}

func (f *uploadsFixture) open(t *testing.T, professor int64, size int64) string {
	t.Helper()
	up, err := f.service.Create(professor, uploads.Subject{Kind: uploads.SubjectControl, ID: "MOZMMCHZLSQ3NEKN2P7CO5APNM"},
		"scan.pdf", size, nil)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return up.ID
}

// do sends one request as the signed-in professor. csrf is the header's value
// ("" sends no header at all).
func (f *uploadsFixture) do(t *testing.T, method, path, csrf string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/octet-stream")
	if csrf != "" {
		req.Header.Set(middleware.CSRFHeaderName, csrf)
	}
	req.AddCookie(f.cookie)
	rec := httptest.NewRecorder()
	f.server.ServeHTTP(rec, req)
	return rec
}

func (f *uploadsFixture) held(t *testing.T, id string) int64 {
	t.Helper()
	up, err := f.service.Status(f.prof.ID, id)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	return up.Received
}

// jsonBody decodes a JSON body, failing when it is not JSON at all.
func jsonBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json; body:\n%s", ct, rec.Body.String())
	}
	var v map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("the body is not JSON: %v\n%s", err, rec.Body.String())
	}
	return v
}

func chunkPath(id string, offset int64) string {
	return "/uploads/" + id + "?offset=" + strconv.FormatInt(offset, 10)
}

// AC-8 at the route: a chunk is accepted only with the session's token in
// the header — not without one, not with another.
func TestAChunkNeedsTheSessionsTokenInItsHeader(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 1000)
	chunk := bytes.Repeat([]byte("a"), 400)

	if rec := f.do(t, http.MethodPut, chunkPath(id, 0), "", chunk); rec.Code != http.StatusForbidden {
		t.Errorf("no header: status = %d, want 403", rec.Code)
	}
	if rec := f.do(t, http.MethodPut, chunkPath(id, 0), "a-token-from-elsewhere", chunk); rec.Code != http.StatusForbidden {
		t.Errorf("a wrong header: status = %d, want 403", rec.Code)
	}
	if got := f.held(t, id); got != 0 {
		t.Fatalf("a refused chunk was written: %d bytes held", got)
	}

	rec := f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, chunk)
	if rec.Code != http.StatusOK {
		t.Fatalf("the right header: status = %d, want 200; body:\n%s", rec.Code, rec.Body.String())
	}
	if got := jsonBody(t, rec)["received"]; got != float64(400) {
		t.Errorf("received = %v, want 400", got)
	}
	if got := f.held(t, id); got != 400 {
		t.Errorf("the partial holds %d bytes, want 400", got)
	}
}

// AC-5. A chunk at the wrong offset is a 409 whose body carries what the
// server holds, and nothing is written.
func TestAChunkAtTheWrongOffsetIs409WithWhatIsHeld(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 1000)
	_ = f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, bytes.Repeat([]byte("a"), 300))

	rec := f.do(t, http.MethodPut, chunkPath(id, 100), f.csrf, bytes.Repeat([]byte("b"), 50))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	body := jsonBody(t, rec)
	if body["received"] != float64(300) {
		t.Errorf("received = %v, want 300", body["received"])
	}
	if msg, _ := body["message"].(string); msg == "" {
		t.Error("the 409 carries no message for the page")
	}
	if got := f.held(t, id); got != 300 {
		t.Errorf("the refused chunk changed the partial: %d held, want 300", got)
	}
}

// A chunk larger than the cap is refused before it is read, and one that would
// carry the upload past its declared size is refused whole. Both 413.
func TestAnOversizedChunkIs413AndWritesNothing(t *testing.T) {
	t.Run("past the chunk cap", func(t *testing.T) {
		f := newUploadsFixture(t)
		id := f.open(t, f.prof.ID, 4<<20)
		rec := f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, bytes.Repeat([]byte("a"), uploads.ChunkBytes+1))
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want 413", rec.Code)
		}
		if got := f.held(t, id); got != 0 {
			t.Errorf("an oversized chunk left %d bytes", got)
		}
	})
	t.Run("past the declared size", func(t *testing.T) {
		f := newUploadsFixture(t)
		id := f.open(t, f.prof.ID, 100)
		rec := f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, bytes.Repeat([]byte("a"), 101))
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("status = %d, want 413", rec.Code)
		}
		if msg, _ := jsonBody(t, rec)["message"].(string); msg == "" {
			t.Error("the 413 carries no message for the page")
		}
		if got := f.held(t, id); got != 0 {
			t.Errorf("a chunk past the size left %d bytes", got)
		}
	})
}

func TestAnOffsetThatIsNotANumberIs400(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 100)
	for _, q := range []string{"", "?offset=", "?offset=-1", "?offset=abc", "?offset=1e3"} {
		rec := f.do(t, http.MethodPut, "/uploads/"+id+q, f.csrf, []byte("a"))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%q: status = %d, want 400", q, rec.Code)
		}
	}
	if got := f.held(t, id); got != 0 {
		t.Errorf("a refused chunk left %d bytes", got)
	}
}

// AC-7 at the route. An unknown uid, another professor's and a malformed one
// answer the same 404 with the same body, on every verb — no oracle.
func TestUnknownForeignAndMalformedUploadsAreTheSame404(t *testing.T) {
	f := newUploadsFixture(t)
	theirs := f.open(t, f.other.ID, 100)

	var bodies []string
	for _, id := range []string{"AAAAAAAAAAAAAAAAAAAAAAAAAA", theirs, "not-an-upload"} {
		for _, call := range []struct {
			method, path string
			body         []byte
		}{
			{http.MethodGet, "/uploads/" + id, nil},
			{http.MethodPut, chunkPath(id, 0), []byte("a")},
			{http.MethodDelete, "/uploads/" + id, nil},
		} {
			rec := f.do(t, call.method, call.path, f.csrf, call.body)
			if rec.Code != http.StatusNotFound {
				t.Errorf("%s %s: status = %d, want 404", call.method, call.path, rec.Code)
			}
			bodies = append(bodies, rec.Body.String())
		}
	}
	for _, b := range bodies[1:] {
		if b != bodies[0] {
			t.Errorf("two 404 bodies differ, which tells a caller which uid exists:\n%s\n%s", bodies[0], b)
		}
	}
	if _, err := f.service.Status(f.other.ID, theirs); err != nil {
		t.Errorf("another professor's upload was touched: %v", err)
	}
}

// Status is how the page resynchronises after any error; it must never come
// from a cache.
func TestStatusAnswersWhatIsHeldAndIsNeverCached(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 1000)
	_ = f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, bytes.Repeat([]byte("a"), 250))

	rec := f.do(t, http.MethodGet, "/uploads/"+id, "", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := jsonBody(t, rec)
	if body["received"] != float64(250) || body["size"] != float64(1000) {
		t.Errorf("body = %v, want received 250 of size 1000", body)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

// AC-9's Cancelar: the partial goes at once.
func TestCancelRemovesThePartialAtOnce(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 1000)
	_ = f.do(t, http.MethodPut, chunkPath(id, 0), f.csrf, bytes.Repeat([]byte("a"), 250))

	if rec := f.do(t, http.MethodDelete, "/uploads/"+id, "", nil); rec.Code != http.StatusForbidden {
		t.Errorf("a cancel without the token: status = %d, want 403", rec.Code)
	}
	rec := f.do(t, http.MethodDelete, "/uploads/"+id, f.csrf, nil)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if left, _ := os.ReadDir(f.root); len(left) != 0 {
		t.Errorf("Cancelar left %d files", len(left))
	}
}

// AC-12's first half: a chunk sent after the session expired is answered by
// the gate with the way back to the login page — not with JSON, which is how
// the page tells "sign in again" apart from every other answer.
func TestAChunkWithNoSessionIsSentToTheLoginPage(t *testing.T) {
	f := newUploadsFixture(t)
	id := f.open(t, f.prof.ID, 1000)

	req := httptest.NewRequest(http.MethodPut, chunkPath(id, 0), strings.NewReader("a"))
	req.Header.Set(middleware.CSRFHeaderName, f.csrf)
	rec := httptest.NewRecorder()
	f.server.ServeHTTP(rec, req)

	if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.LoginPath {
		t.Errorf("status = %d, Location = %q; want 303 to %s", rec.Code, rec.Header().Get("Location"), handler.LoginPath)
	}
	if got := f.held(t, id); got != 0 {
		t.Errorf("a chunk with no session was written: %d bytes", got)
	}
}

// failsAfter is a request body that delivers a prefix and then fails.
type failsAfter struct {
	prefix io.Reader
	err    error
}

func (f *failsAfter) Read(p []byte) (int, error) {
	n, err := f.prefix.Read(p)
	if errors.Is(err, io.EOF) {
		return n, f.err
	}
	return n, err
}

// A chunk whose body fails part-way keeps what arrived and says how much — a
// link that dropped is not a server that broke, and the page resumes from the
// number. The read deadline is told apart as a 408.
func TestACutChunkAnswersWhatArrived(t *testing.T) {
	for _, c := range []struct {
		name   string
		prefix int
		err    error
		status int
	}{
		{"the link dropped after some bytes", 300, io.ErrUnexpectedEOF, http.StatusBadRequest},
		{"the link dropped before any byte", 0, io.ErrUnexpectedEOF, http.StatusBadRequest},
		{"the read deadline passed", 300, &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}, http.StatusRequestTimeout},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newUploadsFixture(t)
			id := f.open(t, f.prof.ID, 1000)
			body := &failsAfter{prefix: bytes.NewReader(bytes.Repeat([]byte("a"), c.prefix)), err: c.err}
			req := httptest.NewRequest(http.MethodPut, chunkPath(id, 0), body)
			req.Header.Set(middleware.CSRFHeaderName, f.csrf)
			req.AddCookie(f.cookie)
			rec := httptest.NewRecorder()
			f.server.ServeHTTP(rec, req)

			if rec.Code != c.status {
				t.Errorf("status = %d, want %d", rec.Code, c.status)
			}
			if got := jsonBody(t, rec)["received"]; got != float64(c.prefix) {
				t.Errorf("received = %v, want %d", got, c.prefix)
			}
			if got := f.held(t, id); got != int64(c.prefix) {
				t.Errorf("the partial holds %d bytes, want %d", got, c.prefix)
			}
		})
	}
}
