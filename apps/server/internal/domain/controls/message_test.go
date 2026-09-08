package controls_test

import (
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

// The fixture's name is written the way the roster actually holds it —
// CAPITALS, accents and all four words — because that is what Canvas
// hands this course for all 25 of its rows. A fixture spelled "María"
// would let the whole formatter be deleted with the suite still green.
func messageInput() controls.MessageInput {
	return controls.MessageInput{
		CourseCode:     "CIT2006-03",
		ControlName:    "Control 2",
		Grade:          "5.7",
		StudentName:    "MARÍA PAZ SOTO VERA",
		StudentEmail:   "maria.gonzalez@udp.cl",
		ProfessorName:  "Miguel Rodríguez",
		ProfessorEmail: "miguel@udp.cl",
		FromAddress:    "miguel.personal@gmail.com",
		Attachment: controls.Attachment{
			Filename:    "correccion-control-2.pdf",
			ContentType: "application/pdf",
			Content:     []byte("%PDF"),
		},
	}
}

// The golden case. A message is the one artefact of this whole WP a person
// outside the project reads, and it is read by somebody who has just been
// given a grade — so every line of it is pinned verbatim rather than
// sampled with Contains. A substring assertion passes over a stray blank
// line, a doubled greeting, or a signature that lost its name.
//
// It is also what pins the two things Miguel changed after the first live
// send: the greeting carries the WHOLE name, and the footer — a rotating
// joke plus two lines disclosing that a machine wrote the note — is gone.
// Re-adding either reddens exactly here.
func TestTheRenderedMessageIsExactlyThis(t *testing.T) {
	msg := controls.BuildMessage(messageInput())

	const wantSubject = "[CIT2006-03] Corrección Control 2 — nota 5,7"
	if msg.Subject != wantSubject {
		t.Errorf("subject:\n got %q\nwant %q", msg.Subject, wantSubject)
	}

	const wantBody = `Hola María Paz Soto Vera,

Adjunto la corrección del Control 2. Tu nota es 5,7.

Si necesitas alguna corrección, responde este mismo correo.

Saludos,
Miguel Rodríguez
`
	if msg.Text != wantBody {
		t.Errorf("body:\n--- got ---\n%s\n--- want ---\n%s", msg.Text, wantBody)
	}
}

func TestTheMessageCarriesTheThreeAddressesApart(t *testing.T) {
	in := messageInput()
	msg := controls.BuildMessage(in)

	if msg.From != in.FromAddress {
		t.Errorf("From = %q, want the CONNECTED account", msg.From)
	}
	if msg.To != in.StudentEmail {
		t.Errorf("To = %q, want the student", msg.To)
	}
	if msg.ProfessorEmail != in.ProfessorEmail {
		t.Errorf("ProfessorEmail = %q, want where a staging run redirects", msg.ProfessorEmail)
	}
	// The three are allowed to be three different addresses, and the
	// builder must not collapse any pair: the professor logs in with one,
	// may have connected another, and students reply to the From.
	if msg.From == msg.ProfessorEmail {
		t.Error("the fixture stopped exercising the case where the connected account differs " +
			"from the login address; that difference is the one this WP is built to allow")
	}
}

// A grade is written 5,7 in Chile and 5.7 nowhere a student reads. The
// swap happens at the text, never at the arithmetic — FormatGrade stays a
// Go float formatter.
func TestTheGradeIsWrittenWithAComma(t *testing.T) {
	msg := controls.BuildMessage(messageInput())

	if strings.Contains(msg.Subject, "5.7") || strings.Contains(msg.Text, "5.7") {
		t.Error("the message shows a decimal point where a Chilean student reads a comma")
	}
	if !strings.Contains(msg.Subject, "5,7") || !strings.Contains(msg.Text, "5,7") {
		t.Errorf("the grade is missing from subject %q or body %q", msg.Subject, msg.Text)
	}
}

// The formatter, through the only door it has. Every case here is one a
// naive implementation gets wrong, and the first two are the live roster:
// 25 rows in CAPITALS, 15 of them carrying an accent or an ñ.
//
// The greeting is asserted whole rather than by Contains — "Hola" plus a
// substring passes over a lost surname, which is the exact defect this
// change exists to fix.
func TestTheGreetingWritesTheWholeNameTheWayAPersonWritesIt(t *testing.T) {
	for _, tc := range []struct {
		name  string
		given string
		want  string
	}{
		{"the roster's own shape: capitals, two given names, two surnames",
			"BENJAMIN MATIAS PEREZ GONZALEZ", "Hola Benjamin Matias Perez Gonzalez,"},
		{"accents and an ene survive the case change",
			"JOSÉ IGNACIO MUÑOZ ÑANCO", "Hola José Ignacio Muñoz Ñanco,"},
		{"three given names, which the live roster's longest row carries",
			"MARIA JOSE DEL PILAR SOTO", "Hola Maria Jose del Pilar Soto,"},
		{"a name already written properly is left alone",
			"María Paz Soto Vera", "Hola María Paz Soto Vera,"},
		{"a lower-case source is raised, not just left",
			"ana soto vera", "Hola Ana Soto Vera,"},
		{"the particles of a surname stay lower case",
			"ANA DE LA FUENTE ROJAS", "Hola Ana de la Fuente Rojas,"},
		{"a particle in FIRST position is a given name and is capitalised",
			"DE LA FUENTE", "Hola De la Fuente,"},
		{"a hyphen and an apostrophe are word boundaries, not letters",
			"JEAN-PAUL O'HIGGINS", "Hola Jean-Paul O'Higgins,"},
		{"padding and doubled spaces collapse",
			"   ANA    SOTO   ", "Hola Ana Soto,"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := messageInput()
			in.StudentName = tc.given

			got := strings.SplitN(controls.BuildMessage(in).Text, "\n", 2)[0]
			if got != tc.want {
				t.Errorf("greeting:\n got %q\nwant %q", got, tc.want)
			}
		})
	}
}

// "Hola ," is the shape of a bug reaching a person. A roster that holds no
// name is ordinary — Canvas does not promise one, and 00014_roster.sql
// defaults both name columns to the empty string.
func TestAStudentWithNoNameIsGreetedWithoutADanglingComma(t *testing.T) {
	in := messageInput()
	in.StudentName = "   "

	body := controls.BuildMessage(in).Text
	if !strings.HasPrefix(body, "Hola,\n") {
		t.Errorf("the greeting is %q, want a nameless one rather than a dangling space",
			strings.SplitN(body, "\n", 2)[0])
	}
}

// The whole name is the point of the change, so the halves are asserted
// against a Recipient rather than against a string the test composed: the
// store fills both columns, and a FullName that dropped one would greet
// twenty-five students by half their name with every other case green.
func TestARecipientsFullNameCarriesBothColumnsAndNeitherAlone(t *testing.T) {
	for _, tc := range []struct {
		name string
		r    controls.Recipient
		want string
	}{
		{"both halves", controls.Recipient{FirstName: "ANA", LastName: "SOTO VERA"}, "ANA SOTO VERA"},
		{"no surname on file", controls.Recipient{FirstName: "ANA"}, "ANA"},
		{"no given name on file", controls.Recipient{LastName: "SOTO VERA"}, "SOTO VERA"},
		{"neither", controls.Recipient{}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.r.FullName(); got != tc.want {
				t.Errorf("FullName() = %q, want %q", got, tc.want)
			}
		})
	}
}

// The invitation to reply is only TRUE because the message goes out as the
// professor's own account (ADR-0072 §1). It is asserted separately from
// the golden body because it is the one line whose correctness depends on
// the transport rather than on the template.
func TestTheStudentIsToldToReplyToTheMessageItself(t *testing.T) {
	msg := controls.BuildMessage(messageInput())

	if !strings.Contains(msg.Text, "responde este mismo correo") {
		t.Errorf("the body offers the student no way back:\n%s", msg.Text)
	}
	if msg.From != "miguel.personal@gmail.com" {
		t.Errorf("From = %q; the reply invitation is a lie unless the message is the "+
			"professor's own", msg.From)
	}
}

func TestTheAttachmentTravelsUntouched(t *testing.T) {
	in := messageInput()
	msg := controls.BuildMessage(in)

	if msg.Attachment.Filename != in.Attachment.Filename {
		t.Errorf("filename = %q", msg.Attachment.Filename)
	}
	if string(msg.Attachment.Content) != string(in.Attachment.Content) {
		t.Error("the builder altered the attachment")
	}
}
