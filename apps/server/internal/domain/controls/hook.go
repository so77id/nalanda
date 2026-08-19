package controls

import (
	"context"
	"log/slog"
)

// OnCorrectionClosed is the seam a future integration hangs off — sending
// the grade by email, posting it to Canvas (issue #190 §Non-goals keeps
// both out of this WP; the hook is the abstraction, not the integration).
// It fires after a close request leaves the control Graded — including an
// idempotent re-close of an already-graded control, so integrations must
// be idempotent themselves — and its error does not undo the close: the
// correction is closed either way.
type OnCorrectionClosed interface {
	// Closed is called after the state moved to Graded. The order is part
	// of the contract — a consumer must never observe an ungraded control
	// from inside Closed.
	Closed(ctx context.Context, controlID string) error
}

// NoopHook is the default OnCorrectionClosed: it logs and returns nil, so
// the seam exists and costs nothing until a real integration replaces it
// in cmd/server's wiring.
type NoopHook struct {
	Log *slog.Logger
}

// NewNoopHook returns the default hook. Same constructor shape as the rest
// of the domain: a nil logger is a wiring mistake and panics at boot
// rather than inside the first Closed call (backend-code-style.md §Errors).
func NewNoopHook(log *slog.Logger) *NoopHook {
	if log == nil {
		panic("controls.NewNoopHook: no logger")
	}
	return &NoopHook{Log: log}
}

// Closed logs the event at INFO — the whole default behaviour.
func (n *NoopHook) Closed(_ context.Context, controlID string) error {
	n.Log.Info("correction closed", "control", controlID)
	return nil
}

// Assert the default hook satisfies the interface at compile time.
var _ OnCorrectionClosed = (*NoopHook)(nil)
