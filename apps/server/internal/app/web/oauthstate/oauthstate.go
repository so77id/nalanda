// Package oauthstate holds the nonces that tie an OAuth callback back to the
// login attempt that started it.
//
// It is the CSRF defence of the callback itself: without it, anyone could send a
// professor's browser to /login/google/callback with a code of their choosing.
// The nonce is issued when the flow starts, travels to Google in the state
// parameter, comes back in the callback, and is consumed exactly once.
//
// In memory, deliberately. The alternative — a table — buys durability across a
// restart for a value whose whole life is the twenty seconds a person spends on
// Google's account chooser. What a restart costs is a login attempt that has to
// be clicked again; what a table would cost is a schema, a sweep, and a row
// written on every visit to the login page. When there is a second instance of
// this server (§C15 defers that decision), this is one of the things that has to
// move — recorded here because nothing else would say so.
package oauthstate

import (
	"sync"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

// DefaultTTL is how long a login attempt may take. Long enough to choose an
// account and type a password, short enough that an abandoned attempt is not a
// nonce sitting in memory all afternoon.
const DefaultTTL = 10 * time.Minute

// Store keeps the live nonces. The zero value is not usable; call New.
type Store struct {
	mu      sync.Mutex
	issued  map[string]time.Time
	ttl     time.Duration
	now     func() time.Time
	maxSize int
}

// DefaultMaxSize bounds the map. The login page is public, so issuing a nonce is
// something a stranger can ask for as fast as they like; without a ceiling that
// is a memory leak with a URL. At the ceiling the oldest are dropped, which
// costs an abandoned attempt a retry and costs an attacker nothing they wanted.
const DefaultMaxSize = 4096

// New returns a Store. A zero ttl means DefaultTTL; a nil clock means time.Now.
func New(ttl time.Duration, now func() time.Time) *Store {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if now == nil {
		now = time.Now
	}
	return &Store{
		issued:  map[string]time.Time{},
		ttl:     ttl,
		now:     now,
		maxSize: DefaultMaxSize,
	}
}

// Issue returns a fresh nonce and remembers it until it expires.
func (s *Store) Issue() (string, error) {
	nonce, err := auth.NewToken()
	if err != nil {
		return "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.purge()
	if len(s.issued) >= s.maxSize {
		s.dropOldest()
	}
	s.issued[nonce] = s.now().Add(s.ttl)
	return nonce, nil
}

// Consume reports whether the nonce was live, and spends it.
//
// Single use: a callback that arrives twice with the same nonce is a replay, and
// the second one is refused. That is the difference between remembering a nonce
// and checking one.
func (s *Store) Consume(nonce string) bool {
	if nonce == "" {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.purge()
	expiry, found := s.issued[nonce]
	if !found {
		return false
	}
	delete(s.issued, nonce)
	return expiry.After(s.now())
}

// Len reports how many nonces are live. Exported for the test that proves the
// map does not grow without bound.
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.purge()
	return len(s.issued)
}

// purge drops what has expired. Called on every operation rather than on a
// timer: the map is small, the work is proportional to it, and a goroutine would
// need a lifetime someone has to manage.
//
// The caller holds the lock.
func (s *Store) purge() {
	now := s.now()
	for nonce, expiry := range s.issued {
		if !expiry.After(now) {
			delete(s.issued, nonce)
		}
	}
}

// dropOldest removes the entry closest to expiring. The caller holds the lock.
func (s *Store) dropOldest() {
	var (
		oldest       string
		oldestExpiry time.Time
	)
	for nonce, expiry := range s.issued {
		if oldest == "" || expiry.Before(oldestExpiry) {
			oldest, oldestExpiry = nonce, expiry
		}
	}
	delete(s.issued, oldest)
}
