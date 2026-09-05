package secret

import (
	"context"
	"errors"
)

// Namespace values. One constant per third-party the professor holds a
// credential for, so the string a writer stores and the string a reader
// looks up cannot drift apart.
const (
	// NamespaceCanvas is the professor's Canvas integration (issue #271).
	NamespaceCanvas = "canvas"
)

// Key values inside a namespace. Named rather than inlined for the same
// reason as the namespaces above.
const (
	// KeyToken is the API token the professor pastes on their profile page.
	KeyToken = "token"
)

// ErrNotFound is what a lookup returns when the triple holds no secret.
// Absence is part of this domain's vocabulary; database/sql's sentinel is
// not, and a caller branching on it would be reading storage's opinion —
// the same rule authstore follows with auth.ErrNotFound.
var ErrNotFound = errors.New("secret: no secret stored for that triple")

// Store persists per-professor encrypted secrets, keyed by namespace and
// key. Plaintext never leaves the call site: the implementation owns the
// master key, encrypts in Set and decrypts in Get, so nothing above this
// interface ever holds a ciphertext or a key.
//
// Declared here rather than beside its implementation because this is where
// it is consumed (backend-code-style.md §The dependency rule) — the same
// shape as health.Prober and jobs.Store.
type Store interface {
	// Set encrypts plaintext and upserts the row for
	// (userID, namespace, key). A second Set on the same triple replaces
	// the value, which is what makes "Reemplazar" on the profile page one
	// call rather than a delete and an insert.
	Set(ctx context.Context, userID int64, namespace, key, plaintext string) error

	// Get returns the decrypted plaintext for the triple. It returns
	// ErrNotFound when no row exists, and a crypto error when a row exists
	// but cannot be authenticated — a wrong master key, a tampered blob,
	// or a row moved between triples. The two are kept apart because the
	// first is an ordinary "not configured yet" and the second means
	// something is wrong with the deployment.
	Get(ctx context.Context, userID int64, namespace, key string) (string, error)

	// Delete removes the row. Idempotent: deleting a triple that holds
	// nothing is not an error, so a professor clicking "Eliminar" twice
	// sees the same outcome both times.
	Delete(ctx context.Context, userID int64, namespace, key string) error
}
