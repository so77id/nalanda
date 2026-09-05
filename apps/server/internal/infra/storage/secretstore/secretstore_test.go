package secretstore_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/secretstore"
	"github.com/so77id/nalanda/apps/server/migrations"
)

// L6 cases: the adapter against a real SQLite file with the shipped
// migrations applied, like authstore_test. What is worth asserting here is
// what the database does with the queries — the upsert's conflict target,
// the BLOB round trip, and the AAD binding, none of which a mock could show.

func key32(fill byte) []byte {
	k := make([]byte, secret.MasterKeySize)
	for i := range k {
		k[i] = fill + byte(i)
	}
	return k
}

// store returns a migrated database, a professor's id, and the adapter over
// it. The *sql.DB comes back too so a case can look at the raw column
// without the production type growing a test-only accessor.
func store(t *testing.T, masterKey []byte) (context.Context, *sql.DB, int64, *secretstore.Store) {
	t.Helper()

	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := storage.Migrate(ctx, db, migrations.FS); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	result, err := db.ExecContext(ctx,
		`INSERT INTO users (email, name) VALUES ('profesora@example.com', 'Profesora')`)
	if err != nil {
		t.Fatalf("inserting the professor: %v", err)
	}
	userID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the professor id: %v", err)
	}

	s, err := secretstore.New(db, masterKey)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return ctx, db, userID, s
}

// The interface the domain declares, satisfied by the adapter. Compile-time,
// like storage.Prober against health.Prober.
func TestTheStoreSatisfiesTheDomainInterface(t *testing.T) {
	var _ secret.Store = (*secretstore.Store)(nil)
}

func TestSetAndGetRoundTripTheSecret(t *testing.T) {
	ctx, _, userID, s := store(t, key32(1))

	const token = "1234~AbCdEf0123456789"
	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, token); err != nil {
		t.Fatalf("Set: %v", err)
	}

	back, err := s.Get(ctx, userID, secret.NamespaceCanvas, secret.KeyToken)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if back != token {
		t.Errorf("Get = %q, want %q", back, token)
	}
}

// The whole point of the table: what lands in the column is not the token.
// A store that quietly wrote plaintext would pass every round-trip case
// above and defeat the reason this package exists.
func TestTheStoredColumnHoldsNoPlaintext(t *testing.T) {
	ctx, db, userID, s := store(t, key32(1))

	const token = "1234~AbCdEf0123456789"
	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, token); err != nil {
		t.Fatalf("Set: %v", err)
	}

	var stored []byte
	if err := db.QueryRowContext(ctx,
		`SELECT ciphertext FROM user_secrets WHERE user_id = ? AND namespace = ? AND key = ?`,
		userID, secret.NamespaceCanvas, secret.KeyToken,
	).Scan(&stored); err != nil {
		t.Fatalf("reading the raw column: %v", err)
	}
	if strings.Contains(string(stored), token) {
		t.Error("the ciphertext column contains the token verbatim")
	}
	if len(stored) != 12+len(token)+16 {
		t.Errorf("the column holds %d bytes for a %d-byte token, want %d (nonce + ct + tag)",
			len(stored), len(token), 12+len(token)+16)
	}
}

// "Reemplazar" on the profile page is one Set, not a delete plus an insert.
// A second Set must replace the row rather than conflict on the UNIQUE.
func TestASecondSetReplacesTheSecretInPlace(t *testing.T) {
	ctx, db, userID, s := store(t, key32(1))

	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, "el primero"); err != nil {
		t.Fatalf("Set (first): %v", err)
	}
	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, "el segundo"); err != nil {
		t.Fatalf("Set (second): %v", err)
	}

	back, err := s.Get(ctx, userID, secret.NamespaceCanvas, secret.KeyToken)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if back != "el segundo" {
		t.Errorf("Get = %q, want the replacement", back)
	}

	var rows int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM user_secrets`).Scan(&rows); err != nil {
		t.Fatalf("counting: %v", err)
	}
	if rows != 1 {
		t.Errorf("user_secrets holds %d rows after two Sets on one triple, want 1", rows)
	}
}

// Absence speaks the domain's vocabulary, never database/sql's: a handler
// branching on sql.ErrNoRows would be reading storage's opinion of what
// "not configured yet" means.
func TestGetReturnsErrNotFoundForATripleThatHoldsNothing(t *testing.T) {
	ctx, _, userID, s := store(t, key32(1))

	_, err := s.Get(ctx, userID, secret.NamespaceCanvas, secret.KeyToken)
	if !errors.Is(err, secret.ErrNotFound) {
		t.Errorf("Get on an empty triple returned %v, want secret.ErrNotFound", err)
	}
	if errors.Is(err, sql.ErrNoRows) {
		t.Error("Get leaked database/sql's sentinel to its caller")
	}
}

// The deployment-level failure, kept distinct from the ordinary one above: a
// row that exists but cannot be authenticated is a wrong master key or a
// tampered database, and reading it as "not configured" would tell the
// professor to paste their token again forever.
func TestGetRefusesARowSealedUnderADifferentMasterKey(t *testing.T) {
	ctx, db, userID, s := store(t, key32(1))

	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, "el token"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	other, err := secretstore.New(db, key32(2))
	if err != nil {
		t.Fatalf("New (other key): %v", err)
	}
	got, err := other.Get(ctx, userID, secret.NamespaceCanvas, secret.KeyToken)
	if err == nil {
		t.Fatalf("Get under the wrong master key returned %q, want a refusal", got)
	}
	if errors.Is(err, secret.ErrNotFound) {
		t.Error("a row that cannot be decrypted was reported as absent; the two failures must stay apart")
	}
}

// The AAD binding, end to end. Moving a ciphertext into another triple is
// the attack ADR-0068 (and DocumentBuddy's ADR-012 before it) names, and
// this is the case that proves the binding actually holds in the schema
// rather than only in the crypto unit tests.
func TestARowMovedToAnotherTripleNoLongerDecrypts(t *testing.T) {
	ctx, db, userID, s := store(t, key32(1))

	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, "el token"); err != nil {
		t.Fatalf("Set: %v", err)
	}

	// A second professor, and their row overwritten with the first one's
	// ciphertext — exactly what an attacker with write access to the file
	// would do to borrow someone else's Canvas token.
	result, err := db.ExecContext(ctx,
		`INSERT INTO users (email, name) VALUES ('otro@example.com', 'Otro')`)
	if err != nil {
		t.Fatalf("inserting the second professor: %v", err)
	}
	otherID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("reading the second professor id: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
        INSERT INTO user_secrets (user_id, namespace, key, ciphertext)
        SELECT ?, namespace, key, ciphertext FROM user_secrets WHERE user_id = ?`,
		otherID, userID,
	); err != nil {
		t.Fatalf("copying the ciphertext: %v", err)
	}

	got, err := s.Get(ctx, otherID, secret.NamespaceCanvas, secret.KeyToken)
	if err == nil {
		t.Fatalf("the copied row decrypted as %q under another professor; the AAD is not binding", got)
	}
	if errors.Is(err, secret.ErrNotFound) {
		t.Error("the copied row was reported as absent rather than as unauthenticated")
	}
}

func TestDeleteRemovesTheSecretAndIsIdempotent(t *testing.T) {
	ctx, _, userID, s := store(t, key32(1))

	if err := s.Set(ctx, userID, secret.NamespaceCanvas, secret.KeyToken, "el token"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := s.Delete(ctx, userID, secret.NamespaceCanvas, secret.KeyToken); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := s.Get(ctx, userID, secret.NamespaceCanvas, secret.KeyToken); !errors.Is(err, secret.ErrNotFound) {
		t.Errorf("Get after Delete returned %v, want secret.ErrNotFound", err)
	}
	if err := s.Delete(ctx, userID, secret.NamespaceCanvas, secret.KeyToken); err != nil {
		t.Errorf("a second Delete returned %v, want it to be idempotent", err)
	}
}

// A key of the wrong size never reaches a query: the constructor refuses it,
// so a misconfigured deployment fails at wiring time rather than at the
// first professor who pastes a token.
func TestNewRefusesAMasterKeyThatIsNotThirtyTwoBytes(t *testing.T) {
	ctx := context.Background()
	db, err := storage.Open(ctx, filepath.Join(t.TempDir(), "nalanda.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	for _, size := range []int{0, 16, 31, 33} {
		if _, err := secretstore.New(db, make([]byte, size)); err == nil {
			t.Errorf("New accepted a %d-byte master key, want a refusal", size)
		}
	}
}
