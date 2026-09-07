package controls

import (
	"fmt"
	"hash/fnv"
	"strings"
)

// The message a student receives (issue #273). Spanish, like everything a
// person reads (root CLAUDE.md §Language); plaintext, because v1 sends no
// HTML alternative and a student reading this on a phone in a corridor
// gains nothing from one.

// MessageInput is everything building one message needs, already resolved.
//
// A value rather than a pile of lookups: the builder does no I/O, so the
// golden test below is a pure comparison and the publish job is the only
// place that knows how to find a course code or a student's name. The two
// concerns drifted apart in the first sketch, where the builder took a
// Reading and grew a store.
type MessageInput struct {
	// CourseCode is what goes in the subject's bracket — "CIT2006-03".
	CourseCode string
	// ControlName is the professor's own name for it — "Control 2".
	ControlName string
	// Grade is the already-formatted 1,0–7,0 grade. A STRING, not a float,
	// because FormatGrade is the single source of that arithmetic
	// (ADR-0031, issue #251's cannot-disagree rule) and a second
	// formatting here would be a second place for it to round differently.
	Grade string
	// StudentName is the given name — the message greets a person, not a
	// row. Empty falls back to a nameless greeting rather than "Hola ,".
	StudentName  string
	StudentEmail string
	// ProfessorName signs the message; ProfessorEmail is where a staging
	// run redirects it. FromAddress is the CONNECTED account, which the
	// professor is allowed to make different from either.
	ProfessorName  string
	ProfessorEmail string
	FromAddress    string
	// ControlID and CopyNumber seed the footer. See pickJoke.
	ControlID  string
	CopyNumber int
	Attachment Attachment
}

// BuildMessage renders one student's email.
func BuildMessage(in MessageInput) Message {
	return Message{
		From:           in.FromAddress,
		To:             in.StudentEmail,
		ProfessorEmail: in.ProfessorEmail,
		Subject:        buildSubject(in),
		Text:           buildBody(in),
		Attachment:     in.Attachment,
	}
}

// buildSubject renders `[CIT2006-03] Corrección Control 2 — nota 5,7`.
//
// The bracketed code leads because that is what a student filters on when
// four courses are mailing them, and the grade closes because it is the one
// thing they want before opening anything.
//
// The em dash and the decimal COMMA are Chilean-Spanish typography, not
// decoration: a grade is written 5,7 here and 5.7 nowhere a student reads.
// FormatGrade renders a point (it is a Go float formatter), so the swap
// happens at the last possible moment — in the text a person sees, never in
// the arithmetic.
func buildSubject(in MessageInput) string {
	return fmt.Sprintf("[%s] Corrección %s — nota %s",
		in.CourseCode, in.ControlName, spanishDecimal(in.Grade))
}

// buildBody renders the plaintext.
func buildBody(in MessageInput) string {
	var b strings.Builder

	fmt.Fprintf(&b, "Hola%s,\n\n", greetingName(in.StudentName))
	fmt.Fprintf(&b, "Adjunto la corrección del %s. Tu nota es %s.\n\n",
		in.ControlName, spanishDecimal(in.Grade))
	b.WriteString("Saludos,\n")
	fmt.Fprintf(&b, "%s\n\n", in.ProfessorName)
	b.WriteString("---\n")
	fmt.Fprintf(&b, "%s\n", pickJoke(in.ControlID, in.CopyNumber))
	fmt.Fprintf(&b,
		"Este mensaje fue generado automáticamente por la IA que trabaja para %s.\n",
		in.ProfessorName)

	return b.String()
}

// greetingName returns " María" or "", so a student the roster holds no
// given name for is greeted "Hola," rather than "Hola ,".
func greetingName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	return " " + name
}

// spanishDecimal turns Go's 5.7 into the 5,7 a Chilean student reads.
//
// Applied at the text, never at the number: the arithmetic stays in
// FormatGrade, and a comma introduced any earlier would have to be parsed
// back out by anything that wanted to compute with it.
func spanishDecimal(grade string) string {
	return strings.ReplaceAll(grade, ".", ",")
}

// jokes is the rotating footer. Spanish, one line each, self-aware about
// the machine that sent the message and never about the student or their
// grade — the reader may have just opened a 2,1, and a joke that lands
// badly there is worse than no joke at all.
//
// Extending the pool is a two-line change. Removing or REORDERING one is
// not free: pickJoke maps a copy onto an index, so a student who re-reads
// an old email would find a different joke under the same message. That
// costs nothing to anybody, but the surprise is worth one sentence here
// rather than a puzzled question later.
var jokes = []string{
	"La IA redactó esto mientras el profesor tomaba café.",
	"Ningún profesor fue molestado durante el envío de este correo.",
	"Esto se armó solo: el profesor únicamente apretó un botón.",
	"La corrección la hizo una máquina; la responsabilidad sigue siendo del profesor.",
	"Escrito por una IA que nunca ha rendido un control.",
	"Enviado automáticamente, revisado humanamente. En ese orden.",
	"Una IA leyó tu hoja y prometió no comentarla con nadie.",
	"Este correo se envió sin intervención humana. El control no.",
	"La máquina cuenta las respuestas; el profesor decide qué significan.",
	"Generado por una IA con estricta política de no opinar sobre notas.",
	"Ninguna hoja fue dañada en la elaboración de esta corrección.",
	"Automático de punta a punta, salvo la parte difícil.",
}

// pickJoke chooses deterministically from (control, copy).
//
// DETERMINISTIC, not random, and the reason is a support conversation
// nobody wants to have: a professor re-runs a publication after fixing one
// student's grade, and the student compares the two emails. With a random
// pick the footer changes, which invites "did you send me a different
// correction?" about a message whose only difference is a joke. Seeding on
// the copy also spreads the pool across a class rather than sending forty
// people the same line.
//
// FNV-1a rather than a cryptographic hash: this picks a joke. It needs to
// be stable across processes and architectures, which a Go map iteration or
// a pointer would not be, and nothing more.
func pickJoke(controlID string, copyNumber int) string {
	h := fnv.New32a()
	_, _ = fmt.Fprintf(h, "%s|%d", controlID, copyNumber)
	return jokes[int(h.Sum32()%uint32(len(jokes)))]
}
