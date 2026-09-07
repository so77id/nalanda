package gmail_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/domain/secret"
)

// What is worth pinning here is not the happy path — it is the three
// asymmetries, each of which is a decision that reads as arbitrary until
// its failure mode is named:
//
//  1. Complete writes the sealed token BEFORE the address, so the
//     observable "connected" signal is never true over nothing.
//  2. AccessToken clears the credential on a rejection and NOT on an
//     outage. Getting that backwards makes a professor reconnect every
//     time Google hiccups, and the server cannot re-consent for them.
//  3. A secret that exists but will not unseal is a deployment fault, not
//     a rejection, and must not be deleted — a correct master key would
//     still open it.

type fakeAuthorizer struct {
	grant    gmail.Grant
	exchange error

	access  gmail.Access
	refresh error

	refreshes int
}

func (f *fakeAuthorizer) AuthCodeURL(state, redirectURI string) string {
	return "https://provider.test/auth?state=" + state + "&redirect_uri=" + redirectURI
}

func (f *fakeAuthorizer) Exchange(context.Context, string, string) (gmail.Grant, error) {
	if f.exchange != nil {
		return gmail.Grant{}, f.exchange
	}
	return f.grant, nil
}

func (f *fakeAuthorizer) Refresh(context.Context, string) (gmail.Access, error) {
	f.refreshes++
	if f.refresh != nil {
		return gmail.Access{}, f.refresh
	}
	return f.access, nil
}

// memSecrets is an in-memory secret.Store keyed by the same triple.
type memSecrets struct {
	values  map[string]string
	setErr  error
	getErr  error
	deletes int
}

func newMemSecrets() *memSecrets { return &memSecrets{values: map[string]string{}} }

func (m *memSecrets) key(userID int64, ns, k string) string {
	return string(rune(userID)) + "|" + ns + "|" + k
}

func (m *memSecrets) Set(_ context.Context, userID int64, ns, k, plaintext string) error {
	if m.setErr != nil {
		return m.setErr
	}
	m.values[m.key(userID, ns, k)] = plaintext
	return nil
}

func (m *memSecrets) Get(_ context.Context, userID int64, ns, k string) (string, error) {
	if m.getErr != nil {
		return "", m.getErr
	}
	v, ok := m.values[m.key(userID, ns, k)]
	if !ok {
		return "", secret.ErrNotFound
	}
	return v, nil
}

func (m *memSecrets) Delete(_ context.Context, userID int64, ns, k string) error {
	m.deletes++
	delete(m.values, m.key(userID, ns, k))
	return nil
}

type memAccounts struct {
	address string
	setErr  error
	getErr  error
	sets    []string
}

func (m *memAccounts) SetGmailAddress(_ context.Context, _ int64, address string) error {
	if m.setErr != nil {
		return m.setErr
	}
	m.sets = append(m.sets, address)
	m.address = address
	return nil
}

func (m *memAccounts) GmailAddress(context.Context, int64) (string, error) {
	if m.getErr != nil {
		return "", m.getErr
	}
	return m.address, nil
}

func newService(auth *fakeAuthorizer, secrets *memSecrets, accounts *memAccounts) *gmail.Service {
	return gmail.NewService(gmail.Service{
		Authorizer: auth,
		Secrets:    secrets,
		Accounts:   accounts,
		Log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func TestCompleteSealsTheTokenAndRecordsTheAddress(t *testing.T) {
	auth := &fakeAuthorizer{grant: gmail.Grant{
		RefreshToken: "1//refresh",
		Address:      "profesora@gmail.com",
	}}
	secrets, accounts := newMemSecrets(), &memAccounts{}

	address, err := newService(auth, secrets, accounts).
		Complete(context.Background(), 7, "code", "https://nalanda.test/cb")
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if address != "profesora@gmail.com" {
		t.Errorf("Complete returned %q, want the connected address", address)
	}
	if got := accounts.address; got != "profesora@gmail.com" {
		t.Errorf("the stored address is %q", got)
	}
	stored, err := secrets.Get(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken)
	if err != nil {
		t.Fatalf("the refresh token was not sealed: %v", err)
	}
	if stored != "1//refresh" {
		t.Errorf("the sealed token is %q", stored)
	}
}

// The ordering contract. If the address could be written first, a failure
// between the two would leave a profile page saying "Gmail conectado" over
// no credential, and every publication after it would fail for every
// student with an error the professor cannot act on.
func TestCompleteLeavesNoAddressBehindWhenTheSecretCannotBeSealed(t *testing.T) {
	auth := &fakeAuthorizer{grant: gmail.Grant{RefreshToken: "1//refresh", Address: "profesora@gmail.com"}}
	secrets := newMemSecrets()
	secrets.setErr = errors.New("disk full")
	accounts := &memAccounts{}

	if _, err := newService(auth, secrets, accounts).
		Complete(context.Background(), 7, "code", "https://nalanda.test/cb"); err == nil {
		t.Fatal("Complete succeeded although the token could not be sealed")
	}
	if accounts.address != "" {
		t.Errorf("the address was recorded as %q over a credential that was never stored", accounts.address)
	}
	if len(accounts.sets) != 0 {
		t.Errorf("the account store was written %d times, want none", len(accounts.sets))
	}
}

func TestCompleteRollsTheSealedTokenBackWhenTheAddressCannotBeRecorded(t *testing.T) {
	auth := &fakeAuthorizer{grant: gmail.Grant{RefreshToken: "1//refresh", Address: "profesora@gmail.com"}}
	secrets, accounts := newMemSecrets(), &memAccounts{setErr: errors.New("locked")}

	if _, err := newService(auth, secrets, accounts).
		Complete(context.Background(), 7, "code", "https://nalanda.test/cb"); err == nil {
		t.Fatal("Complete succeeded although the address could not be recorded")
	}
	if _, err := secrets.Get(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken); !errors.Is(err, secret.ErrNotFound) {
		t.Error("the sealed token survived a failed connect; the next connect would overwrite it, " +
			"but leaving it is a credential nothing points at")
	}
}

func TestCompletePropagatesAConsentThatCarriedNoRefreshToken(t *testing.T) {
	auth := &fakeAuthorizer{exchange: gmail.ErrNoRefreshToken}
	secrets, accounts := newMemSecrets(), &memAccounts{}

	_, err := newService(auth, secrets, accounts).
		Complete(context.Background(), 7, "code", "https://nalanda.test/cb")
	if !errors.Is(err, gmail.ErrNoRefreshToken) {
		t.Fatalf("Complete returned %v, want ErrNoRefreshToken", err)
	}
	if accounts.address != "" {
		t.Error("a consent with no refresh token still recorded an address")
	}
}

func TestAccessTokenRefusesAProfessorWhoConnectedNothing(t *testing.T) {
	auth := &fakeAuthorizer{}
	secrets, accounts := newMemSecrets(), &memAccounts{}

	_, err := newService(auth, secrets, accounts).AccessToken(context.Background(), 7)
	if !errors.Is(err, gmail.ErrNotConnected) {
		t.Fatalf("AccessToken returned %v, want ErrNotConnected", err)
	}
	if auth.refreshes != 0 {
		t.Error("the authorizer was called although nothing was stored")
	}
}

func TestAccessTokenRefreshesTheStoredCredential(t *testing.T) {
	auth := &fakeAuthorizer{access: gmail.Access{
		Token:  "ya29.fresh",
		Expiry: time.Now().Add(time.Hour),
	}}
	secrets, accounts := newMemSecrets(), &memAccounts{address: "profesora@gmail.com"}
	_ = secrets.Set(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken, "1//refresh")

	access, err := newService(auth, secrets, accounts).AccessToken(context.Background(), 7)
	if err != nil {
		t.Fatalf("AccessToken: %v", err)
	}
	if access.Token != "ya29.fresh" {
		t.Errorf("Token = %q", access.Token)
	}
}

// The pair. Both halves in one case, because either alone passes over the
// implementation that gets the other backwards.
func TestAccessTokenClearsARejectedCredentialAndKeepsOneThroughAnOutage(t *testing.T) {
	t.Run("a rejection clears both halves", func(t *testing.T) {
		auth := &fakeAuthorizer{refresh: gmail.ErrRejected}
		secrets := newMemSecrets()
		accounts := &memAccounts{address: "profesora@gmail.com"}
		_ = secrets.Set(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken, "1//dead")

		_, err := newService(auth, secrets, accounts).AccessToken(context.Background(), 7)
		if !errors.Is(err, gmail.ErrRejected) {
			t.Fatalf("AccessToken returned %v, want ErrRejected", err)
		}
		if _, err := secrets.Get(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken); !errors.Is(err, secret.ErrNotFound) {
			t.Error("a credential the provider disowned is still sealed")
		}
		if accounts.address != "" {
			t.Error("the profile page would still name a connected account whose credential is dead")
		}
	})

	t.Run("an outage keeps them", func(t *testing.T) {
		auth := &fakeAuthorizer{refresh: gmail.ErrUnavailable}
		secrets := newMemSecrets()
		accounts := &memAccounts{address: "profesora@gmail.com"}
		_ = secrets.Set(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken, "1//alive")

		_, err := newService(auth, secrets, accounts).AccessToken(context.Background(), 7)
		if !errors.Is(err, gmail.ErrUnavailable) {
			t.Fatalf("AccessToken returned %v, want ErrUnavailable", err)
		}
		if _, err := secrets.Get(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken); err != nil {
			t.Errorf("an outage deleted a working credential (%v); the server cannot re-consent "+
				"on the professor's behalf, so this is unrecoverable in the direction that matters", err)
		}
		if accounts.address == "" {
			t.Error("an outage disconnected the account")
		}
	})
}

// A row that exists and will not unseal is a wrong master key or a
// tampered blob — a deployment fault. Reading it as a rejection would
// delete a credential a correct key would still open.
func TestAccessTokenDoesNotDeleteASecretItCannotUnseal(t *testing.T) {
	auth := &fakeAuthorizer{}
	secrets := newMemSecrets()
	secrets.getErr = errors.New("cipher: message authentication failed")
	accounts := &memAccounts{address: "profesora@gmail.com"}

	_, err := newService(auth, secrets, accounts).AccessToken(context.Background(), 7)
	if errors.Is(err, gmail.ErrRejected) {
		t.Fatal("an unsealable row was reported as a rejected credential, which deletes it")
	}
	if !errors.Is(err, gmail.ErrUnavailable) {
		t.Fatalf("AccessToken returned %v, want ErrUnavailable", err)
	}
	if secrets.deletes != 0 {
		t.Error("the credential was deleted over a master-key problem")
	}
	if auth.refreshes != 0 {
		t.Error("the authorizer was called with a token that never unsealed")
	}
}

func TestDisconnectRemovesBothHalves(t *testing.T) {
	auth := &fakeAuthorizer{}
	secrets := newMemSecrets()
	accounts := &memAccounts{address: "profesora@gmail.com"}
	_ = secrets.Set(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken, "1//refresh")

	if err := newService(auth, secrets, accounts).Disconnect(context.Background(), 7); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if accounts.address != "" {
		t.Errorf("the address survived at %q", accounts.address)
	}
	if _, err := secrets.Get(context.Background(), 7, secret.NamespaceGmail, secret.KeyRefreshToken); !errors.Is(err, secret.ErrNotFound) {
		t.Error("the sealed token survived the disconnect")
	}
}

func TestConnectionReportsWhatTheProfilePageShows(t *testing.T) {
	auth := &fakeAuthorizer{}

	connected, err := newService(auth, newMemSecrets(), &memAccounts{address: "profesora@gmail.com"}).
		Connection(context.Background(), 7)
	if err != nil {
		t.Fatalf("Connection: %v", err)
	}
	if !connected.Connected() || connected.Address != "profesora@gmail.com" {
		t.Errorf("Connection = %+v, want a connected account", connected)
	}

	none, err := newService(auth, newMemSecrets(), &memAccounts{}).Connection(context.Background(), 7)
	if err != nil {
		t.Fatalf("Connection: %v", err)
	}
	if none.Connected() {
		t.Errorf("Connection = %+v, want no connection", none)
	}
}
