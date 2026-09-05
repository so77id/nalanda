// Package secret encrypts a professor's third-party credentials at rest and
// declares the store that holds them.
//
// It exists because the Canvas integration (issue #271) needs the
// professor's own Canvas API token to fetch a roster, and a token in
// plaintext in the SQLite file is a token in every off-host backup. The
// primitive and the layout are transplanted from DocumentBuddy's package of
// the same name (its ADR-012); ADR-0068 records the transplant and what was
// changed on the way in.
//
// The on-disk layout is LOCKED:
//
//	nonce(12) || ciphertext || gcm_tag(16)
//	AAD = "user_id\x00namespace\x00key"
//
// Changing either invalidates every ciphertext already stored, and nothing
// in this repository would notice before a professor's token stopped
// decrypting. TestTheSealedBlobCarriesItsNonceAndTagAroundTheCiphertext and
// TestAADSeparatesItsThreeFieldsUnambiguously are what pin them.
//
// The package is PURE: crypto/aes, crypto/cipher and crypto/rand are
// standard library, so it satisfies the dependency rule's first edge
// (internal/domain imports no third-party package). The SQLite side lives in
// internal/infra/storage/secretstore, unlike DocumentBuddy which keeps its
// sqlite_store.go here — see ADR-0068 §Decision.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
)

// MasterKeySize is the required length of the AES-256 master key, in bytes.
// AES-256 admits exactly this length; a shorter key is refused rather than
// stretched, because a silently weaker cipher is the failure nobody sees.
const MasterKeySize = 32

// Seal encrypts plaintext under masterKey and binds the result to aad. The
// returned blob is the storage layout: nonce(12) || ciphertext || tag(16).
//
// masterKey must be exactly MasterKeySize bytes; aad may be empty, but the
// same value must be passed to Open.
func Seal(plaintext, masterKey, aad []byte) ([]byte, error) {
	gcm, err := newGCM(masterKey)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	// crypto/rand.Read cannot return a short read without an error
	// (documented on the package), so a full nonce is guaranteed by
	// construction — the same reasoning controls.NewID relies on.
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("secret: read nonce: %w", err)
	}
	// gcm.Seal(dst, nonce, plaintext, aad) APPENDS ciphertext||tag to dst.
	// Passing the nonce slice as dst is what produces nonce||ct||tag in one
	// allocation — it is not a typo, and rewriting it as gcm.Seal(nil, …)
	// would drop the nonce from the blob and make every row unopenable.
	return gcm.Seal(nonce, nonce, plaintext, aad), nil
}

// Open reverses Seal. It refuses a blob shorter than its own envelope, a
// wrong master key, a tampered ciphertext or nonce, and an aad that differs
// from the one used to seal — the last of which is what stops a row copied
// into another professor's (user, namespace, key) from decrypting there.
//
// A refusal returns nil plaintext: there is no partially-authenticated
// result to hand a caller.
func Open(blob, masterKey, aad []byte) ([]byte, error) {
	gcm, err := newGCM(masterKey)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	// Checked before slicing: blob comes from a database column, and a
	// truncated row would otherwise panic on the slice expression — the one
	// thing backend-code-style.md §Errors forbids in a request path.
	if len(blob) < ns+gcm.Overhead() {
		return nil, fmt.Errorf("secret: blob too short: %d bytes", len(blob))
	}
	nonce, ct := blob[:ns], blob[ns:]
	plaintext, err := gcm.Open(nil, nonce, ct, aad)
	if err != nil {
		// The error is deliberately not decorated with which of the four
		// causes it was: GCM does not distinguish them, and a message that
		// guessed would be a lie in a security path.
		return nil, fmt.Errorf("secret: open: %w", err)
	}
	return plaintext, nil
}

// AAD builds the canonical additional-authenticated-data bytes for a stored
// secret, binding each ciphertext to its (user_id, namespace, key) triple.
//
// The NUL separators are load-bearing rather than decorative: a plain
// concatenation would give (7, "ca", "nvas") and (7, "canv", "as") the same
// AAD, and a ciphertext would then authenticate under a triple it was never
// bound to.
func AAD(userID int64, namespace, key string) []byte {
	return fmt.Appendf(nil, "%d\x00%s\x00%s", userID, namespace, key)
}

func newGCM(masterKey []byte) (cipher.AEAD, error) {
	if len(masterKey) != MasterKeySize {
		return nil, fmt.Errorf("secret: master key must be %d bytes, got %d", MasterKeySize, len(masterKey))
	}
	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return nil, fmt.Errorf("secret: aes new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("secret: new gcm: %w", err)
	}
	return gcm, nil
}
