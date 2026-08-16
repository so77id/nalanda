package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/auth"
)

func TestNewTokenIsHexAndUnpredictable(t *testing.T) {
	first, err := auth.NewToken()
	if err != nil {
		t.Fatalf("NewToken: %v", err)
	}

	// 32 random bytes, hex-encoded. The length is asserted because a token that
	// silently got shorter is still a working login.
	if len(first) != 64 {
		t.Errorf("token length = %d, want 64", len(first))
	}
	if strings.Trim(first, "0123456789abcdef") != "" {
		t.Errorf("token %q contains a non-hex character", first)
	}

	second, err := auth.NewToken()
	if err != nil {
		t.Fatalf("second NewToken: %v", err)
	}
	if first == second {
		t.Error("two tokens came back identical, so the source is not random")
	}
}

func TestHashTokenIsDeterministicAndHidesTheToken(t *testing.T) {
	const token = "a-token"

	hash := auth.HashToken(token)
	if hash != auth.HashToken(token) {
		t.Error("HashToken is not deterministic, so a stored hash could never be matched again")
	}
	if hash == token || strings.Contains(hash, token) {
		t.Errorf("HashToken(%q) = %q, which carries the token itself", token, hash)
	}
	if hash == auth.HashToken("another-token") {
		t.Error("two different tokens hash the same")
	}
}

func TestTokenMatchesHash(t *testing.T) {
	const token = "a-token"
	hash := auth.HashToken(token)

	for _, c := range []struct {
		name  string
		hash  string
		token string
		want  bool
	}{
		{"the token it was made from", hash, token, true},
		{"another token", hash, "another-token", false},
		{"an empty token", hash, "", false},
		{"an empty hash", "", token, false},
		{"the token compared against itself", token, token, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := auth.TokenMatchesHash(c.hash, c.token); got != c.want {
				t.Errorf("TokenMatchesHash(%q, %q) = %v, want %v", c.hash, c.token, got, c.want)
			}
		})
	}
}

// The empty cases are the point. A CSRF check that accepts two empty strings is
// a check that passes for every request that simply omits the field, which is
// precisely the request it exists to reject.
func TestVerifyCSRF(t *testing.T) {
	for _, c := range []struct {
		name      string
		expected  string
		submitted string
		want      bool
	}{
		{"the session's token", "token", "token", true},
		{"another token", "token", "other", false},
		{"nothing submitted", "token", "", false},
		{"no token on the session", "", "token", false},
		{"neither side has one", "", "", false},
		{"a prefix of the token", "token", "tok", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := auth.VerifyCSRF(c.expected, c.submitted); got != c.want {
				t.Errorf("VerifyCSRF(%q, %q) = %v, want %v", c.expected, c.submitted, got, c.want)
			}
		})
	}
}

// Expiry is the session row's, not the cookie's, and the boundary is closed:
// a session whose expiry is exactly now is over. An open boundary is a session
// that survives its own deadline for as long as the clock takes to tick.
func TestSessionIsExpired(t *testing.T) {
	deadline := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.UTC)
	session := auth.Session{ExpiresAt: deadline}

	for _, c := range []struct {
		name string
		now  time.Time
		want bool
	}{
		{"a second before", deadline.Add(-time.Second), false},
		{"exactly at the deadline", deadline, true},
		{"a second after", deadline.Add(time.Second), true},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := session.IsExpired(c.now); got != c.want {
				t.Errorf("IsExpired(%v) = %v, want %v", c.now, got, c.want)
			}
		})
	}
}

// A professor who has been deactivated may still hold a valid cookie. The
// middleware asks this question on every request, so the answer lives on the
// type rather than in the middleware.
func TestUserMayLogIn(t *testing.T) {
	for _, c := range []struct {
		name string
		user auth.User
		want bool
	}{
		{"an active professor", auth.User{ID: 1, IsActive: true}, true},
		{"a deactivated professor", auth.User{ID: 1, IsActive: false}, false},
		{"the zero user", auth.User{}, false},
		// The case that pins "fails closed": a value that was never loaded but
		// whose IsActive happens to be set — the shape a skipped error check
		// leaves behind.
		{"an active professor with no id", auth.User{IsActive: true}, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := c.user.MayLogIn(); got != c.want {
				t.Errorf("MayLogIn() = %v, want %v", got, c.want)
			}
		})
	}
}
