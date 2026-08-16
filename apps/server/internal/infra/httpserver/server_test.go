package httpserver_test

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/infra/httpserver"
)

// get issues a GET against the server's resolved address and returns the status
// code. A failure to connect is returned as an error, which is what the
// after-shutdown case asserts on.
func get(addr string) (int, error) {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://" + addr + "/")
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode, nil
}

func TestServeUntilContextIsDone(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})

	srv, err := httpserver.New("127.0.0.1:0", handler)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	served := make(chan error, 1)
	go func() { served <- srv.Serve(ctx) }()

	// The listener is already bound by New, so there is no race here: the
	// address accepts connections before Serve is even scheduled.
	status, err := get(srv.Addr())
	if err != nil {
		t.Fatalf("request while running: %v", err)
	}
	if status != http.StatusTeapot {
		t.Errorf("status while running = %d, want %d", status, http.StatusTeapot)
	}

	cancel()

	select {
	case err := <-served:
		if err != nil {
			t.Fatalf("Serve returned %v, want nil on a clean shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return within 5s of the context being cancelled")
	}

	// The point of the slice: cancelling the context stops the SERVER, it does
	// not merely make Serve return while the port stays open. Without the
	// Shutdown call this assertion is the one that fires.
	if status, err := get(srv.Addr()); err == nil {
		t.Errorf("request after shutdown succeeded with status %d, want a connection failure", status)
	}
}

// drainHold is how long the parked handler below stays parked AFTER the context
// is cancelled. It is not a budget the code arms — it is the window in which a
// shutdown that cuts connections instead of draining them must reveal itself.
// A busy machine only widens that window, so the case cannot flake in the
// direction of a false pass.
const drainHold = 300 * time.Millisecond

func TestServeDrainsAnInFlightRequest(t *testing.T) {
	// The handler announces that it is running and then parks until the test
	// releases it, so the request is provably still in flight at the moment the
	// context is cancelled. A Close instead of a Shutdown cuts this connection
	// and the client sees an error. (Verified: with Shutdown replaced by Close
	// this test fails at "in-flight request failed during shutdown".)
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusOK)
	})

	srv, err := httpserver.New("127.0.0.1:0", handler)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ctx) }()

	type result struct {
		status int
		err    error
	}
	done := make(chan result, 1)
	go func() {
		status, err := get(srv.Addr())
		done <- result{status, err}
	}()

	// Wait until the handler is actually running before cancelling, otherwise
	// the request may not have reached the server yet and the case degrades
	// into the previous one.
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("handler never ran")
	}

	cancel()
	// Stay parked across the shutdown. Releasing immediately lets a
	// connection-cutting implementation lose the race and pass — measured: with
	// Shutdown replaced by Close and no hold here, the case was green.
	time.Sleep(drainHold)
	close(release)

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("in-flight request failed during shutdown: %v", got.err)
		}
		if got.status != http.StatusOK {
			t.Errorf("in-flight status = %d, want %d", got.status, http.StatusOK)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight request never completed")
	}

	if err := <-served; err != nil {
		t.Fatalf("Serve returned %v, want nil", err)
	}
}

func TestNewReportsAnAddressAlreadyInUse(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	defer func() { _ = taken.Close() }()

	addr := taken.Addr().String()
	_, err = httpserver.New(addr, http.NotFoundHandler())
	if err == nil {
		t.Fatal("New on a taken address returned no error, want one")
	}
	// Binding at construction is what buys the caller a startup error instead
	// of a process that reports itself up and never accepts a connection.
	if !errors.Is(err, syscall.EADDRINUSE) {
		t.Errorf("New error = %v, want it to wrap EADDRINUSE", err)
	}
	// The operator has to be able to tell WHICH address failed from the log
	// line alone.
	if !strings.Contains(err.Error(), addr) {
		t.Errorf("New error = %q, want it to name the address %q", err, addr)
	}
}
