package email_test

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
)

// The message is PARSED back with net/mail and mime/multipart rather than
// grepped as a string, because the failure this guards against is a message
// that looks right in a diff and is not a message: a missing blank line
// between headers and body, a boundary that does not match, an unencoded
// accent in a Subject. Every one of those reaches the student's inbox as
// something other than what was written, and none of them is visible to an
// assertion on a substring.

type stubCredentials struct {
	access gmail.Access
	err    error
	calls  int
}

func (s *stubCredentials) AccessToken(context.Context, int64) (gmail.Access, error) {
	s.calls++
	if s.err != nil {
		return gmail.Access{}, s.err
	}
	return s.access, nil
}

// gmailRig is an httptest stand-in for Gmail's send endpoint. It keeps what
// it received so a case can take the message apart.
type gmailRig struct {
	server *httptest.Server

	status int
	body   string

	gotAuth        string
	gotContentType string
	gotBody        []byte
	requests       int
}

func newGmailRig(t *testing.T) *gmailRig {
	t.Helper()

	rig := &gmailRig{}
	rig.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rig.requests++
		rig.gotAuth = r.Header.Get("Authorization")
		rig.gotContentType = r.Header.Get("Content-Type")
		rig.gotBody, _ = io.ReadAll(r.Body)

		if rig.status != 0 {
			w.WriteHeader(rig.status)
			_, _ = w.Write([]byte(rig.body))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"18f0c2a1b2c3d4e5"}`))
	}))
	t.Cleanup(rig.server.Close)
	return rig
}

// dispatcher returns a GmailDispatcher pointed at the rig.
func (rig *gmailRig) dispatcher(creds email.Credentials) *email.GmailDispatcher {
	return email.NewGmailDispatcher(email.GmailConfig{
		Credentials: creds,
		Endpoint:    rig.server.URL,
		HTTPClient:  rig.server.Client(),
	})
}

// base64Reader undoes a part's Content-Transfer-Encoding.
//
// multipart.Reader decodes quoted-printable and leaves base64 alone, so a
// case that skipped this would compare the ENCODED bytes and pass over a
// body that never decodes — which is exactly the state a wrongly wrapped
// or truncated encoding leaves it in.
func base64Reader(part *multipart.Part) io.Reader {
	if part.Header.Get("Content-Transfer-Encoding") != "base64" {
		return part
	}
	return base64.NewDecoder(base64.StdEncoding, part)
}

func liveCredentials() *stubCredentials {
	return &stubCredentials{access: gmail.Access{
		Token:  "ya29.access",
		Expiry: time.Now().Add(time.Hour),
	}}
}

// accented on purpose, at every point a header can carry one.
func spanishMessage() controls.Message {
	return controls.Message{
		From:           "profesora@gmail.com",
		To:             "alumna@example.com",
		ProfessorEmail: "profesora@example.com",
		Subject:        "[CIT2006-03] Corrección Control 2 — nota 5.7",
		Text:           "Hola María,\n\nAdjunto la corrección. Tu nota es 5,7.\n",
		Attachment: controls.Attachment{
			Filename:    "corrección-control-2.pdf",
			ContentType: "application/pdf",
			Content:     []byte("%PDF-1.4\nfake annotated copy\n%%EOF"),
		},
	}
}

func TestGmailDispatcherSatisfiesTheDispatcherPort(t *testing.T) {
	rig := newGmailRig(t)
	var _ controls.Dispatcher = rig.dispatcher(liveCredentials())
}

func TestSendPresentsTheTokenAndTheRFC822ContentType(t *testing.T) {
	rig := newGmailRig(t)
	creds := liveCredentials()

	id, err := rig.dispatcher(creds).Send(context.Background(), 7, spanishMessage())
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if id != "18f0c2a1b2c3d4e5" {
		t.Errorf("Send returned %q, want Gmail's id", id)
	}
	if rig.gotAuth != "Bearer ya29.access" {
		t.Errorf("Authorization = %q", rig.gotAuth)
	}
	if rig.gotContentType != "message/rfc822" {
		t.Errorf("Content-Type = %q, want message/rfc822 — the media endpoint takes the "+
			"message as the body, not a JSON envelope", rig.gotContentType)
	}
	if creds.calls != 1 {
		t.Errorf("the dispatcher asked for %d tokens to send one message", creds.calls)
	}
}

// The whole point of the slice: what arrives is a well-formed message
// carrying a readable Spanish subject and the PDF intact.
func TestTheSentMessageParsesAsMailWithTheSubjectAndTheAttachment(t *testing.T) {
	rig := newGmailRig(t)
	msg := spanishMessage()

	if _, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	parsed, err := mail.ReadMessage(strings.NewReader(string(rig.gotBody)))
	if err != nil {
		t.Fatalf("what was sent is not a parseable message: %v", err)
	}

	// PARSED, not compared raw — the header carries the RFC 5322 angle-addr
	// form (`<a@b>`), which is what `mail.Address.String` produces and what
	// closes the injection class. Comparing the raw string would pin the
	// serialisation rather than the address, and would have to change again
	// the next time the encoder does something correct.
	fromAddr, err := mail.ParseAddress(parsed.Header.Get("From"))
	if err != nil {
		t.Fatalf("the From header does not parse as an address: %v", err)
	}
	if fromAddr.Address != msg.From {
		t.Errorf("From = %q, want the professor's connected address %q", fromAddr.Address, msg.From)
	}
	toAddr, err := mail.ParseAddress(parsed.Header.Get("To"))
	if err != nil {
		t.Fatalf("the To header does not parse as an address: %v", err)
	}
	if toAddr.Address != msg.To {
		t.Errorf("To = %q", toAddr.Address)
	}

	// DECODED, not compared raw: the header on the wire is Q-encoded, and
	// what matters is that a client decodes it back to the Spanish that was
	// written. Comparing the raw header would pass over a subject that was
	// never encoded at all.
	subject, err := new(mime.WordDecoder).DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("the Subject does not decode: %v", err)
	}
	if subject != msg.Subject {
		t.Errorf("Subject decodes to %q, want %q", subject, msg.Subject)
	}
	if strings.Contains(parsed.Header.Get("Subject"), "Corrección") {
		t.Error("the Subject carries a raw accent; RFC 5322 headers are ASCII and this " +
			"reaches the student as mojibake on the one line they read before opening it")
	}

	mediaType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("Content-Type does not parse: %v", err)
	}
	if mediaType != "multipart/mixed" {
		t.Fatalf("Content-Type = %q, want multipart/mixed", mediaType)
	}

	var sawText, sawPDF bool
	reader := multipart.NewReader(parsed.Body, params["boundary"])
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("reading the parts: %v", err)
		}
		// NextPart decodes quoted-printable but not base64, so the part's
		// own encoding is undone here — which is also what proves the
		// base64 is well-formed and correctly wrapped.
		content, err := io.ReadAll(base64Reader(part))
		if err != nil {
			t.Fatalf("decoding a part: %v", err)
		}

		switch {
		case strings.HasPrefix(part.Header.Get("Content-Type"), "text/plain"):
			sawText = true
			if string(content) != msg.Text {
				t.Errorf("the body decodes to %q, want %q", content, msg.Text)
			}
		case strings.HasPrefix(part.Header.Get("Content-Type"), "application/pdf"):
			sawPDF = true
			if string(content) != string(msg.Attachment.Content) {
				t.Error("the attachment's bytes did not survive the encoding")
			}
			disposition := part.Header.Get("Content-Disposition")
			if !strings.HasPrefix(disposition, "attachment;") {
				t.Errorf("Content-Disposition = %q, want an attachment", disposition)
			}
			if strings.Contains(disposition, "corrección") {
				t.Error("the filename carries a raw accent")
			}
		}
	}
	if !sawText {
		t.Error("the message carries no text part")
	}
	if !sawPDF {
		t.Error("the message carries no PDF part — a correction with no correction in it")
	}
}

// RFC 2045 caps an ENCODED CONTENT line at 76 characters. A multi-megabyte
// PDF on one line is a message some relays refuse and others truncate.
//
// Content lines only, and the exclusion is precise rather than convenient:
// the 76 cap governs the transfer encoding's output, while a header field
// has its own limit (RFC 5322's 998, with folding merely recommended at
// 78) — `Content-Disposition: attachment; filename="…"` legitimately runs
// past 76 and folding it would buy nothing. Base64's alphabet holds no
// colon and no space, so "carries a colon" separates the two without a
// parser, and boundaries announce themselves with `--`.
func TestTheEncodedAttachmentIsWrappedAtSeventySixColumns(t *testing.T) {
	rig := newGmailRig(t)
	msg := spanishMessage()
	msg.Attachment.Content = make([]byte, 4096)

	if _, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	longest, checked := 0, 0
	for _, line := range strings.Split(string(rig.gotBody), "\r\n") {
		if line == "" || strings.Contains(line, ":") || strings.HasPrefix(line, "--") {
			continue
		}
		checked++
		if len(line) > longest {
			longest = len(line)
		}
		if len(line) > 76 {
			t.Fatalf("an encoded line of %d characters reached the wire; RFC 2045 caps it at 76", len(line))
		}
	}

	// Non-vacuity: a 4 KB attachment is ~5.5 KB of base64, so there must be
	// dozens of content lines and the longest must actually be at the cap.
	// Without this the case passes over a message carrying no content at
	// all — which is precisely what a broken encoder produces.
	if checked < 50 {
		t.Fatalf("only %d content lines were checked; the message carries no encoded payload", checked)
	}
	if longest != 76 {
		t.Errorf("the longest content line is %d characters, want the encoder to fill to 76", longest)
	}
}

func TestSendRefusesAMessageWithNoRecipientBeforeSpendingAToken(t *testing.T) {
	rig := newGmailRig(t)
	creds := liveCredentials()

	msg := spanishMessage()
	msg.To = ""
	if _, err := rig.dispatcher(creds).Send(context.Background(), 7, msg); err == nil {
		t.Fatal("a message with no recipient was sent")
	}
	if creds.calls != 0 || rig.requests != 0 {
		t.Error("the dispatcher refreshed a token and called Gmail for a message it could not address")
	}
}

func TestSendPropagatesACredentialItCouldNotObtain(t *testing.T) {
	rig := newGmailRig(t)
	creds := &stubCredentials{err: gmail.ErrNotConnected}

	_, err := rig.dispatcher(creds).Send(context.Background(), 7, spanishMessage())
	if !errors.Is(err, gmail.ErrNotConnected) {
		t.Fatalf("Send returned %v, want ErrNotConnected", err)
	}
	if rig.requests != 0 {
		t.Error("Gmail was called without a token")
	}
}

// The mapping that decides whether a professor's stored credential is
// deleted. Getting 403 wrong deletes a working credential over a quota, and
// only a human at a consent screen can restore it.
func TestTheStatusMappingOnlyTreatsA401AsARejectedCredential(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"401 is the credential", 401, `{"error":{"status":"UNAUTHENTICATED"}}`, gmail.ErrRejected},
		{"403 is this message", 403, `{"error":{"status":"PERMISSION_DENIED"}}`, controls.ErrSendRefused},
		{"429 is this message", 429, `{"error":{"status":"RESOURCE_EXHAUSTED"}}`, controls.ErrSendRefused},
		{"400 is this message", 400, `{"error":{"status":"INVALID_ARGUMENT"}}`, controls.ErrSendRefused},
		{"500 is neither", 500, `{"error":{"status":"INTERNAL"}}`, controls.ErrSendUnavailable},
		{"503 is neither", 503, `{"error":{"status":"UNAVAILABLE"}}`, controls.ErrSendUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rig := newGmailRig(t)
			rig.status = tc.status
			rig.body = tc.body

			_, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, spanishMessage())
			if !errors.Is(err, tc.want) {
				t.Fatalf("a %d produced %v, want %v", tc.status, err, tc.want)
			}
			// The one that must never be reached by accident.
			if tc.want != gmail.ErrRejected && errors.Is(err, gmail.ErrRejected) {
				t.Errorf("a %d was reported as a rejected credential, which DELETES it", tc.status)
			}
		})
	}
}

func TestAnAcceptedMessageWithNoIdIsNotReportedAsSent(t *testing.T) {
	rig := newGmailRig(t)
	rig.status = http.StatusOK
	rig.body = `{}`

	id, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, spanishMessage())
	if err == nil {
		t.Fatalf("Send returned id %q and no error although Gmail named nothing", id)
	}
	if !errors.Is(err, controls.ErrSendUnavailable) {
		t.Errorf("Send returned %v; \"we do not know\" is closer to unavailable than to refused", err)
	}
}

// The same rule internal/infra/canvas and internal/infra/oidc hold to: an
// error string reaches stderr, and stderr reaches whatever collects
// container logs.
func TestNoSendErrorEverCarriesTheAccessToken(t *testing.T) {
	for _, status := range []int{400, 401, 403, 500} {
		rig := newGmailRig(t)
		rig.status = status
		rig.body = `{"error":{"status":"NOPE","message":"ya29.access is bad"}}`

		_, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, spanishMessage())
		if err == nil {
			t.Fatalf("a %d produced no error", status)
		}
		if strings.Contains(err.Error(), "ya29.access") {
			t.Errorf("the error from a %d carries the access token: %v", status, err)
		}
	}
}

// The injection class, closed by #273's review (SEC-1). The attack was
// executed against the previous encoder, which interpolated From and To
// with fmt.Fprintf and no escaping: a CR or LF injected an arbitrary header
// — a `Bcc:` that Gmail's message/rfc822 upload honours, sending one
// student's grade and corrected PDF out of the professor's own mailbox — or
// terminated the header block and injected a body.
//
// Subject and the attachment filename were never vulnerable (mime.QEncoding
// encodes every character below U+0020) and are asserted here anyway, so a
// future encoder change cannot quietly move them into the vulnerable set.
func TestNoControlCharacterCanReachAHeader(t *testing.T) {
	for _, tc := range []struct {
		name    string
		break_  func(*controls.Message)
		refused bool
	}{
		{"CRLF in To", func(m *controls.Message) {
			m.To = "alumna@example.com\r\nBcc: attacker@evil.com"
		}, true},
		{"a bare LF in To", func(m *controls.Message) {
			m.To = "alumna@example.com\nBcc: attacker@evil.com"
		}, true},
		{"a body injected through To", func(m *controls.Message) {
			m.To = "alumna@example.com\r\n\r\nPAGA A ESTA CUENTA"
		}, true},
		{"CRLF in From", func(m *controls.Message) {
			m.From = "profesora@gmail.com\r\nBcc: attacker@evil.com"
		}, true},
		{"CRLF in the attachment's content type", func(m *controls.Message) {
			m.Attachment.ContentType = "application/pdf\r\nX-Injected: yes"
		}, true},
		// These two are encoded rather than refused, which is the correct
		// answer for them: a Subject and a filename are free text a
		// professor may legitimately write anything into.
		{"CRLF in the Subject is encoded", func(m *controls.Message) {
			m.Subject = "nota 7\r\nBcc: attacker@evil.com"
		}, false},
		{"CRLF in the filename is encoded", func(m *controls.Message) {
			m.Attachment.Filename = "a.pdf\r\nX-Injected: yes"
		}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rig := newGmailRig(t)
			msg := spanishMessage()
			tc.break_(&msg)

			_, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, msg)

			if tc.refused {
				if err == nil {
					t.Fatalf("the message was SENT; the wire carried:\n%s", rig.gotBody)
				}
				if !errors.Is(err, email.ErrHeaderInjection) {
					t.Errorf("Send returned %v, want ErrHeaderInjection", err)
				}
				if rig.requests != 0 {
					t.Error("an injected message reached Gmail")
				}
				return
			}

			if err != nil {
				t.Fatalf("Send: %v", err)
			}
			// PARSED, not grepped. The encoded form legitimately contains
			// the literal text `X-Injected:` inside a `=?utf-8?q?…?=` word
			// on a single line, where it is inert — a substring search
			// calls that an injection and is wrong. What matters is
			// whether a mail parser sees a HEADER, so ask one.
			parsed, err := mail.ReadMessage(strings.NewReader(string(rig.gotBody)))
			if err != nil {
				t.Fatalf("what was sent is not a parseable message: %v", err)
			}
			for _, injected := range []string{"Bcc", "X-Injected"} {
				if got := parsed.Header.Get(injected); got != "" {
					t.Errorf("the encoding produced a real %s header (%q):\n%s",
						injected, got, rig.gotBody)
				}
			}
		})
	}
}

// The other half of the same class, and the one the test-send route walks
// into: net/mail.ParseAddress ACCEPTS `"a@evil.com,b"@x.com` and un-quotes
// the local part, so writing the parsed address raw would put two
// recipients in a header the professor typed one address into (#273 review,
// SEC-2). mail.Address.String re-quotes it.
func TestAnAddressThatUnquotesIntoTwoStaysOneRecipient(t *testing.T) {
	rig := newGmailRig(t)
	msg := spanishMessage()
	msg.To = `a@evil.com,b@x.com`

	if _, err := rig.dispatcher(liveCredentials()).Send(context.Background(), 7, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}
	parsed, err := mail.ReadMessage(strings.NewReader(string(rig.gotBody)))
	if err != nil {
		t.Fatalf("the message does not parse: %v", err)
	}
	list, err := mail.ParseAddressList(parsed.Header.Get("To"))
	if err != nil {
		t.Fatalf("the To header does not parse: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("the To header carries %d recipients, want 1: %q", len(list), parsed.Header.Get("To"))
	}
}
