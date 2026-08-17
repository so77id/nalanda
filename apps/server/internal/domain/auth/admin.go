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
// rather than read from any context here so the domain does not know what
// a session is:
//
//  1. targetID == actingID → ErrCannotDeactivateSelf, unconditionally.
//  2. CountActiveUsers <= 1 → ErrCannotDeactivateLastActive, so the server
//     never lands in a state where nobody can sign in.
//
// The sessions of an unknown target are not deleted: the row is looked up
// via SetActive, and if it does not exist ErrNotFound propagates BEFORE the
// session sweep — a Deactivate on a mistyped id must not have side effects.
func (a *Admin) Deactivate(ctx context.Context, targetID, actingID int64) (User, error) {
	if targetID == actingID {
		return User{}, ErrCannotDeactivateSelf
	}
	active, err := a.Users.CountActiveUsers(ctx)
	if err != nil {
		return User{}, fmt.Errorf("count active professors: %w", err)
	}
	if active <= 1 {
		return User{}, ErrCannotDeactivateLastActive
	}

	user, err := a.Users.SetActive(ctx, targetID, false, a.Now())
	if err != nil {
		return User{}, fmt.Errorf("deactivate professor %d: %w", targetID, err)
	}

	if err := a.Sessions.DeleteUserSessions(ctx, targetID); err != nil {
		return User{}, fmt.Errorf("end sessions of professor %d after deactivation: %w", targetID, err)
	}
	return user, nil
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
