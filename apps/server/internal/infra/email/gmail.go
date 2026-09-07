package email

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/mail"
	"net/textproto"
	"strings"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
)

// Credentials is what the transport needs from the authorisation half: a
// usable access token for one professor.
//
// A port rather than a *gmail.Service field so this package does not drag
// the secret store, the account store and an OAuth client into every test
// that wants to assert a MIME header. gmail.Service is what satisfies it.
type Credentials interface {
	AccessToken(ctx context.Context, professorID int64) (gmail.Access, error)
}

// sendEndpoint is Gmail's MEDIA upload endpoint, and choosing it over the
// metadata one is a decision rather than a coin toss.
//
// The metadata endpoint (…/messages/send, no /upload/) takes the whole
// message base64url-encoded inside a JSON `raw` field, and caps the request
// at 5 MB. Base64 inflates by a third, so a 3.8 MB annotated PDF — a
// plausible four-page colour scan — becomes a 5.1 MB request and is refused
// with a message about the request, not about the attachment.
//
// The media endpoint takes the RFC 5322 message as the body itself, reaches
// 35 MB, and skips the base64 pass over the whole message entirely: the
// attachment is still base64 inside its MIME part, but the envelope is not
// re-encoded on top of it. Fewer bytes on the wire, a cap an annotated
// control cannot plausibly reach, and less code.
const sendEndpoint = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media"

// defaultTimeout bounds one send.
//
// Generous next to internal/infra/canvas's 15 s, and deliberately: this
// request carries an attachment of a few megabytes over whatever uplink the
// Jetson has, while Canvas's carries a GraphQL query. It is still bounded,
// because a publication is a loop over a class and one wedged send must not
// hold the job's goroutine for the afternoon.
const defaultTimeout = 60 * time.Second

// GmailConfig configures the real transport. Credentials is required;
// everything else has a working default, the oidc.GoogleConfig shape — so a
// test points Endpoint at an httptest server and nothing else in the
// package needs a test-only door.
type GmailConfig struct {
	Credentials Credentials
	// Endpoint overrides sendEndpoint. Empty means Gmail's.
	Endpoint string
	// HTTPClient overrides the default. Empty means one with defaultTimeout.
	HTTPClient *http.Client
}

// GmailDispatcher sends as the professor, through their own account.
type GmailDispatcher struct {
	cfg GmailConfig
}

// NewGmailDispatcher returns the real transport with the defaults filled in.
func NewGmailDispatcher(cfg GmailConfig) *GmailDispatcher {
	if cfg.Credentials == nil {
		panic("email.NewGmailDispatcher: no credentials")
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = sendEndpoint
	}
	if cfg.HTTPClient == nil {
		// A timeout, because the default client has none: without it a
		// Gmail that accepts the connection and stops talking holds the
		// publication's goroutine for as long as it likes.
		cfg.HTTPClient = &http.Client{Timeout: defaultTimeout}
	}
	return &GmailDispatcher{cfg: cfg}
}

var _ controls.Dispatcher = (*GmailDispatcher)(nil)

// Delivers is true: this is the transport that actually sends.
func (d *GmailDispatcher) Delivers() bool { return true }

// Send delivers one message and returns Gmail's id for it.
func (d *GmailDispatcher) Send(ctx context.Context, professorID int64, msg controls.Message) (string, error) {
	if msg.To == "" {
		return "", fmt.Errorf("%w", ErrNoRecipient)
	}

	// One credential fetch per MESSAGE, and it really is one refresh per
	// message — there is no cache anywhere, and an earlier version of this
	// comment claimed there was (#273 review, CACHE-1, found by three
	// lenses independently).
	//
	// It is the deliberate cost, not an oversight. A cache would save ~40
	// keep-alive POSTs to Google beside 40 multi-megabyte uploads, which is
	// noise — and it would BREAK the property that makes the per-message
	// fetch worth having: a credential revoked halfway through a batch
	// stops the batch at the next copy, instead of failing the remaining
	// thirty-nine against a token this process is still holding.
	access, err := d.cfg.Credentials.AccessToken(ctx, professorID)
	if err != nil {
		return "", err
	}

	raw, err := buildMIME(msg)
	if err != nil {
		// TWO %w, so both sentinels stay reachable: ErrSendRefused is what
		// the publication loop branches on to record a per-copy failure and
		// carry on, and the wrapped cause is what says WHICH refusal it was
		// — ErrHeaderInjection in particular, which an operator needs to
		// see because it means the roster is carrying something nobody
		// should be able to write.
		return "", fmt.Errorf("%w: build the message: %w", controls.ErrSendRefused, err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.cfg.Endpoint, bytes.NewReader(raw))
	if err != nil {
		return "", fmt.Errorf("%w: build the send request: %v", controls.ErrSendUnavailable, err)
	}
	request.Header.Set("Authorization", "Bearer "+access.Token)
	request.Header.Set("Content-Type", "message/rfc822")

	response, err := d.cfg.HTTPClient.Do(request)
	if err != nil {
		// %v, not %w: this error is built from a request that carried a
		// bearer token, and a server that echoed the request back would
		// put the token into a log line. Same rule as
		// internal/infra/canvas and internal/infra/oidc.
		return "", fmt.Errorf("%w: reach Gmail: %v", controls.ErrSendUnavailable, err)
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != http.StatusOK {
		return "", d.failure(response)
	}

	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		// The message may well have been sent. Reporting it as unavailable
		// rather than refused is the honest half: "we do not know" is
		// closer to unavailable, and a publication records the failure
		// without claiming the student was not written to.
		return "", fmt.Errorf("%w: decode Gmail's answer: %v", controls.ErrSendUnavailable, err)
	}
	if body.ID == "" {
		return "", fmt.Errorf("%w: Gmail accepted the message and named no id", controls.ErrSendUnavailable)
	}
	return body.ID, nil
}

// failure maps a non-200 onto the sentinels a caller branches on.
//
// The load-bearing decision here is what does NOT map to gmail.ErrRejected,
// because that sentinel deletes the professor's stored credential and only
// a human at a consent screen can restore it.
//
//   - 401 does. The token was refreshed moments ago, so an unauthenticated
//     answer means the grant was withdrawn between the refresh and this
//     send. That is exactly the state re-consent repairs.
//   - 403 does NOT, although it can mean "insufficient permission" as well
//     as "daily limit exceeded". Gmail spells both 403 and only
//     distinguishes them inside an error `reason` whose vocabulary is not
//     contractual. Between deleting a working credential over a quota and
//     leaving a broken one in place for the professor to reconnect by hand,
//     the second is the recoverable mistake — so a 403 is a refusal of THIS
//     message and the credential is left alone.
//   - 429 and the other 4xx are refusals of the message.
//   - 5xx says nothing about either.
func (d *GmailDispatcher) failure(response *http.Response) error {
	reason := errorReason(response.Body)

	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return fmt.Errorf("%w: Gmail answered 401", gmail.ErrRejected)
	case response.StatusCode >= 500:
		return fmt.Errorf("%w: Gmail answered %d: %s",
			controls.ErrSendUnavailable, response.StatusCode, reason)
	default:
		return fmt.Errorf("%w: Gmail answered %d: %s",
			controls.ErrSendRefused, response.StatusCode, reason)
	}
}

// errorReason extracts the CLOSED-VOCABULARY status from Gmail's error
// envelope, and nothing else.
//
// `status` only. The envelope's `message` is provider-controlled free text
// on a path that answers a request carrying a bearer token and that ends in
// a log line, and the earlier version of this function fell back to it when
// `status` was absent — so the one branch that echoed an arbitrary
// provider string was also the one branch the test fixture never reached
// (#273 review, TEST-2). Reading only the bounded field is the same rule,
// and the same reason, as oidc.oauthErrorCode reading only `error`.
func errorReason(body io.Reader) string {
	var envelope struct {
		Error struct {
			Status string `json:"status"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 8<<10)).Decode(&envelope); err != nil {
		return "unreadable"
	}
	if envelope.Error.Status != "" {
		return envelope.Error.Status
	}
	return "no reason given"
}

// buildMIME assembles the RFC 5322 message.
//
// Every header that can carry a person's name or a Spanish word goes
// through mime.QEncoding, and that is not decoration: RFC 5322 headers are
// ASCII, and "Corrección" in a bare Subject reaches the student's inbox as
// mojibake — on the one line they read before deciding whether to open it.
// The filename gets the same treatment for the same reason.
func buildMIME(msg controls.Message) ([]byte, error) {
	from, err := headerAddress(msg.From)
	if err != nil {
		return nil, fmt.Errorf("from: %w", err)
	}
	to, err := headerAddress(msg.To)
	if err != nil {
		return nil, fmt.Errorf("to: %w", err)
	}

	var out bytes.Buffer
	body := multipart.NewWriter(&out)

	header := func(name, value string) {
		fmt.Fprintf(&out, "%s: %s\r\n", name, value)
	}
	header("From", from)
	header("To", to)
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("MIME-Version", "1.0")
	header("Content-Type", "multipart/mixed; boundary="+body.Boundary())
	out.WriteString("\r\n")

	text, err := body.CreatePart(textproto.MIMEHeader{
		"Content-Type":              {"text/plain; charset=utf-8"},
		"Content-Transfer-Encoding": {"base64"},
	})
	if err != nil {
		return nil, fmt.Errorf("create the text part: %w", err)
	}
	// base64 rather than 8bit: the body is Spanish and full of accented
	// characters, and an 8-bit body is at the mercy of every relay between
	// here and the student that decides to be strict about it.
	if err := writeBase64(text, []byte(msg.Text)); err != nil {
		return nil, fmt.Errorf("write the text part: %w", err)
	}

	if len(msg.Attachment.Content) > 0 {
		contentType := msg.Attachment.ContentType
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		if strings.ContainsAny(contentType, "\r\n") {
			return nil, fmt.Errorf("%w: the attachment's content type", ErrHeaderInjection)
		}
		name := mime.QEncoding.Encode("utf-8", msg.Attachment.Filename)
		file, err := body.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {contentType},
			"Content-Transfer-Encoding": {"base64"},
			"Content-Disposition":       {`attachment; filename="` + name + `"`},
		})
		if err != nil {
			return nil, fmt.Errorf("create the attachment part: %w", err)
		}
		if err := writeBase64(file, msg.Attachment.Content); err != nil {
			return nil, fmt.Errorf("write the attachment part: %w", err)
		}
	}

	if err := body.Close(); err != nil {
		return nil, fmt.Errorf("close the message: %w", err)
	}
	return out.Bytes(), nil
}

// ErrHeaderInjection is a value that cannot go in an RFC 5322 header.
//
// It exists because the previous version of buildMIME interpolated From and
// To with fmt.Fprintf and no escaping, so a CR or LF in either injected an
// arbitrary header — a `Bcc:` that Gmail's message/rfc822 upload honours,
// exfiltrating one student's grade and corrected PDF from the professor's
// own mailbox — or terminated the header block and injected a body
// (#273 review, SEC-1; the attack was executed, not argued).
//
// Subject and the attachment filename were never vulnerable: they go
// through mime.QEncoding, which encodes every character below U+0020.
var ErrHeaderInjection = errors.New("email: a header value carries a control character")

// headerAddress renders one address safely for a To or From header.
//
// mail.Address.String rather than a hand-rolled check, because it does two
// things at once: it refuses nothing silently, and it QUOTES a local part
// that needs quoting. That second half is what closes the other half of the
// same class — net/mail.ParseAddress accepts `"a@evil.com,b"@x.com` and
// un-quotes it, so writing parsed.Address raw would put TWO recipients in a
// header the professor typed one address into (#273 review, SEC-2).
//
// The explicit CR/LF refusal comes first anyway. String() strips them, and
// a silently stripped injection attempt is a thing this server should
// refuse rather than sanitise: it means the roster, or Canvas, is handing
// us something nobody should be able to write.
func headerAddress(address string) (string, error) {
	if strings.ContainsAny(address, "\r\n") {
		return "", fmt.Errorf("%w", ErrHeaderInjection)
	}
	return (&mail.Address{Address: address}).String(), nil
}

// writeBase64 writes content as base64 wrapped at 76 columns.
//
// The wrapping is required, not cosmetic: RFC 2045 caps an encoded line at
// 76 characters, and a multi-megabyte PDF on one line is a message some
// relays refuse and others silently truncate.
func writeBase64(w io.Writer, content []byte) error {
	const lineLength = 76

	encoded := base64Encode(content)
	for start := 0; start < len(encoded); start += lineLength {
		end := min(start+lineLength, len(encoded))
		if _, err := io.WriteString(w, encoded[start:end]+"\r\n"); err != nil {
			return err
		}
	}
	return nil
}

// base64Encode is STANDARD base64 with padding — the MIME transfer
// encoding, which is not the base64url the OAuth layer next door uses.
// Named rather than inlined so the difference is visible at the call site
// instead of hiding in an alphabet argument.
func base64Encode(content []byte) string {
	return base64.StdEncoding.EncodeToString(content)
}
