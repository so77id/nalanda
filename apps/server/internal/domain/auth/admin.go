package auth

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// The refusals a deactivation may return. Both are reported to the
// professor in Spanish rather than 500ing (issue #151 AC-8), so a caller
// branches on these with errors.Is to shape the message.

// ErrCannotDeactivateSelf: locking yourself out of the only administration
// surface has no recovery path short of the bootstrap address on an empty
// database (issue #151 §Deactivation, guard 1).
var ErrCannotDeactivateSelf = errors.New("auth: a professor cannot deactivate themselves")

// ErrCannotDeactivateLastActive: same failure as guard 1, reached by two
// people instead of one (issue #151 §Deactivation, guard 2). Fires when the
// server would be left with zero active professors after the action.
var ErrCannotDeactivateLastActive = errors.New("auth: the last active professor cannot be deactivated")

// Admin is the CRUD's write-side domain service. Deactivate and Reactivate
// live here rather than on Login because they are administration, not
// admission — putting them on Login would grow the type by concern and
// leave the login path holding a CountActiveUsers dependency it never calls.
type Admin struct {
	Users    UserStore
	Sessions SessionStore
	// Now is the clock, so deactivated_at is what the service decided rather
	// than what the row happened to see.
	Now func() time.Time
}

// NewAdmin refuses a set it cannot serve with — same reason as the other
// domain constructors: a literal with a field forgotten compiles and
// nil-dereferences inside the request rather than panicking at boot.
func NewAdmin(deps Admin) *Admin {
	switch {
	case deps.Users == nil:
		panic("auth.NewAdmin: no user store")
	case deps.Sessions == nil:
		panic("auth.NewAdmin: no session store")
	case deps.Now == nil:
		panic("auth.NewAdmin: no clock")
	}
	return &deps
}

// Deactivate flips a professor to is_active=0 and ENDS every session they
// hold. Both writes must happen: is_active alone kills the next request
// through the middleware but leaves the session rows behind, and a revoke
// that leaves rows behind reads as done and is not (issue #151
// §Deactivation).
//
// Two guards. actingID is the professor performing the action — passed in
// rather than read from any context here so the domain does not know what a
// session is:
//
//  1. targetID == actingID → ErrCannotDeactivateSelf, unconditionally.
//  2. The write leaves at least one active professor. Enforced atomically
//     by UserStore.DeactivateIfNotLast, so two concurrent deactivations
//     cannot both pass a check-then-write TOCTOU (COR-4 / SEC-1). The
//     ErrCannotDeactivateLastActive branch fires when the target IS
//     currently active and yet the atomic write refused — the only reason
//     that happens is "would leave zero active".
//
// The DeactivateOutcome shape lets a target that was ALREADY inactive
// (crafted URL, since the list hides the button) return through the
// success path as an idempotent no-op with Changed=false (COR-5) —
// avoiding a misleading "última profesora activa" for a state the caller
// could not reach through the UI.
type DeactivateResult struct {
	User User
	// Changed reports whether the store actually flipped is_active. A
	// Changed=false with err=nil is a no-op (target was already inactive)
	// — the caller flashes accordingly instead of celebrating.
	Changed bool
}

func (a *Admin) Deactivate(ctx context.Context, targetID, actingID int64) (DeactivateResult, error) {
	if targetID == actingID {
		return DeactivateResult{}, ErrCannotDeactivateSelf
	}

	outcome, err := a.Users.DeactivateIfNotLast(ctx, targetID, a.Now())
	if err != nil {
		return DeactivateResult{}, fmt.Errorf("deactivate professor %d: %w", targetID, err)
	}
	if !outcome.Changed {
		if outcome.User.IsActive {
			// The atomic guard refused: the target is active but is the
			// only active one, so flipping would leave zero.
			return DeactivateResult{}, ErrCannotDeactivateLastActive
		}
		// Target was already inactive. No-op success, no session sweep to
		// do (a professor with no active flag also has no live sessions
		// past the next middleware check).
		return DeactivateResult{User: outcome.User, Changed: false}, nil
	}

	if err := a.Sessions.DeleteUserSessions(ctx, targetID); err != nil {
		return DeactivateResult{}, fmt.Errorf("end sessions of professor %d after deactivation: %w", targetID, err)
	}
	return DeactivateResult{User: outcome.User, Changed: true}, nil
}

// Reactivate flips a professor back to is_active=1 and clears
// deactivated_at. No guard: the failure guards protect the "nobody can sign
// in" state, and reactivation moves AWAY from it.
func (a *Admin) Reactivate(ctx context.Context, targetID int64) (User, error) {
	user, err := a.Users.SetActive(ctx, targetID, true, a.Now())
	if err != nil {
		return User{}, fmt.Errorf("reactivate professor %d: %w", targetID, err)
	}
	return user, nil
}
