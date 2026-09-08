package controls

import (
	"fmt"
	"strings"
	"unicode"
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
	// StudentName is the student's WHOLE name — given names and both
	// surnames, exactly as the roster holds them, casing included. The
	// greeting is presentation and belongs to the builder (see
	// formatStudentName), so the caller passes the row through rather
	// than deciding what a person is called. Empty falls back to a
	// nameless greeting rather than "Hola ,".
	StudentName  string
	StudentEmail string
	// ProfessorName signs the message; ProfessorEmail is where a staging
	// run redirects it. FromAddress is the CONNECTED account, which the
	// professor is allowed to make different from either.
	ProfessorName  string
	ProfessorEmail string
	FromAddress    string
	Attachment     Attachment
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
//
// Four short blocks and nothing else. The message had a rotating footer —
// a joke drawn from a twelve-line pool, plus two lines disclosing that a
// machine had written it — and Miguel removed both after the first live
// send (2026-09-07): a student opening their grade wants the grade and a
// way to answer back, and the covering note is his whether a program
// typed it or he did.
func buildBody(in MessageInput) string {
	var b strings.Builder

	fmt.Fprintf(&b, "Hola%s,\n\n", greetingName(in.StudentName))
	fmt.Fprintf(&b, "Adjunto la corrección del %s. Tu nota es %s.\n\n",
		in.ControlName, spanishDecimal(in.Grade))
	// The reply invitation is only TRUE because of ADR-0072 §1: the
	// message goes out as the professor's own Gmail account, so a reply
	// lands in their inbox with no Reply-To trick and no shared mailbox
	// to watch. A transactional sender would make this line a lie.
	b.WriteString("Si necesitas alguna corrección, responde este mismo correo.\n\n")
	b.WriteString("Saludos,\n")
	fmt.Fprintf(&b, "%s\n", in.ProfessorName)

	return b.String()
}

// greetingName returns " María Paz Soto Vera" or "", so a student the
// roster holds no name for is greeted "Hola," rather than "Hola ,".
func greetingName(name string) string {
	formatted := formatStudentName(name)
	if formatted == "" {
		return ""
	}
	return " " + formatted
}

// formatStudentName renders a roster name the way a person writes it.
//
// Canvas hands this roster names in CAPITALS — on 2026-09-07 all 25 rows
// of the live course, given names and surnames alike — and "Hola BENJAMIN
// MATIAS PEREZ GONZALEZ," reads as shouting at somebody who has just been
// handed a grade. The fix belongs HERE and not in the import: the roster
// screens show what Canvas holds, and rewriting the stored row would make
// the two disagree about the same person.
//
// Hand-written rather than borrowed. strings.Title is deprecated for
// exactly this use, and golang.org/x/text/cases would be a new dependency
// (root CLAUDE.md). unicode.ToUpper / ToLower already carry the accented
// Latin letters this roster actually holds — 15 of those 25 rows — so the
// whole operation is a rune walk over the standard library.
//
// What it deliberately does NOT do: preserve a capital INSIDE a word.
// "McDonald" comes back "Mcdonald". Trusting the source's case instead
// would send the CAPITALS through untouched for all 25, which is the
// louder mistake.
func formatStudentName(name string) string {
	var out strings.Builder
	for i, word := range strings.Fields(name) {
		if i > 0 {
			out.WriteByte(' ')
			if particles[strings.ToLower(word)] {
				out.WriteString(strings.ToLower(word))
				continue
			}
		}
		out.WriteString(capitalizeWord(word))
	}
	return out.String()
}

// particles are the connectors a Spanish surname keeps lower case when
// they are not the first word: "Ana de la Fuente", never "Ana De La
// Fuente". Never applied to the FIRST word, which is a given name
// whatever it is spelled like.
//
// No row of the live roster carries one today. They are here because the
// next import will, and because a mangled surname is the first thing its
// owner notices.
var particles = map[string]bool{
	"de": true, "del": true, "la": true, "las": true, "los": true,
	"y": true, "da": true, "das": true, "do": true, "dos": true,
}

// capitalizeWord uppercases the first letter of every letter RUN, so the
// separators inside a name survive it: JEAN-PAUL becomes Jean-Paul and
// O'HIGGINS becomes O'Higgins. Capitalising only rune zero would give
// "Jean-paul", which is a different mistake rather than a smaller one.
func capitalizeWord(word string) string {
	out := make([]rune, 0, len(word))
	atStart := true
	for _, r := range word {
		switch {
		case !unicode.IsLetter(r):
			atStart = true
			out = append(out, r)
		case atStart:
			atStart = false
			out = append(out, unicode.ToUpper(r))
		default:
			out = append(out, unicode.ToLower(r))
		}
	}
	return string(out)
}

// spanishDecimal turns Go's 5.7 into the 5,7 a Chilean student reads.
//
// Applied at the text, never at the number: the arithmetic stays in
// FormatGrade, and a comma introduced any earlier would have to be parsed
// back out by anything that wanted to compute with it.
func spanishDecimal(grade string) string {
	return strings.ReplaceAll(grade, ".", ",")
}
