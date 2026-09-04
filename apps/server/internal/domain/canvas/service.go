package canvas

import (
	"context"
	"errors"
	"fmt"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// Service is the policy around a professor's Canvas token.
//
// Three rules live here rather than in the handler, so a second caller
// cannot get any of them wrong:
//
//  1. A token is VERIFIED against Canvas before it is stored. Storing an
//     unverified token means the professor learns it was mistyped at import
//     time, on a different screen, with no idea which step was wrong.
//  2. A token that Canvas could not be asked about is NOT stored.
//     ErrUnavailable is not evidence of anything, and treating it as
//     success would silently store a bad token.
//  3. A stored token is never handed to a reader. Token is for the import
//     path; nothing renders its return value.
type Service struct {
	// Secrets is nil when the deployment has no master key. Nil is the
	// legal, boot-able state (ADR-0068 §Decision 3), so every method checks
	// Configured first rather than dereferencing.
	Secrets secret.Store
	API     API
}

// NewService returns the service. secrets may be nil — that is the
// "integration not configured" state, not a wiring mistake. api may not:
// without it nothing could verify a token, and a nil there is a programming
// error at boot, which is the one place §Errors allows a panic.
func NewService(secrets secret.Store, api API) *Service {
	if api == nil {
		panic("canvas.NewService: no API client")
	}
	return &Service{Secrets: secrets, API: api}
}

// Configured reports whether secrets can be stored at all. False means the
// operator has not set NALANDA_SECRETS_MASTER_KEY; the profile page renders
// an explanation instead of a form.
func (s *Service) Configured() bool {
	return s.Secrets != nil
}

// Connected reports whether this professor has a stored Canvas token.
//
// It does NOT decrypt to a caller and does not ask Canvas: rendering a page
// must not depend on a third party being up, and a token that has since been
// revoked in Canvas surfaces at the next real call with ErrTokenRejected.
func (s *Service) Connected(ctx context.Context, userID int64) (bool, error) {
	if !s.Configured() {
		return false, nil
	}
	if _, err := s.Secrets.Get(ctx, userID, secretNamespace, secretKey); err != nil {
		if errors.Is(err, secret.ErrNotFound) {
			return false, nil
		}
		// A row that will not decrypt is NOT reported as "not connected":
		// that would render the same form and let the professor paste a new
		// token forever without anyone noticing the master key is wrong.
		return false, fmt.Errorf("canvas: read the stored token: %w", err)
	}
	return true, nil
}

// SaveToken verifies token against Canvas and, only then, seals and stores
// it for this professor. A second SaveToken replaces the first.
//
// The token is not trimmed, lower-cased or otherwise adjusted: it is an
// opaque credential, and a client that "helpfully" normalised it would turn
// a working paste into a rejection nobody could explain. An EMPTY token is
// refused here rather than sent to Canvas — it is a form the professor
// submitted blank, not a credential.
func (s *Service) SaveToken(ctx context.Context, userID int64, token string) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	if token == "" {
		return ErrTokenRejected
	}
	if err := s.API.Verify(ctx, token); err != nil {
		// Passed through unchanged, sentinel and all: the caller renders a
		// different message for "Canvas says no" than for "Canvas is
		// down", and flattening them here would lose that.
		return err
	}
	if err := s.Secrets.Set(ctx, userID, secretNamespace, secretKey, token); err != nil {
		return fmt.Errorf("canvas: store the verified token: %w", err)
	}
	return nil
}

// Token returns the professor's decrypted Canvas token, for the import path
// to spend on one request.
//
// Callers must not log it, put it in an error message, or render it. It
// returns ErrNoToken when the professor has not connected Canvas, and
// ErrNotConfigured when the deployment has no master key.
func (s *Service) Token(ctx context.Context, userID int64) (string, error) {
	if !s.Configured() {
		return "", ErrNotConfigured
	}
	token, err := s.Secrets.Get(ctx, userID, secretNamespace, secretKey)
	if err != nil {
		if errors.Is(err, secret.ErrNotFound) {
			return "", ErrNoToken
		}
		return "", fmt.Errorf("canvas: read the stored token: %w", err)
	}
	return token, nil
}

// Forget removes the stored token. Idempotent, like the store beneath it: a
// professor who clicks "Eliminar" twice sees the same outcome both times.
func (s *Service) Forget(ctx context.Context, userID int64) error {
	if !s.Configured() {
		return ErrNotConfigured
	}
	if err := s.Secrets.Delete(ctx, userID, secretNamespace, secretKey); err != nil {
		return fmt.Errorf("canvas: forget the stored token: %w", err)
	}
	return nil
}
