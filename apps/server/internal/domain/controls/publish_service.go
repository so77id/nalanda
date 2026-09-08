package controls

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/so77id/nalanda/apps/server/internal/domain/gmail"
)

// The publication itself: the loop that turns a corrected control into one
// email per student (issue #273). It runs on the job runner, minutes-class
// by construction — forty Gmail calls plus forty PDFs read off the shared
// volume do not belong on an HTTP goroutine bounded by a 30 s write
// timeout (ADR-0050).

// Recipient is one student a publication can write to.
//
// A local shape rather than roster.Enrollment, the Matcher reasoning one
// concept over: this domain needs a name and an address, not the roster
// package. It keeps the publication tests free of a course table, and it
// keeps "what a person is" on the other side of a boundary.
type Recipient struct {
	// Name is the given name the message greets. May be empty; the
	// builder handles that.
	Name  string
	Email string
}

// PublishRoster is what a publication needs to know about the class.
//
// One method, because a publication asks one question: who is on this
// course and what is the course called. Two methods would be two round
// trips for one screen's worth of facts.
type PublishRoster interface {
	// CourseForPublication returns the course's code and its enrolled
	// students by student id. Withdrawn students are NOT included — a
	// person who dropped the course still sat the control they sat, but
	// they have not asked to keep hearing from it.
	CourseForPublication(ctx context.Context, courseID int64) (string, map[int64]Recipient, error)
}

// Sender is the professor a publication goes out as.
type Sender struct {
	// Name signs the message.
	Name string
	// Email is the address they log in with, and where a STAGING run
	// redirects delivery.
	Email string
	// GmailAddress is the account they authorised this server to send as,
	// empty when they have connected none. It is the From, and it is
	// allowed to differ from Email.
	GmailAddress string
}

// SenderReader resolves the professor who pressed the button.
type SenderReader interface {
	SenderFor(ctx context.Context, professorID int64) (Sender, error)
}

// PublishRequest is one publication.
type PublishRequest struct {
	// ProfessorID is who pressed the button — not control.CreatedBy. It is
	// their consent, their address and their Sent folder, and a control
	// created by a colleague is still published by whoever publishes it.
	ProfessorID int64
	// Mode is the per-publication choice: PublishModeReal sends to the
	// student, PublishModeStaging redirects every message to the
	// professor. The deployment-wide NALANDA_EMAIL_MODE can override both
	// by having selected a transport that ignores the recipient.
	Mode PublishMode
	// TestTo, when non-empty, makes this a REHEARSAL: every message goes
	// to that one address and the control is not stamped published.
	//
	// It rides on the same request, and therefore the same jobs.Kind, as a
	// real publication because the two differ only in the recipient and in
	// whether state moved. A second Kind would duplicate the loop that
	// does the work, and the loop is the part worth having one of.
	TestTo string
}

// PublishMode is the per-publication choice the professor makes on the
// form. Distinct from config.EmailMode, which is the deployment's, and
// deliberately so: one is a decision per control and the other a decision
// per host.
type PublishMode string

const (
	// PublishModeReal addresses each student.
	PublishModeReal PublishMode = "real"
	// PublishModeStaging redirects every message to the professor.
	PublishModeStaging PublishMode = "staging"
)

// ValidPublishMode reports whether m is one of the two. Handlers use it to
// refuse a form value before it reaches the schema's CHECK.
func ValidPublishMode(m PublishMode) bool {
	return m == PublishModeReal || m == PublishModeStaging
}

// PublishResult is what one run did.
type PublishResult struct {
	// Sent is how many messages the transport accepted.
	Sent int
	// Skipped is copies the publication had nothing to say about: no
	// matched student, no defined grade, or a matched student who is no
	// longer enrolled. NOT a failure — these are the ordinary state of a
	// class where two people missed the control.
	Skipped int
	// Failures is one entry per copy the publication tried and could not
	// deliver. Rendered on the control page; never silently dropped.
	Failures []PublishFailure
}

// PublishFailure names one copy that did not go out.
type PublishFailure struct {
	CopyNumber int
	// Reason is the Spanish sentence the professor reads.
	Reason string
}

// DeliversMail reports whether this process can actually put mail in front
// of a student.
//
// Exposed as a SERVICE method rather than letting a handler read
// s.Dispatcher, because a delivery surface depends on a domain service and
// never on what sits behind it (backend-code-style.md §The dependency
// rule, edge 4).
func (s *Service) DeliversMail() bool { return s.Dispatcher.Delivers() }

// The refusals Publish makes before sending anything.
var (
	// ErrNotGraded is a control whose correction is not closed. Publishing
	// an in-review control would mail grades that are still moving.
	ErrNotGraded = errors.New("controls: the correction is not closed yet")
	// ErrNoCourse is a control nobody has filed under a course, so there
	// is no roster to address.
	ErrNoCourse = errors.New("controls: the control belongs to no course")
	// ErrAlreadyPublished is a second publication of the same control.
	// Publication is one-way unless the professor explicitly unpublishes
	// (issue #273 §Non-goals, amended by the WP's own review).
	ErrAlreadyPublished = errors.New("controls: the control was already published")

	// ErrNotPublished is an unpublish of a control that never went out.
	// Distinct from ErrControlNotFound so a hand-typed URL against a real
	// control says what is actually wrong.
	ErrNotPublished = errors.New("controls: the control was never published")

	// ErrCannotDeliver is a process whose transport sends nothing —
	// NALANDA_EMAIL_MODE is `stub` or `dryrun`.
	//
	// A REFUSAL rather than a silent no-stamp, because the professor is
	// standing in front of the button and the honest answer is that this
	// server cannot mail anybody. Before this existed the publication ran,
	// counted every suppressed message as a success, stamped the control
	// and said the class had been written to (#273 review, PUB-2) — and
	// since `stub` is the default and the deploy document did not list the
	// variable, that was the documented production path.
	ErrCannotDeliver = errors.New("controls: this server is not configured to send mail")
)

// Publish sends one email per deliverable copy.
//
// THE ORDER OF THE TWO SIDE EFFECTS IS THE CONTRACT. The control is
// stamped published BEFORE the loop runs, not after, and the reason is
// what a crash halfway through would otherwise mean: an unstamped control
// with twenty students already emailed is a control the professor will
// publish again, and the twenty receive a second copy. Stamping first
// makes a crash cost the un-sent half — which the failure list names, and
// which a future resend endpoint can pick up — rather than a duplicate
// mailing nobody can recall.
//
// A REHEARSAL (TestTo set) stamps nothing, and can therefore be run as
// often as the professor likes.
//
// One student's bounce does not stop the other thirty-nine: every send is
// attempted, failures are collected, and the run reports what happened.
func (s *Service) Publish(ctx context.Context, controlID string, req PublishRequest) (PublishResult, error) {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return PublishResult{}, err
	}
	rehearsal := req.TestTo != ""

	switch {
	case control.State != Graded:
		return PublishResult{}, fmt.Errorf("%w", ErrNotGraded)
	case control.CourseID == nil:
		return PublishResult{}, fmt.Errorf("%w", ErrNoCourse)
	case control.PublishedAt != nil && !rehearsal:
		return PublishResult{}, fmt.Errorf("%w", ErrAlreadyPublished)
	case !rehearsal && !s.Dispatcher.Delivers():
		// Checked BEFORE the stamp, so a server in stub or dryrun leaves the
		// control exactly as it found it. A rehearsal is still allowed —
		// rehearsing under a transport that delivers nothing is a coherent
		// thing to do, and it changes no state either way.
		return PublishResult{}, fmt.Errorf("%w", ErrCannotDeliver)
	}

	sender, err := s.Senders.SenderFor(ctx, req.ProfessorID)
	if err != nil {
		return PublishResult{}, fmt.Errorf("controls.Publish: read the sender: %w", err)
	}
	if sender.GmailAddress == "" {
		// Refused BEFORE anything is stamped, so a professor who
		// disconnected their account can connect it and publish for real.
		return PublishResult{}, fmt.Errorf("%w", gmail.ErrNotConnected)
	}

	code, recipients, err := s.Roster.CourseForPublication(ctx, *control.CourseID)
	if err != nil {
		return PublishResult{}, fmt.Errorf("controls.Publish: read the course: %w", err)
	}

	readings, err := s.Readings.ReadingsByControl(ctx, controlID)
	if err != nil {
		return PublishResult{}, fmt.Errorf("controls.Publish: read the copies: %w", err)
	}

	if !rehearsal {
		// The EFFECTIVE mode, not the one the form asked for. A
		// deployment-wide `staging` transport rewrites every recipient to
		// the professor, so a run requested as `real` reached nobody in the
		// class — and stamping it `real` would make the page say the
		// students were written to (#273 review, DAC-8). The column exists
		// to record what HAPPENED.
		effective := req.Mode
		if s.Dispatcher.RedirectsToSender() {
			effective = PublishModeStaging
		}
		if err := s.Store.MarkPublished(ctx, controlID, s.Now(), string(effective)); err != nil {
			return PublishResult{}, fmt.Errorf("controls.Publish: stamp the control: %w", err)
		}
	}

	result := PublishResult{}
	for _, reading := range readings {
		message, ok := s.messageFor(ctx, control, code, sender, req, recipients, reading)
		if !ok {
			result.Skipped++
			continue
		}
		if _, err := s.Dispatcher.Send(ctx, req.ProfessorID, message); err != nil {
			// Logged with the copy NUMBER and never the address: the copy
			// number is what the professor clicks on, and
			// docs/security-notes.md §"Logs and personal data" keeps the
			// student out of the line.
			s.Log.Error("controls.Publish: send failed",
				"control", controlID, "copy", reading.CopyNumber, "error", err)
			result.Failures = append(result.Failures, PublishFailure{
				CopyNumber: reading.CopyNumber,
				Reason:     publishFailureReason(err),
			})
			continue
		}
		result.Sent++
	}

	if !rehearsal {
		// Bookkeeping, AFTER the loop and best-effort. The stamp above is
		// the load-bearing write and its ordering is the contract; this
		// number only makes the unpublish confirmation honest ("nobody
		// received anything" versus "38 people already have this"). A crash
		// between the two leaves it NULL, which the page words as "no se
		// sabe cuántos llegaron" — the truthful answer, and the reason the
		// column is nullable rather than defaulted to zero.
		if err := s.Store.RecordPublishedSent(ctx, controlID, result.Sent); err != nil {
			s.Log.Warn("controls.Publish: could not record how many were sent",
				"control", controlID, "sent", result.Sent, "error", err)
		}
	}
	return result, nil
}

// Unpublish clears the publication so the control can be published again.
//
// The escape hatch the review asked for, and the reason it is a hatch
// rather than a rule: "do not stamp when nothing was delivered" only
// reaches one of the three failure shapes, because under a staging run
// every send genuinely succeeds. What covers all three is letting the
// professor undo a publication — and putting the one judgement a machine
// cannot make in front of the person who can, which is whether the people
// who already received their correction may receive it twice.
//
// It does NOT unsend anything, and the page that offers it says so, using
// the count this records to say how many are affected.
func (s *Service) Unpublish(ctx context.Context, controlID string) error {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return err
	}
	if control.PublishedAt == nil {
		return fmt.Errorf("%w", ErrNotPublished)
	}
	return s.Store.ClearPublished(ctx, controlID)
}

// messageFor assembles one copy's message, or reports that there is
// nothing to send.
//
// The three skip reasons are all ORDINARY — a class where two people
// missed the control and one has no RUT on file is a normal class — so
// they are counted rather than reported as failures. Folding them into
// Failures would tell the professor about a problem they do not have, and
// the review page is already where an unmatched copy is looked at.
func (s *Service) messageFor(
	ctx context.Context, control Control, code string, sender Sender, req PublishRequest,
	recipients map[int64]Recipient, reading Reading,
) (Message, bool) {
	if reading.StudentID == nil {
		return Message{}, false
	}
	recipient, enrolled := recipients[*reading.StudentID]
	if !enrolled || recipient.Email == "" {
		return Message{}, false
	}
	// NumericGrade, not a second computation. It is the numeric back door
	// of TotalAndGrade and both share one rawTotal, which is what makes
	// the email and the readings table unable to disagree (issue #251).
	// ok=false is a copy whose grade is genuinely unknown — doubtful
	// answers nobody resolved, an unreadable RUT, a copy never handed in —
	// and mailing "tu nota es —" would be worse than mailing nothing.
	total, ok := NumericGrade(control.QuestionsPerCopy, reading)
	if !ok {
		return Message{}, false
	}

	attachment, ok := s.annotatedFor(ctx, control.ID, reading.CopyNumber)
	if !ok {
		return Message{}, false
	}

	message := BuildMessage(MessageInput{
		CourseCode:     code,
		ControlName:    control.Name,
		Grade:          FormatGrade(total, control.QuestionsPerCopy),
		StudentName:    recipient.Name,
		StudentEmail:   recipient.Email,
		ProfessorName:  sender.Name,
		ProfessorEmail: sender.Email,
		FromAddress:    sender.GmailAddress,
		ControlID:      control.ID,
		CopyNumber:     reading.CopyNumber,
		Attachment:     attachment,
	})

	// The per-publication redirects, applied HERE rather than in a
	// transport, because this is the layer that knows what the professor
	// asked for. The deployment-wide modes (staging, dryrun, stub) sit
	// underneath and override whatever this produced — which is the point
	// of selecting them at boot.
	switch {
	case req.TestTo != "":
		message.To = req.TestTo
	case req.Mode == PublishModeStaging:
		message.To = sender.Email
	}
	return message, true
}

// annotatedFor reads one copy's corrected PDF off the shared volume.
//
// A copy with no annotated row, or a file that is gone, is SKIPPED rather
// than sent without its attachment. The attachment is the thing the email
// exists to deliver: a message saying "adjunto la corrección" with nothing
// attached is worse than no message, because the student now has to ask.
func (s *Service) annotatedFor(ctx context.Context, controlID string, copyNumber int) (Attachment, bool) {
	record, exists, err := s.Store.AnnotatedByCopy(ctx, controlID, copyNumber)
	if err != nil || !exists {
		return Attachment{}, false
	}
	content, err := os.ReadFile(filepath.Join(s.WorkDir, record.Path))
	if err != nil || len(content) == 0 {
		s.Log.Warn("controls.Publish: the annotated PDF is unreadable",
			"control", controlID, "copy", copyNumber, "error", err)
		return Attachment{}, false
	}
	return Attachment{
		// Spanish, like everything the reader perceives — this is a
		// filename in a student's downloads folder.
		Filename:    fmt.Sprintf("correccion-copia-%d.pdf", copyNumber),
		ContentType: "application/pdf",
		Content:     content,
	}, true
}

// publishFailureReason words one failed send for the professor.
//
// Spanish, and specific enough to act on: the three outcomes need three
// different actions, and "no se pudo enviar" for all of them would send a
// professor to the wrong one.
func publishFailureReason(err error) string {
	switch {
	case errors.Is(err, gmail.ErrNotConnected):
		return "no hay una cuenta de Gmail conectada"
	case errors.Is(err, gmail.ErrRejected):
		return "se perdió la conexión con Gmail: vuelve a conectarla en tu perfil"
	case errors.Is(err, ErrSendRefused):
		return "Gmail rechazó el mensaje (puede ser la cuota diaria)"
	case errors.Is(err, ErrSendUnavailable):
		return "no se pudo contactar a Gmail"
	default:
		return "no se pudo enviar"
	}
}
