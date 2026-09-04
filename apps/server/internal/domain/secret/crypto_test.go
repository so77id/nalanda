package secret_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// The Canvas token this package seals is the professor's own Canvas
// credential: whoever reads it can act as them inside Canvas. The layout is
// locked (nonce(12) || ciphertext || tag(16), AAD = user\x00namespace\x00key)
// and every case here exists because breaking one of those silently produces
// a blob that still decrypts — under the wrong identity, or with the tag
// unchecked.

// key32 is a deterministic 32-byte key. Deterministic rather than random so a
// failure reproduces from the failure message alone.
func key32(fill byte) []byte {
	k := make([]byte, secret.MasterKeySize)
	for i := range k {
		k[i] = fill + byte(i)
	}
	return k
}

func TestSealAndOpenRoundTripThePlaintext(t *testing.T) {
	key := key32(1)
	aad := secret.AAD(7, "canvas", "token")
	plaintext := []byte("1234~abcdefghijklmnopqrstuvwxyz")

	blob, err := secret.Seal(plaintext, key, aad)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(blob, plaintext) {
		t.Error("the sealed blob contains the plaintext verbatim; it was not encrypted")
	}

	back, err := secret.Open(blob, key, aad)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(back, plaintext) {
		t.Errorf("Open returned %q, want %q", back, plaintext)
	}
}

// The envelope is exactly nonce + ciphertext + tag. Pinned as arithmetic
// rather than as a comment because a change to the layout invalidates every
// ciphertext already on disk, and nothing else in this repo would notice.
func TestTheSealedBlobCarriesItsNonceAndTagAroundTheCiphertext(t *testing.T) {
	plaintext := []byte("abc")

	blob, err := secret.Seal(plaintext, key32(1), nil)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if want := 12 + len(plaintext) + 16; len(blob) != want {
		t.Errorf("sealed %d bytes for a %d-byte plaintext, want %d (nonce 12 + ct + tag 16)",
			len(blob), len(plaintext), want)
	}
}

// A repeated nonce under one key is what breaks GCM outright. Sealing the
// same plaintext twice must not produce the same bytes.
func TestSealUsesAFreshNonceForEverySeal(t *testing.T) {
	key := key32(1)
	aad := secret.AAD(7, "canvas", "token")
	plaintext := []byte("el mismo token de siempre")

	first, err := secret.Seal(plaintext, key, aad)
	if err != nil {
		t.Fatalf("Seal (first): %v", err)
	}
	second, err := secret.Seal(plaintext, key, aad)
	if err != nil {
		t.Fatalf("Seal (second): %v", err)
	}
	if bytes.Equal(first, second) {
		t.Fatal("two seals of the same plaintext produced identical blobs; the nonce is not fresh")
	}
	if bytes.Equal(first[:12], second[:12]) {
		t.Error("the two blobs share a nonce")
	}
}

// The four ways a stored blob can be wrong, each of which GCM must refuse.
// The AAD case is the one that matters most in this schema: it is what stops
// a row copied into another professor's (user, namespace, key) from
// decrypting there.
func TestOpenRefusesEveryTamperedInput(t *testing.T) {
	key := key32(1)
	aad := secret.AAD(7, "canvas", "token")

	sealed, err := secret.Seal([]byte("el token"), key, aad)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	for _, c := range []struct {
		name string
		blob []byte
		key  []byte
		aad  []byte
	}{
		{
			name: "a flipped bit in the ciphertext",
			blob: flip(sealed, 12),
			key:  key,
			aad:  aad,
		},
		{
			name: "a flipped bit in the nonce",
			blob: flip(sealed, 0),
			key:  key,
			aad:  aad,
		},
		{
			name: "a flipped bit in the tag",
			blob: flip(sealed, len(sealed)-1),
			key:  key,
			aad:  aad,
		},
		{
			name: "another professor's AAD",
			blob: sealed,
			key:  key,
			aad:  secret.AAD(8, "canvas", "token"),
		},
		{
			name: "another namespace's AAD",
			blob: sealed,
			key:  key,
			aad:  secret.AAD(7, "resend", "token"),
		},
		{
			name: "another key's AAD",
			blob: sealed,
			key:  key,
			aad:  secret.AAD(7, "canvas", "refresh"),
		},
		{
			name: "a different master key",
			blob: sealed,
			key:  key32(2),
			aad:  aad,
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			back, err := secret.Open(c.blob, c.key, c.aad)
			if err == nil {
				t.Fatalf("Open accepted it and returned %q, want an authentication failure", back)
			}
			if back != nil {
				t.Errorf("Open returned %q alongside its error; a refused blob yields nothing", back)
			}
		})
	}
}

// A blob shorter than its own envelope cannot be sliced into nonce and
// ciphertext. Without the length check the slice expression panics, which in
// a request path is the one thing §Errors forbids outright.
func TestOpenRefusesABlobShorterThanItsEnvelope(t *testing.T) {
	for _, size := range []int{0, 1, 12, 27} {
		blob := make([]byte, size)
		if _, err := secret.Open(blob, key32(1), nil); err == nil {
			t.Errorf("Open accepted a %d-byte blob, want a refusal", size)
		}
	}
}

// AES-256 means a 32-byte key and nothing else. A shorter key must be an
// error naming the size, not a silently weaker cipher.
func TestSealAndOpenRefuseAKeyThatIsNotThirtyTwoBytes(t *testing.T) {
	for _, size := range []int{0, 16, 24, 31, 33} {
		key := make([]byte, size)

		_, sealErr := secret.Seal([]byte("x"), key, nil)
		if sealErr == nil {
			t.Errorf("Seal accepted a %d-byte master key, want a refusal", size)
			continue
		}
		if !strings.Contains(sealErr.Error(), "32") {
			t.Errorf("Seal refused a %d-byte key with %v, want the message to name the required size", size, sealErr)
		}
		if _, err := secret.Open(make([]byte, 40), key, nil); err == nil {
			t.Errorf("Open accepted a %d-byte master key, want a refusal", size)
		}
	}
}

// The AAD is a delimited encoding, not a concatenation. Without the NUL
// separators (7, "ca", "nvas") and (7, "canv", "as") would produce the same
// bytes, and a ciphertext would decrypt under a triple it was never bound to.
func TestAADSeparatesItsThreeFieldsUnambiguously(t *testing.T) {
	if bytes.Equal(secret.AAD(7, "ca", "nvas"), secret.AAD(7, "canv", "as")) {
		t.Error("two different (namespace, key) pairs produced the same AAD; the fields are being concatenated")
	}
	if bytes.Equal(secret.AAD(7, "canvas", "token"), secret.AAD(71, "canvas", "token")) {
		t.Error("two different user ids produced the same AAD")
	}
	if !bytes.Equal(secret.AAD(7, "canvas", "token"), secret.AAD(7, "canvas", "token")) {
		t.Error("AAD is not deterministic")
	}
}

// flip returns a copy of blob with one bit of byte i inverted.
func flip(blob []byte, i int) []byte {
	out := bytes.Clone(blob)
	out[i] ^= 0x01
	return out
}
