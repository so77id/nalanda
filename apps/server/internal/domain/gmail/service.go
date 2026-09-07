package gmail

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// AccountStore records WHICH Gmail account a professor connected.
//
// A port of its own rather than two more methods on auth.UserStore: this
// domain needs two columns of the users table and nothing else about
// authentication, and widening the auth store would make every auth test
// carry a Gmail concept it has no use for. The narrow shape is the one
// health.Prober and jobs.Store already have here.
//
// The address is the AUTHORITATIVE "is this professor connected" signal —
// see Service.Complete for the ordering that makes it safe to read as one.
type AccountStore interface {
	// SetGmailAddress records the connected account, or clears it when
	// address is empty.
	SetGmailAddress(ctx context.Context, userID int64, address string) error

	// GmailAddress returns the connected account, or "" for a professor
	// who has connected none. Absence is an ordinary answer here, not an
	// error: most professors have not connected one.
	GmailAddress(ctx context.Context, userID int64) (string, error)
}

// Connection is what the profile page renders.
type Connection struct {
	// Address is the connected account, empty when there is none.
	Address string
}

// Connected reports whether anything is connected.
func (c Connection) Connected() bool { return c.Address != "" }

// Service is the policy over the authorization flow and the two halves of
// the stored credential.
type Service struct {
	Authorizer Authorizer
	// Secrets seals the refresh token (ADR-0068). The plaintext never
	// leaves a call in this file.
	Secrets secret.Store
	// Accounts holds the non-secret half.
	Accounts AccountStore
	Log      *slog.Logger
}

// NewService refuses a set it cannot serve with — a wiring mistake is a
// panic at boot rather than a nil dereference inside a request
// (backend-code-style.md §Errors), the shape every constructor in this app
// has.
func NewService(deps Service) *Service {
	switch {
	case deps.Authorizer == nil:
		panic("gmail.NewService: no authorizer")
	case deps.Secrets == nil:
		panic("gmail.NewService: no secret store")
	case deps.Accounts == nil:
		panic("gmail.NewService: no account store")
	case deps.Log == nil:
		panic("gmail.NewService: no logger")
	}
	return &deps
}

// ConnectURL is where the professor's browser goes to grant consent.
func (s *Service) ConnectURL(state, redirectURI string) string {
	return s.Authorizer.AuthCodeURL(state, redirectURI)
}

// Complete finishes the callback: exchange the code, seal the refresh
// token, record the address. It returns the connected address.
//
// THE ORDER OF THE TWO WRITES IS THE CONTRACT, and it is why the address
// can be read elsewhere as "is this professor connected".
//
// The secret is sealed FIRST and the address stamped SECOND, so the
// observable signal is the last thing written and is never true without a
// credential behind it. The other order gives a profile page that says
// "Gmail conectado" over nothing, and a publication that fails for every
// student with an error the professor cannot act on.
//
// If the second write fails, the first is rolled back best-effort. A
// sealed token with no address is the harmless half of the pair — it is
// invisible, it is overwritten by the next successful connect, and leaving
// it costs a row rather than a wrong claim — so a failed rollback is
// logged and not forwarded. Same "best-effort cleanup after the
// load-bearing decision" shape as Service.Purge's directory removal.
func (s *Service) Complete(ctx context.Context, professorID int64, code, redirectURI string) (string, error) {
	grant, err := s.Authorizer.Exchange(ctx, code, redirectURI)
	if err != nil {
		return "", err
	}

	if err := s.Secrets.Set(ctx, professorID, secret.NamespaceGmail, secret.KeyRefreshToken, grant.RefreshToken); err != nil {
		// The error is not wrapped with anything about the value: this is
		// the one path holding a refresh token in a local variable, and an
		// error string reaches stderr.
		return "", fmt.Errorf("gmail: seal the refresh token: %w", err)
	}

	if err := s.Accounts.SetGmailAddress(ctx, professorID, grant.Address); err != nil {
		if cleanup := s.Secrets.Delete(ctx, professorID, secret.NamespaceGmail, secret.KeyRefreshToken); cleanup != nil {
			s.Log.Warn("gmail: could not roll back the sealed token after the address failed to stamp",
				"professor", professorID, "error", cleanup)
		}
		return "", fmt.Errorf("gmail: record the connected address: %w", err)
	}

	return grant.Address, nil
}

// Disconnect removes both halves.
//
// The ADDRESS goes first here, the mirror of Complete's order and for the
// same reason: the moment it is gone the professor is disconnected
// everywhere that asks, whatever happens to the sealed row afterwards. A
// failure between the two leaves an unreachable secret, which the next
// connect overwrites.
func (s *Service) Disconnect(ctx context.Context, professorID int64) error {
	if err := s.Accounts.SetGmailAddress(ctx, professorID, ""); err != nil {
		return fmt.Errorf("gmail: clear the connected address: %w", err)
	}
	if err := s.Secrets.Delete(ctx, professorID, secret.NamespaceGmail, secret.KeyRefreshToken); err != nil {
		return fmt.Errorf("gmail: remove the sealed token: %w", err)
	}
	return nil
}

// Connection reports what the profile page shows.
func (s *Service) Connection(ctx context.Context, professorID int64) (Connection, error) {
	address, err := s.Accounts.GmailAddress(ctx, professorID)
	if err != nil {
		return Connection{}, fmt.Errorf("gmail: read the connected address: %w", err)
	}
	return Connection{Address: address}, nil
}

// AccessToken returns a token the mail transport can present, refreshing
// the stored credential to get one.
//
// This method is where AC13 lives — "a credential the provider has revoked
// degrades honestly" — and the three outcomes are deliberately not two:
//
//   - ErrNotConnected: nothing is stored. The professor never connected,
//     or disconnected. Nothing is deleted, because there is nothing there.
//   - ErrRejected: the provider will not honour the stored token. The
//     credential is CLEARED, because the repair is a human at a consent
//     screen and a dead credential that keeps looking alive on the profile
//     page sends the professor hunting somewhere else. Retrying it would
//     never succeed.
//   - ErrUnavailable: the question could not be asked. NOTHING is
//     deleted. Deleting here is the mistake that makes every professor
//     reconnect each time Google hiccups, and it is unrecoverable in the
//     direction that matters — the server cannot re-consent on their
//     behalf.
//
// The asymmetry between the last two is the whole point, and it is why the
// authorizer keeps invalid_grant apart from every other failure.
func (s *Service) AccessToken(ctx context.Context, professorID int64) (Access, error) {
	refresh, err := s.Secrets.Get(ctx, professorID, secret.NamespaceGmail, secret.KeyRefreshToken)
	switch {
	case errors.Is(err, secret.ErrNotFound):
		return Access{}, fmt.Errorf("%w", ErrNotConnected)
	case err != nil:
		// A row that exists and cannot be authenticated: a wrong master
		// key or a tampered blob. That is a deployment fault, not a
		// professor's, so it is NOT ErrRejected and nothing is cleared —
		// throwing the row away would destroy a credential that a correct
		// master key would still open.
		return Access{}, fmt.Errorf("%w: unseal the refresh token: %v", ErrUnavailable, err)
	}

	access, err := s.Authorizer.Refresh(ctx, refresh)
	switch {
	case err == nil:
		return access, nil
	case errors.Is(err, ErrRejected):
		s.clearRejected(ctx, professorID)
		return Access{}, err
	default:
		return Access{}, err
	}
}

// clearRejected removes a credential the provider has disowned.
//
// Best-effort and logged rather than forwarded: the caller is already
// returning ErrRejected, which is the answer the professor acts on, and
// replacing it with "could not clean up" would hide the one instruction
// that helps them ("vuelve a conectar Gmail").
func (s *Service) clearRejected(ctx context.Context, professorID int64) {
	if err := s.Disconnect(ctx, professorID); err != nil {
		s.Log.Warn("gmail: could not clear a credential the provider rejected",
			"professor", professorID, "error", err)
	}
}
