package controls_test

import (
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls"
)

func messageInput() controls.MessageInput {
	return controls.MessageInput{
		CourseCode:     "CIT2006-03",
		ControlName:    "Control 2",
		Grade:          "5.7",
		StudentName:    "María",
		StudentEmail:   "maria.gonzalez@udp.cl",
		ProfessorName:  "Miguel Rodríguez",
		ProfessorEmail: "miguel@udp.cl",
		FromAddress:    "miguel.personal@gmail.com",
		ControlID:      "CTRL0000000000000000000001",
		CopyNumber:     7,
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
func TestTheRenderedMessageIsExactlyThis(t *testing.T) {
	msg := controls.BuildMessage(messageInput())

	const wantSubject = "[CIT2006-03] Corrección Control 2 — nota 5,7"
	if msg.Subject != wantSubject {
		t.Errorf("subject:\n got %q\nwant %q", msg.Subject, wantSubject)
	}

	const wantBody = `Hola María,

Adjunto la corrección del Control 2. Tu nota es 5,7.

Saludos,
Miguel Rodríguez

---
Esto se armó solo: el profesor únicamente apretó un botón.
Este mensaje fue generado automáticamente por la IA que trabaja para Miguel Rodríguez.
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

// "Hola ," is the shape of a bug reaching a person. A roster that holds no
// given name is ordinary — Canvas does not promise one.
func TestAStudentWithNoNameIsGreetedWithoutADanglingComma(t *testing.T) {
	in := messageInput()
	in.StudentName = "   "

	body := controls.BuildMessage(in).Text
	if !strings.HasPrefix(body, "Hola,\n") {
		t.Errorf("the greeting is %q, want a nameless one rather than a dangling space",
			strings.SplitN(body, "\n", 2)[0])
	}
}

// Determinism is what stops "did you send me a different correction?" when
// a professor republishes after fixing one grade.
func TestTheFooterIsStableForACopyAndSpreadAcrossAClass(t *testing.T) {
	in := messageInput()

	first := controls.BuildMessage(in).Text
	second := controls.BuildMessage(in).Text
	if first != second {
		t.Error("two renders of the same copy produced different footers")
	}

	// And across a class it is not one line forty times. Forty copies of a
	// twelve-joke pool must land on most of it; a hash that collapsed
	// would pass every case above and send everybody the same footer.
	seen := map[string]bool{}
	for copyNumber := 1; copyNumber <= 40; copyNumber++ {
		in.CopyNumber = copyNumber
		body := controls.BuildMessage(in).Text
		footer := strings.Split(body, "---\n")[1]
		seen[strings.SplitN(footer, "\n", 2)[0]] = true
	}
	if len(seen) < 8 {
		t.Errorf("forty copies drew only %d distinct footers from a pool of twelve; the seed "+
			"is not spreading", len(seen))
	}
}

// The footer talks about the machine. A joke about the student, or about
// their grade, lands on somebody who has just opened a 2,1 — and there is
// no version of that which is better than no joke.
func TestNoJokeMentionsTheStudentOrTheirGrade(t *testing.T) {
	in := messageInput()

	for copyNumber := 1; copyNumber <= 200; copyNumber++ {
		in.CopyNumber = copyNumber
		body := controls.BuildMessage(in).Text
		footer := strings.SplitN(strings.Split(body, "---\n")[1], "\n", 2)[0]

		for _, forbidden := range []string{"María", "5,7", "nota baja", "reprob", "estudias"} {
			if strings.Contains(footer, forbidden) {
				t.Errorf("the footer %q mentions %q", footer, forbidden)
			}
		}
	}
}

// Every message must carry the disclosure. It is the point of the footer
// block — a student receiving a grade has a right to know a machine wrote
// the covering note.
func TestEveryMessageDisclosesThatAMachineSentIt(t *testing.T) {
	in := messageInput()

	for copyNumber := 1; copyNumber <= 40; copyNumber++ {
		in.CopyNumber = copyNumber
		body := controls.BuildMessage(in).Text
		if !strings.Contains(body, "generado automáticamente") {
			t.Fatalf("copy %d carries no disclosure:\n%s", copyNumber, body)
		}
		if !strings.Contains(body, in.ProfessorName) {
			t.Fatalf("copy %d does not name the professor it was sent for", copyNumber)
		}
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
