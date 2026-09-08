package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	domaingmail "github.com/so77id/nalanda/apps/server/internal/domain/gmail"
)

// GmailAuthorizer is the SECOND authorization-code flow this server runs
// against Google (issue #273): the professor's consent to let it send mail
// as them.
//
// It lives in this package, beside the login, because it talks to the same
// endpoints with the same client credentials and reuses the same ID-token
// verification — but it is a separate type rather than a parameter on
// Google, and the reason is in what the two flows want from an exchange.
// The login wants an identity and deliberately discards everything else
// (see this package's doc comment: "no refresh tokens — a professor logs in
// again"). This flow exists precisely FOR the refresh token, because a
// publication runs on the job runner minutes after the browser has gone.
// Folding both into one method would give it a boolean argument that
// changes what it returns.
//
// The scopes, `access_type` and `prompt` are the three parameters that fail
// SILENTLY when wrong — the token is issued either way and the failure
// surfaces at the first real send, or weeks later at the first refresh — so
// each is asserted in gmail_test.go rather than trusted to review.
type GmailAuthorizer struct {
	cfg GoogleConfig
	// verifier is a Google built from the same configuration, used for
	// nothing but verifyIDToken and the JWKS cache behind it. Reused
	// rather than reimplemented: a second copy of the signature check is a
	// second place for it to be wrong, and the one thing worse than no
	// verification is verification that differs between two paths.
	verifier *Google
}

// NewGmailAuthorizer returns an authorizer with the same defaults NewGoogle
// fills in.
func NewGmailAuthorizer(cfg GoogleConfig) *GmailAuthorizer {
	verifier := NewGoogle(cfg)
	return &GmailAuthorizer{cfg: verifier.cfg, verifier: verifier}
}

var _ domaingmail.Authorizer = (*GmailAuthorizer)(nil)

// gmailScopes is what the consent screen asks for.
//
// `gmail.send` is the permission; `openid email` is how the exchange comes
// back naming WHICH account was connected, which is the address every
// message's From is built from and which the professor is allowed to make
// different from their login. `profile` is deliberately absent — the login
// asks for it, this flow reads no display name, and a flow must not ask for
// more than it uses.
var gmailScopes = []string{domaingmail.Scope, "openid", "email"}

// AuthCodeURL builds the URL the professor's browser is sent to. The client
// secret is not among the parameters and must never be: this URL travels
// through the browser and into its history.
func (g *GmailAuthorizer) AuthCodeURL(state, redirectURI string) string {
	query := url.Values{}
	query.Set("client_id", g.cfg.ClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("response_type", "code")
	query.Set("scope", strings.Join(gmailScopes, " "))
	query.Set("state", state)
	// Without offline access Google returns an access token and no refresh
	// token. The connection would look complete — the profile page would
	// name the account — and every publication after the first hour would
	// fail with nothing stored to refresh.
	query.Set("access_type", "offline")
	// consent, not select_account. Google omits the refresh token when the
	// account has ALREADY granted this scope and the request does not
	// force a fresh consent, so a professor who reconnects (after a
	// "Desconectar", or after the seven-day revocation of an app still in
	// Testing status) would otherwise land in exactly the state above.
	// Re-asking is the cost of never storing a half credential.
	query.Set("prompt", "consent")

	return g.cfg.AuthURL + "?" + query.Encode()
}

// Exchange trades the callback's code for the grant.
//
// On any failure it returns the zero Grant alongside the error, the same
// contract Google.Exchange holds to: partial data would let a caller that
// mishandles the error connect whoever an unverified token happens to name.
func (g *GmailAuthorizer) Exchange(ctx context.Context, code, redirectURI string) (domaingmail.Grant, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", g.cfg.ClientID)
	form.Set("client_secret", g.cfg.ClientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")

	body, err := g.token(ctx, form)
	if err != nil {
		return domaingmail.Grant{}, err
	}
	if body.RefreshToken == "" {
		// Explicit, never a shrug. The silent version is the worst outcome
		// available here: the connection completes, the page names the
		// account, and nothing works from the first hour onwards.
		return domaingmail.Grant{}, fmt.Errorf("%w", domaingmail.ErrNoRefreshToken)
	}
	if body.IDToken == "" {
		return domaingmail.Grant{}, fmt.Errorf(
			"%w: the token response carries no id_token, so the connected account is unknown",
			domaingmail.ErrUnavailable)
	}
	// The granted scope, not the requested one. Asking for `gmail.send` and
	// checking that it came back are two different things, and the second
	// is the one that matters: Google returns a refresh token either way,
	// so without this the connection looks complete and the failure surfaces
	// at the first publication — on a control that is already stamped.
	//
	// Same class as access_type and prompt above, which this file's own
	// doc-comment calls "the three parameters that fail SILENTLY when
	// wrong". This is the fourth.
	if !slices.Contains(strings.Fields(body.Scope), domaingmail.Scope) {
		return domaingmail.Grant{}, fmt.Errorf("%w", domaingmail.ErrScopeNotGranted)
	}

	// VERIFIED, not decoded. The address this returns becomes the From on
	// mail sent to students; a reader that trusted the payload would let
	// anyone who can reach the callback name any sender they like.
	// (email, subject), in that order — the subject is the login's stable
	// key and is of no use here. Taking the wrong one silently puts a
	// Google numeric subject id in the From of every student's email.
	address, _, err := g.verifier.verifyIDToken(ctx, body.IDToken)
	if err != nil {
		return domaingmail.Grant{}, fmt.Errorf("verify the connected account: %w", err)
	}

	return domaingmail.Grant{
		RefreshToken: body.RefreshToken,
		Address:      address,
		Access:       g.access(body),
	}, nil
}

// Refresh trades the stored refresh token for a fresh access token.
//
// Google does not rotate the refresh token on this grant, so nothing here
// is written back — a caller that re-stored the same value on every send
// would be writing the database once per student for no reason.
func (g *GmailAuthorizer) Refresh(ctx context.Context, refreshToken string) (domaingmail.Access, error) {
	form := url.Values{}
	form.Set("client_id", g.cfg.ClientID)
	form.Set("client_secret", g.cfg.ClientSecret)
	form.Set("refresh_token", refreshToken)
	form.Set("grant_type", "refresh_token")

	body, err := g.token(ctx, form)
	if err != nil {
		return domaingmail.Access{}, err
	}
	if body.AccessToken == "" {
		return domaingmail.Access{}, fmt.Errorf(
			"%w: the refresh response carries no access_token", domaingmail.ErrUnavailable)
	}
	return g.access(body), nil
}

// tokenResponse is the union of the fields the two grants read. One struct
// because the endpoint is one endpoint; each caller checks what it needs.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int64  `json:"expires_in"`
	// Scope is what Google ACTUALLY granted, which is not what was asked
	// for: `gmail.send` is a granular permission the professor can untick
	// on the consent screen while still approving it. Reading it is the
	// only way to tell (#273 review, SCOPE-1).
	Scope string `json:"scope"`
}

// access turns the response's relative lifetime into an absolute expiry.
//
// A MISSING expires_in yields a zero expiry, which Access.Valid reads as
// "not usable" — so the next send refreshes rather than presenting a token
// of unknown age. Defaulting to an hour would be a guess that fails closed
// in the wrong direction.
func (g *GmailAuthorizer) access(body tokenResponse) domaingmail.Access {
	out := domaingmail.Access{Token: body.AccessToken}
	if body.ExpiresIn > 0 {
		out.Expiry = g.cfg.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	}
	return out
}

// token posts one grant to the token endpoint and maps the answer onto this
// domain's failure modes.
//
// The mapping is the load-bearing part. `invalid_grant` is the ONLY answer
// that means the stored credential is dead, and it is the only one whose
// repair is a human at a consent screen — so it is the only one a caller
// may throw a credential away on. Everything else, including a 400 that is
// not invalid_grant, leaves the credential alone: a bad request this server
// built says nothing about the professor's authorisation, and an outage
// that deleted credentials would make every professor reconnect each time
// Google hiccups.
func (g *GmailAuthorizer) token(ctx context.Context, form url.Values) (tokenResponse, error) {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, g.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, fmt.Errorf("%w: build the token request: %v", domaingmail.ErrUnavailable, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := g.cfg.HTTPClient.Do(request)
	if err != nil {
		// %v rather than %w on the transport error: it is the one value
		// here built from a request that carried the client secret, and a
		// provider that echoed the request back would put the secret in a
		// log line. Same reasoning as oauthErrorCode below.
		return tokenResponse{}, fmt.Errorf("%w: reach the token endpoint: %v", domaingmail.ErrUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		// Only the OAuth error CODE is reported, never the body. The body
		// is attacker-adjacent data on the path most likely to be logged,
		// and it answers a request that carried the client secret.
		code := oauthErrorCode(response.Body)
		if code == "invalid_grant" {
			return tokenResponse{}, fmt.Errorf("%w: the provider answered invalid_grant", domaingmail.ErrRejected)
		}
		return tokenResponse{}, fmt.Errorf(
			"%w: the token endpoint answered %d: %s", domaingmail.ErrUnavailable, response.StatusCode, code)
	}

	var body tokenResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return tokenResponse{}, fmt.Errorf("%w: decode the token response: %v", domaingmail.ErrUnavailable, err)
	}
	return body, nil
}
