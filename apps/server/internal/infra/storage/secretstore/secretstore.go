// Package secretstore is the SQLite side of the secret domain: one type
// implementing secret.Store over the user_secrets table migration 00014
// creates.
//
// It lives under internal/infra/storage because that is where ADR-0034 puts
// store implementations, and in its own package so that storage itself stays
// about opening a database and applying migrations — the same placement
// authstore, controlstore and jobstore have.
//
// DocumentBuddy, whose package this is transplanted from, keeps the
// equivalent sqlite_store.go INSIDE its domain/secret package. That layout
// is not carried over: this repository's dependency rule puts adapters
// beneath the domain, and correcting on entry is the posture #149 took
// toward DocumentBuddy's own ADR-005 debt. ADR-0068 records the decision.
//
// This package holds the master key. Nothing above it ever sees a key or a
// ciphertext: secret.Store's method set takes and returns plaintext strings,
// and the encryption happens here.
package secretstore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// Store is the adapter over user_secrets.
type Store struct {
	db        *sql.DB
	masterKey []byte
}

// New returns a Store over db, sealing and opening under masterKey.
//
// The key is validated HERE as well as in secret.Seal, so a misconfigured
// deployment fails at wiring time rather than at the first professor who
// pastes a token. The caller owns the handle and its lifetime.
func New(db *sql.DB, masterKey []byte) (*Store, error) {
	if len(masterKey) != secret.MasterKeySize {
		return nil, fmt.Errorf("secretstore: master key must be %d bytes, got %d",
			secret.MasterKeySize, len(masterKey))
	}
	return &Store{db: db, masterKey: masterKey}, nil
}

// The domain's interface, satisfied at compile time — the storage.Prober
// shape.
var _ secret.Store = (*Store)(nil)

// Set encrypts plaintext and upserts the row for the triple.
//
// The upsert's conflict target is the UNIQUE (user_id, namespace, key) the
// migration declares — replacing in place is what makes "Reemplazar" on the
// profile page one call, and what stops a re-save from conflicting.
func (s *Store) Set(ctx context.Context, userID int64, namespace, key, plaintext string) error {
	blob, err := secret.Seal([]byte(plaintext), s.masterKey, secret.AAD(userID, namespace, key))
	if err != nil {
		// Deliberately not wrapped with the plaintext or the triple beyond
		// what the caller already knows: an error string ends up in a log.
		return fmt.Errorf("secretstore: seal: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
        INSERT INTO user_secrets (user_id, namespace, key, ciphertext)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, namespace, key) DO UPDATE SET
            ciphertext = excluded.ciphertext,
            updated_at = unixepoch()`,
		userID, namespace, key, blob,
	); err != nil {
		return fmt.Errorf("secretstore: upsert the %s/%s secret: %w", namespace, key, err)
	}
	return nil
}

// Get returns the decrypted plaintext for the triple.
//
// The two failure modes stay apart on purpose. An absent row is
// secret.ErrNotFound — "the professor has not configured this yet", which
// the profile page renders as a form. A row that will not authenticate is
// passed through as a crypto error, because it means a wrong master key or a
// tampered database, and rendering that as "not configured" would tell the
// professor to paste their token again forever.
func (s *Store) Get(ctx context.Context, userID int64, namespace, key string) (string, error) {
	var blob []byte
	err := s.db.QueryRowContext(ctx, `
        SELECT ciphertext FROM user_secrets
        WHERE user_id = ? AND namespace = ? AND key = ?`,
		userID, namespace, key,
	).Scan(&blob)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", fmt.Errorf("secretstore: the %s/%s secret: %w", namespace, key, secret.ErrNotFound)
	case err != nil:
		return "", fmt.Errorf("secretstore: read the %s/%s secret: %w", namespace, key, err)
	}

	plaintext, err := secret.Open(blob, s.masterKey, secret.AAD(userID, namespace, key))
	if err != nil {
		return "", fmt.Errorf("secretstore: the %s/%s secret does not authenticate "+
			"(wrong master key, or the row was tampered with): %w", namespace, key, err)
	}
	return string(plaintext), nil
}

// Delete removes the row. Idempotent: a DELETE that matches nothing is a
// successful DELETE, so a professor clicking "Eliminar" twice sees the same
// outcome both times and no caller has to inspect RowsAffected.
func (s *Store) Delete(ctx context.Context, userID int64, namespace, key string) error {
	if _, err := s.db.ExecContext(ctx, `
        DELETE FROM user_secrets
        WHERE user_id = ? AND namespace = ? AND key = ?`,
		userID, namespace, key,
	); err != nil {
		return fmt.Errorf("secretstore: delete the %s/%s secret: %w", namespace, key, err)
	}
	return nil
}
