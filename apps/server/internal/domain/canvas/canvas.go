// Package canvas is the professor's Canvas integration: the policy around
// their API token, and the vocabulary the HTTP adapter speaks.
//
// It exists because the roster the entrance controls need (issue #271, epic
// #270) already lives in Canvas, and the only way in without UDP IT is a
// personal access token the professor generates themselves (Canvas →
// Account → Settings → New Access Token). This package owns what happens to
// that token: it is verified against Canvas before it is believed, sealed by
// internal/domain/secret before it is stored, and never handed back to a
// reader.
//
// The HTTP client lives in internal/infra/canvas and satisfies API, which is
// declared HERE because this is where it is consumed — the health.Prober
// shape (backend-code-style.md §The dependency rule).
package canvas

import (
	"context"
	"errors"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// The namespace and key this package stores its secret under.
//
// They REFERENCE secret's own constants rather than repeating the strings.
// An earlier revision declared bare literals under a comment claiming they
// were wrappers, which was false: a review mutation renamed both exported
// constants and the whole suite stayed green, so the two sides could drift
// with nothing noticing (#271 review, ARQ-2/COR-9). Set and Get read the
// same private constant so they could not desynchronise from each other —
// what the literals actually cost was that the exported constants had no
// production reader, and secretstore's tests asserted a triple production
// never wrote.
const (
	secretNamespace = secret.NamespaceCanvas
	secretKey       = secret.KeyToken
)

// Sentinel errors callers branch on.
var (
	// ErrNotConfigured is what every method returns when the deployment has
	// no NALANDA_SECRETS_MASTER_KEY. Distinct from "no token stored"
	// because the professor cannot fix it: the operator has to set the key
	// before any token can be sealed at all (ADR-0068 §Decision 3).
	ErrNotConfigured = errors.New("canvas: the secrets master key is not configured")

	// ErrNoToken is "this professor has not connected Canvas yet". The
	// ordinary empty state, rendered as a form.
	ErrNoToken = errors.New("canvas: no token stored for this professor")

	// ErrTokenRejected is Canvas answering that the token is not valid —
	// mistyped, revoked, or expired. The professor fixes this by pasting a
	// new one, so it is a field error on the form, never a 500.
	ErrTokenRejected = errors.New("canvas: the token was rejected by Canvas")

	// ErrCourseNotFound is Canvas answering 200 with a null course: an id
	// this token cannot see, or one that was deleted. Kept apart from an
	// EMPTY roster, which is a real course that has no students yet.
	ErrCourseNotFound = errors.New("canvas: Canvas knows no such course for this token")

	// ErrUnavailable is Canvas not answering, or answering with something
	// this client cannot read. Nothing about the token is known, so the
	// caller must NOT store it and must not tell the professor it is wrong.
	ErrUnavailable = errors.New("canvas: Canvas could not be reached")
)

// API is what this domain needs from Canvas. Implemented by
// internal/infra/canvas over Canvas's GraphQL endpoint.
//
// The token is a PARAMETER of every call rather than state on the client:
// the client is a process-wide singleton, and a professor's credential must
// not outlive the request that decrypted it.
type API interface {
	// Verify reports whether the token authenticates against Canvas. It
	// returns nil when Canvas accepts it, ErrTokenRejected when Canvas
	// refuses it, and ErrUnavailable when the answer says nothing about the
	// token either way.
	Verify(ctx context.Context, token string) error

	// Courses lists every course the token's owner is enrolled in, in any
	// role. Canvas offers no role filter on that query and Course has no
	// `enrollments` field, so narrowing to "courses I teach" would cost one
	// round trip per course; the picker orders and discloses instead
	// (ADR-0069 §Decision 5).
	Courses(ctx context.Context, token string) ([]Course, error)

	// Roster returns the STUDENTS of one Canvas course, normalised into the
	// shape the schema stores. Teachers and TAs are not students and are
	// skipped (ADR-0069 §Decision 4).
	//
	// It follows Relay pagination to the end: a course larger than one page
	// must not come back truncated, which would look exactly like a class
	// where half the students dropped out.
	Roster(ctx context.Context, token, canvasCourseID string) ([]Student, error)
}
