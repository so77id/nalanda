package controls

import (
	"context"
	"errors"
)

// Publication is the last step of the control cycle (issue #273, WP-3 of
// epic #270): the professor presses "Publicar" and every student whose copy
// was matched and graded receives their annotated PDF by email.
//
// This file holds what the DOMAIN needs to express that — the message, the
// port that delivers it, and the failure modes a caller branches on. The
// transports live in internal/infra/email, the same way amcworker
// implements Generator, Analyzer and Annotator: the interface is declared
// here because this is where it is consumed (backend-code-style.md §The
// dependency rule).

// Attachment is one file travelling with a Message. Exactly one per
// message today — a copy's annotated PDF — and a struct rather than three
// parameters so a second attachment costs a slice rather than a signature
// change at every call site.
type Attachment struct {
	// Filename is what the student sees in their mail client. Spanish,
	// like everything a person reads.
	Filename string
	// ContentType is the MIME type. Always application/pdf today; carried
	// on the value rather than assumed by the transport so a future
	// attachment does not need the transport to learn about it.
	ContentType string
	// Content is the file's bytes, read from the shared volume by the
	// caller. The transport does not touch the filesystem: a dispatcher
	// that resolved paths would need the work directory, and the stub
	// would need a disk.
	Content []byte
}

// Message is one email a publication sends.
type Message struct {
	// From is the professor's CONNECTED Gmail address — the account they
	// authorised on /profile, which may differ from the address they log
	// in with. The transport does not choose it: a dispatcher that filled
	// this in would be deciding whose mailbox a message came from.
	From string
	// To is the recipient this message is addressed to. For a real
	// publication that is the student; for an "envío de prueba" it is
	// whatever address the professor typed.
	To string
	// ProfessorEmail is where a STAGING run redirects delivery — the
	// professor's own `users.email`.
	//
	// It travels on the message rather than being looked up by the staging
	// dispatcher on purpose. The caller has already resolved the professor
	// to build From and the signature, so asking the transport to resolve
	// them again would give a wrapper whose whole job is one field
	// substitution a store, a query and a failure mode. Here the staging
	// wrapper is a pure function over the value it was handed.
	ProfessorEmail string
	Subject        string
	// Text is the plaintext body. v1 sends no HTML alternative.
	Text       string
	Attachment Attachment
}

// Dispatcher delivers one message. The four implementations
// (internal/infra/email) differ only in what they do with it: send it,
// redirect it to the professor, log it without sending, or fabricate an
// answer.
//
// Send returns the provider's id for the delivered message. The id is not
// interpreted here — it is what an operator quotes when a student says
// nothing arrived — but it must be non-empty on success, so a caller can
// tell "sent" from "silently did nothing".
//
// professorID is what the transport resolves a credential from. It is a
// parameter rather than state on the dispatcher because this server holds
// one dispatcher for the whole process and several professors: a
// credential stored on the client would outlive the request that decrypted
// it and be reachable by the next one, whoever it belongs to. Same rule and
// the same reason as internal/infra/canvas, whose token is a parameter of
// every call.
type Dispatcher interface {
	Send(ctx context.Context, professorID int64, msg Message) (string, error)
}

// The failure modes a caller branches on. Kept apart because the publish
// job handler words each of them differently to the professor, and because
// only the second one is repaired by reconnecting an account.
var (
	// ErrNotConnected is a professor who has authorised no Gmail account.
	// Reached by a hand-typed POST — the control page refuses "Publicar"
	// before offering it — and by a publication started before a
	// "Desconectar".
	ErrNotConnected = errors.New("controls: the professor has not connected a Gmail account")

	// ErrCredentialRejected is a stored refresh token the provider will no
	// longer honour: revoked from the Google account page, expired under
	// the app's Testing publishing status, or invalidated by a password
	// change. The credential is cleared and the professor reconnects.
	//
	// Kept distinct from ErrUnavailable because the repairs are opposite:
	// this one needs a human at a consent screen, and retrying it forever
	// would never succeed.
	ErrCredentialRejected = errors.New("controls: the provider rejected the stored credential")

	// ErrSendRefused is the provider refusing this particular message — a
	// quota, a malformed address, an attachment over the limit. The
	// credential is fine and the other copies of the batch still go.
	ErrSendRefused = errors.New("controls: the provider refused to send the message")

	// ErrSendUnavailable is a failure that says nothing about the message
	// or the credential: a transport error, a 5xx, a timeout. Same shape
	// and same reason as ErrGeneratorUnavailable and ErrAnalyzerUnavailable.
	ErrSendUnavailable = errors.New("controls: the mail provider is unreachable")
)
