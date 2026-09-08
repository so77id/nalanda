package controls

import "time"

// One copy's publication state (issue #287).
//
// #273 recorded a publication as one fact about a control: when it ran, in
// which mode, and how many messages went out. Not who. This file is the
// per-copy answer, and every state in it is DERIVED — from the two columns
// migration 00019 added, the roster, the grade the copy currently has, and
// whether an annotated PDF exists for it.
//
// Derived rather than stored, deliberately. A fifth column holding the
// state would have to be invalidated on every re-read, every re-annotation,
// every override and every roster import, and would be wrong for the whole
// window between the change and the invalidation. The comparison costs one
// string equality and cannot go stale.

// CopyPublicationState is what a professor is told about one copy.
type CopyPublicationState string

const (
	// CopyNotSent is a deliverable copy no publication has written to.
	// Offers "Enviar".
	CopyNotSent CopyPublicationState = "not_sent"
	// CopySent is a copy whose student holds the current correction.
	// Offers nothing: there is nothing to do about it.
	CopySent CopyPublicationState = "sent"
	// CopyStale is a copy that went out and whose grade has moved since —
	// the state a re-correction after a publication produces. Offers
	// "Reenviar", and the next Publicar picks it up on its own.
	CopyStale CopyPublicationState = "stale"
	// CopySkipped is a copy there is nothing to send about at all, with
	// SkipReason naming which of the three shapes it is. ORDINARY, not a
	// failure: a class where two people missed the control is a normal
	// class (apps/server/CLAUDE.md, "a publication skips; it does not
	// fail").
	CopySkipped CopyPublicationState = "skipped"
)

// CopySkipReason names why a copy cannot be published.
//
// A typed value rather than a Spanish sentence, so the wording lives on the
// surface that renders it (handler.copyPublicationWord) and the domain
// keeps one fact per value. The three are exhaustive against
// deliverableCopy, which is the only function that produces them.
type CopySkipReason string

const (
	// SkipNoStudent covers all three ways a copy has nobody to write to:
	// the RUT matched nobody, the person it matched is no longer enrolled,
	// or the roster carries no address for them. One reason because the
	// professor's next move is the same for all three — look at the copy
	// on the review page — and three would ask them to distinguish states
	// they cannot act on differently.
	SkipNoStudent CopySkipReason = "no_student"
	// SkipNoGrade is a copy whose grade is genuinely unknown: never handed
	// in, an unreadable RUT nobody overrode, doubtful answers nobody
	// resolved. Mailing "tu nota es —" would be worse than mailing
	// nothing.
	SkipNoGrade CopySkipReason = "no_grade"
	// SkipNoAnnotated is a copy with no corrected PDF on record. The
	// attachment is the thing the message exists to deliver: "adjunto la
	// corrección" with nothing attached is worse than no message, because
	// the student now has to ask.
	SkipNoAnnotated CopySkipReason = "no_annotated"
)

// CopyPublication is one copy's derived publication state, with everything
// a screen or a publication loop needs to act on it.
type CopyPublication struct {
	CopyNumber int
	State      CopyPublicationState
	// SkipReason is set only when State is CopySkipped.
	SkipReason CopySkipReason
	// Grade is what this copy would be mailed NOW, empty when it has none
	// (a skipped copy, or one sent before it stopped being deliverable).
	// It is FormatGrade's output, which is what actually travels in the
	// message — the same string published_grade holds, so the two can be
	// compared without either side re-deriving the number (ADR-0031).
	Grade string
	// SentGrade is what the student is holding: the grade that went out,
	// empty for a copy that never did. On a CopyStale it differs from
	// Grade, and both are worth showing — "salió con un 4,0 y ahora tiene
	// un 5,7" is the sentence the professor needs.
	SentGrade string
	// PublishedAt is when this copy's own message went out, nil when it
	// never did.
	PublishedAt *time.Time
}

// NeedsSending reports whether a publication should write to this copy.
//
// The resume rule, in one place: send what has not gone out and what has
// gone out with a grade that has since moved; skip the rest. Service.Publish
// is its only caller today, and it lives beside the states rather than
// inside the loop so the page and the loop cannot disagree about which
// copies a second Publicar would write to.
func (p CopyPublication) NeedsSending() bool {
	return p.State == CopyNotSent || p.State == CopyStale
}

// CopyPublicationFor derives one copy's state.
//
// `annotated` is the control's corrected-PDF records by copy number — one
// map for the whole control rather than a lookup per copy, because the
// copies table derives thirty of these for one page render and the
// publication loop derives forty for one run. A per-row query is the N+1
// that #271's review already removed once from the course list. Only its
// KEYS matter here; the path is what Service.messageFor reads the file
// from.
//
// THE ORDER OF THE TWO QUESTIONS IS THE CONTRACT. Deliverability is asked
// FIRST, but only decides the answer for a copy that was never sent. A copy
// that WAS sent and has since stopped being deliverable — the student
// withdrew, an override turned their grade into a dash — stays "enviado":
// none of that un-sends the mail they are holding, and reporting it as
// skipped would tell the professor nobody wrote to somebody who has the
// correction in their inbox.
func CopyPublicationFor(c Control, r Reading, recipients map[int64]Recipient, annotated map[int]AnnotatedCopy) CopyPublication {
	out := CopyPublication{
		CopyNumber:  r.CopyNumber,
		SentGrade:   r.PublishedGrade,
		PublishedAt: r.PublishedAt,
	}

	_, grade, reason, deliverable := deliverableCopy(c, r, recipients, annotated)
	if deliverable {
		out.Grade = grade
	}

	switch {
	case !deliverable && r.PublishedAt == nil:
		out.State = CopySkipped
		out.SkipReason = reason
	case r.PublishedAt == nil:
		out.State = CopyNotSent
	case deliverable && r.PublishedGrade != grade:
		out.State = CopyStale
	default:
		// Sent, and either the grade still agrees or there is no current
		// grade to disagree with.
		out.State = CopySent
	}
	return out
}

// deliverableCopy answers "can this copy be mailed, and with what grade".
//
// THE single decision. Both readers of it — CopyPublicationFor, which
// renders the state, and Service.messageFor, which builds the message —
// go through here, so a screen can never offer a button for a copy the
// publication would skip, nor skip one the screen says is ready. The two
// were one function's worth of `if`s duplicated across two layers in the
// first draft of this WP, which is exactly the shape #251's
// cannot-disagree rule exists to refuse.
//
// The four checks are ordered by what the professor would fix first: no
// recipient (a roster or a RUT problem, fixed on the review page), then no
// grade (a correction problem), then no PDF (a re-annotation). Reporting
// the innermost failure of a copy that fails several would send them to the
// wrong screen.
func deliverableCopy(c Control, r Reading, recipients map[int64]Recipient, annotated map[int]AnnotatedCopy) (Recipient, string, CopySkipReason, bool) {
	if r.StudentID == nil {
		return Recipient{}, "", SkipNoStudent, false
	}
	recipient, enrolled := recipients[*r.StudentID]
	if !enrolled || recipient.Email == "" {
		return Recipient{}, "", SkipNoStudent, false
	}
	// GradeFor, which is the SAME function the readings table renders
	// through — not a second spelling of it. ok=false is a copy whose grade
	// is genuinely unknown: doubtful answers nobody resolved, an unreadable
	// RUT, a copy never handed in. Mailing "tu nota es —" would be worse
	// than mailing nothing.
	grade, ok := GradeFor(c.QuestionsPerCopy, r)
	if !ok {
		return Recipient{}, "", SkipNoGrade, false
	}
	if _, exists := annotated[r.CopyNumber]; !exists {
		return Recipient{}, "", SkipNoAnnotated, false
	}
	return recipient, grade, "", true
}
