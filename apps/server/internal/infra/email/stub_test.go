package email_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
	"github.com/so77id/nalanda/apps/server/internal/infra/email"
)

// The stub is what CI runs and what a developer without credentials runs,
// so it is the implementation most code will meet. Its contract is
// therefore worth pinning rather than assuming: an id that is empty, or one
// that changes between runs, would make every downstream assertion about
// "was this sent" either vacuous or flaky.

func message(to, subject string) controls.Message {
	return controls.Message{
		From:           "profesora@gmail.com",
		To:             to,
		ProfessorEmail: "profesora@example.com",
		Subject:        subject,
		Text:           "Hola",
		Attachment: controls.Attachment{
			Filename:    "correccion.pdf",
			ContentType: "application/pdf",
			Content:     []byte("%PDF-1.4 fake"),
		},
	}
}

func TestStubSatisfiesTheDispatcherPort(t *testing.T) {
	var _ controls.Dispatcher = email.NewStubDispatcher()
}

func TestStubReturnsANonEmptyIdThatIsStableForTheSameMessage(t *testing.T) {
	ctx := context.Background()
	first := email.NewStubDispatcher()
	second := email.NewStubDispatcher()

	a, err := first.Send(ctx, 1, message("alumna@example.com", "Corrección Control 1"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if a == "" {
		t.Fatal("the stub returned an empty id; a caller cannot tell that from a dispatcher that did nothing")
	}

	// A SECOND dispatcher, so the stability is a property of the message
	// and not of one instance's counter. A per-instance counter passes an
	// equality check against itself and still renumbers every id the day a
	// test sends in a different order.
	b, err := second.Send(ctx, 1, message("alumna@example.com", "Corrección Control 1"))
	if err != nil {
		t.Fatalf("Send on a second dispatcher: %v", err)
	}
	if a != b {
		t.Errorf("the same message produced %q and %q; the stub's ids must be deterministic", a, b)
	}
}

func TestStubGivesDifferentMessagesDifferentIds(t *testing.T) {
	ctx := context.Background()
	d := email.NewStubDispatcher()

	same, err := d.Send(ctx, 1, message("alumna@example.com", "Corrección Control 1"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	otherRecipient, err := d.Send(ctx, 1, message("alumno@example.com", "Corrección Control 1"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	otherSubject, err := d.Send(ctx, 1, message("alumna@example.com", "Corrección Control 2"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	if same == otherRecipient {
		t.Errorf("two recipients shared the id %q; a batch of thirty would look like one send repeated", same)
	}
	if same == otherSubject {
		t.Errorf("two subjects shared the id %q", same)
	}
}

func TestStubRecordsEveryMessageInOrderWithItsAttachment(t *testing.T) {
	ctx := context.Background()
	d := email.NewStubDispatcher()

	for _, to := range []string{"una@example.com", "dos@example.com", "tres@example.com"} {
		if _, err := d.Send(ctx, 7, message(to, "Corrección Control 1")); err != nil {
			t.Fatalf("Send to %s: %v", to, err)
		}
	}

	sent := d.Sent()
	if len(sent) != 3 {
		t.Fatalf("recorded %d messages, want 3", len(sent))
	}
	for i, want := range []string{"una@example.com", "dos@example.com", "tres@example.com"} {
		if sent[i].Message.To != want {
			t.Errorf("message %d addressed to %q, want %q", i, sent[i].Message.To, want)
		}
		if sent[i].ProfessorID != 7 {
			t.Errorf("message %d recorded professor %d, want 7", i, sent[i].ProfessorID)
		}
	}
	// The attachment is the thing a publication exists to deliver, so a
	// recorder that dropped it would let every later slice assert a
	// successful send of an empty envelope.
	if got := string(sent[0].Message.Attachment.Content); got != "%PDF-1.4 fake" {
		t.Errorf("the recorded attachment carries %q, want the bytes it was handed", got)
	}
}

func TestStubIsSafeUnderConcurrentSends(t *testing.T) {
	ctx := context.Background()
	d := email.NewStubDispatcher()

	var wg sync.WaitGroup
	for i := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = d.Send(ctx, 1, message("alumna@example.com", string(rune('A'+i))))
		}()
	}
	wg.Wait()

	if got := len(d.Sent()); got != 20 {
		t.Errorf("recorded %d of 20 concurrent sends", got)
	}
}

func TestStubRefusesAMessageWithNoRecipient(t *testing.T) {
	ctx := context.Background()
	d := email.NewStubDispatcher()

	msg := message("", "Corrección Control 1")
	if _, err := d.Send(ctx, 1, msg); err == nil {
		t.Fatal("the stub accepted a message with no To; the real transport will not, " +
			"and a stub that is more permissive than production hides the bug until the Jetson")
	}
}

func TestStubIdIsRecognisableAsAStub(t *testing.T) {
	ctx := context.Background()
	d := email.NewStubDispatcher()

	id, err := d.Send(ctx, 1, message("alumna@example.com", "Corrección Control 1"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	// An operator reading a log line, or a row of a future delivery table,
	// must be able to tell a fabricated id from a provider's one without
	// knowing which mode the deployment was in.
	if !strings.HasPrefix(id, "STUB-") {
		t.Errorf("id %q does not announce itself as a stub", id)
	}
}
