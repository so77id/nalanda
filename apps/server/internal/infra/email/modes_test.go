package email_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
)

// Both wrappers stand between a real transport and a class of students, and
// both are tested for the same thing: that they cannot fail OPEN. An email
// that reached forty inboxes cannot be recalled, so every failure mode here
// has to end in "nothing was sent" rather than in "sent to whoever was in
// the To field".

// recorder is a controls.Dispatcher that keeps what it was handed.
type recorder struct {
	got   []controls.Message
	err   error
	calls int
}

func (r *recorder) Send(_ context.Context, _ int64, msg controls.Message) (string, error) {
	r.calls++
	if r.err != nil {
		return "", r.err
	}
	r.got = append(r.got, msg)
	return "INNER-1", nil
}

func TestStagingRedirectsToTheProfessorAndChangesNothingElse(t *testing.T) {
	inner := &recorder{}
	msg := spanishMessage()

	id, err := email.NewStagingDispatcher(inner).Send(context.Background(), 7, msg)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if id != "INNER-1" {
		t.Errorf("Send returned %q, want the inner transport's id", id)
	}
	if len(inner.got) != 1 {
		t.Fatalf("the inner transport saw %d messages", len(inner.got))
	}

	sent := inner.got[0]
	if sent.To != msg.ProfessorEmail {
		t.Errorf("To = %q, want the professor's own address %q", sent.To, msg.ProfessorEmail)
	}
	// Everything else must survive untouched: what the professor reads in a
	// rehearsal has to be what a student would have read, or the rehearsal
	// proves nothing about the message.
	if sent.Subject != msg.Subject || sent.Text != msg.Text || sent.From != msg.From {
		t.Errorf("staging altered the message beyond the recipient: %+v", sent)
	}
	if string(sent.Attachment.Content) != string(msg.Attachment.Content) {
		t.Error("staging altered the attachment")
	}
}

// The single most important case in the package. Staging is selected so
// that no student receives anything; a wrapper that fell through to msg.To
// when it could not find the redirect address would do the exact thing the
// mode exists to prevent, on the run where somebody was being careful.
func TestStagingRefusesRatherThanFallingBackToTheStudent(t *testing.T) {
	inner := &recorder{}
	msg := spanishMessage()
	msg.ProfessorEmail = ""

	_, err := email.NewStagingDispatcher(inner).Send(context.Background(), 7, msg)
	if err == nil {
		t.Fatal("staging sent a message it had no address to redirect")
	}
	if !errors.Is(err, email.ErrNoStagingRecipient) {
		t.Errorf("Send returned %v, want ErrNoStagingRecipient", err)
	}
	if inner.calls != 0 {
		t.Fatalf("the message reached the transport %d times; in staging mode, addressed to the "+
			"STUDENT — the one outcome this mode is selected to make impossible", inner.calls)
	}
}

func TestStagingPropagatesTheInnerFailure(t *testing.T) {
	inner := &recorder{err: controls.ErrSendUnavailable}

	_, err := email.NewStagingDispatcher(inner).Send(context.Background(), 7, spanishMessage())
	if !errors.Is(err, controls.ErrSendUnavailable) {
		t.Errorf("Send returned %v, want the inner failure", err)
	}
}

func newDryRun(t *testing.T, creds email.Credentials) (*email.DryRunDispatcher, *bytes.Buffer) {
	t.Helper()
	logs := &bytes.Buffer{}
	return email.NewDryRunDispatcher(creds, slog.New(slog.NewTextHandler(logs, nil))), logs
}

func TestDryRunSendsNothingAndSaysWhatItWouldHaveSent(t *testing.T) {
	creds := liveCredentials()
	dispatcher, logs := newDryRun(t, creds)
	msg := spanishMessage()

	id, err := dispatcher.Send(context.Background(), 7, msg)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if !strings.HasPrefix(id, "DRYRUN-") {
		t.Errorf("id %q does not announce itself as a dry run", id)
	}

	line := logs.String()
	if !strings.Contains(line, msg.Subject) {
		t.Error("the log line does not carry the subject, which is where the grade is")
	}
	if !strings.Contains(line, "attachment_bytes=34") {
		t.Errorf("the log line does not say how much was attached: %s", line)
	}
}

// The half of a real send that a dry run must NOT skip. A dry run that
// never resolved the credential would report success for a professor whose
// authorisation was revoked last week — and the whole point of rehearsing
// is to find that out before the class does.
func TestDryRunStillProvesTheCredential(t *testing.T) {
	creds := &stubCredentials{err: gmail.ErrRejected}
	dispatcher, _ := newDryRun(t, creds)

	_, err := dispatcher.Send(context.Background(), 7, spanishMessage())
	if !errors.Is(err, gmail.ErrRejected) {
		t.Fatalf("Send returned %v, want the credential failure to surface", err)
	}
	if creds.calls != 1 {
		t.Errorf("the dry run resolved %d credentials; a rehearsal that skips this proves nothing "+
			"about whether the professor can still send", creds.calls)
	}
}

// docs/security-notes.md §"Logs and personal data": the identifier stays
// out of the line. A forty-copy dry run on the Jetson would otherwise write
// a whole class's addresses into log rotation.
func TestDryRunDoesNotWriteStudentAddressesIntoTheLog(t *testing.T) {
	dispatcher, logs := newDryRun(t, liveCredentials())
	msg := spanishMessage()
	msg.To = "maria.gonzalez@udp.cl"

	if _, err := dispatcher.Send(context.Background(), 7, msg); err != nil {
		t.Fatalf("Send: %v", err)
	}

	line := logs.String()
	if strings.Contains(line, "maria.gonzalez") {
		t.Errorf("the student's address reached the log: %s", line)
	}
	// And what a dry run is actually asked still has an answer: which side
	// of the staging switch this landed on.
	if !strings.Contains(line, "udp.cl") {
		t.Errorf("the log line does not say where the message was headed: %s", line)
	}
}

func TestDryRunGivesEachRehearsalItsOwnId(t *testing.T) {
	dispatcher, _ := newDryRun(t, liveCredentials())

	first, err := dispatcher.Send(context.Background(), 7, spanishMessage())
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	second, err := dispatcher.Send(context.Background(), 7, spanishMessage())
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if first == second {
		t.Errorf("two rehearsals shared the id %q; a stable one invites somebody to key on it", first)
	}
}

func TestDryRunRefusesAMessageWithNoRecipient(t *testing.T) {
	creds := liveCredentials()
	dispatcher, _ := newDryRun(t, creds)

	msg := spanishMessage()
	msg.To = ""
	if _, err := dispatcher.Send(context.Background(), 7, msg); err == nil {
		t.Fatal("the dry run accepted a message with no recipient; production would not, and a " +
			"rehearsal more permissive than the thing it rehearses hides the bug until the Jetson")
	}
	if creds.calls != 0 {
		t.Error("a credential was resolved for a message that could not be addressed")
	}
}

func TestBothWrappersSatisfyTheDispatcherPort(t *testing.T) {
	var _ controls.Dispatcher = email.NewStagingDispatcher(&recorder{})
	dispatcher, _ := newDryRun(t, liveCredentials())
	var _ controls.Dispatcher = dispatcher
}
