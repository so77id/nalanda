// Package email holds the transports that deliver a publication's
// messages: the four dispatchers of issue #273, all satisfying
// controls.Dispatcher, which is declared in the domain because that is
// where it is consumed (backend-code-style.md §The dependency rule).
//
// The four differ only in what they do with a message they are handed —
// send it as the professor, redirect it to the professor, log it without
// sending, or fabricate an answer. Which one the process runs is decided
// once at boot from NALANDA_EMAIL_MODE and logged in one line: the
// "select don't describe" shape of DocumentBuddy's ADR-021, so nothing
// downstream branches on a mode and no caller can be in one mode while its
// neighbour is in another.
//
// Nothing in this package logs, wraps or formats a credential. An error
// string reaches stderr and stderr reaches whatever collects container
// logs; the rule is the one internal/infra/canvas follows for the Canvas
// token, and it is asserted rather than trusted.
package email

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// StubDispatcher answers without a network, a credential or a provider.
// It is what the test suite runs, what CI runs, and what a developer who
// has connected no Gmail account runs.
//
// It also RECORDS what it was asked to send, which is what makes it useful
// beyond "does not crash": a test over the publish job can assert that
// thirty-eight students were addressed and two were skipped without
// reaching for a fake HTTP server.
type StubDispatcher struct {
	mu   sync.Mutex
	sent []StubSend
}

// StubSend is one recorded call. It keeps the professor id beside the
// message because "which professor's account would this have gone out as"
// is exactly what a publication test wants to assert, and the Message
// itself carries the From rather than the id.
type StubSend struct {
	ProfessorID int64
	Message     controls.Message
}

// NewStubDispatcher returns a dispatcher that sends nothing.
func NewStubDispatcher() *StubDispatcher { return &StubDispatcher{} }

var _ controls.Dispatcher = (*StubDispatcher)(nil)

// ErrNoRecipient is a message with an empty To.
//
// The stub validates it although sending nothing could not fail, because a
// stub that is MORE PERMISSIVE than production is a stub that hides the
// bug until it reaches the Jetson: every test would pass over a message
// builder that forgot to address anybody, and the first evidence would be
// Gmail refusing thirty messages in a row. Same reasoning as the amctest
// fakes, which refuse the requests the real worker refuses.
var ErrNoRecipient = errors.New("email: the message names no recipient")

// Send records the message and returns a fabricated id.
func (d *StubDispatcher) Send(_ context.Context, professorID int64, msg controls.Message) (string, error) {
	if msg.To == "" {
		return "", fmt.Errorf("%w", ErrNoRecipient)
	}

	d.mu.Lock()
	d.sent = append(d.sent, StubSend{ProfessorID: professorID, Message: msg})
	d.mu.Unlock()

	return stubID(msg), nil
}

// Delivers is false: this transport reaches no network and no person.
//
// It is what stops a publication under the default mode from stamping a
// control and reporting a class that was never written to (#273 review,
// PUB-2).
func (d *StubDispatcher) Delivers() bool { return false }

// RedirectsToSender is false — it redirects nowhere, because it sends
// nowhere. Only meaningful beside Delivers(), which is already false.
func (d *StubDispatcher) RedirectsToSender() bool { return false }

// Sent returns the calls recorded so far, oldest first.
//
// A COPY, not the slice itself: handing out the backing array would let a
// caller iterating the history race a concurrent Send that appends to it,
// and the whole point of the mutex above is that this type survives
// `go test -race`.
func (d *StubDispatcher) Sent() []StubSend {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]StubSend(nil), d.sent...)
}

// stubID derives the fabricated id from the message.
//
// A HASH rather than a counter, so the id is a property of the message and
// not of the order it was sent in: a counter is stable only against itself,
// and renumbers everything the day a test sends two messages the other way
// round. Recipient and subject together identify a message within a
// publication — one student gets one email per control.
//
// The STUB- prefix is load-bearing rather than decorative: an operator
// reading a log line must be able to tell a fabricated id from a
// provider's without first working out which mode the deployment was in.
func stubID(msg controls.Message) string {
	sum := sha256.Sum256([]byte(msg.To + "\x00" + msg.Subject))
	return "STUB-" + hex.EncodeToString(sum[:6])
}
