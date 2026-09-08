package controls

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

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
	// FirstName and LastName are the roster's own two columns, passed
	// through exactly as Canvas wrote them — which is CAPITALS, for
	// every row of the live course. Turning that into a greeting is the
	// message builder's job (controls.formatStudentName), not this
	// struct's and not the store's.
	FirstName string
	LastName  string
	Email     string
}

// FullName is the whole name the message greets, given names first, in
// the order a Chilean writes them.
//
// TrimSpace rather than a plain join: a roster row may carry one half and
// not the other, since 00014_roster.sql defaults both name columns to the
// empty string — and "Hola Benjamín ," is the shape of a bug reaching a
// person.
func (r Recipient) FullName() string {
	return strings.TrimSpace(r.FirstName + " " + r.LastName)
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
	// Sent is how many messages the transport accepted ON THIS RUN. Since
	// issue #287 that is not the same as how many people hold their
	// correction — a resume that writes to one copy of a class of forty
	// reports 1 — which is why the page derives its count from the stamped
	// readings rather than from here.
	Sent int
	// AlreadySent is copies this run skipped because their student already
	// holds the current correction (issue #287). Deliberately NOT folded
	// into Skipped: the two mean opposite things to a professor. Skipped is
	// "nobody got this and here is why"; AlreadySent is "this one is
	// finished", and it is what makes pressing Publicar twice a safe thing
	// to do rather than a mistake the app has to refuse.
	AlreadySent int
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
	// ErrCopyNotDeliverable is one copy PublishOne has nothing to send
	// about: nobody matched, no defined grade, or no annotated PDF (issue
	// #287). Wrapped by CopyNotDeliverableError, which carries WHICH of
	// the three it is so the review page can say what to fix.
	//
	// A distinct sentinel rather than reusing the batch's silence: a
	// publication SKIPS such a copy because a class where two people
	// missed the control is a normal class, but a professor who pressed
	// "Enviar la corrección" on one copy asked about THAT copy, and
	// answering them with a success flash over nothing is the "green over
	// nothing" #273's review spent itself removing.
	ErrCopyNotDeliverable = errors.New("controls: there is nothing to send for this copy")

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

// Publish sends one email per copy that needs one, and is RESUMABLE.
//
// THE ORDER OF THE SIDE EFFECTS IS THE CONTRACT, and issue #287 reversed
// the half of it #273 wrote. Each copy is stamped IMMEDIATELY AFTER its own
// send succeeds — never before, never in a batch at the end — because that
// is what makes a process that dies mid-loop leave the truth behind it: the
// copies already written to are on record, the rest are untouched, and the
// next Publicar picks up exactly where this one stopped.
//
// #273 stamped the CONTROL above the loop and nothing per copy, and it was
// right to: with no per-copy record the choice was between losing the
// un-sent half of a crashed run and mailing half a class twice, and it took
// the first. The per-copy stamp removes the choice, so the rule it bought
// goes with it (ADR-0074 supersedes ADR-0072 §5).
//
// WHICH COPIES: the ones that have not gone out, and the ones that went out
// with a grade that has since moved. Everything else is left alone, which is
// why pressing Publicar twice is harmless BY CONSTRUCTION rather than by
// refusal. CopyPublication.NeedsSending is the rule, and the copies table
// renders the same states from the same function, so the page and the loop
// cannot disagree about what a second press would do.
//
// The control's own published_at is still stamped ONCE, on the first run.
// It answers a question no per-copy row answers — when was this class
// published, and for real or as a rehearsal — and re-dating it on every
// resume would move "Publicado el 8 de septiembre" forward each time a
// professor re-sent one copy.
//
// A REHEARSAL (TestTo set) stamps nothing and sends EVERYTHING, whatever
// state each copy is in: it exists to put the real batch in front of the
// professor, and filtering it would rehearse something other than the
// thing being rehearsed.
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

	// ONE query for the whole control, above the loop. The pre-#287 shape
	// asked AnnotatedByCopy per copy, which is a query per student on a
	// path that already makes one Gmail call each — the N+1 #271's review
	// removed from the course list, in the one place where it was hiding
	// behind a slower thing.
	annotated, err := s.Store.AnnotatedCopiesForControl(ctx, controlID)
	if err != nil {
		return PublishResult{}, fmt.Errorf("controls.Publish: read the corrected PDFs: %w", err)
	}

	if !rehearsal && control.PublishedAt == nil {
		// ONCE, on the first publication only. A resume finds the control
		// already stamped and leaves the date alone.
		//
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
		publication := CopyPublicationFor(control, reading, recipients, annotated)
		switch {
		case publication.State == CopySkipped:
			// Ordinary, not a failure: a class where two people missed the
			// control is a normal class. Since #287 the professor can see
			// WHICH copies and why, on the control page.
			result.Skipped++
			continue
		case !rehearsal && !publication.NeedsSending():
			// This student already holds the current correction. The whole
			// resume rule, in one branch.
			result.AlreadySent++
			continue
		}

		message, ok := s.messageFor(control, code, sender, req, recipients, annotated, reading)
		if !ok {
			// Deliverable on paper, and the corrected PDF is unreadable on
			// the volume — the one refusal CopyPublicationFor cannot see,
			// because it does not touch the filesystem.
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

		if rehearsal {
			// A rehearsal records nothing: it can be run as often as the
			// professor likes, and stamping would make the second one skip
			// the class it exists to show them.
			continue
		}
		// IMMEDIATELY after this copy's own send, with the grade that
		// actually went out. Everything the resume knows, it knows from
		// here.
		if err := s.Readings.MarkCopyPublished(ctx, reading.ID, s.Now(), publication.Grade); err != nil {
			// Logged and not returned: the message is already in the
			// student's mailbox and the other thirty-nine still have to go.
			// The cost of the lost stamp is one duplicate on the next run,
			// which is the smaller of the two failures — and the copy
			// NUMBER never the address (docs/security-notes.md §"Logs and
			// personal data").
			s.Log.Error("controls.Publish: could not record that the copy was sent",
				"control", controlID, "copy", reading.CopyNumber, "error", err)
		}
	}

	// NOTHING is written back after the loop. #273 recorded result.Sent
	// into control.published_sent here; since #287 that number is "how
	// many went out on THIS run", which a resume makes smaller than the
	// class, and the count a page wants is the stamped readings. The
	// column and its writer go in the slice that removes the last of its
	// readers.
	return result, nil
}

// CopyNotDeliverableError names WHICH of the three reasons stopped one
// copy, so the review page can say what to fix rather than "no se pudo".
//
// A typed error beside the sentinel, the AnalyzerRefusedError shape: the
// caller branches on errors.Is(err, ErrCopyNotDeliverable) and reads the
// Reason off the concrete value when it wants to be specific.
type CopyNotDeliverableError struct {
	CopyNumber int
	Reason     CopySkipReason
}

func (e *CopyNotDeliverableError) Error() string {
	return fmt.Sprintf("controls: copy %d cannot be published (%s)", e.CopyNumber, e.Reason)
}

func (e *CopyNotDeliverableError) Unwrap() error { return ErrCopyNotDeliverable }

// PublishOne sends ONE copy's correction, synchronously, whatever state
// that copy is in (issue #287).
//
// WHY SYNCHRONOUS, when Publish is a job. `apps/server/CLAUDE.md`'s rule is
// that the shape of the WORK decides, not who it talks to: async is for the
// loop nobody can wait on — forty Gmail calls plus forty PDFs off the
// shared volume against a 30 s write timeout. One Gmail call and one PDF is
// a bounded third-party call the professor waits on, the same shape as
// #271's Canvas lookups, and it is pressed from the review page where they
// have just finished re-correcting somebody and want to know it went.
//
// WHATEVER STATE: it does not consult NeedsSending. That is the whole point
// — it is the manual override for the case the staleness rule cannot see
// (§3), a re-annotation that moved the marks without moving the total. The
// professor knows whose marks they just fixed; the machine does not.
//
// It does NOT stamp the control. `control.published_at` means "this class
// was published", and one student receiving their correction is not that.
// A control that has only ever been written to one copy at a time shows no
// "Publicado el …" line, which is the truth.
func (s *Service) PublishOne(ctx context.Context, controlID string, copyNumber int, professorID int64) error {
	control, err := s.Store.ControlByID(ctx, controlID)
	if err != nil {
		return err
	}
	switch {
	case control.State != Graded:
		return fmt.Errorf("%w", ErrNotGraded)
	case control.CourseID == nil:
		return fmt.Errorf("%w", ErrNoCourse)
	case !s.Dispatcher.Delivers():
		return fmt.Errorf("%w", ErrCannotDeliver)
	}

	sender, err := s.Senders.SenderFor(ctx, professorID)
	if err != nil {
		return fmt.Errorf("controls.PublishOne: read the sender: %w", err)
	}
	if sender.GmailAddress == "" {
		return fmt.Errorf("%w", gmail.ErrNotConnected)
	}

	reading, err := s.Readings.ReadingByCopy(ctx, controlID, copyNumber)
	if err != nil {
		return err
	}
	code, recipients, err := s.Roster.CourseForPublication(ctx, *control.CourseID)
	if err != nil {
		return fmt.Errorf("controls.PublishOne: read the course: %w", err)
	}
	// One copy, so one lookup — not the whole control's map. The map shape
	// exists for the loops; building it here would read thirty rows to use
	// one.
	annotated := map[int]AnnotatedCopy{}
	if record, exists, err := s.Store.AnnotatedByCopy(ctx, controlID, copyNumber); err != nil {
		return fmt.Errorf("controls.PublishOne: read the corrected PDF: %w", err)
	} else if exists {
		annotated[copyNumber] = record
	}

	if _, _, reason, ok := deliverableCopy(control, reading, recipients, annotated); !ok {
		return &CopyNotDeliverableError{CopyNumber: copyNumber, Reason: reason}
	}

	message, ok := s.messageFor(control, code, sender, PublishRequest{
		ProfessorID: professorID,
		Mode:        PublishModeReal,
	}, recipients, annotated, reading)
	if !ok {
		// deliverableCopy said yes and the bytes are not there: the record
		// exists and the file on the volume does not.
		return &CopyNotDeliverableError{CopyNumber: copyNumber, Reason: SkipNoAnnotated}
	}

	if _, err := s.Dispatcher.Send(ctx, professorID, message); err != nil {
		// The copy NUMBER, never the address (docs/security-notes.md
		// §"Logs and personal data").
		s.Log.Error("controls.PublishOne: send failed",
			"control", controlID, "copy", copyNumber, "error", err)
		return err
	}

	// After the send, like the loop's — and here the professor is waiting,
	// so a stamp that fails is worth returning rather than logging: they
	// would otherwise be told it went, and the next Publicar would send it
	// again.
	publication := CopyPublicationFor(control, reading, recipients, annotated)
	if err := s.Readings.MarkCopyPublished(ctx, reading.ID, s.Now(), publication.Grade); err != nil {
		return fmt.Errorf("controls.PublishOne: record that the copy was sent: %w", err)
	}
	return nil
}

// messageFor assembles one copy's message, or reports that there is
// nothing to send.
//
// It does not decide WHETHER there is: deliverableCopy does, and
// CopyPublicationFor asks the same function to render the state on the
// page. That is the whole point of the split — a screen that offered
// "Enviar" for a copy this loop skips, or a loop that skipped one the
// screen called ready, would be two answers to one question, which is the
// shape #251's cannot-disagree rule refuses.
//
// The three skip reasons are all ORDINARY — a class where two people missed
// the control and one has no RUT on file is a normal class — so they are
// counted rather than reported as failures. Folding them into Failures
// would tell the professor about a problem they do not have, and the review
// page is already where an unmatched copy is looked at.
func (s *Service) messageFor(
	control Control, code string, sender Sender, req PublishRequest,
	recipients map[int64]Recipient, annotated map[int]AnnotatedCopy, reading Reading,
) (Message, bool) {
	recipient, grade, _, ok := deliverableCopy(control, reading, recipients, annotated)
	if !ok {
		return Message{}, false
	}
	attachment, ok := s.attachmentFor(annotated[reading.CopyNumber])
	if !ok {
		return Message{}, false
	}

	message := BuildMessage(MessageInput{
		CourseCode:     code,
		ControlName:    control.Name,
		Grade:          grade,
		StudentName:    recipient.FullName(),
		StudentEmail:   recipient.Email,
		ProfessorName:  sender.Name,
		ProfessorEmail: sender.Email,
		FromAddress:    sender.GmailAddress,
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

// attachmentFor reads one copy's corrected PDF off the shared volume.
//
// The RECORD's existence is deliverableCopy's question; this one is whether
// the bytes are actually there. A file that is gone or empty means the copy
// is SKIPPED rather than sent without its attachment: the attachment is the
// thing the email exists to deliver, and a message saying "adjunto la
// corrección" with nothing attached is worse than no message, because the
// student now has to ask.
func (s *Service) attachmentFor(record AnnotatedCopy) (Attachment, bool) {
	content, err := os.ReadFile(filepath.Join(s.WorkDir, record.Path))
	if err != nil || len(content) == 0 {
		s.Log.Warn("controls.Publish: the annotated PDF is unreadable",
			"control", record.ControlID, "copy", record.CopyNumber, "error", err)
		return Attachment{}, false
	}
	return Attachment{
		// Spanish, like everything the reader perceives — this is a
		// filename in a student's downloads folder.
		Filename:    fmt.Sprintf("correccion-copia-%d.pdf", record.CopyNumber),
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
