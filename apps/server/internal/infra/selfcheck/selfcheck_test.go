package selfcheck_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/infra/selfcheck"
)

func TestProbeSucceedsOn200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/health" {
			t.Errorf("path = %q, want /health", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	if err := selfcheck.Probe(context.Background(), strings.TrimPrefix(server.URL, "http://")); err != nil {
		t.Errorf("Probe against a healthy server = %v, want nil", err)
	}
}

// The point of the check. A 503 means the server is up and its database is not,
// and the container must be reported unhealthy rather than merely running.
func TestProbeFailsOnANon200(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	err := selfcheck.Probe(context.Background(), strings.TrimPrefix(server.URL, "http://"))
	if err == nil {
		t.Fatal("Probe against a 503 = nil, want an error")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Errorf("error = %q, want it to carry the status code", err)
	}
}

func TestProbeFailsWhenNothingIsListening(t *testing.T) {
	// Port 1 on loopback: reserved, and nothing in a container binds it.
	if err := selfcheck.Probe(context.Background(), "127.0.0.1:1"); err == nil {
		t.Error("Probe against a dead address = nil, want an error")
	}
}

// The container is configured with NALANDA_ADDR=0.0.0.0:8081, which is a bind
// address and not a destination. Dialling it works on Linux by accident and
// fails elsewhere; the check has to ask the loopback interface instead. Without
// this the healthcheck is a coin toss that depends on the host kernel.
func TestProbeDialsLoopbackForAWildcardBindAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	port := server.URL[strings.LastIndex(server.URL, ":")+1:]

	for _, bind := range []string{"0.0.0.0:" + port, ":" + port, "[::]:" + port} {
		t.Run(bind, func(t *testing.T) {
			if err := selfcheck.Probe(context.Background(), bind); err != nil {
				t.Errorf("Probe(%q) = %v, want it to reach the loopback listener", bind, err)
			}
		})
	}
}
