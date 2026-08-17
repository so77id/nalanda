package oauthstate_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/app/web/oauthstate"
)

func TestAnIssuedNonceIsConsumedOnce(t *testing.T) {
	store := oauthstate.New(time.Minute, nil)

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	if !store.Consume(nonce) {
		t.Fatal("a freshly issued nonce was not accepted")
	}
	// The second time is a replay of the callback, and is what single-use
	// consumption exists to refuse.
	if store.Consume(nonce) {
		t.Error("the same nonce was accepted twice")
	}
}

func TestAnUnknownNonceIsRefused(t *testing.T) {
	store := oauthstate.New(time.Minute, nil)

	for _, nonce := range []string{"", "a-nonce-nobody-issued"} {
		if store.Consume(nonce) {
			t.Errorf("Consume(%q) accepted it", nonce)
		}
	}
}

// The boundary, closed like the other two in this WP (auth.Session.IsExpired and
// the ID token's exp). COR-6 made purge the SOLE enforcer of nonce expiry, so
// the instant it decides on is the whole rule.
func TestANonceExpiresExactlyAtItsDeadline(t *testing.T) {
	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	store := oauthstate.New(time.Minute, func() time.Time { return now })

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	now = now.Add(time.Minute)

	if store.Consume(nonce) {
		t.Error("a nonce expiring exactly now was accepted")
	}
}

func TestANonceExpires(t *testing.T) {
	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	store := oauthstate.New(time.Minute, func() time.Time { return now })

	nonce, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	now = now.Add(2 * time.Minute)

	if store.Consume(nonce) {
		t.Error("an expired nonce was accepted")
	}
}

// Issuing is something a stranger can ask for as fast as they like — the login
// page is public — so the map has to be bounded. Without this it is a memory
// leak with a URL.
func TestTheStoreDoesNotGrowWithoutBound(t *testing.T) {
	store := oauthstate.New(time.Hour, nil)

	var refusals int
	for range oauthstate.DefaultMaxSize + 500 {
		if _, err := store.Issue(); err != nil {
			refusals++
		}
	}

	if got := store.Len(); got > oauthstate.DefaultMaxSize {
		t.Errorf("the store holds %d nonces, want at most %d", got, oauthstate.DefaultMaxSize)
	}
	if refusals == 0 {
		t.Error("the store never refused, so it bounded itself some other way")
	}
}

// A full store refuses the NEWEST attempt; it does not evict the oldest. The
// direction is the whole finding: the oldest live nonce belongs to the professor
// currently on Google's account chooser, so evicting it means 4096 anonymous
// requests can knock out exactly the login in flight, over and over.
//
// Measured against the previous implementation, which dropped the oldest:
// "EXPLOITED: 4096 unauthenticated GETs of /login/google evicted the pending
// login nonce" (#150 review, SEC-2).
func TestAFloodCannotDisplaceALoginAlreadyInFlight(t *testing.T) {
	store := oauthstate.New(time.Hour, nil)

	professor, err := store.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	// The flood: every call is one anonymous GET /login/google.
	for range oauthstate.DefaultMaxSize + 500 {
		_, _ = store.Issue()
	}

	if !store.Consume(professor) {
		t.Error("the pending login was evicted by a flood of anonymous attempts")
	}
}

// And the flood's own attempts are refused with a distinguishable error, so the
// caller can say "try again" rather than "login failed".
func TestAFullStoreRefusesWithErrBusy(t *testing.T) {
	store := oauthstate.New(time.Hour, nil)

	for range oauthstate.DefaultMaxSize {
		if _, err := store.Issue(); err != nil {
			t.Fatalf("Issue below the ceiling: %v", err)
		}
	}

	_, err := store.Issue()
	if !errors.Is(err, oauthstate.ErrBusy) {
		t.Errorf("Issue at the ceiling = %v, want ErrBusy", err)
	}
}

// Expired nonces are dropped rather than merely refused, or a server nobody
// finishes logging in to accumulates them until it restarts.
func TestExpiredNoncesAreForgotten(t *testing.T) {
	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	store := oauthstate.New(time.Minute, func() time.Time { return now })

	for range 10 {
		if _, err := store.Issue(); err != nil {
			t.Fatalf("Issue: %v", err)
		}
	}
	if store.Len() != 10 {
		t.Fatalf("Len = %d before expiry, want 10", store.Len())
	}

	now = now.Add(2 * time.Minute)

	if got := store.Len(); got != 0 {
		t.Errorf("Len = %d after expiry, want 0", got)
	}
}

// The store is reached from every request goroutine at once, so the race
// detector in the pre-PR protocol has something to look at.
func TestConcurrentUse(t *testing.T) {
	store := oauthstate.New(time.Minute, nil)

	var wait sync.WaitGroup
	for range 50 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			nonce, err := store.Issue()
			if err != nil {
				t.Errorf("Issue: %v", err)
				return
			}
			if !store.Consume(nonce) {
				t.Error("a nonce issued by this goroutine was refused")
			}
		}()
	}
	wait.Wait()
}
