package email

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The two wrappers that stand between a real transport and a class of
// students. Both exist for the same reason: publishing is irreversible in
// the only way that matters — an email that reached forty inboxes cannot be
// recalled — so the deployment must be able to rehearse the whole batch
// without anybody receiving anything.

// StagingDispatcher redirects every message to the professor.
//
// It wraps another dispatcher rather than reimplementing one, so what the
// professor receives in a rehearsal is byte-for-byte what a student would
// have received, minus the To. A wrapper that built its own message would
// prove the wrapper works and nothing about the message.
type StagingDispatcher struct {
	inner controls.Dispatcher
}

// NewStagingDispatcher wraps inner.
func NewStagingDispatcher(inner controls.Dispatcher) *StagingDispatcher {
	if inner == nil {
		panic("email.NewStagingDispatcher: no inner dispatcher")
	}
	return &StagingDispatcher{inner: inner}
}

var _ controls.Dispatcher = (*StagingDispatcher)(nil)

// ErrNoStagingRecipient is a message whose ProfessorEmail is empty.
//
// It is an ERROR and never a fall-through to the original recipient, which
// is the single most important line in this file. Staging exists so that no
// student receives anything; a wrapper that sent to msg.To when it could
// not find the redirect address would do the exact thing the mode was
// selected to prevent, on the run where somebody was deliberately being
// careful. Failing the send is recoverable; delivering it is not.
var ErrNoStagingRecipient = errors.New("email: staging has no address to redirect to")

// Delivers defers to the transport underneath: a staging run really does
// put the message in a mailbox — the professor's. It is a rehearsal in
// intent, not in effect, and the control it stamps was genuinely published
// to somebody.
func (d *StagingDispatcher) Delivers() bool { return d.inner.Delivers() }

// RedirectsToSender is TRUE, and this is the whole reason the method
// exists. A deployment-wide staging run delivers — so Delivers() says yes —
// but it delivers to the professor, and a control stamped
// `publication_mode = 'real'` after one would assert a class was written to
// (#273 review, DAC-8).
func (d *StagingDispatcher) RedirectsToSender() bool { return true }

// Send redirects and delegates.
func (d *StagingDispatcher) Send(ctx context.Context, professorID int64, msg controls.Message) (string, error) {
	if msg.ProfessorEmail == "" {
		return "", fmt.Errorf("%w", ErrNoStagingRecipient)
	}
	msg.To = msg.ProfessorEmail
	return d.inner.Send(ctx, professorID, msg)
}

// DryRunDispatcher sends nothing and proves the credential anyway.
//
// It holds Credentials rather than wrapping a Dispatcher, and that is the
// whole design. "Suppress the send" over a wrapped transport would leave
// nothing to suppress it AFTER — the interesting half of a real send is the
// credential, and a dry run that skipped it would report success for a
// professor whose authorisation was revoked last week. So the token is
// resolved for real (the one network call), the message is built for real,
// and only the delivery is withheld.
type DryRunDispatcher struct {
	creds Credentials
	log   *slog.Logger
	// newID makes the synthetic id. Injectable so a test can pin one;
	// random by default, because two dry runs are two distinct events and
	// a stable id would invite somebody to key something on it.
	newID func() string
}

// NewDryRunDispatcher returns a transport that delivers nothing.
func NewDryRunDispatcher(creds Credentials, log *slog.Logger) *DryRunDispatcher {
	switch {
	case creds == nil:
		panic("email.NewDryRunDispatcher: no credentials")
	case log == nil:
		panic("email.NewDryRunDispatcher: no logger")
	}
	return &DryRunDispatcher{creds: creds, log: log, newID: randomDryRunID}
}

var _ controls.Dispatcher = (*DryRunDispatcher)(nil)

// Delivers is false: a dry run withholds every message by definition.
func (d *DryRunDispatcher) Delivers() bool { return false }

// RedirectsToSender is false: it delivers to nobody at all, so there is no
// recipient to have redirected.
func (d *DryRunDispatcher) RedirectsToSender() bool { return false }

// Send validates, logs and withholds.
func (d *DryRunDispatcher) Send(ctx context.Context, professorID int64, msg controls.Message) (string, error) {
	if msg.To == "" {
		return "", fmt.Errorf("%w", ErrNoRecipient)
	}

	// The credential is resolved for real. Everything else about a dry run
	// is a rehearsal; this part is the measurement.
	if _, err := d.creds.AccessToken(ctx, professorID); err != nil {
		return "", err
	}

	if _, err := buildMIME(msg); err != nil {
		return "", fmt.Errorf("%w: build the message: %v", controls.ErrSendRefused, err)
	}

	// The recipient is MASKED, and the tension is worth naming because the
	// issue's design asked for the address in full. A dry run's whole
	// purpose is to let an operator see what would have gone out — but
	// docs/security-notes.md §"Logs and personal data" keeps a student's
	// identifier out of the line, and a forty-copy dry run on the Jetson
	// would otherwise write a whole class's addresses into log rotation.
	//
	// Masking keeps every question a dry run is actually asked: whether it
	// is going to a student or to the professor (the domain survives),
	// whether the subject and the grade are right, whether the attachment
	// is there and non-trivial.
	d.log.Info("dryrun: would send",
		"professor", professorID,
		"to", maskAddress(msg.To),
		"subject", msg.Subject,
		"attachment_bytes", len(msg.Attachment.Content),
	)
	return d.newID(), nil
}

// randomDryRunID makes an id no provider issued.
//
// The DRYRUN- prefix carries the same weight as STUB-: an operator reading
// a log line, or a future delivery record, must be able to tell a
// fabricated id from Gmail's without first working out which mode the
// deployment was in.
func randomDryRunID() string {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		// Unreachable on any platform this runs on, and a dry run must not
		// fail over its own bookkeeping — the send it is rehearsing already
		// succeeded as far as it goes.
		return "DRYRUN-unavailable"
	}
	return "DRYRUN-" + hex.EncodeToString(b[:])
}

// maskAddress keeps the shape of an address without writing it down.
//
// `maria.gonzalez@udp.cl` becomes `m…z@udp.cl`: enough to see which side of
// the staging switch a message landed on, not enough to be a mailing list.
// Same convention and the same reason as handler.maskRUT.
func maskAddress(address string) string {
	local, domain, found := strings.Cut(address, "@")
	if !found || local == "" {
		return "…"
	}
	if len(local) < 3 {
		return "…@" + domain
	}
	return local[:1] + "…" + local[len(local)-1:] + "@" + domain
}
