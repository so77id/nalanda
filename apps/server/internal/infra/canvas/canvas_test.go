package canvas_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	domaincanvas "github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/infra/canvas"
)

// A fake Canvas, the way oidctest.Provider is a fake Google. Nothing here
// reaches the real UDP Canvas — that is a human's check (issue #271 S8), for
// the same reason GOOGLE-CHECK.md exists.

const token = "1234~AbCdEfGhIjKlMnOpQrStUvWxYz"

// fakeCanvas records what it was asked and answers what the case tells it
// to.
type fakeCanvas struct {
	status int
	body   string

	gotAuth        string
	gotContentType string
	gotMethod      string
	gotQuery       string
	calls          int
}

func (f *fakeCanvas) start(t *testing.T) string {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls++
		f.gotMethod = r.Method
		f.gotAuth = r.Header.Get("Authorization")
		f.gotContentType = r.Header.Get("Content-Type")

		raw, _ := io.ReadAll(r.Body)
		var payload struct {
			Query string `json:"query"`
		}
		_ = json.Unmarshal(raw, &payload)
		f.gotQuery = payload.Query

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(f.status)
		_, _ = io.WriteString(w, f.body)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestVerifyAcceptsATokenCanvasAnswersFor(t *testing.T) {
	fake := &fakeCanvas{status: http.StatusOK, body: `{"data":{"__typename":"Query"}}`}
	client := canvas.New(fake.start(t))

	if err := client.Verify(context.Background(), token); err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if fake.gotMethod != http.MethodPost {
		t.Errorf("method = %s, want POST", fake.gotMethod)
	}
	if want := "Bearer " + token; fake.gotAuth != want {
		t.Errorf("Authorization = %q, want %q", fake.gotAuth, want)
	}
	if fake.gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", fake.gotContentType)
	}
	// The verification asks nothing of Canvas's own schema, so it cannot
	// break when Canvas changes its types.
	if !strings.Contains(fake.gotQuery, "__typename") {
		t.Errorf("query = %q, want the schema-independent __typename probe", fake.gotQuery)
	}
}

// 401 and 403 are the only two answers that mean "this token is bad". They
// are the only two that let the caller store nothing AND tell the professor
// to paste another one.
func TestVerifyRejectsTheTokenOnlyOnAnAuthenticationStatus(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			fake := &fakeCanvas{status: status, body: `{"errors":[{"message":"user authorization required"}]}`}
			client := canvas.New(fake.start(t))

			err := client.Verify(context.Background(), token)
			if !errors.Is(err, domaincanvas.ErrTokenRejected) {
				t.Errorf("Verify returned %v, want ErrTokenRejected", err)
			}
			if errors.Is(err, domaincanvas.ErrUnavailable) {
				t.Error("a rejection also matched ErrUnavailable; the two must stay apart")
			}
		})
	}
}

// Everything else says nothing about the token. Reporting any of these as a
// rejection would tell a professor with a perfectly good token to go and
// generate another one.
func TestVerifyReportsUnavailableForEveryAnswerThatIsNotAboutTheToken(t *testing.T) {
	for _, c := range []struct {
		name   string
		status int
		body   string
	}{
		{"a 500 from Canvas", http.StatusInternalServerError, `{"errors":[{"message":"boom"}]}`},
		{"a 502 from a proxy", http.StatusBadGateway, `<html>gateway</html>`},
		{"a 429 rate limit", http.StatusTooManyRequests, `{"errors":[{"message":"rate limited"}]}`},
		{"a 200 with a body that is not JSON", http.StatusOK, `<html>maintenance</html>`},
		{"a 200 carrying GraphQL errors", http.StatusOK, `{"errors":[{"message":"__typename is disabled"}]}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			fake := &fakeCanvas{status: c.status, body: c.body}
			client := canvas.New(fake.start(t))

			err := client.Verify(context.Background(), token)
			if !errors.Is(err, domaincanvas.ErrUnavailable) {
				t.Errorf("Verify returned %v, want ErrUnavailable", err)
			}
			if errors.Is(err, domaincanvas.ErrTokenRejected) {
				t.Error("an unreadable answer was reported as a rejected token")
			}
		})
	}
}

// A Canvas that is not there at all: the connection itself fails. Same
// verdict as an unreadable answer, and worth its own case because it takes a
// different branch (the transport error rather than a status).
func TestVerifyReportsUnavailableWhenCanvasCannotBeReached(t *testing.T) {
	// A server started and immediately closed leaves a port nothing is
	// listening on — a refused connection rather than a timeout, so the
	// case is fast and deterministic.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()

	err := canvas.New(url).Verify(context.Background(), token)
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Verify returned %v, want ErrUnavailable", err)
	}
}

// A cancelled request is the professor closing the tab, not a bad token.
func TestVerifyHonoursTheContext(t *testing.T) {
	fake := &fakeCanvas{status: http.StatusOK, body: `{"data":{"__typename":"Query"}}`}
	client := canvas.New(fake.start(t))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := client.Verify(ctx, token)
	if !errors.Is(err, domaincanvas.ErrUnavailable) {
		t.Errorf("Verify on a cancelled context returned %v, want ErrUnavailable", err)
	}
	if fake.calls != 0 {
		t.Errorf("Canvas was called %d times on a cancelled context, want 0", fake.calls)
	}
}

// The token travels in a header, so no error this package builds can carry
// it — not the transport failure, not the status branches, not the
// unreadable body. An error string reaches stderr and stderr reaches
// whatever collects container logs.
func TestNoErrorEverCarriesTheToken(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	cases := map[string]func() error{
		"canvas is unreachable": func() error {
			return canvas.New(deadURL).Verify(context.Background(), token)
		},
	}
	for _, c := range []struct {
		name   string
		status int
		body   string
	}{
		{"canvas rejects it", http.StatusUnauthorized, `{"errors":[{"message":"user authorization required"}]}`},
		{"canvas answers 500", http.StatusInternalServerError, `{"errors":[{"message":"boom"}]}`},
		{"canvas answers unparseable json", http.StatusOK, `<html>`},
		{"canvas answers 200 with graphql errors", http.StatusOK, `{"errors":[{"message":"nope"}]}`},
	} {
		fake := &fakeCanvas{status: c.status, body: c.body}
		url := fake.start(t)
		cases[c.name] = func() error { return canvas.New(url).Verify(context.Background(), token) }
	}

	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("the call succeeded, so this case verified nothing")
			}
			if strings.Contains(err.Error(), token) {
				t.Errorf("the error carries the token: %v", err)
			}
			// Not even a prefix of it: a truncated credential in a log is
			// still a credential in a log.
			if strings.Contains(err.Error(), token[:12]) {
				t.Errorf("the error carries part of the token: %v", err)
			}
		})
	}
}

// An empty endpoint falls back to UDP's, so a deployment that does not set
// the variable still talks to the right Canvas.
func TestAnEmptyEndpointFallsBackToUDPCanvas(t *testing.T) {
	if canvas.DefaultEndpoint != "https://udp.instructure.com/api/graphql" {
		t.Errorf("DefaultEndpoint = %q, want UDP's Canvas GraphQL endpoint", canvas.DefaultEndpoint)
	}
	if canvas.New("") == nil {
		t.Error("New(\"\") returned nil")
	}
}
