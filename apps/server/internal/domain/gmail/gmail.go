// Package gmail is the professor's authorisation to let this server send
// mail as them (issue #273, WP-3 of epic #270).
//
// It is deliberately NOT part of the login. The login (ADR-0009, ADR-0036)
// asks Google for `openid email profile` and receives an ID token: enough
// to know who is at the keyboard, and nothing more. Sending mail needs the
// `gmail.send` scope, which Google only grants against an explicit consent
// screen reading "Enviar correo electrónico en tu nombre", and it needs
// `access_type=offline` so a refresh token survives the request that
// obtained it — publication runs on the job runner, minutes after the
// professor's browser has gone.
//
// Widening the LOGIN's scopes would have avoided a second flow and was
// rejected: every professor would then meet that consent screen merely to
// enter, and this server would hold a mail-sending credential for people
// who never asked to send mail. The grant is opt-in, from /profile, the
// same shape as the Canvas token of #271.
//
// The credential's two halves are stored apart, and the split is the
// point: the refresh token is sealed in user_secrets (ADR-0068) and never
// leaves secret.Store as plaintext, while the connected ADDRESS sits in the
// clear on users.gmail_address because it is what the profile page prints
// and what every message's From is built from.
package gmail

import (
	"context"
	"errors"
	"time"
)

// Scope is the single permission this flow asks for.
//
// `gmail.send` and nothing wider, on purpose. It permits sending and
// nothing else — it cannot read a message, list a thread or change a
// setting — and Google classifies it as SENSITIVE rather than RESTRICTED,
// which is the difference between an app review and an annually repeated
// third-party security assessment. Widening it to gmail.modify or
// https://mail.google.com/ would buy nothing this server does and would
// move the app into the assessed tier.
const Scope = "https://www.googleapis.com/auth/gmail.send"

// Grant is what a completed consent yields.
type Grant struct {
	// RefreshToken is the long-lived half, and the only part worth
	// storing. Sealed by the caller before it touches a disk.
	RefreshToken string
	// Address is the account that was connected, read from the ID token
	// the same exchange returned. It is not assumed to equal the address
	// the professor logs in with: they are usually the same and are
	// allowed to differ, and it is THIS one that appears as the From.
	Address string
	// Access is the short-lived token the same exchange already produced.
	//
	// Carried for a caller that wants it; Service.Complete deliberately
	// does NOT keep it. Storing or caching an access token would break the
	// property the per-message refresh exists for — see
	// email.GmailDispatcher.Send — and ADR-0072 §3 records that access
	// tokens are never stored.
	Access Access
}

// Access is a short-lived access token and when it stops working.
type Access struct {
	Token  string
	Expiry time.Time
}

// Valid reports whether the token can still be used at `now`, with a
// margin.
//
// The margin is not decoration: a token that passes an exact check can
// still expire in flight, between this call and Google reading the header
// on the far side of a request carrying a multi-megabyte attachment.
//
// NOTHING IN PRODUCTION CALLS THIS. It is kept for a caller that holds an
// Access and wants to know, and the honest statement is that this server
// is not one: Service.AccessToken refreshes on every message on purpose
// (email.GmailDispatcher.Send says why). An earlier version of this
// comment implied a cache consulted it (#273 review, CACHE-1).
func (a Access) Valid(now time.Time) bool {
	return a.Token != "" && now.Add(time.Minute).Before(a.Expiry)
}

// Authorizer is the OAuth side of connecting an account: the consent URL,
// the code exchange, and the refresh grant. Declared here because this is
// where it is consumed; internal/infra/oidc implements it
// (backend-code-style.md §The dependency rule).
type Authorizer interface {
	// AuthCodeURL builds the URL the professor's browser is sent to.
	AuthCodeURL(state, redirectURI string) string

	// Exchange trades the callback's code for a Grant.
	Exchange(ctx context.Context, code, redirectURI string) (Grant, error)

	// Refresh trades a stored refresh token for a fresh access token. The
	// refresh token itself is unchanged by a successful call — Google does
	// not rotate it — so a caller has nothing to write back.
	Refresh(ctx context.Context, refreshToken string) (Access, error)
}

// The failure modes callers branch on. They are kept apart because each
// one is repaired differently, and because only ErrRejected justifies
// throwing a stored credential away.
var (
	// ErrNotConnected is a professor who has authorised no account at all.
	// An ordinary state — most professors are in it — and the answer the
	// control page uses to refuse "Publicar" before offering it.
	ErrNotConnected = errors.New("gmail: the professor has not connected an account")

	// ErrNotConfigured is a deployment with no NALANDA_SECRETS_MASTER_KEY,
	// which can store no credential at all. Distinct from ErrNotConnected
	// because the repair belongs to a different person: the operator sets
	// a key, and no amount of clicking by the professor helps.
	ErrNotConfigured = errors.New("gmail: this deployment cannot store credentials")

	// ErrScopeNotGranted is a consent that completed WITHOUT the send
	// permission. Google presents `gmail.send` as a granular checkbox
	// beside the identity scopes, so a professor can approve the screen
	// with it unticked — and the response still carries a refresh token and
	// an id_token, which is what makes this failure invisible without an
	// explicit check.
	//
	// Left unchecked it is the worst shape available here (#273 review,
	// SCOPE-1): the connection completes, the profile page says
	// "Conectado como …", and the first publication stamps the control
	// before discovering that every send 403s — which the transport reads
	// as a message refusal and words as "puede ser la cuota diaria",
	// pointing the professor at a quota that is not the problem, on a
	// control that is one-way.
	ErrScopeNotGranted = errors.New("gmail: the consent did not grant permission to send")

	// ErrNoRefreshToken is a consent that came back without the long-lived
	// half. Google omits it when the account has already granted this
	// scope and the request did not force a fresh consent — which is why
	// the flow always sends `prompt=consent`.
	//
	// It is an explicit failure rather than a shrug because the silent
	// version is worse than anything: the connection would look complete,
	// the profile page would name the account, and every publication from
	// then on would fail with no credential to refresh.
	ErrNoRefreshToken = errors.New("gmail: the consent returned no refresh token")

	// ErrRejected is a refresh token Google will no longer honour —
	// revoked from the account's own permissions page, invalidated by a
	// password change, or expired because the OAuth app is still in
	// Testing publishing status, where Google revokes them after seven
	// days.
	//
	// The repair is a human at a consent screen, so a caller CLEARS the
	// stored credential rather than retrying: retrying this one never
	// succeeds, and a credential that is known dead must not keep looking
	// alive on the profile page.
	ErrRejected = errors.New("gmail: the stored credential was rejected")

	// ErrUnavailable is a failure that says nothing about the credential:
	// a transport error, a 5xx, a timeout. Kept apart from ErrRejected
	// precisely so an outage never deletes a working credential — the
	// mistake that would make a professor reconnect every time Google
	// hiccups.
	ErrUnavailable = errors.New("gmail: could not reach the provider")
)
