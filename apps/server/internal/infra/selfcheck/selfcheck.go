// Package selfcheck lets the binary ask its own /health endpoint whether it is
// well, so that `docker compose` can too.
//
// It exists because the production image is `scratch`: no shell, no curl, no
// wget, nothing a CMD-SHELL healthcheck could use. The container's only
// executable is the server itself, so the server has to be able to play client.
package selfcheck

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

// timeout bounds the whole check. It is shorter than the healthcheck interval
// in infra/local/docker-compose.yml so a hung check fails rather than piling up.
const timeout = 4 * time.Second

// Probe issues GET path against addr and returns nil only on a 200.
//
// The path is a parameter rather than a literal because the route belongs to
// internal/app/web, and an infra package may not import a surface — the layer
// guard forbids it. main passes web.HealthPath through, which keeps the
// constant flowing app -> main -> infra.
//
// A non-200 is a failure with the status in the message: 503 means the process
// is up and its database is not, which is precisely the state a container
// healthcheck exists to notice and a plain liveness ping would miss.
func Probe(ctx context.Context, addr, path string) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url := "http://" + dialable(addr) + path
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("building the health request for %s: %w", url, err)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return fmt.Errorf("requesting %s: %w", url, err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %d", url, response.StatusCode)
	}
	return nil
}

// dialable turns a BIND address into a destination.
//
// The container is configured to listen on 0.0.0.0, which is a wildcard meaning
// "every interface" and not an address anything can connect to. Linux happens
// to route a connection to 0.0.0.0 to the loopback interface; that is a kernel
// courtesy, not a guarantee, and relying on it makes the healthcheck depend on
// which host it runs on.
func dialable(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// Not a host:port at all — hand it back untouched and let the request
		// fail with a message naming what was passed.
		return addr
	}
	switch host {
	// No "[::]" arm: SplitHostPort strips the brackets, so that form never
	// reaches here. Pinned by TestSplitHostPortStripsIPv6Brackets.
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
