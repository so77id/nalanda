// A white-box test, deliberately in package selfcheck rather than
// selfcheck_test.
//
// The reason is the whole point of this file. The integration cases next door
// drive a real httptest server, and they pass whether or not dialable rewrites
// anything at all — because the host kernel routes 0.0.0.0, :: and "" to
// loopback anyway. That is the exact "kernel courtesy" selfcheck.go says must
// not be relied on, and relying on it is what the test was written to prevent.
// Deleting the entire rewrite left all three of those subtests green, on this
// machine and on the CI runner (#149 review, F6).
//
// Asserting the FUNCTION is the only way to see the rewrite happen.
package selfcheck

import (
	"net"
	"testing"
)

func TestDialable(t *testing.T) {
	for _, c := range []struct {
		name string
		addr string
		want string
	}{
		{"IPv4 wildcard becomes loopback", "0.0.0.0:8081", "127.0.0.1:8081"},
		{"an omitted host becomes loopback", ":8081", "127.0.0.1:8081"},
		{"IPv6 wildcard becomes loopback", "[::]:8081", "127.0.0.1:8081"},
		{"a real host is left alone", "127.0.0.1:8081", "127.0.0.1:8081"},
		{"a named host is left alone", "server:8081", "server:8081"},
		{"a non-wildcard IPv6 host is left alone", "[::1]:8081", "[::1]:8081"},
		{"something that is not host:port is handed back untouched", "notanaddr", "notanaddr"},
		{"an empty address is handed back untouched", "", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := dialable(c.addr); got != c.want {
				t.Errorf("dialable(%q) = %q, want %q", c.addr, got, c.want)
			}
		})
	}
}

// net.SplitHostPort strips the brackets from an IPv6 literal, so the host it
// returns for "[::]:8081" is "::" and never "[::]". The switch therefore needs
// only the unbracketed form; the bracketed arm was dead code.
//
// This is pinned rather than assumed because it is a fact about the standard
// library that the switch depends on, and a silently-dead case is how a reader
// concludes the other cases are load-bearing when they are not.
func TestSplitHostPortStripsIPv6Brackets(t *testing.T) {
	host, port, err := net.SplitHostPort("[::]:8081")
	if err != nil {
		t.Fatalf("SplitHostPort: %v", err)
	}
	if host != "::" {
		t.Errorf("host = %q, want %q — if this ever returns the bracketed form, dialable needs that arm back", host, "::")
	}
	if port != "8081" {
		t.Errorf("port = %q, want %q", port, "8081")
	}
}
