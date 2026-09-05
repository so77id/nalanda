package canvas_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/canvas"
	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// fakeAPI is the Canvas end of the seam. Nothing in this package can talk to
// the real Canvas — the same premise as oidctest.Provider standing in for
// Google, and the same consequence: the real round trip is a human's check
// (S8), not a test.
type fakeAPI struct {
	err    error
	seen   []string
	called int
}

func (f *fakeAPI) Verify(_ context.Context, token string) error {
	f.called++
	f.seen = append(f.seen, token)
	return f.err
}

// The service does not call these — its cases are about the token policy —
// but the interface is what it is. Returning the configured error keeps a
// stray call visible rather than silently succeeding.
func (f *fakeAPI) Courses(context.Context, string) ([]canvas.Course, error) {
	f.called++
	return nil, f.err
}

func (f *fakeAPI) Roster(context.Context, string, string) ([]canvas.Student, error) {
	f.called++
	return nil, f.err
}

// memStore is an in-memory secret.Store. It stores PLAINTEXT on purpose:
// what this package's cases are about is the policy (verify before store,
// never store on an unknown answer), and the encryption itself is pinned one
// package over by secretstore's own suite against the real schema.
type memStore struct {
	rows    map[string]string
	setErr  error
	getErr  error
	delErr  error
	deletes int
}

func newMemStore() *memStore { return &memStore{rows: map[string]string{}} }

func (m *memStore) key(userID int64, namespace, key string) string {
	return string(secret.AAD(userID, namespace, key))
}

func (m *memStore) Set(_ context.Context, userID int64, namespace, key, plaintext string) error {
	if m.setErr != nil {
		return m.setErr
	}
	m.rows[m.key(userID, namespace, key)] = plaintext
	return nil
}

func (m *memStore) Get(_ context.Context, userID int64, namespace, key string) (string, error) {
	if m.getErr != nil {
		return "", m.getErr
	}
	v, ok := m.rows[m.key(userID, namespace, key)]
	if !ok {
		return "", secret.ErrNotFound
	}
	return v, nil
}

func (m *memStore) Delete(_ context.Context, userID int64, namespace, key string) error {
	m.deletes++
	if m.delErr != nil {
		return m.delErr
	}
	delete(m.rows, m.key(userID, namespace, key))
	return nil
}

const professor = int64(7)

func TestSaveTokenVerifiesBeforeItStores(t *testing.T) {
	api := &fakeAPI{}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	if err := svc.SaveToken(context.Background(), professor, "1234~elToken"); err != nil {
		t.Fatalf("SaveToken: %v", err)
	}
	if api.called != 1 {
		t.Errorf("Verify was called %d times, want exactly 1", api.called)
	}
	if len(api.seen) != 1 || api.seen[0] != "1234~elToken" {
		t.Errorf("Verify saw %q, want the token verbatim", api.seen)
	}

	got, err := svc.Token(context.Background(), professor)
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got != "1234~elToken" {
		t.Errorf("Token = %q, want the stored token", got)
	}
}

// Rule 1: a token Canvas refuses is not stored. The professor pastes another
// one; nothing is left behind that a later import would spend.
func TestSaveTokenStoresNothingWhenCanvasRejectsIt(t *testing.T) {
	api := &fakeAPI{err: canvas.ErrTokenRejected}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	err := svc.SaveToken(context.Background(), professor, "1234~malo")
	if !errors.Is(err, canvas.ErrTokenRejected) {
		t.Fatalf("SaveToken returned %v, want ErrTokenRejected", err)
	}
	if len(store.rows) != 0 {
		t.Errorf("a rejected token was stored anyway: %v", store.rows)
	}
}

// Rule 2, and the case most worth having: "Canvas is down" is not evidence
// that the token is good. Storing on ErrUnavailable would mean a professor
// who pastes a typo during an outage gets told it worked, and finds out at
// import time on another screen.
func TestSaveTokenStoresNothingWhenCanvasCannotBeReached(t *testing.T) {
	api := &fakeAPI{err: canvas.ErrUnavailable}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	err := svc.SaveToken(context.Background(), professor, "1234~quizas")
	if !errors.Is(err, canvas.ErrUnavailable) {
		t.Fatalf("SaveToken returned %v, want ErrUnavailable", err)
	}
	if errors.Is(err, canvas.ErrTokenRejected) {
		t.Error("an outage was reported as a rejected token; the professor would retype a good token")
	}
	if len(store.rows) != 0 {
		t.Errorf("a token was stored despite an unknown answer: %v", store.rows)
	}
}

// An empty submission never reaches Canvas: it is a blank form, and asking a
// third party about it would be a request that can only fail.
func TestSaveTokenRefusesAnEmptyTokenWithoutAskingCanvas(t *testing.T) {
	api := &fakeAPI{}
	svc := canvas.NewService(newMemStore(), api)

	if err := svc.SaveToken(context.Background(), professor, ""); !errors.Is(err, canvas.ErrTokenRejected) {
		t.Errorf("SaveToken(\"\") returned %v, want ErrTokenRejected", err)
	}
	if api.called != 0 {
		t.Errorf("Verify was called %d times for an empty token, want 0", api.called)
	}
}

// The token is opaque: a client that trimmed or folded it would turn a
// working paste into a rejection nobody could explain.
func TestSaveTokenPassesTheTokenThroughUnchanged(t *testing.T) {
	api := &fakeAPI{}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	const padded = "  1234~conEspacios  "
	if err := svc.SaveToken(context.Background(), professor, padded); err != nil {
		t.Fatalf("SaveToken: %v", err)
	}
	if api.seen[0] != padded {
		t.Errorf("Verify saw %q, want the value unchanged", api.seen[0])
	}
	got, err := svc.Token(context.Background(), professor)
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got != padded {
		t.Errorf("Token = %q, want the value unchanged", got)
	}
}

func TestASecondSaveTokenReplacesTheFirst(t *testing.T) {
	api := &fakeAPI{}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	for _, token := range []string{"1234~viejo", "1234~nuevo"} {
		if err := svc.SaveToken(context.Background(), professor, token); err != nil {
			t.Fatalf("SaveToken(%q): %v", token, err)
		}
	}
	got, err := svc.Token(context.Background(), professor)
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	if got != "1234~nuevo" {
		t.Errorf("Token = %q, want the replacement", got)
	}
}

func TestConnectedReportsWhetherATokenIsStored(t *testing.T) {
	api := &fakeAPI{}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	connected, err := svc.Connected(context.Background(), professor)
	if err != nil {
		t.Fatalf("Connected: %v", err)
	}
	if connected {
		t.Error("Connected is true before any token was saved")
	}

	if err := svc.SaveToken(context.Background(), professor, "1234~elToken"); err != nil {
		t.Fatalf("SaveToken: %v", err)
	}
	connected, err = svc.Connected(context.Background(), professor)
	if err != nil {
		t.Fatalf("Connected: %v", err)
	}
	if !connected {
		t.Error("Connected is false after a token was saved")
	}

	// And it does not ask Canvas: rendering a page must not depend on a
	// third party being up.
	if api.called != 1 {
		t.Errorf("Verify was called %d times, want only the one SaveToken made", api.called)
	}
}

// A row that will not decrypt is a wrong master key, not an empty state.
// Reporting it as "not connected" would render the same form forever and
// hide a broken deployment.
func TestConnectedSurfacesAStoreFailureRatherThanReportingNotConnected(t *testing.T) {
	store := newMemStore()
	store.getErr = errors.New("does not authenticate")
	svc := canvas.NewService(store, &fakeAPI{})

	connected, err := svc.Connected(context.Background(), professor)
	if err == nil {
		t.Fatal("Connected returned no error for a store that failed")
	}
	if connected {
		t.Error("Connected is true despite the failure")
	}
}

func TestTokenReportsErrNoTokenBeforeAnythingIsSaved(t *testing.T) {
	svc := canvas.NewService(newMemStore(), &fakeAPI{})

	if _, err := svc.Token(context.Background(), professor); !errors.Is(err, canvas.ErrNoToken) {
		t.Errorf("Token returned %v, want ErrNoToken", err)
	}
}

func TestForgetRemovesTheTokenAndIsIdempotent(t *testing.T) {
	api := &fakeAPI{}
	store := newMemStore()
	svc := canvas.NewService(store, api)

	if err := svc.SaveToken(context.Background(), professor, "1234~elToken"); err != nil {
		t.Fatalf("SaveToken: %v", err)
	}
	if err := svc.Forget(context.Background(), professor); err != nil {
		t.Fatalf("Forget: %v", err)
	}
	if _, err := svc.Token(context.Background(), professor); !errors.Is(err, canvas.ErrNoToken) {
		t.Errorf("Token after Forget returned %v, want ErrNoToken", err)
	}
	if err := svc.Forget(context.Background(), professor); err != nil {
		t.Errorf("a second Forget returned %v, want it to be idempotent", err)
	}
}

// The whole unconfigured branch: a deployment with no master key boots, and
// every method says so by name rather than panicking on a nil store. This is
// what makes ADR-0068 §Decision 3 safe.
func TestEveryMethodReportsErrNotConfiguredWithoutAMasterKey(t *testing.T) {
	api := &fakeAPI{}
	svc := canvas.NewService(nil, api)

	if svc.Configured() {
		t.Error("Configured() is true with no store")
	}

	connected, err := svc.Connected(context.Background(), professor)
	if err != nil {
		t.Errorf("Connected returned %v; an unconfigured deployment is not an error to render", err)
	}
	if connected {
		t.Error("Connected is true with no store")
	}

	if err := svc.SaveToken(context.Background(), professor, "1234~x"); !errors.Is(err, canvas.ErrNotConfigured) {
		t.Errorf("SaveToken returned %v, want ErrNotConfigured", err)
	}
	if _, err := svc.Token(context.Background(), professor); !errors.Is(err, canvas.ErrNotConfigured) {
		t.Errorf("Token returned %v, want ErrNotConfigured", err)
	}
	if err := svc.Forget(context.Background(), professor); !errors.Is(err, canvas.ErrNotConfigured) {
		t.Errorf("Forget returned %v, want ErrNotConfigured", err)
	}
	if api.called != 0 {
		t.Errorf("Canvas was asked %d times by an unconfigured deployment, want 0", api.called)
	}
}

// No error this package produces may carry the token. Error strings reach
// stderr, and stderr reaches whatever collects container logs — the same
// rule config.SafeDatabaseURL and Config.LogValue follow.
func TestNoErrorEverCarriesTheToken(t *testing.T) {
	const token = "1234~AbCdEfGhIjKlMnOpQrSt"

	for _, c := range []struct {
		name string
		svc  *canvas.Service
	}{
		{"canvas rejects it", canvas.NewService(newMemStore(), &fakeAPI{err: canvas.ErrTokenRejected})},
		{"canvas is unreachable", canvas.NewService(newMemStore(), &fakeAPI{err: canvas.ErrUnavailable})},
		{"the store fails", func() *canvas.Service {
			s := newMemStore()
			s.setErr = errors.New("disk is full")
			return canvas.NewService(s, &fakeAPI{})
		}()},
		{"no master key", canvas.NewService(nil, &fakeAPI{})},
	} {
		t.Run(c.name, func(t *testing.T) {
			err := c.svc.SaveToken(context.Background(), professor, token)
			if err == nil {
				t.Fatal("SaveToken succeeded, so this case verified nothing")
			}
			if strings.Contains(err.Error(), token) {
				t.Errorf("the error carries the token: %v", err)
			}
		})
	}
}
